const Router = require('../models/Router');
const Plan = require('../models/Plan');
const Vlan = require('../models/Vlan');
const IpPool = require('../models/IpPool');
const Subscription = require('../models/Subscription');
const Sale = require('../models/Sale');
const routerService = require('../services/routerService');
const capacityService = require('../services/capacityService');
const repairService = require('../services/repairService');
const { registrar } = require('../services/auditService');
const { cifrar } = require('../services/cryptoService');
const { crearError, mensajeDeError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');
const { escaparRegex } = require('../utils/strings');

function leerWans(body = {}) {
  const nombres = [].concat(body.wanName || []);
  const proveedores = [].concat(body.wanProvider || []);
  const bajadas = [].concat(body.wanDownload || []);
  const subidas = [].concat(body.wanUpload || []);
  const notas = [].concat(body.wanNotes || []);
  return nombres
    .map((nombre, indice) => ({
      name: String(nombre || '').trim(),
      provider: String(proveedores[indice] || '').trim(),
      downloadMbps: Number(bajadas[indice]) || 0,
      uploadMbps: Number(subidas[indice]) || 0,
      notes: String(notas[indice] || '').trim(),
    }))
    .filter((wan) => wan.name);
}

function payloadRouter(body = {}) {
  const vendor = body.vendor === 'cisco' ? 'cisco' : 'mikrotik';
  return {
    name: body.name || '',
    description: body.description || '',
    vendor,
    model: String(body.model || '').trim(),
    mode: 'real',
    host: body.host || '',
    port: Number(body.port) || (vendor === 'cisco' ? 22 : 8728),
    sshPort: Number(body.sshPort) || 22,
    username: body.username || '',
    tls: body.tls === 'on' || body.tls === 'true',
    verifyTls: body.verifyTls === 'on' || body.verifyTls === 'true',
    transport: body.transport === 'ssh' ? 'ssh' : 'api',
    active: body.active === 'on' || body.active === 'true',
    planMode: body.planMode === 'address_list' ? 'address_list' : 'simple_queue',
    contractedDownloadMbps: Math.max(0, Number(body.contractedDownloadMbps) || 0),
    contractedUploadMbps: Math.max(0, Number(body.contractedUploadMbps) || 0),
    mangleChain: body.mangleChain === 'prerouting' ? 'prerouting' : 'forward',
    queueParent: String(body.queueParent || 'global').trim() || 'global',
    wanInterfaces: leerWans(body),
    notes: body.notes || '',
  };
}

/** Exige host y usuario; la contraseña puede estar vacía. */
function validarConexionReal(datos) {
  const errores = [];
  if (!datos.host) errores.push(`Debes indicar el host o la IP del ${datos.vendor === 'cisco' ? 'Cisco' : 'CHR/MikroTik'}.`);
  if (!datos.username) errores.push(`Debes indicar el usuario ${datos.vendor === 'cisco' ? 'SSH' : 'de la API'}.`);
  return errores;
}

/** GET /routers */
async function index(req, res, next) {
  try {
    const { q = '' } = req.query;
    const incluir = ['activos', 'recientes', 'todos'].includes(req.query.incluir) ? req.query.incluir : 'activos';
    const consulta = {};
    if (q.trim()) consulta.name = new RegExp(escaparRegex(q.trim()), 'i');

    const routers = await Router.find(consulta).sort({ active: -1, createdAt: 1 });
    const ids = routers.map((r) => r._id);
    const [pools, servicios, vlans, capacidad] = await Promise.all([
      IpPool.aggregate([{ $match: { routerId: { $in: ids } } }, { $group: { _id: '$routerId', total: { $sum: 1 } } }]),
      Subscription.aggregate([{ $match: { 'serviceConfig.routerId': { $in: ids } } }, { $group: { _id: '$serviceConfig.routerId', total: { $sum: 1 } } }]),
      Vlan.aggregate([{ $match: { routerId: { $in: ids } } }, { $group: { _id: '$routerId', total: { $sum: 1 } } }]),
      capacityService.resumenPorRouter(incluir),
    ]);
    const mapaPools = new Map(pools.map((f) => [String(f._id), f.total]));
    const mapaSubs = new Map(servicios.map((f) => [String(f._id), f.total]));
    const mapaVlans = new Map(vlans.map((f) => [String(f._id), f.total]));

    res.render('routers/index', {
      titulo: 'Routers',
      routers: routers.map((router) => ({
        ...router.toObject({ virtuals: true }),
        pools: mapaPools.get(String(router._id)) || 0,
        servicios: mapaSubs.get(String(router._id)) || 0,
        vlans: mapaVlans.get(String(router._id)) || 0,
        capacidad: capacidad(router),
      })),
      filtros: { q, incluir },
      resumen: {
        total: routers.length,
        wans: routers.reduce((suma, r) => suma + (r.wanInterfaces?.length || 0), 0),
      },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /routers/nuevo */
function formNuevo(req, res) {
  res.render('routers/form', {
    titulo: 'Nuevo router',
    router: new Router({ mode: 'real', port: 8728, active: true, wanInterfaces: [{ name: 'ether1', provider: '', downloadMbps: 100, uploadMbps: 50 }] }),
    modo: 'crear',
    errores: [],
    tienePassword: false,
  });
}

/** POST /routers */
async function crear(req, res, next) {
  try {
    const datos = payloadRouter(req.body);
    const errores = validarConexionReal(datos);
    if (errores.length) {
      return res.status(422).render('routers/form', {
        titulo: 'Nuevo router',
        router: new Router(datos),
        modo: 'crear',
        errores,
        tienePassword: Boolean(req.body.password),
      });
    }
    const router = new Router({
      ...datos,
      passwordEnc: req.body.password ? cifrar(req.body.password) : '',
      enablePasswordEnc: req.body.enablePassword ? cifrar(req.body.enablePassword) : '',
    });
    await router.save();
    await registrar({
      module: 'provisioning',
      entity: 'Router',
      entityId: router._id,
      action: 'create',
      description: `Router ${router.name} (${router.mode}) registrado.`,
      changes: { after: { name: router.name, mode: router.mode, host: router.host } },
    });
    req.flash('exito', `Router ${router.name} creado.`);
    res.redirect('/red/routers');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000 || error.status) {
      return res.status(422).render('routers/form', {
        titulo: 'Nuevo router',
        router: new Router(payloadRouter(req.body)),
        modo: 'crear',
        errores: error.name === 'ValidationError' ? Object.values(error.errors).map((d) => d.message) : [mensajeDeError(error)],
        tienePassword: Boolean(req.body.password),
      });
    }
    next(error);
  }
}

/** GET /routers/:id/editar */
async function formEditar(req, res, next) {
  try {
    const router = await Router.findById(req.params.id).select('+passwordEnc +enablePasswordEnc');
    if (!router) throw crearError(404, 'El router no existe.');
    res.render('routers/form', {
      titulo: `Editar ${router.name}`,
      router,
      modo: 'editar',
      errores: [],
      tienePassword: Boolean(router.passwordEnc),
      tieneEnablePassword: Boolean(router.enablePasswordEnc),
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /routers/:id */
async function actualizar(req, res, next) {
  try {
    const router = await Router.findById(req.params.id).select('+passwordEnc +enablePasswordEnc');
    if (!router) throw crearError(404, 'El router no existe.');
    const datos = payloadRouter(req.body);
    const vendorAnterior = router.vendor || 'mikrotik';
    if (vendorAnterior !== datos.vendor) {
      const [servicios, planes] = await Promise.all([
        Subscription.countDocuments({ 'serviceConfig.routerId': router._id }),
        Plan.countDocuments({ routerIds: router._id }),
      ]);
      if (servicios || planes) {
        const error = crearError(422, 'No puedes cambiar el fabricante de un router con servicios o planes asignados.');
        error.campos = { vendor: 'Reasigna o elimina los servicios y planes antes de cambiar el fabricante.' };
        throw error;
      }
    }
    if (router.planMode !== datos.planMode) {
      const [servicios, planes] = await Promise.all([
        Subscription.countDocuments({ 'serviceConfig.routerId': router._id }),
        Plan.countDocuments({ routerIds: router._id }),
      ]);
      if (servicios || planes) {
        const error = crearError(422, 'No puedes cambiar el manejo de planes de un router con servicios o planes asignados.');
        error.campos = { planMode: 'Reasigna o elimina los servicios y planes antes de cambiar el modo.' };
        throw error;
      }
    }
    const errores = validarConexionReal(datos);
    if (errores.length) {
      Object.assign(router, datos);
      const campos = {};
      if (!datos.host) campos.host = 'Debes indicar el host o la IP.';
      if (!datos.username) campos.username = 'Debes indicar el usuario de la API.';
      return res.status(422).render('routers/form', {
        titulo: `Editar ${router.name}`,
        router,
        modo: 'editar',
        errores,
        erroresCampo: campos,
        tienePassword: Boolean(router.passwordEnc),
        tieneEnablePassword: Boolean(router.enablePasswordEnc),
      });
    }
    Object.assign(router, datos);
    if (req.body.password) router.passwordEnc = cifrar(req.body.password);
    if (req.body.quitarPassword === 'on') router.passwordEnc = '';
    if (req.body.enablePassword) router.enablePasswordEnc = cifrar(req.body.enablePassword);
    if (req.body.quitarEnablePassword === 'on') router.enablePasswordEnc = '';
    await router.save();
    await registrar({
      module: 'provisioning',
      entity: 'Router',
      entityId: router._id,
      action: 'update',
      description: `Router ${router.name} actualizado.`,
      changes: { after: { name: router.name, mode: router.mode, host: router.host, active: router.active } },
    });
    req.flash('exito', 'Router actualizado.');
    res.redirect('/red/routers');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000 || error.status) {
      const router = await Router.findById(req.params.id).select('+passwordEnc +enablePasswordEnc');
      if (router) Object.assign(router, payloadRouter(req.body));
      const { lista, campos } = normalizarErrores(error);
      return res.status(422).render('routers/form', {
        titulo: `Editar ${router?.name || 'router'}`,
        router: router || new Router(payloadRouter(req.body)),
        modo: 'editar',
        errores: lista,
        erroresCampo: campos,
        tienePassword: Boolean(router?.passwordEnc),
        tieneEnablePassword: Boolean(router?.enablePasswordEnc),
      });
    }
    next(error);
  }
}

/** POST /routers/:id/probar */
async function probar(req, res, next) {
  try {
    const router = await Router.findById(req.params.id).select('+passwordEnc +enablePasswordEnc');
    if (!router) throw crearError(404, 'El router no existe.');
    const resultado = await routerService.probarConexion(router);
    if (resultado.ok) {
      req.flash('exito', `Conexión con ${router.name}: ${resultado.simulated ? 'simulada correctamente' : 'establecida'}.`);
    } else {
      req.flash('error', `No se pudo conectar con ${router.name}: ${resultado.result}`);
    }
    res.redirect('/red/routers');
  } catch (error) {
    next(error);
  }
}

/** POST /routers/:id/reparar */
async function reparar(req, res, next) {
  try {
    const router = await Router.findById(req.params.id).select('+passwordEnc +enablePasswordEnc');
    if (!router) throw crearError(404, 'El router no existe.');
    const resultado = await repairService.reparar(router, {
      actor: req.usuario ? req.usuario.username : 'admin',
      modo: req.body.modo === 'completo' ? 'completo' : 'normal',
    });
    const total = resultado.resultados.length;
    if (!total) {
      req.flash('exito', `${router.name} no tiene VLANs, firewall, EOIP, balanceo ni servicios que reponer.`);
    } else if (resultado.simulado) {
      req.flash('exito', `Reparación simulada de ${router.name}: ${total} elemento(s) registrados sin tocar el equipo.`);
    } else if (resultado.fallos) {
      const fallo = resultado.resultados.find((r) => !r.ok);
      req.flash('error', `${router.name}: ${total - resultado.fallos}/${total} correctos. Falló ${fallo.tipo} ${fallo.nombre}.`);
    } else if (resultado.modo === 'completo') {
      req.flash('exito', `${router.name}: respaldo completo aplicado, ${total} elemento(s) repuestos (incluye PPPoE, colas y morosos).`);
    } else {
      req.flash('exito', `${router.name} reparado: ${total} elemento(s) repuestos. Respaldo previo guardado.`);
    }
    res.redirect('/red/routers');
  } catch (error) {
    /* Cualquier fallo se informa en pantalla; nunca debe tumbar la vista. */
    req.flash('error', error.message || 'No se pudo reparar el router.');
    res.redirect('/red/routers');
  }
}

/** DELETE /routers/:id */
async function eliminar(req, res, next) {
  try {
    const router = await Router.findById(req.params.id);
    if (!router) throw crearError(404, 'El router no existe.');
    const [pools, servicios, planes, vlans, ventas] = await Promise.all([
      IpPool.countDocuments({ routerId: router._id }),
      Subscription.countDocuments({ 'serviceConfig.routerId': router._id }),
      Plan.countDocuments({ routerIds: router._id }),
      Vlan.countDocuments({ routerId: router._id }),
      Sale.countDocuments({ status: 'waiting', 'service.routerId': router._id }),
    ]);
    if (pools || servicios || planes || vlans || ventas) {
      req.flash('error', `No se puede eliminar ${router.name}: tiene ${pools} pool(s), ${servicios} servicio(s), ${planes} plan(es), ${vlans} VLAN(s) y ${ventas} venta(s) en espera.`);
      return res.redirect('/red/routers');
    }
    await router.deleteOne();
    await registrar({
      module: 'provisioning',
      entity: 'Router',
      entityId: router._id,
      action: 'delete',
      description: `Router ${router.name} eliminado.`,
      changes: { before: { name: router.name, host: router.host } },
    });
    req.flash('exito', 'Router eliminado.');
    res.redirect('/red/routers');
  } catch (error) {
    next(error);
  }
}

/** GET /routers/:id/provisionar */
async function formProvisionar(req, res, next) {
  try {
    const router = await Router.findById(req.params.id).select('+passwordEnc');
    if (!router) throw crearError(404, 'El router no existe.');
    if (router.vendor !== 'mikrotik') {
      throw crearError(422, 'El aprovisionamiento masivo solo está disponible en MikroTik.');
    }
    const base = {
      status: { $ne: 'cancelled' },
      $or: [{ 'serviceConfig.routerId': router._id }, { 'serviceConfig.routerId': null }],
    };
    const [pendientes, total] = await Promise.all([
      Subscription.countDocuments({ ...base, 'serviceConfig.provisioningState': { $ne: 'ok' } }),
      Subscription.countDocuments(base),
    ]);
    res.render('routers/provisionar', {
      titulo: `Aprovisionar ${router.name}`,
      router,
      pendientes,
      total,
    });
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/red/routers');
    }
    next(error);
  }
}

/** POST /routers/:id/provisionar */
async function provisionarMasivo(req, res, next) {
  try {
    const router = await Router.findById(req.params.id).select('+passwordEnc');
    if (!router) throw crearError(404, 'El router no existe.');
    if (router.vendor !== 'mikrotik') {
      throw crearError(422, 'El aprovisionamiento masivo solo está disponible en MikroTik.');
    }
    const resultado = await routerService.aprovisionarLote(router, {
      actor: req.usuario ? req.usuario.username : 'admin',
      todos: req.body.todos === 'on',
    });
    const resto = resultado.restantes ? ` Quedan ${resultado.restantes} para el siguiente lote.` : '';
    const fallo = resultado.fallos ? ` Falló en ${resultado.fallos} servicio(s).` : '';
    req.flash(
      resultado.fallos ? 'error' : 'exito',
      `${router.name}: ${resultado.creados}/${resultado.total} servicios aprovisionados.${fallo}${resto}`
    );
    res.redirect(`/red/routers/${router._id}/provisionar`);
  } catch (error) {
    req.flash('error', error.message || 'No se pudo aprovisionar.');
    res.redirect('/red/routers');
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar, probar, reparar, eliminar, formProvisionar, provisionarMasivo };
