const routeros = require('./routeros');
const mikrotikSsh = require('./mikrotikSsh');
const ciscoService = require('./ciscoService');
const { registrar } = require('./auditService');
const { crearError } = require('../utils/errors');
const { esIpValida } = require('../utils/ip');

const MAXIMO_WAN = 256;

const INTERFAZ_SEGURA = /^[A-Za-z0-9._/-]+$/;

function validarBalanceo(config) {
  const metodo = config.method === 'pcc' ? 'pcc' : 'ecmp';
  const entradas = (config.entries || []).filter((entrada) => entrada.enabled !== false && String(entrada.gateway || '').trim());
  if (entradas.length < 2) throw crearError(422, 'Un balanceo necesita al menos 2 WAN activas.');
  if (entradas.length > MAXIMO_WAN) throw crearError(422, `El máximo configurado es ${MAXIMO_WAN} WAN.`);
  const lanInterface = String(config.lanInterface || '').trim();
  if (metodo === 'pcc') {
    if (!lanInterface) throw crearError(422, 'Indica la interfaz LAN para el balanceo PCC.');
    if (!INTERFAZ_SEGURA.test(lanInterface)) throw crearError(422, 'La interfaz LAN contiene caracteres no válidos.');
  }
  const vistas = new Set();
  const normalizadas = entradas.map((entrada, indice) => {
    const gateway = String(entrada.gateway || '').trim();
    if (!esIpValida(gateway)) throw crearError(422, `La gateway de la WAN ${indice + 1} no es válida.`);
    if (vistas.has(gateway)) throw crearError(422, `La gateway ${gateway} está repetida.`);
    vistas.add(gateway);
    const interfaz = String(entrada.interface || '').trim();
    if (metodo === 'pcc' && !interfaz) {
      throw crearError(422, `Indica la interfaz de la WAN ${indice + 1}; PCC necesita el NAT por interfaz.`);
    }
    if (interfaz && !INTERFAZ_SEGURA.test(interfaz)) {
      throw crearError(422, `La interfaz de la WAN ${indice + 1} contiene caracteres no válidos.`);
    }
    return {
      name: String(entrada.name || '').trim().slice(0, 80),
      gateway,
      interface: interfaz,
      enabled: true,
    };
  });
  return normalizadas;
}

function comentario(config) {
  return `CT-BALANCE-${String(config._id).slice(-8).toUpperCase()}`;
}

async function limpiarPorEtiqueta(conexion, etiqueta) {
  const grupos = [
    '/ip/firewall/mangle/print',
    '/ip/firewall/nat/print',
    '/ip/route/print',
  ];
  const borrar = async (path, fila) => {
    try {
      await conexion.write(path.replace('/print', '/remove'), [`=.id=${fila['.id']}`]);
    } catch (error) {
      /* Se reintenta en la segunda pasada. */
    }
  };
  for (const path of grupos) {
    const filas = await conexion.write(path).catch(() => []);
    for (const fila of (filas || []).filter((f) => String(f.comment || '').startsWith(etiqueta))) {
      await borrar(path, fila);
    }
  }
  /* Segunda pasada: RouterOS puede tardar en liberar rutas recién removidas. */
  const restantes = await conexion.write('/ip/route/print').catch(() => []);
  for (const fila of (restantes || []).filter((f) => String(f.comment || '').startsWith(etiqueta))) {
    await borrar('/ip/route/print', fila);
  }
  const tablas = await conexion.write('/routing/table/print').catch(() => []);
  for (const tabla of (tablas || []).filter((t) => String(t.name || '').startsWith(etiqueta))) {
    await conexion.write('/routing/table/remove', [`=.id=${tabla['.id']}`]).catch(() => null);
  }
}

/** Redes directamente conectadas: su tráfico no debe salir por una WAN. */
async function redesConectadas(conexion) {
  const rutas = await conexion.write('/ip/route/print').catch(() => []);
  return (rutas || [])
    .filter((ruta) => String(ruta.connect) === 'true' && ruta['dst-address'] && ruta['dst-address'] !== '0.0.0.0/0')
    .map((ruta) => ruta['dst-address']);
}

