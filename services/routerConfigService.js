const routeros = require('./routeros');
const { registrar } = require('./auditService');
const { crearError } = require('../utils/errors');
const { esIpValida, analizarCidr } = require('../utils/ip');

function comentarioFirewall(regla) {
  return `CT-FW-${String(regla._id).slice(-8).toUpperCase()}`;
}

function validarFirewall(regla) {
  const chain = ['input', 'forward'].includes(regla.chain) ? regla.chain : 'forward';
  const action = ['accept', 'drop', 'reject'].includes(regla.action) ? regla.action : 'drop';
  const protocol = ['tcp', 'udp', 'icmp'].includes(regla.protocol) ? regla.protocol : '';
  let port = null;
  if (protocol === 'tcp' || protocol === 'udp') {
    port = Number(regla.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw crearError(422, 'Indica un puerto entre 1 y 65535 para TCP/UDP.');
    }
  }
  const srcAddress = String(regla.srcAddress || '').trim();
  if (srcAddress) {
    const valida = srcAddress.includes('/') ? analizarCidr(srcAddress).ok : esIpValida(srcAddress);
    if (!valida) throw crearError(422, 'La IP o red de origen no es válida.');
  }
  return { chain, action, protocol, port, srcAddress };
}

function validarEoip(tunel) {
  const nombre = String(tunel.name || '').trim();
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(nombre)) {
    throw crearError(422, 'El nombre del túnel solo admite letras, números, punto, guion y guion bajo.');
  }
  if (!esIpValida(tunel.remoteAddress)) throw crearError(422, 'La IP remota no es válida.');
  const tunnelId = Number(tunel.tunnelId);
  if (!Number.isInteger(tunnelId) || tunnelId < 1 || tunnelId > 65535) {
    throw crearError(422, 'El Tunnel ID debe estar entre 1 y 65535.');
  }
  const localAddress = String(tunel.localAddress || '').trim();
  if (localAddress && !esIpValida(localAddress)) throw crearError(422, 'La IP local no es válida.');
  return { nombre, remoteAddress: String(tunel.remoteAddress).trim(), tunnelId, localAddress };
}

function comando(path, params, lookup, descripcion) {
  const legible = params.map((p) => p.replace(/^=/, '')).join(' ');
  return { path, params, lookup, upsert: true, descripcion, comando: `${path} ${legible}` };
}

async function aplicarFirewall(router, regla, accion, { actor = 'admin' } = {}) {
  const datos = validarFirewall(regla);
  const etiqueta = comentarioFirewall(regla);
  if (router.mode !== 'real') {
    return { ok: true, simulado: true, resultados: [{ comando: 'SIMULADO', ok: true, result: 'Regla registrada sin ejecutar.' }], salida: 'Regla simulada.' };
  }
  if (router.vendor === 'cisco') {
    return {
      ok: false,
      simulado: false,
      resultados: [{ comando: 'Cisco SSH', ok: false, result: 'Firewall Cisco todavía no se aplica automáticamente (experimental).' }],
      salida: 'Firewall Cisco no soportado todavía.',
    };
  }

  const comandos = [];
  if (accion === 'crear' || accion === 'actualizar') {
    const params = [`=chain=${datos.chain}`, `=action=${datos.action}`];
    if (datos.protocol) params.push(`=protocol=${datos.protocol}`);
    if (datos.port) params.push(`=dst-port=${datos.port}`);
    if (datos.srcAddress) params.push(`=src-address=${datos.srcAddress}`);
    params.push(`=comment=${etiqueta}`, `=disabled=${regla.enabled ? 'no' : 'yes'}`);
    comandos.push(
      comando('/ip/firewall/filter/add', params, { path: '/ip/firewall/filter/print', filters: [`?comment=${etiqueta}`] }, `Asegurar regla ${etiqueta}`)
    );
  } else if (accion === 'habilitar' || accion === 'inhabilitar') {
    comandos.push(
      comando('/ip/firewall/filter/set', [`=disabled=${accion === 'habilitar' ? 'no' : 'yes'}`], { path: '/ip/firewall/filter/print', filters: [`?comment=${etiqueta}`] }, `${accion} regla ${etiqueta}`)
    );
  } else if (accion === 'eliminar') {
    comandos.push(
      comando('/ip/firewall/filter/remove', [], { path: '/ip/firewall/filter/print', filters: [`?comment=${etiqueta}`] }, `Eliminar regla ${etiqueta}`)
    );
  }

  const resultados = [];
  for (const cmd of comandos) {
    const respuesta = await routeros.ejecutar(router, cmd);
    resultados.push({ comando: cmd.comando, ok: respuesta.ok, result: respuesta.result });
    if (!respuesta.ok) break;
  }
  const ok = resultados.every((r) => r.ok);
  const salida = resultados.map((r) => `${r.ok ? 'OK' : 'ERROR'} · ${r.result}`).join('\n');
  await registrar({
    module: 'provisioning',
    entity: 'FirewallRule',
    entityId: regla._id,
    action: accion === 'eliminar' ? 'delete' : accion === 'crear' ? 'create' : 'update',
    description: `Regla firewall ${etiqueta} ${accion} en ${router.name}.`,
    command: resultados.map((r) => r.comando).join('\n'),
    commandResult: salida.slice(0, 1900),
    status: ok ? 'success' : 'failed',
    actor,
  });
  return { ok, simulado: false, resultados, salida };
}

