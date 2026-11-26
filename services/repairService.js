const Vlan = require('../models/Vlan');
const FirewallRule = require('../models/FirewallRule');
const EoipTunnel = require('../models/EoipTunnel');
const BalanceConfig = require('../models/BalanceConfig');
const Subscription = require('../models/Subscription');
const vlanService = require('./vlanService');
const routerConfigService = require('./routerConfigService');
const balanceService = require('./balanceService');
const routerService = require('./routerService');
const routeros = require('./routeros');
const experimentalService = require('./experimentalService');
const { registrar } = require('./auditService');
const { crearError } = require('../utils/errors');

const MAXIMO_SERVICIOS = 200;
/* Aplicar respaldo recorre todo el padrón; se corta para no eternizar la tarea. */
const MAXIMO_SERVICIOS_COMPLETO = 500;

/** Deja el registro con el estado que devolvió el router. */
function anotar(registro, resultado) {
  registro.status = resultado.simulado ? 'simulated' : resultado.ok ? 'applied' : 'error';
  registro.lastResult = String(resultado.salida || '').slice(0, 500);
  registro.appliedAt = new Date();
  return registro.save().catch(() => null);
}

/** Asegura la IP del moroso en la lista MOROSOS sin duplicarla. */
async function asegurarMoroso(router, subscription) {
  const ip = String(subscription.serviceConfig?.ipAddress || '').trim();
  const codigo = subscription.clientId?.clientCode || 'CLIENTE';
  const comando = {
    path: '/ip/firewall/address-list/add',
    lookup: {
      path: '/ip/firewall/address-list/print',
      filters: ['?list=MOROSOS', `?address=${ip}`],
    },
    upsert: true,
    params: ['=list=MOROSOS', `=address=${ip}`, `=comment=CRACKENTICK ${codigo}`.replace(/"/g, "'")],
    paramsSet: [`=comment=CRACKENTICK ${codigo}`.replace(/"/g, "'")],
    comando: `/ip firewall address-list add list=MOROSOS address=${ip} comment="CRACKENTICK ${codigo}"`,
  };
  const respuesta = await routeros.ejecutar(router, comando);
  return {
    ok: respuesta.ok,
    simulado: false,
    salida: respuesta.ok ? `${ip} en MOROSOS` : respuesta.result,
  };
}

/** Corta el PPPoE de un moroso para que no vuelva a entrar con IP dinámica. */
async function deshabilitarSecret(router, subscription) {
  const usuario = String(subscription.serviceConfig?.pppoeUsername || '').trim();
  if (!usuario) return { ok: true, salida: 'Sin PPPoE.' };
  const respuesta = await routeros.ejecutar(router, {
    path: '/ppp/secret/set',
    lookup: { path: '/ppp/secret/print', filters: [`?name=${usuario}`] },
    params: ['=disabled=yes'],
    comando: `/ppp/secret/disable [find name="${usuario}"]`,
  });
  return { ok: respuesta.ok, simulado: false, salida: respuesta.ok ? `${usuario} deshabilitado` : respuesta.result };
}

/**
 * Repone en el router lo administrado en Red: VLANs, firewall, EOIP y balanceo.
 * Respeta el modo del router: en simulado solo registra.
 */
async function reparar(router, { actor = 'admin', modo = 'normal' } = {}) {
  if (router.vendor === 'cisco') {
    throw crearError(422, 'La reparación completa solo está disponible en MikroTik. En Cisco aplica VLANs y balanceo por separado.');
  }
  const completo = modo === 'completo';

  const [vlans, reglas, tuneles, balance] = await Promise.all([
    Vlan.find({ routerId: router._id }).sort({ vlanId: 1 }),
    FirewallRule.find({ routerId: router._id, enabled: true }).sort({ createdAt: 1 }),
    EoipTunnel.find({ routerId: router._id }).sort({ tunnelId: 1 }),
    BalanceConfig.findOne({ routerId: router._id }),
  ]);

  const inicio = Date.now();
  const resultados = [];
  let respaldo = null;
  if (router.mode === 'real') {
    try {
      respaldo = await experimentalService.respaldar(router, actor, 'reparacion');
    } catch (error) {
      resultados.push({
        tipo: 'Respaldo',
        nombre: 'Respaldo previo',
        ok: false,
        simulado: false,
        salida: `No se pudo respaldar el equipo: ${error.message}`,
      });
    }
  }

  async function paso(tipo, nombre, ejecutar) {
    let resultado;
    try {
      resultado = await ejecutar();
    } catch (error) {
      resultado = { ok: false, simulado: false, salida: error.message };
    }
    resultados.push({
      tipo,
      nombre,
      ok: resultado.ok !== false,
      simulado: Boolean(resultado.simulado),
      salida: String(resultado.salida || '').slice(0, 300),
    });
    return resultado;
  }

  for (const vlan of vlans) {
    const resultado = await paso('VLAN', `VLAN ${vlan.vlanId} · ${vlan.name}`, () =>
      vlanService.aplicar(router, vlan, 'crear', { actor })
    );
    await anotar(vlan, resultado);
  }

  for (const regla of reglas) {
    const resultado = await paso('Firewall', `Regla ${regla.comment || `${regla.chain} ${regla.action}`}`, () =>
      routerConfigService.aplicarFirewall(router, regla, 'crear', { actor })
    );
    await anotar(regla, resultado);
  }

  for (const tunel of tuneles) {
    const resultado = await paso('EOIP', `Túnel ${tunel.name}`, () =>
      routerConfigService.aplicarEoip(router, tunel, 'crear', { actor })
    );
    await anotar(tunel, resultado);
  }

  if (balance) {
    const anteriores = balance.entries.map((entrada) => ({ gateway: entrada.gateway }));
    const resultado = await paso('Balanceo', `ECMP ${balance.entries.length} WAN`, () =>
      balanceService.aplicar(router, balance, 'crear', { anteriores, actor })
    );
    await anotar(balance, resultado);
  }

  /* Servicios del router: PPPoE, address list y colas. En completo, todo el padrón. */
  const servicios = await Subscription.find({
    'serviceConfig.routerId': router._id,
    ...(completo ? { status: { $ne: 'cancelled' } } : { status: 'active' }),
  })
    .sort({ createdAt: 1 })
    .limit(completo ? MAXIMO_SERVICIOS_COMPLETO : MAXIMO_SERVICIOS)
    .select('clientId status serviceConfig.pppoeUsername')
    .populate('clientId', 'clientCode firstName lastName status')
    .lean();

  for (const servicio of servicios) {
    const etiqueta = servicio.clientId
      ? `${servicio.clientId.clientCode} · ${servicio.clientId.firstName || ''} ${servicio.clientId.lastName || ''}`.trim()
      : 'servicio sin cliente';
    await paso('Servicio', etiqueta, () => routerService.aprovisionar(servicio._id, { accion: 'create', actor }));
    if (completo && servicio.status === 'suspended') {
      await paso('PPPoE bloqueado', etiqueta, () => deshabilitarSecret(router, servicio));
    }
  }

  if (completo) {
    /* Morosos con IP fija: a la lista MOROSOS, sin duplicar registros. */
    const morosos = await Subscription.find({
      'serviceConfig.routerId': router._id,
      'serviceConfig.ipAddress': { $nin: ['', null] },
      status: { $ne: 'cancelled' },
    })
      .select('clientId serviceConfig.ipAddress')
      .populate('clientId', 'clientCode status')
      .lean();

    for (const servicio of morosos) {
      if (servicio.clientId?.status !== 'suspended') continue;
      const ip = servicio.serviceConfig.ipAddress;
      await paso('Morosos', `${servicio.clientId.clientCode || 'cliente'} · ${ip}`, () => asegurarMoroso(router, servicio));
    }
  }

  const fallos = resultados.filter((r) => !r.ok);
  const correctos = resultados.length - fallos.length;  await registrar({
    module: 'provisioning',
    entity: 'Router',
    entityId: router._id,
    action: 'provision',
    description: `Reparación${completo ? ' con respaldo completo' : ''} de ${router.name}: ${correctos}/${resultados.length} elementos repuestos.`,
    command: respaldo ? `Respaldo red previo: ${respaldo._id}` : 'Modo simulado: sin respaldo del equipo.',
    commandResult: resultados.map((r) => `${r.ok ? 'OK' : 'ERROR'} · ${r.tipo} ${r.nombre}`).join('\n').slice(0, 1900),
    status: fallos.length ? 'failed' : 'success',
    durationMs: Date.now() - inicio,
    actor,
  });

  return {
    ok: !fallos.length,
    simulado: router.mode !== 'real',
    modo: completo ? 'completo' : 'normal',
    resultados,
    fallos: fallos.length,
    respaldoId: respaldo ? String(respaldo._id) : '',
    durationMs: Date.now() - inicio,
  };
}

module.exports = { reparar };