function comandosPcc(etiqueta, lan, entradas, accion) {
  const comandos = [
    `/ip/firewall/mangle/remove [find comment~"${etiqueta}"]`,
    `/ip/firewall/nat/remove [find comment~"${etiqueta}"]`,
    `/ip/route/remove [find comment~"${etiqueta}"]`,
    `/routing/table/remove [find name~"${etiqueta}"]`,
  ];
  if (accion === 'eliminar') return comandos;
  comandos.push(
    `:foreach r in=[/ip/route/find where connect] do={/ip/firewall/mangle/add chain=prerouting action=accept dst-address=[/ip/route/get $r dst-address] comment="${etiqueta}-L"}`
  );
  entradas.forEach((entrada, indice) => {
    comandos.push(`/routing/table/add name=${etiqueta}-T${indice + 1} fib`);
  });
  entradas.forEach((entrada, indice) => {
    const c = `${etiqueta}-C${indice + 1}`;
    const t = `${etiqueta}-T${indice + 1}`;
    comandos.push(
      `/ip/firewall/mangle/add chain=prerouting action=mark-connection new-connection-mark=${c} connection-mark=no-mark connection-state=new dst-address-type=!local in-interface=${lan} per-connection-classifier=both-addresses:${entradas.length}/${indice} comment=${etiqueta}-MC${indice + 1}`
    );
    comandos.push(
      `/ip/firewall/mangle/add chain=prerouting action=mark-routing connection-mark=${c} in-interface=${lan} new-routing-mark=${t} comment=${etiqueta}-MR${indice + 1}`
    );
    comandos.push(`/ip/firewall/mangle/add chain=output action=mark-routing connection-mark=${c} new-routing-mark=${t} comment=${etiqueta}-MO${indice + 1}`);
  });
  entradas.forEach((entrada, indice) => {
    const t = `${etiqueta}-T${indice + 1}`;
    comandos.push(`/ip/route/add dst-address=0.0.0.0/0 gateway=${entrada.gateway} check-gateway=ping routing-table=${t} comment=${etiqueta}-R${indice + 1}`);
    comandos.push(`/ip/route/add dst-address=0.0.0.0/0 gateway=${entrada.gateway} check-gateway=ping distance=${indice + 1} comment=${etiqueta}-M${indice + 1}`);
  });
  entradas.forEach((entrada, indice) => {
    comandos.push(`/ip/firewall/nat/add chain=srcnat out-interface=${entrada.interface} action=masquerade comment=${etiqueta}-N${indice + 1}`);
  });
  return comandos;
}