async function aplicarEoip(router, tunel, accion, { actor = 'admin' } = {}) {
  const datos = validarEoip(tunel);
  if (router.mode !== 'real') {
    return { ok: true, simulado: true, resultados: [{ comando: 'SIMULADO', ok: true, result: 'Túnel registrado sin ejecutar.' }], salida: 'Túnel simulado.' };
  }
  if (router.vendor === 'cisco') {
    return {
      ok: false,
      simulado: false,
      resultados: [{ comando: 'Cisco SSH', ok: false, result: 'EOIP es propio de RouterOS; en Cisco no se aplica automáticamente (experimental).' }],
      salida: 'EOIP no soportado en Cisco.',
    };
  }

  const comandos = [];
  if (accion === 'crear' || accion === 'actualizar') {
    const params = [`=name=${datos.nombre}`, `=remote-address=${datos.remoteAddress}`, `=tunnel-id=${datos.tunnelId}`, `=disabled=${tunel.enabled ? 'no' : 'yes'}`, `=comment=CRACKENTICK EOIP ${datos.nombre}`];
    if (datos.localAddress) params.push(`=local-address=${datos.localAddress}`);
    comandos.push(comando('/interface/eoip/add', params, { path: '/interface/eoip/print', filters: [`?name=${datos.nombre}`] }, `Asegurar túnel ${datos.nombre}`));
  } else if (accion === 'habilitar' || accion === 'inhabilitar') {
    comandos.push(comando('/interface/eoip/set', [`=disabled=${accion === 'habilitar' ? 'no' : 'yes'}`], { path: '/interface/eoip/print', filters: [`?name=${datos.nombre}`] }, `${accion} túnel ${datos.nombre}`));
  } else if (accion === 'eliminar') {
    comandos.push(comando('/interface/eoip/remove', [], { path: '/interface/eoip/print', filters: [`?name=${datos.nombre}`] }, `Eliminar túnel ${datos.nombre}`));
  }

  const resultados = [];
  for (const cmd of comandos) {
    const respuesta = await routeros.ejecutar(router, cmd);
    resultados.push({ comando: cmd.comando, ok: respuesta.ok, result: respuesta.result });
    if (!respuesta.ok) break;
  }
  const ok = resultados.every((r) => r.ok);
  const salida = resultados.map((r) => `${r.ok ? 'OK' : 'ERROR'} · ${r.result}`).join('\n');
  await registrar({
    module: 'provisioning',
    entity: 'EoipTunnel',
    entityId: tunel._id,
    action: accion === 'eliminar' ? 'delete' : accion === 'crear' ? 'create' : 'update',
    description: `Túnel EOIP ${datos.nombre} ${accion} en ${router.name}.`,
    command: resultados.map((r) => r.comando).join('\n'),
    commandResult: salida.slice(0, 1900),
    status: ok ? 'success' : 'failed',
    actor,
  });
  return { ok, simulado: false, resultados, salida };
}

module.exports = { aplicarFirewall, aplicarEoip, validarFirewall, validarEoip };
