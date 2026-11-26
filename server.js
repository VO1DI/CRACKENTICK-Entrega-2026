require('dotenv').config();

const app = require('./app');
const systemBackupService = require('./services/systemBackupService');
const trafficDailyService = require('./services/trafficDailyService');
const hotspotService = require('./services/hotspotService');
const { conectarDB, desconectarDB } = require('./config/db');
const backgroundLeader = require('./utils/backgroundLeader');
const monitoringService = require('./services/monitoringService');
const payrollService = require('./services/payrollService');
const exchangeRateService = require('./services/exchangeRateService');
const settingsCache = require('./services/settingsCache');
const counterService = require('./services/counterService');
const taskTypeService = require('./services/taskTypeService');
const User = require('./models/User');
const InstallationReport = require('./models/InstallationReport');
const { ADMIN_PRINCIPAL } = require('./config/constants');

const PUERTO = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

/**
 * Bases creadas antes del alta manual de instalaciones conservan un índice
 * único no parcial en saleId; los reportes manuales usan saleId null. Se
 * reemplaza al arrancar para que no fallen con duplicate key.
 */
async function asegurarIndicesInstalaciones() {
  try {
    const coleccion = InstallationReport.collection;
    const indices = await coleccion.indexes().catch(() => []);
    const viejo = indices.find((indice) => indice.name === 'saleId_1');
    if (viejo && !viejo.partialFilterExpression) {
      await coleccion.dropIndex('saleId_1');
    }
    await coleccion
      .createIndex(
        { saleId: 1 },
        { unique: true, partialFilterExpression: { saleId: { $type: 'objectId' } } }
      )
      .catch((error) => {
        if (error.code !== 85 && error.code !== 86) throw error;
      });
  } catch (error) {
    console.error('No se pudo ajustar el índice de instalaciones:', error.message);
  }
}

/**
 * En producción no se arranca con secretos de ejemplo ni con la clave del
 * administrador de demostración.
 */
function validarSecretos() {
  if (!String(process.env.ENCRYPTION_KEY || '').trim()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY no está configurado. Genera una clave de 64 caracteres hexadecimales antes de arrancar; sin ella los secretos no sobreviven a un reinicio.');
    }
    console.warn('⚠️  ENCRYPTION_KEY no configurado; se usa la clave de desarrollo. Configúrala antes de guardar credenciales reales.');
  }
  if (process.env.NODE_ENV !== 'production') return;
  const sesion = String(process.env.SESSION_SECRET || '').trim();
  if (!sesion || sesion === 'genera-una-cadena-larga-y-aleatoria' || sesion === 'cambia-esta-clave-en-produccion') {
    throw new Error('SESSION_SECRET no está configurado. Genera una cadena aleatoria antes de arrancar en producción.');
  }
}

async function asegurarAdminSeguro() {
  if (process.env.NODE_ENV !== 'production') return;
  const admin = await User.findOne({ username: ADMIN_PRINCIPAL.username }).select('+passwordHash');
  if (admin && admin.verificarPassword('admin123')) {
    throw new Error('El administrador principal sigue usando admin123. Cambia la contraseña antes de arrancar en producción.');
  }
}

async function iniciar() {
  try {
    validarSecretos();
    await conectarDB();
    const configuracionInicial = await settingsCache.obtener();
    if (configuracionInicial?.billing?.timezone) {
      process.env.TZ = configuracionInicial.billing.timezone;
    }
    await User.sincronizarAdminPrincipal();
    await asegurarAdminSeguro();
    await asegurarIndicesInstalaciones();
    await counterService.asegurarContadores();
    await taskTypeService.asegurarTipos();

    const servidor = app.listen(PUERTO, HOST, () => {
      console.log('──────────────────────────────────────────────');
      console.log(`🚀 CRACKENTICK en http://localhost:${PUERTO}`);
      console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log('   Dashboard: http://localhost:' + PUERTO + '/');
      console.log('   Pulsa Ctrl+C para detener el servidor.');
      console.log('──────────────────────────────────────────────');
    });

    /* listen() informa sus fallos de forma asíncrona: sin esto, EADDRINUSE
       termina el proceso con una traza en lugar de un mensaje claro. */
    servidor.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ El puerto ${PUERTO} ya está en uso. Cierra la otra instancia o cambia PORT en .env.`);
      } else {
        console.error(`❌ No se pudo abrir el servidor en ${HOST}:${PUERTO}: ${error.message}`);
      }
      process.exit(1);
    });

    let trabajosIniciados = false;
    const iniciarTrabajos = () => {
      if (trabajosIniciados) return;
      trabajosIniciados = true;
      monitoringService.iniciar();
      payrollService.iniciarProgramador();
      systemBackupService.programar();
      trafficDailyService.iniciar();
      hotspotService.iniciarLimpieza();

      /* Dólar BCV: una consulta al arrancar y otra cada hora. */
      const actualizarTasa = () => exchangeRateService.obtenerTasa({ forzar: true }).catch(() => null);
      actualizarTasa();
      const tasaTimer = setInterval(actualizarTasa, 60 * 60 * 1000);
      if (tasaTimer.unref) tasaTimer.unref();
    };

    /* Solo una instancia ejecuta los trabajos programados. */
    const buscarLiderazgo = async () => {
      try {
        if (await backgroundLeader.intentar()) {
          iniciarTrabajos();
          return;
        }
        console.warn('⚠️  Otra instancia tiene los trabajos programados; esta solo atiende HTTP.');
      } catch (error) {
        console.error('No se pudo reclamar el liderazgo de trabajos:', error.message);
      }
      const reintento = setTimeout(buscarLiderazgo, 60 * 1000);
      if (reintento.unref) reintento.unref();
    };
    buscarLiderazgo();

    const apagar = (senal) => async () => {
      console.log(`\n${senal} recibido, cerrando...`);
      monitoringService.detener();
      await backgroundLeader.liberar();
      servidor.close(async () => {
        await desconectarDB();
        process.exit(0);
      });
    };

    process.on('SIGINT', apagar('SIGINT'));
    process.on('SIGTERM', apagar('SIGTERM'));
  } catch (error) {
    console.error('\n❌ No se pudo iniciar la aplicación.');
    console.error(`   ${error.message}\n`);
    console.error('   Revisa que MongoDB esté en ejecución y que MONGODB_URI');
    console.error('   (archivo .env) apunte a una base de datos válida.\n');
    process.exit(1);
  }
}

iniciar();