async function aplicarPcc(router, config, entradas, { accion, actor }) {
  const etiqueta = comentario(config);
  const lan = String(config.lanInterface || '').trim();
  const inicio = Date.now();
  const resultados = [];

  if (router.transport === 'ssh') {
    const comandos = comandosPcc(etiqueta, lan, entradas, accion);
    try {
      const salida = await mikrotikSsh.ejecutar(router, comandos);
      const fallo = String(salida || '')
        .split(/\r?\n/)
        .map((linea) => linea.trim())
        .find((linea) => /^(failure|bad command|invalid|expected|no such item|cannot|already have)/i.test(linea));
      resultados.push({
        comando: comandos.join('\n'),
        ok: !fallo,
        result: fallo || (accion === 'eliminar' ? 'PCC eliminado.' : `PCC aplicado con ${entradas.length} WAN.`),
      });
      if (accion !== 'eliminar') {
        resultados.push({
          comando: 'aviso PCC SSH',
          ok: true,
          result: 'PCC SSH excluye las redes conectadas con una regla dinámica.',
        });
      }
    } catch (error) {
      resultados.push({ comando: 'RouterOS SSH', ok: false, result: error.message });
    }
  } else {
    let conexion;
    try {
      conexion = await routeros.conectar(router);
      await limpiarPorEtiqueta(conexion, etiqueta);
      if (accion === 'eliminar') {
        resultados.push({ comando: `limpieza ${etiqueta}`, ok: true, result: 'PCC eliminado del router.' });
      } else {
        const locales = await redesConectadas(conexion);
        for (let i = 0; i < locales.length; i += 1) {
          await conexion.write('/ip/firewall/mangle/add', [
            '=chain=prerouting',
            '=action=accept',
            `=dst-address=${locales[i]}`,
            `=comment=${etiqueta}-L${i + 1}`,
          ]);
        }
        if (locales.length) {
          resultados.push({
            comando: `/ip/firewall/mangle/add accept ${locales.join(', ')}`,
            ok: true,
            result: `${locales.length} red(es) interna(s) excluidas del balanceo`,
          });
        }
        const filtros = await conexion.write('/ip/firewall/filter/print').catch(() => []);
        if ((filtros || []).some((fila) => fila.action === 'fasttrack-connection')) {
          resultados.push({
            comando: 'aviso FastTrack',
            ok: true,
            result: 'FastTrack detectado: revisa que las conexiones marcadas no se aceleren antes de mangle.',
          });
        }
      }
      if (accion !== 'eliminar') {
        for (let i = 0; i < entradas.length; i += 1) {
          const tabla = `${etiqueta}-T${i + 1}`;
          await conexion.write('/routing/table/add', [`=name=${tabla}`, '=fib=']);
          resultados.push({ comando: `/routing/table/add name=${tabla} fib`, ok: true, result: 'tabla creada' });
        }
        for (let i = 0; i < entradas.length; i += 1) {
          const marca = `${etiqueta}-C${i + 1}`;
          const tabla = `${etiqueta}-T${i + 1}`;
          await conexion.write('/ip/firewall/mangle/add', [
            '=chain=prerouting',
            '=action=mark-connection',
            `=new-connection-mark=${marca}`,
            '=connection-mark=no-mark',
            '=connection-state=new',
            '=dst-address-type=!local',
            `=in-interface=${lan}`,
            `=per-connection-classifier=both-addresses:${entradas.length}/${i}`,
            `=comment=${etiqueta}-MC${i + 1}`,
          ]);
          await conexion.write('/ip/firewall/mangle/add', [
            '=chain=prerouting',
            '=action=mark-routing',
            `=connection-mark=${marca}`,
            `=in-interface=${lan}`,
            `=new-routing-mark=${tabla}`,
            `=comment=${etiqueta}-MR${i + 1}`,
          ]);
          await conexion.write('/ip/firewall/mangle/add', [
            '=chain=output',
            '=action=mark-routing',
            `=connection-mark=${marca}`,
            `=new-routing-mark=${tabla}`,
            `=comment=${etiqueta}-MO${i + 1}`,
          ]);
          resultados.push({ comando: `/ip/firewall/mangle/add marca=${marca} tabla=${tabla}`, ok: true, result: 'mangle creado' });
        }
        for (let i = 0; i < entradas.length; i += 1) {
          const tabla = `${etiqueta}-T${i + 1}`;
          await conexion.write('/ip/route/add', [
            '=dst-address=0.0.0.0/0',
            `=gateway=${entradas[i].gateway}`,
            '=check-gateway=ping',
            `=routing-table=${tabla}`,
            `=comment=${etiqueta}-R${i + 1}`,
          ]);
          await conexion.write('/ip/route/add', [
            '=dst-address=0.0.0.0/0',
            `=gateway=${entradas[i].gateway}`,
            '=check-gateway=ping',
            `=distance=${i + 1}`,
            `=comment=${etiqueta}-M${i + 1}`,
          ]);
          resultados.push({ comando: `/ip/route/add gateway=${entradas[i].gateway} tabla=${tabla}`, ok: true, result: 'ruta creada' });
        }
        for (let i = 0; i < entradas.length; i += 1) {
          await conexion.write('/ip/firewall/nat/add', [
            '=chain=srcnat',
            `=out-interface=${entradas[i].interface}`,
            '=action=masquerade',
            `=comment=${etiqueta}-N${i + 1}`,
          ]);
          resultados.push({ comando: `/ip/firewall/nat/add out-interface=${entradas[i].interface}`, ok: true, result: 'NAT creado' });
        }
      }
    } catch (error) {
      resultados.push({ comando: 'RouterOS API', ok: false, result: error.message });
      if (conexion) await limpiarPorEtiqueta(conexion, etiqueta).catch(() => null);
    } finally {
      if (conexion) routeros.cerrar(conexion);
    }
  }

  const ok = resultados.length > 0 && resultados.every((r) => r.ok);
  const salida = resultados.map((r) => `${r.ok ? 'OK' : 'ERROR'} · ${r.result}`).join('\n');
  await registrar({
    module: 'provisioning',
    entity: 'BalanceConfig',
    entityId: config._id,
    action: accion === 'eliminar' ? 'delete' : 'config_change',
    description: `Balanceo PCC ${accion} en ${router.name} con ${entradas.length} WAN (LAN ${lan}).`,
    command: resultados.map((r) => r.comando).join('\n').slice(0, 4000),
    commandResult: salida.slice(0, 1900),
    status: ok ? 'success' : 'failed',
    durationMs: Date.now() - inicio,
    actor,
  });
  return { ok, simulado: false, resultados, salida, durationMs: Date.now() - inicio };
}

async function aplicar(router, config, accion, { anteriores = [], actor = 'admin' } = {}) {
  const entradas = accion === 'eliminar'
    ? (config.entries || []).filter((entrada) => String(entrada.gateway || '').trim()).map((entrada) => ({ gateway: String(entrada.gateway).trim() }))
    : validarBalanceo(config);
  if (accion !== 'eliminar' && entradas.length < 2) {
    throw crearError(422, 'Un balanceo necesita al menos 2 WAN activas.');
  }

  if (router.mode !== 'real') {
    return {
      ok: true,
      simulado: true,
      resultados: [{ comando: 'SIMULADO', ok: true, result: 'Balanceo registrado sin ejecutar.' }],
      salida: 'Balanceo simulado.',
    };
  }

  const inicio = Date.now();
  const resultados = [];

  if (config.method === 'pcc' && router.vendor === 'mikrotik') {
    return aplicarPcc(router, config, entradas, { accion, actor });
  }

  try {
    if (router.vendor === 'cisco') {
      const comandos = [];
      if (accion === 'eliminar') {
        for (const entrada of anteriores) comandos.push(`no ip route 0.0.0.0 0.0.0.0 ${entrada.gateway}`);
      } else {
        if (anteriores.length) {
          for (const entrada of anteriores) comandos.push(`no ip route 0.0.0.0 0.0.0.0 ${entrada.gateway}`);
        }
        for (const entrada of entradas) comandos.push(`ip route 0.0.0.0 0.0.0.0 ${entrada.gateway}`);
      }
      const salida = await ciscoService.ejecutar(router, comandos, { config: true });
      resultados.push({ comando: comandos.join('\n'), ok: salida.ok, result: salida.result });
    } else if (router.transport === 'ssh') {
      /* Emergencia: el balanceo va por la consola SSH, igual que el resto. */
      const etiqueta = comentario(config);
      const comandos = [`/ip/route/remove [find comment~"${etiqueta}"]`];
      if (accion !== 'eliminar') {
        entradas.forEach((entrada, indice) => {
          comandos.push(`/ip/route/add dst-address=0.0.0.0/0 gateway=${entrada.gateway} check-gateway=ping distance=1 comment=${etiqueta}-${indice + 1}`);
        });
      }
      const salida = await mikrotikSsh.ejecutar(router, comandos);
      const fallo = salida
        .split(/\r?\n/)
        .map((linea) => linea.trim())
        .find((linea) => /^(failure|bad command|invalid|expected|no such item|cannot|already have)/i.test(linea));
      resultados.push({
        comando: comandos.join('\n'),
        ok: !fallo,
        result: fallo || (accion === 'eliminar' ? 'Rutas de balanceo eliminadas.' : `${entradas.length} ruta(s) ECMP creadas.`),
      });
    } else {
      /* RouterOS 7 no acepta gateways separadas por coma: una ruta por WAN. */
      const etiqueta = comentario(config);
      const conexion = await routeros.conectar(router);
      try {
        const rutas = await conexion.write('/ip/route/print');
        for (const ruta of rutas.filter((r) => String(r.comment || '').startsWith(etiqueta))) {
          await conexion.write('/ip/route/remove', [`=.id=${ruta['.id']}`]);
        }
        if (accion !== 'eliminar') {
          let indice = 0;
          for (const entrada of entradas) {
            indice += 1;
            await conexion.write('/ip/route/add', [
              '=dst-address=0.0.0.0/0',
              `=gateway=${entrada.gateway}`,
              '=check-gateway=ping',
              '=distance=1',
              `=comment=${etiqueta}-${indice}`,
            ]);
          }
        }
        resultados.push({
          comando: accion === 'eliminar'
            ? `/ip/route/remove [find comment~"${etiqueta}"]`
            : entradas.map((e, i) => `add gateway=${e.gateway} comment=${etiqueta}-${i + 1}`).join('\n'),
          ok: true,
          result: accion === 'eliminar'
            ? 'Rutas de balanceo eliminadas.'
            : `${entradas.length} ruta(s) ECMP creadas.`,
        });
      } finally {
        routeros.cerrar(conexion);
      }
    }
  } catch (error) {
    resultados.push({ comando: router.vendor === 'cisco' ? 'Cisco SSH' : router.transport === 'ssh' ? 'RouterOS SSH' : 'RouterOS API', ok: false, result: error.message });
  }

  const ok = resultados.length > 0 && resultados.every((r) => r.ok);
  const salida = resultados.map((r) => `${r.ok ? 'OK' : 'ERROR'} · ${r.result}`).join('\n');
  await registrar({
    module: 'provisioning',
    entity: 'BalanceConfig',
    entityId: config._id,
    action: accion === 'eliminar' ? 'delete' : 'config_change',
    description: `Balanceo ECMP ${accion} en ${router.name} con ${entradas.length} WAN.`,
    command: resultados.map((r) => r.comando).join('\n').slice(0, 4000),
    commandResult: salida.slice(0, 1900),
    status: ok ? 'success' : 'failed',
    durationMs: Date.now() - inicio,
    actor,
  });
  return { ok, simulado: false, resultados, salida, durationMs: Date.now() - inicio };
}

module.exports = { aplicar, validarBalanceo, MAXIMO_WAN };
