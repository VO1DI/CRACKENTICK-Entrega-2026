const Router = require('../models/Router');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const { descifrar } = require('./cryptoService');
const { registrar } = require('./auditService');
const { analizarCidr } = require('../utils/ip');
const routeros = require('./routeros');
const mikrotikSsh = require('./mikrotikSsh');
const ciscoService = require('./ciscoService');
const capacityService = require('./capacityService');
const planService = require('./planService');

const SIM_TRAFICO = new Map();
const CONEXIONES_MONITOREO = new Map();
const COLAS_MONITOREO = new Map();

function slug(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function comentarioCliente(subscription) {
  const cliente = subscription.clientId || {};
  return `CRACKENTICK ${cliente.clientCode || ''} ${cliente.firstName || ''} ${cliente.lastName || ''}`
    .replace(/\s+/g, ' ')
    .replace(/"/g, "'")
    .trim();
}

function nombreCola(subscription) {
  const config = subscription.serviceConfig || {};
  if (config.queueName) return config.queueName;
  const base = slug(config.pppoeUsername || (subscription.clientId && subscription.clientId.clientCode) || String(subscription._id));
  return base.startsWith('ct-') ? base : `ct-${base}`;
}

function limite(plan) {
  // RouterOS lee rx/tx como subida/bajada del abonado, al revés que la ficha del plan.
  const bajada = Number(plan?.downloadSpeed || 0);
  const subida = Number(plan?.uploadSpeed || 0);
  return `${subida}M/${bajada}M`;
}

function limiteVisible(plan) {
  const bajada = Number(plan?.downloadSpeed || 0);
  const subida = Number(plan?.uploadSpeed || 0);
  return `${bajada}M/${subida}M`;
}

function nombrePerfil(plan) {
  return `ct-plan-${slug(plan?.name || 'plan')}`;
}

function esAddressList(plan) {
  return (plan?.trafficMode || 'simple_queue') === 'address_list';
}

function nombreListaPlan(plan) {
  return `ct-plan-${slug(plan?.name || 'plan')}`;
}

function nombrePcq(plan, direccion) {
  return `pcq-${direccion}-${slug(plan?.name || 'plan')}`;
}

function nombreColaPlan(plan, direccion) {
  return `ct-plan-${slug(plan?.name || 'plan')}-${direccion}`;
}

function nombreRaiz(direccion) {
  return `ct-root-${direccion}`;
}

function planDe(subscription, plan) {
  return plan || subscription.planId || subscription.planSnapshot || {};
}

/** Comandos base de address list: raíz, PCQ, cola del plan y marcas. */
function construirBaseAddressList(plan, router, planMax = {}) {
  const modo = plan.trafficMode || 'simple_queue';
  if (modo !== 'address_list') return [];

  const sufijo = slug(plan.name || 'plan');
  const lista = nombreListaPlan(plan);
  const parent = router?.queueParent || 'global';
  const chain = router?.mangleChain === 'prerouting' ? 'prerouting' : 'forward';
  const contratadoBajada = Number(router?.contractedDownloadMbps) || 0;
  const contratadoSubida = Number(router?.contractedUploadMbps) || 0;
  const maxBajada = Number(plan.parentMaxDownloadMbps) || Number(planMax.download) || 0;
  const maxSubida = Number(plan.parentMaxUploadMbps) || Number(planMax.upload) || 0;
  const garantiaBajada = Number(plan.parentLimitAtDownloadMbps) || 0;
  const garantiaSubida = Number(plan.parentLimitAtUploadMbps) || 0;
  const comandos = [];

  ['down', 'up'].forEach((direccion) => {
    const velocidad = direccion === 'down' ? plan.downloadSpeed : plan.uploadSpeed;
    const clasificador = direccion === 'down' ? 'dst-address' : 'src-address';
    comandos.push({
      op: `pcq-${direccion}-upsert`,
      tipo: 'queue-type',
      path: '/queue/type/add',
      lookup: { path: '/queue/type/print', filters: [`?name=${nombrePcq(plan, direccion)}`] },
      upsert: true,
      params: [
        `=name=${nombrePcq(plan, direccion)}`,
        '=kind=pcq',
        `=pcq-rate=${Number(velocidad) || 0}M`,
        `=pcq-classifier=${clasificador}`,
      ],
      paramsSet: [
        `=pcq-rate=${Number(velocidad) || 0}M`,
        `=pcq-classifier=${clasificador}`,
      ],
      comando: `/queue/type/set [find name="${nombrePcq(plan, direccion)}"] kind=pcq pcq-rate=${Number(velocidad) || 0}M pcq-classifier=${clasificador}`,
      descripcion: `Asegurar PCQ ${direccion} del plan ${plan.name} (${velocidad} Mbps por cliente)`,
    });
  });

  comandos.push({
    op: 'root-down-upsert',
    tipo: 'queue-tree',
    path: '/queue/tree/add',
    lookup: { path: '/queue/tree/print', filters: [`?name=${nombreRaiz('down')}`] },
    upsert: true,
    params: [
      `=name=${nombreRaiz('down')}`,
      `=parent=${parent}`,
      '=queue=default-small',
      `=max-limit=${contratadoBajada}M`,
      '=comment=CRACKENTICK raiz bajada',
    ],
    comando: `/queue/tree/set [find name="${nombreRaiz('down')}"] parent=${parent} max-limit=${contratadoBajada}M`,
    descripcion: `Asegurar raíz de bajada (${contratadoBajada} Mbps contratados)`,
  });

  comandos.push({
    op: 'root-up-upsert',
    tipo: 'queue-tree',
    path: '/queue/tree/add',
    lookup: { path: '/queue/tree/print', filters: [`?name=${nombreRaiz('up')}`] },
    upsert: true,
    params: [
      `=name=${nombreRaiz('up')}`,
      `=parent=${parent}`,
      '=queue=default-small',
      `=max-limit=${contratadoSubida}M`,
      '=comment=CRACKENTICK raiz subida',
    ],
    comando: `/queue/tree/set [find name="${nombreRaiz('up')}"] parent=${parent} max-limit=${contratadoSubida}M`,
    descripcion: `Asegurar raíz de subida (${contratadoSubida} Mbps contratados)`,
  });

  ['down', 'up'].forEach((direccion) => {
    const cola = nombreColaPlan(plan, direccion);
    const raiz = nombreRaiz(direccion);
    const pcq = nombrePcq(plan, direccion);
    const marca = `${lista}-${direccion}`;
    const maximo = direccion === 'down' ? maxBajada : maxSubida;
    const garantia = direccion === 'down' ? garantiaBajada : garantiaSubida;
    const params = [
      `=name=${cola}`,
      `=parent=${raiz}`,
      `=packet-mark=${marca}`,
      `=queue=${pcq}`,
      `=max-limit=${maximo}M`,
      `=limit-at=${garantia}M`,
      `=comment=CRACKENTICK plan ${sufijo} ${direccion}`,
    ];
    comandos.push({
      op: `plan-${direccion}-upsert`,
      tipo: 'queue-tree',
      path: '/queue/tree/add',
      lookup: { path: '/queue/tree/print', filters: [`?name=${cola}`] },
      upsert: true,
      params,
      comando: `/queue/tree/set [find name="${cola}"] parent=${raiz} packet-mark=${marca} queue=${pcq} max-limit=${maximo}M`,
      descripcion: `Asegurar cola padre ${direccion} del plan ${plan.name}`,
    });
  });

  comandos.push({
    op: 'mangle-down-upsert',
    tipo: 'mangle',
    path: '/ip/firewall/mangle/add',
    lookup: { path: '/ip/firewall/mangle/print', filters: [`?comment=CRACKENTICK-plan-${sufijo}-down`] },
    upsert: true,
    params: [
      `=chain=${chain}`,
      `=dst-address-list=${lista}`,
      '=action=mark-packet',
      `=new-packet-mark=${lista}-down`,
      '=passthrough=yes',
      `=comment=CRACKENTICK-plan-${sufijo}-down`,
    ],
    comando: `/ip/firewall/mangle/add chain=${chain} dst-address-list=${lista} action=mark-packet new-packet-mark=${lista}-down`,
    descripcion: `Marcar bajada del plan ${plan.name}`,
  });

  comandos.push({
    op: 'mangle-up-upsert',
    tipo: 'mangle',
    path: '/ip/firewall/mangle/add',
    lookup: { path: '/ip/firewall/mangle/print', filters: [`?comment=CRACKENTICK-plan-${sufijo}-up`] },
    upsert: true,
    params: [
      `=chain=${chain}`,
      `=src-address-list=${lista}`,
      '=action=mark-packet',
      `=new-packet-mark=${lista}-up`,
      '=passthrough=yes',
      `=comment=CRACKENTICK-plan-${sufijo}-up`,
    ],
    comando: `/ip/firewall/mangle/add chain=${chain} src-address-list=${lista} action=mark-packet new-packet-mark=${lista}-up`,
    descripcion: `Marcar subida del plan ${plan.name}`,
  });

  return comandos;
}

/**
 * Construye la lista de comandos RouterOS para crear, actualizar o eliminar
 * el aprovisionamiento de un cliente. PPPoE usa un profile por plan
 * (rate-limit); IP estática/DHCP usa cola simple y lista CLIENTES.
 */
function construirAprovisionamiento(subscription, { accion = 'create', password = '', router = null, plan = null, planMax = {} } = {}) {
  const config = subscription.serviceConfig || {};
  const planDoc = planDe(subscription, plan);
  const planSnap = subscription.planSnapshot || planDoc;
  const modo = planDoc.trafficMode || 'simple_queue';
  const addressList = esAddressList(planDoc);
  const cola = nombreCola(subscription);
  const comentario = comentarioCliente(subscription);
  const comandos = [];

  if (accion === 'delete') {
    if (config.connectionType === 'pppoe' && config.pppoeUsername) {
      comandos.push({
        op: 'pppoe-remove',
        tipo: 'pppoe',
        path: '/ppp/secret/remove',
        lookup: { path: '/ppp/secret/print', filters: [`?name=${config.pppoeUsername}`] },
        params: [],
        comando: `/ppp/secret/remove [find name="${config.pppoeUsername}"]`,
        descripcion: `Eliminar el secret PPPoE ${config.pppoeUsername}`,
      });
    }

    const listas = ['CLIENTES', 'MOROSOS'];
    if (addressList) listas.push(nombreListaPlan(planDoc));
    listas.forEach((lista) => {
      if (!config.ipAddress) return;
      comandos.push({
        op: `address-remove-${slug(lista)}`,
        tipo: 'address-list',
        path: '/ip/firewall/address-list/remove',
        lookup: { path: '/ip/firewall/address-list/print', filters: [`?list=${lista}`, `?address=${config.ipAddress}`] },
        params: [],
        comando: `/ip/firewall/address-list/remove [find list=${lista} address=${config.ipAddress}]`,
        descripcion: `Quitar ${config.ipAddress} de la lista ${lista}`,
      });
    });

    if (!addressList) {
      comandos.push({
        op: 'queue-remove',
        tipo: 'queue',
        path: '/queue/simple/remove',
        lookup: { path: '/queue/simple/print', filters: [`?name=${cola}`] },
        params: [],
        comando: `/queue/simple/remove [find name="${cola}"]`,
        descripcion: `Eliminar la cola ${cola} si existe`,
      });
    }
    return comandos;
  }

  if (addressList) {
    comandos.push(...construirBaseAddressList(planDoc, router, planMax));
  }

  if (config.connectionType === 'pppoe' && config.pppoeUsername) {
    const perfil = addressList ? 'ct-address-list' : nombrePerfil(planDoc);
    if (addressList) {
      comandos.push({
        op: 'profile-neutral-upsert',
        tipo: 'ppp-profile',
        path: '/ppp/profile/add',
        lookup: { path: '/ppp/profile/print', filters: ['?name=ct-address-list'] },
        upsert: true,
        params: ['=name=ct-address-list', '=comment=CRACKENTICK planes por address list'],
        paramsSet: ['=rate-limit=0/0', '=comment=CRACKENTICK planes por address list'],
        comando: '/ppp/profile/set [find name="ct-address-list"] comment="CRACKENTICK planes por address list"',
        descripcion: 'Asegurar el profile PPPoE neutro para planes por address list',
      });
    } else {
      comandos.push({
        op: 'profile-upsert',
        tipo: 'ppp-profile',
        path: '/ppp/profile/add',
        lookup: { path: '/ppp/profile/print', filters: [`?name=${perfil}`] },
        upsert: true,
        params: [`=name=${perfil}`, `=rate-limit=${limite(planSnap)}`, `=comment=CRACKENTICK plan ${String(planSnap.name || '').replace(/"/g, "'")}`],
        comando: `/ppp/profile/set [find name="${perfil}"] rate-limit=${limite(planSnap)}`,
        descripcion: `Asegurar el profile ${perfil} (${limiteVisible(planSnap)})`,
      });
    }

    const params = [
      `=name=${config.pppoeUsername}`,
      '=service=pppoe',
      `=profile=${perfil}`,
      `=comment=${comentario}`,
    ];
    if (password) params.push(`=password=${password}`);
    if (config.ipAddress) params.push(`=remote-address=${config.ipAddress}`);
    const callerId = config.macAuthEnabled && config.macAddress ? config.macAddress : '';
    if (callerId) params.push(`=caller-id=${callerId}`);

    comandos.push({
      op: accion === 'create' ? 'pppoe-create' : 'pppoe-update',
      tipo: 'pppoe',
      path: `/ppp/secret/${accion === 'create' ? 'add' : 'set'}`,
      lookup: { path: '/ppp/secret/print', filters: [`?name=${config.pppoeUsername}`] },
      upsert: true,
      params,
      comando: `/ppp/secret/${accion === 'create' ? 'add' : 'set'} name="${config.pppoeUsername}" service=pppoe profile="${perfil}" password="••••••" comment="${comentario}"`,
      descripcion: `${accion === 'create' ? 'Crear' : 'Actualizar'} el secret PPPoE ${config.pppoeUsername} con el profile ${perfil}`,
    });
  }

  if (config.ipAddress) {
    if (addressList) {
      const lista = nombreListaPlan(planDoc);
      comandos.push({
        op: 'plan-address-upsert',
        tipo: 'address-list',
        path: '/ip/firewall/address-list/add',
        lookup: { path: '/ip/firewall/address-list/print', filters: [`?list=${lista}`, `?address=${config.ipAddress}`] },
        upsert: true,
        params: [`=list=${lista}`, `=address=${config.ipAddress}`, `=comment=${comentario}`],
        comando: `/ip/firewall/address-list/set [find list=${lista} address=${config.ipAddress}] comment="${comentario}"`,
        descripcion: `Asegurar ${config.ipAddress} en la lista ${lista}`,
      });
    } else {
      comandos.push({
        op: 'queue-upsert',
        tipo: 'queue',
        path: '/queue/simple/add',
        lookup: { path: '/queue/simple/print', filters: [`?name=${cola}`] },
        upsert: true,
        params: [
          `=name=${cola}`,
          `=target=${config.ipAddress}`,
          `=max-limit=${limite(planSnap)}`,
          `=comment=${comentario} plan=${String(planSnap.name || '').replace(/"/g, "'")}`,
        ],
        comando: `/queue/simple/set [find name="${cola}"] target="${config.ipAddress}" max-limit=${limite(planSnap)}`,
        descripcion: `Asegurar la cola ${limiteVisible(planSnap)} para ${config.ipAddress}`,
      });
    }

    if (config.connectionType !== 'pppoe') {
      comandos.push({
        op: 'address-upsert',
        tipo: 'address-list',
        path: '/ip/firewall/address-list/add',
        lookup: { path: '/ip/firewall/address-list/print', filters: ['?list=CLIENTES', `?address=${config.ipAddress}`] },
        upsert: true,
        params: ['=list=CLIENTES', `=address=${config.ipAddress}`, `=comment=${comentario}`],
        comando: `/ip/firewall/address-list/set [find list=CLIENTES address=${config.ipAddress}] comment="${comentario}"`,
        descripcion: `Asegurar ${config.ipAddress} en la lista CLIENTES`,
      });
    }

    /* DHCP: reserva del equipo por MAC para que siempre reciba la misma IP. */
    if (config.connectionType === 'dhcp' && config.ipAddress && config.macAddress && config.macAuthEnabled) {
      comandos.push({
        op: 'dhcp-lease-upsert',
        tipo: 'dhcp-lease',
        path: '/ip/dhcp-server/lease/add',
        lookup: { path: '/ip/dhcp-server/lease/print', filters: [`?address=${config.ipAddress}`] },
        upsert: true,
        params: [`=address=${config.ipAddress}`, `=mac-address=${config.macAddress}`, '=server=all', `=comment=${comentario}`],
        paramsSet: [`=mac-address=${config.macAddress}`, `=comment=${comentario}`],
        comando: `/ip/dhcp-server/lease/add address=${config.ipAddress} mac-address=${config.macAddress} comment="${comentario}"`,
        descripcion: 'Asegurar reserva DHCP por MAC',
      });
    }
  }

  return comandos;
}

/** Comandos para materializar un pool CIDR en el router. */
function construirPool(pool) {
  const datos = analizarCidr(pool.cidr);
  if (!datos.ok) return [];
  const nombre = `ct-pool-${slug(pool.name)}`;
  return [
    {
      op: 'pool-upsert',
      tipo: 'ip-pool',
      path: '/ip/pool/add',
      lookup: { path: '/ip/pool/print', filters: [`?name=${nombre}`] },
      upsert: true,
      params: [`=name=${nombre}`, `=ranges=${datos.firstUsable}-${datos.lastUsable}`],
      comando: `/ip/pool/set [find name="${nombre}"] ranges=${datos.firstUsable}-${datos.lastUsable}`,
      descripcion: `Asegurar el pool ${nombre} con ${datos.usable} direcciones`,
    },
    {
      op: 'pool-address-upsert',
      tipo: 'address-list',
      path: '/ip/firewall/address-list/add',
      lookup: { path: '/ip/firewall/address-list/print', filters: [`?list=CT-POOL-${slug(pool.name).toUpperCase()}`, `?address=${datos.network}/${datos.prefix}`] },
      upsert: true,
      params: [`=list=CT-POOL-${slug(pool.name).toUpperCase()}`, `=address=${datos.network}/${datos.prefix}`, '=comment=CRACKENTICK pool'],
      comando: `/ip/firewall/address-list/set [find list=CT-POOL-${slug(pool.name).toUpperCase()} address=${datos.network}/${datos.prefix}] comment="CRACKENTICK pool"`,
      descripcion: `Asegurar el bloque ${datos.network}/${datos.prefix} en la lista de direcciones`,
    },
  ];
}

/** Comandos para sincronizar las reglas de un plan en todos sus servicios. */
function construirSincronizacionPlan(plan, subscriptions, { router = null, planMax = {} } = {}) {
  const addressList = esAddressList(plan);
  const perfil = addressList ? 'ct-address-list' : nombrePerfil(plan);
  const comandos = [];

  if (addressList) {
    comandos.push(...construirBaseAddressList(plan, router, planMax));
    comandos.push({
      op: 'profile-neutral-upsert',
      tipo: 'ppp-profile',
      path: '/ppp/profile/add',
      lookup: { path: '/ppp/profile/print', filters: ['?name=ct-address-list'] },
      upsert: true,
      params: ['=name=ct-address-list', '=comment=CRACKENTICK planes por address list'],
      paramsSet: ['=rate-limit=0/0', '=comment=CRACKENTICK planes por address list'],
      comando: '/ppp/profile/set [find name="ct-address-list"] comment="CRACKENTICK planes por address list"',
      descripcion: 'Asegurar el profile PPPoE neutro para planes por address list',
    });
  } else {
    comandos.push({
      op: 'profile-upsert',
      tipo: 'ppp-profile',
      path: '/ppp/profile/add',
      lookup: { path: '/ppp/profile/print', filters: [`?name=${perfil}`] },
      upsert: true,
      params: [`=name=${perfil}`, `=rate-limit=${limite(plan)}`, `=comment=CRACKENTICK plan ${String(plan.name || '').replace(/"/g, "'")}`],
      comando: `/ppp/profile/set [find name="${perfil}"] rate-limit=${limite(plan)}`,
      descripcion: `Asegurar el profile del plan ${plan.name} (${limiteVisible(plan)})`,
    });
  }

  subscriptions.forEach((subscription) => {
    const config = subscription.serviceConfig || {};
    const cola = nombreCola(subscription);
    const comentario = comentarioCliente(subscription);

    if (config.connectionType === 'pppoe' && config.pppoeUsername) {
      comandos.push({
        op: 'pppoe-set-profile',
        tipo: 'pppoe',
        path: '/ppp/secret/set',
        lookup: { path: '/ppp/secret/print', filters: [`?name=${config.pppoeUsername}`] },
        params: [`=profile=${perfil}`, `=comment=${comentario}`],
        comando: `/ppp/secret/set [find name="${config.pppoeUsername}"] profile="${perfil}"`,
        descripcion: `Asignar ${perfil} al servicio ${subscription.clientId?.clientCode || config.pppoeUsername}`,
      });
    }

    if (config.ipAddress && addressList) {
      const lista = nombreListaPlan(plan);
      comandos.push({
        op: 'plan-address-upsert',
        tipo: 'address-list',
        path: '/ip/firewall/address-list/add',
        lookup: { path: '/ip/firewall/address-list/print', filters: [`?list=${lista}`, `?address=${config.ipAddress}`] },
        upsert: true,
        params: [`=list=${lista}`, `=address=${config.ipAddress}`, `=comment=${comentario}`],
        comando: `/ip/firewall/address-list/set [find list=${lista} address=${config.ipAddress}] comment="${comentario}"`,
        descripcion: `Asegurar ${config.ipAddress} en la lista ${lista}`,
      });
    } else if (config.ipAddress) {
      comandos.push({
        op: 'queue-upsert',
        tipo: 'queue',
        path: '/queue/simple/add',
        lookup: { path: '/queue/simple/print', filters: [`?name=${cola}`] },
        upsert: true,
        params: [`=name=${cola}`, `=target=${config.ipAddress}`, `=max-limit=${limite(plan)}`, `=comment=${comentario}`],
        comando: `/queue/simple/set [find name="${cola}"] max-limit=${limite(plan)}`,
        descripcion: `Actualizar la cola de ${subscription.clientId?.clientCode || config.ipAddress} a ${limiteVisible(plan)}`,
      });
    }

    if (config.connectionType !== 'pppoe' && config.ipAddress) {
      comandos.push({
        op: 'address-upsert',
        tipo: 'address-list',
        path: '/ip/firewall/address-list/add',
        lookup: { path: '/ip/firewall/address-list/print', filters: ['?list=CLIENTES', `?address=${config.ipAddress}`] },
        upsert: true,
        params: ['=list=CLIENTES', `=address=${config.ipAddress}`, `=comment=${comentario}`],
        comando: `/ip/firewall/address-list/set [find list=CLIENTES address=${config.ipAddress}] comment="${comentario}"`,
        descripcion: `Asegurar ${config.ipAddress} en la lista CLIENTES`,
      });
    }
  });

  return comandos;
}

/** Comandos para retirar los objetos de un plan por address list de un router. */
function construirEliminacionPlan(plan) {
  if (!esAddressList(plan)) return [];
  const sufijo = slug(plan.name || 'plan');
  const lista = nombreListaPlan(plan);
  const comandos = [];
  ['down', 'up'].forEach((direccion) => {
    comandos.push({
      op: `plan-${direccion}-remove`,
      tipo: 'queue-tree',
      path: '/queue/tree/remove',
      lookup: { path: '/queue/tree/print', filters: [`?name=${nombreColaPlan(plan, direccion)}`] },
      params: [],
      comando: `/queue/tree/remove [find name="${nombreColaPlan(plan, direccion)}"]`,
      descripcion: `Eliminar la cola ${direccion} del plan ${plan.name}`,
    });
    comandos.push({
      op: `pcq-${direccion}-remove`,
      tipo: 'queue-type',
      path: '/queue/type/remove',
      lookup: { path: '/queue/type/print', filters: [`?name=${nombrePcq(plan, direccion)}`] },
      params: [],
      comando: `/queue/type/remove [find name="${nombrePcq(plan, direccion)}"]`,
      descripcion: `Eliminar el PCQ ${direccion} del plan ${plan.name}`,
    });
    comandos.push({
      op: `mangle-${direccion}-remove`,
      tipo: 'mangle',
      path: '/ip/firewall/mangle/remove',
      lookup: { path: '/ip/firewall/mangle/print', filters: [`?comment=CRACKENTICK-plan-${sufijo}-${direccion}`] },
      params: [],
      comando: `/ip/firewall/mangle/remove [find comment="CRACKENTICK-plan-${sufijo}-${direccion}"]`,
      descripcion: `Eliminar la marca ${direccion} del plan ${plan.name}`,
    });
  });
  comandos.push({
    op: 'plan-address-remove',
    tipo: 'address-list',
    path: '/ip/firewall/address-list/remove',
    lookup: { path: '/ip/firewall/address-list/print', filters: [`?list=${lista}`] },
    params: [],
    comando: `/ip/firewall/address-list/remove [find list=${lista}]`,
    descripcion: `Eliminar la lista ${lista}`,
  });
  return comandos;
}

async function eliminarPlan(plan, { actor = 'admin' } = {}) {
  if (!esAddressList(plan)) return { ok: true, omitido: true, comandos: [] };
  const routers = await Router.find({ _id: { $in: plan.routerIds || [] } }).select('+passwordEnc');
  const comandos = construirEliminacionPlan(plan);
  const resultados = [];
  for (const router of routers) {
    const parcial = await ejecutarComandos(router, comandos, {
      actor,
      module: 'provisioning',
      action: 'delete',
      entity: 'Plan',
      entityId: plan._id,
      descripcion: `Retirar objetos del plan ${plan.name} de ${router.name}.`,
      continuarEnError: true,
    });
    resultados.push(parcial);
  }
  return { ok: resultados.every((r) => r.ok), comandos, resultados };
}

async function obtenerRouter(routerId) {
  if (routerId) return Router.findById(routerId).select('+passwordEnc +enablePasswordEnc');
  return Router.findOne({ active: true }).sort({ createdAt: 1 }).select('+passwordEnc +enablePasswordEnc');
}

async function ejecutarComandos(router, comandos, { actor = 'admin', module = 'provisioning', action = 'provision', entity = 'Subscription', entityId = '', descripcion = '', continuarEnError = false } = {}) {
  const simulado = !router || router.mode !== 'real';
  const resultados = [];
  const inicio = Date.now();

  if (!comandos.length) {
    return { ok: true, simulado, comandos: [], resultados: [], durationMs: 0, salida: '' };
  }

  if (!simulado && router.vendor === 'cisco') {
    const mensaje = 'El aprovisionamiento de PPPoE, colas, address list, EOIP y firewall para Cisco todavía es experimental y no se ejecuta automáticamente. Usa VLANs o el respaldo SSH.';
    const resultado = {
      ok: false,
      simulado: false,
      comandos,
      resultados: [{ comando: 'Cisco SSH', ok: false, result: mensaje }],
      durationMs: 0,
      salida: mensaje,
    };
    await registrar({
      module,
      entity,
      entityId,
      action,
      description: descripcion || mensaje,
      command: comandos.map((c) => c.comando).join('\n'),
      commandResult: mensaje,
      status: 'failed',
      actor,
    });
    return resultado;
  }

  for (const cmd of comandos) {
    if (simulado) {
      resultados.push({ comando: cmd.comando, ok: true, result: 'SIMULATED: comando registrado, no ejecutado.' });
      continue;
    }
    try {
      // Conexión aislada por comando: RouterOS 7 responde `!empty` ante un
      // lookup sin filas y node-routeros desincroniza la conexión si se reutiliza.
      const respuesta = await routeros.ejecutar(router, cmd);
      resultados.push({ comando: cmd.comando, ok: respuesta.ok, result: respuesta.result });
      if (!respuesta.ok && !continuarEnError) break;
    } catch (error) {
      resultados.push({ comando: cmd.comando, ok: false, result: error.message });
      if (!continuarEnError) break;
    }
  }

  const ok = resultados.length === comandos.length && resultados.every((r) => r.ok);
  const duracion = Date.now() - inicio;
  const texto = comandos.map((c) => c.comando).join('\n');
  const salida = resultados.map((r) => `${r.ok ? 'OK' : 'ERROR'} · ${r.result}`).join('\n');

  await registrar({
    module,
    entity,
    entityId,
    action,
    description: descripcion || `${simulado ? 'Simulación' : 'Ejecución'} de ${comandos.length} comando(s) de aprovisionamiento.`,
    command: texto,
    commandResult: salida.slice(0, 1900),
    status: ok ? 'success' : 'failed',
    durationMs: duracion,
    actor,
  });

  return { ok, simulado, comandos, resultados, durationMs: duracion, salida };
}

/** Aprovisiona un servicio: crea, actualiza o elimina PPPoE, cola e IP. */
async function aprovisionar(subscription, { accion = 'create', actor = 'admin' } = {}) {
  const completa = await Subscription.findById(subscription._id || subscription)
    .select('+serviceConfig.pppoePasswordEnc')
    .populate('clientId')
    .populate('planId');
  if (!completa) throw new Error('El servicio no existe.');

  if (!completa.serviceConfig.routerId) {
    const error = new Error('El servicio no tiene un router asignado. Asígnalo antes de aprovisionar.');
    error.status = 422;
    throw error;
  }

  const router = await obtenerRouter(completa.serviceConfig.routerId);
  if (!router) {
    const error = new Error('El router asignado al servicio ya no existe. Corrige el servicio antes de aprovisionar.');
    error.status = 422;
    throw error;
  }
  const planDoc = completa.planId || completa.planSnapshot || {};
  const addressList = esAddressList(planDoc);
  if (addressList && !completa.serviceConfig.ipAddress) {
    throw new Error('Los planes por address list necesitan una IP fija para el servicio.');
  }
  const password = completa.serviceConfig.pppoePasswordEnc
    ? descifrar(completa.serviceConfig.pppoePasswordEnc)
    : '';
  const planMax = addressList && router
    ? await capacityService.capacidadPlanRouter(planDoc, router._id)
    : {};
  const comandos = construirAprovisionamiento(completa, { accion, password, router, plan: planDoc, planMax });

  /* Cliente cortado: el PPPoE se crea pero queda deshabilitado y su IP entra en MOROSOS. */
  const suspendido = completa.status === 'suspended' || completa.clientId?.status === 'suspended';
  if (accion !== 'delete' && suspendido) {
    if (completa.serviceConfig.connectionType === 'pppoe' && completa.serviceConfig.pppoeUsername) {
      comandos.push({
        op: 'pppoe-disable',
        tipo: 'pppoe',
        path: '/ppp/secret/set',
        lookup: { path: '/ppp/secret/print', filters: [`?name=${completa.serviceConfig.pppoeUsername}`] },
        params: ['=disabled=yes'],
        comando: `/ppp/secret/disable [find name="${completa.serviceConfig.pppoeUsername}"]`,
        descripcion: 'Dejar el secret PPPoE deshabilitado',
      });
    }
    if (completa.serviceConfig.ipAddress) {
      const codigo = completa.clientId?.clientCode || 'CLIENTE';
      comandos.push({
        op: 'moroso-upsert',
        tipo: 'address-list',
        path: '/ip/firewall/address-list/add',
        lookup: { path: '/ip/firewall/address-list/print', filters: ['?list=MOROSOS', `?address=${completa.serviceConfig.ipAddress}`] },
        upsert: true,
        params: ['=list=MOROSOS', `=address=${completa.serviceConfig.ipAddress}`, `=comment=CRACKENTICK ${codigo}`],
        paramsSet: [`=comment=CRACKENTICK ${codigo}`],
        comando: `/ip firewall address-list add list=MOROSOS address=${completa.serviceConfig.ipAddress}`,
        descripcion: 'Agregar la IP a MOROSOS sin duplicar',
      });
    }
  }

  const resultado = await ejecutarComandos(router, comandos, {
    actor,
    module: 'provisioning',
    action: 'provision',
    entity: 'Subscription',
    entityId: completa._id,
    descripcion: `${accion === 'delete' ? 'Baja' : accion === 'create' ? 'Alta' : 'Actualización'} de red de ${completa.clientId?.clientCode || 'servicio'} (${router?.name || 'sin router'}).`,
  });

  completa.serviceConfig.queueName = addressList ? '' : nombreCola(completa);
  completa.serviceConfig.provisioningState = resultado.ok ? 'ok' : 'error';
  completa.serviceConfig.provisionedAt = new Date();
  completa.serviceConfig.lastProvisionResult = resultado.ok
    ? `${comandos.length} comando(s) ${resultado.simulado ? 'simulados' : 'ejecutados'}.`
    : (resultado.resultados.find((r) => !r.ok) || {}).result || 'Error de aprovisionamiento.';
  await completa.save();

  return { ...resultado, router, subscription: completa, comandos };
}

/** Sincroniza el profile y las colas de todos los servicios de un plan. */
async function sincronizarPlan(plan, { actor = 'admin' } = {}) {
  const subscriptions = await Subscription.find({ planId: plan._id }).populate('clientId');
  if (!subscriptions.length) return { ok: true, omitido: true, comandos: [], resultados: [] };

  const porRouter = new Map();
  subscriptions.forEach((subscription) => {
    const id = String(subscription.serviceConfig?.routerId || '');
    if (!porRouter.has(id)) porRouter.set(id, []);
    porRouter.get(id).push(subscription);
  });

  const routers = await Router.find({ _id: { $in: [...porRouter.keys()].filter(Boolean) } }).select('+passwordEnc');
  const resultados = [];
  const comandos = [];

  for (const [routerId, listaSuscripciones] of porRouter) {
    const router = routers.find((r) => String(r._id) === routerId);
    /* Sin router o con un router eliminado no hay dónde aplicar el plan. */
    if (!router) continue;
    const planMax = await capacityService.capacidadPlanRouter(plan, router._id);
    const comandosRouter = construirSincronizacionPlan(plan, listaSuscripciones, { router, planMax });
    comandos.push(...comandosRouter);

    const parcial = await ejecutarComandos(router, comandosRouter, {
      actor,
      module: 'provisioning',
      action: 'sync',
      entity: 'Plan',
      entityId: plan._id,
      descripcion: `Sincronización de reglas del plan ${plan.name} (${listaSuscripciones.length} servicio(s)).`,
      continuarEnError: true,
    });
    resultados.push(parcial);
  }

  return {
    ok: resultados.every((r) => r.ok),
    comandos,
    resultados,
    simulados: resultados.every((r) => r.simulado),
  };
}

/** Aplica un pool CIDR al router. */
async function aplicarPool(pool, { actor = 'admin' } = {}) {
  const router = await obtenerRouter(pool.routerId);
  if (!router) throw new Error('No hay un router activo para aplicar el pool.');
  const comandos = construirPool(pool);
  const resultado = await ejecutarComandos(router, comandos, {
    actor,
    module: 'provisioning',
    action: 'sync',
    entity: 'IpPool',
    entityId: pool._id,
    descripcion: `Aplicación del pool ${pool.name} (${pool.cidr}) en ${router?.name || 'sin router'}.`,
  });
  pool.appliedAt = new Date();
  pool.lastApplyResult = resultado.ok ? 'Pool aplicado correctamente.' : 'Error al aplicar el pool.';
  await pool.save();
  return { ...resultado, router };
}

async function probarConexion(router, { actor = 'admin' } = {}) {
  if (!router) throw new Error('El router no existe.');
  const inicio = Date.now();
  if (router.mode !== 'real') {
    const resultado = {
      ok: true,
      command: '/system/identity/print',
      result: `SIMULATED: conexión simulada con ${router.name}.`,
      simulated: true,
      durationMs: 2,
    };
    router.lastTestAt = new Date();
    router.lastTestOk = true;
    router.lastTestResult = resultado.result;
    await router.save();
    return resultado;
  }
  if (router.vendor === 'cisco') {
    try {
      const resultado = await ciscoService.probar(router);
      router.lastTestAt = new Date();
      router.lastTestOk = resultado.ok;
      router.lastTestResult = resultado.result;
      await router.save();
      await registrar({
        module: 'provisioning',
        entity: 'Router',
        entityId: router._id,
        action: 'test_connection',
        description: `Prueba SSH ${resultado.ok ? 'correcta' : 'fallida'} con ${router.name} (Cisco experimental).`,
        command: resultado.command,
        commandResult: resultado.result,
        status: resultado.ok ? 'success' : 'failed',
        durationMs: resultado.durationMs,
        actor,
      });
      return resultado;
    } catch (error) {
      const resultado = { ok: false, command: 'show version', result: error.message, simulated: false, durationMs: Date.now() - inicio };
      router.lastTestAt = new Date();
      router.lastTestOk = false;
      router.lastTestResult = error.message;
      await router.save();
      await registrar({
        module: 'provisioning',
        entity: 'Router',
        entityId: router._id,
        action: 'test_connection',
        description: `Falló la prueba SSH con ${router.name} (Cisco experimental).`,
        command: resultado.command,
        commandResult: error.message,
        status: 'failed',
        durationMs: resultado.durationMs,
        actor,
      });
      return resultado;
    }
  }
  if (router.transport === 'ssh') {
    const inicioSsh = Date.now();
    try {
      const salida = await mikrotikSsh.ejecutar(router, ['/system identity print']);
      const resultado = {
        ok: true,
        command: 'SSH /system identity print',
        result: String(salida || '').trim().slice(0, 400) || 'SSH respondió sin salida.',
        simulated: false,
        durationMs: Date.now() - inicioSsh,
      };
      router.lastTestAt = new Date();
      router.lastTestOk = true;
      router.lastTestResult = resultado.result;
      await router.save();
      await registrar({
        module: 'provisioning',
        entity: 'Router',
        entityId: router._id,
        action: 'test_connection',
        description: `Prueba SSH correcta con ${router.name}.`,
        command: resultado.command,
        commandResult: resultado.result,
        status: 'success',
        durationMs: resultado.durationMs,
        actor,
      });
      return resultado;
    } catch (error) {
      const resultado = {
        ok: false,
        command: 'SSH /system identity print',
        result: error.message,
        simulated: false,
        durationMs: Date.now() - inicioSsh,
      };
      router.lastTestAt = new Date();
      router.lastTestOk = false;
      router.lastTestResult = error.message;
      await router.save();
      await registrar({
        module: 'provisioning',
        entity: 'Router',
        entityId: router._id,
        action: 'test_connection',
        description: `Falló la prueba SSH con ${router.name}.`,
        command: resultado.command,
        commandResult: error.message,
        status: 'failed',
        durationMs: resultado.durationMs,
        actor,
      });
      return resultado;
    }
  }
  try {
    const conexion = await routeros.conectar(router);
    try {
      const identidad = await conexion.write('/system/identity/print');
      const resultado = {
        ok: true,
        command: '/system/identity/print',
        result: JSON.stringify(identidad ?? {}).slice(0, 400),
        simulated: false,
        durationMs: Date.now() - inicio,
      };
      router.lastTestAt = new Date();
      router.lastTestOk = true;
      router.lastTestResult = resultado.result;
      await router.save();
      await registrar({
        module: 'provisioning',
        entity: 'Router',
        entityId: router._id,
        action: 'test_connection',
        description: `Prueba de conexión correcta con ${router.name}.`,
        command: resultado.command,
        commandResult: resultado.result,
        status: 'success',
        durationMs: resultado.durationMs,
        actor,
      });
      return resultado;
    } finally {
      routeros.cerrar(conexion);
    }
  } catch (error) {
    const resultado = {
      ok: false,
      command: '/system/identity/print',
      result: error.message,
      simulated: false,
      durationMs: Date.now() - inicio,
    };
    router.lastTestAt = new Date();
    router.lastTestOk = false;
    router.lastTestResult = error.message;
    await router.save();
    await registrar({
      module: 'provisioning',
      entity: 'Router',
      entityId: router._id,
      action: 'test_connection',
      description: `Falló la prueba de conexión con ${router.name}.`,
      command: resultado.command,
      commandResult: error.message,
      status: 'failed',
      durationMs: resultado.durationMs,
      actor,
    });
    return resultado;
  }
}

/** Serializa las lecturas de un router para compartir una sola conexión API. */
function enColaMonitoreo(clave, tarea) {
  const anterior = COLAS_MONITOREO.get(clave) || Promise.resolve();
  const siguiente = anterior.catch(() => {}).then(tarea);
  COLAS_MONITOREO.set(clave, siguiente);
  siguiente.then(
    () => { if (COLAS_MONITOREO.get(clave) === siguiente) COLAS_MONITOREO.delete(clave); },
    () => { if (COLAS_MONITOREO.get(clave) === siguiente) COLAS_MONITOREO.delete(clave); }
  );
  return siguiente;
}

async function conexionMonitoreo(router) {
  const clave = String(router._id);
  const existente = CONEXIONES_MONITOREO.get(clave);
  if (existente) return existente;
  const conexion = await routeros.conectar(router);
  CONEXIONES_MONITOREO.set(clave, conexion);
  return conexion;
}

function invalidarConexionMonitoreo(router) {
  const clave = String(router?._id || '');
  const conexion = CONEXIONES_MONITOREO.get(clave);
  if (conexion) routeros.cerrar(conexion);
  CONEXIONES_MONITOREO.delete(clave);
}

/** Cierra las conexiones persistentes usadas por el monitor WAN. */
function cerrarMonitoreo() {
  for (const conexion of CONEXIONES_MONITOREO.values()) routeros.cerrar(conexion);
  CONEXIONES_MONITOREO.clear();
  COLAS_MONITOREO.clear();
}

async function consultarTraficoReal(router, wan) {
  const conexion = await conexionMonitoreo(router);
  const filas = await conexion.write('/interface/monitor-traffic', [`=interface=${wan.name}`, '=once=']);
  const fila = Array.isArray(filas) ? filas[0] : filas || {};
  return {
    ok: true,
    rx: Number(fila['rx-bits-per-second'] || 0),
    tx: Number(fila['tx-bits-per-second'] || 0),
    status: 'up',
    simulated: false,
  };
}

/** Lectura instantánea de tráfico de una interfaz WAN. En simulado hace random walk. */
async function leerTrafico(router, wan) {
  if (!router || router.mode !== 'real') {
    const clave = `${router?._id || 'x'}:${wan.name}`;
    const anterior = SIM_TRAFICO.get(clave) || {
      rx: (Number(wan.downloadMbps) || 100) * 1e6 * 0.35,
      tx: (Number(wan.uploadMbps) || 50) * 1e6 * 0.2,
    };
    const rx = Math.max(0, anterior.rx * (0.88 + Math.random() * 0.24));
    const tx = Math.max(0, anterior.tx * (0.88 + Math.random() * 0.24));
    SIM_TRAFICO.set(clave, { rx, tx });
    return { ok: true, rx, tx, status: 'up', simulated: true };
  }

  if (router.vendor === 'cisco') {
    return {
      ok: true,
      rx: 0,
      tx: 0,
      status: 'up',
      simulated: false,
      experimental: true,
      error: 'Lectura de tráfico Cisco aún no implementada (experimental).',
    };
  }

  const clave = String(router._id);
  try {
    return await enColaMonitoreo(clave, () => consultarTraficoReal(router, wan));
  } catch (error) {
    invalidarConexionMonitoreo(router);
    try {
      // Reintento único: la conexión persistente pudo quedar ociosa o reiniciada.
      return await enColaMonitoreo(clave, () => consultarTraficoReal(router, wan));
    } catch (segundoError) {
      invalidarConexionMonitoreo(router);
      return { ok: false, rx: 0, tx: 0, status: 'down', simulated: false, error: segundoError.message };
    }
  }
}

/**
 * Lectura instantánea del tráfico de un cliente concreto.
 * Devuelve `null` cuando el router está en modo simulado (el llamador decide
 * cómo generar la muestra), o un objeto con `ok:false` si la lectura real falla.
 */
async function leerTraficoCliente(subscription) {
  const config = (subscription && subscription.serviceConfig) || {};
  const router = await obtenerRouter(config.routerId);
  if (!router || router.mode !== 'real') return null;
  if (router.vendor === 'cisco') {
    return {
      ok: false,
      rx: 0,
      tx: 0,
      status: 'down',
      simulated: false,
      origen: 'cisco',
      error: 'El monitoreo de tráfico Cisco aún no está implementado.',
    };
  }

  const cola = nombreCola(subscription);
  const inicio = Date.now();
  let conexion;
  try {
    conexion = await routeros.conectar(router);
  } catch (error) {
    return { ok: false, rx: 0, tx: 0, status: 'down', simulated: false, origen: 'conexion', error: error.message };
  }

  try {
    const modo = subscription.planSnapshot?.trafficMode || subscription.planId?.trafficMode || 'simple_queue';
    // 1) Estadísticas de la cola simple: campo `rate` en bits/s (rx/tx).
    if (modo !== 'address_list') {
      try {
        const filas = await conexion.write('/queue/simple/print', [`?name=${cola}`]);
        const fila = Array.isArray(filas) ? filas[0] : filas;
        if (fila && fila.rate) {
          const [rx, tx] = String(fila.rate)
            .split('/')
            .map((valor) => Number(String(valor).replace(/[^0-9.]/g, '')) || 0);
          return {
            ok: true,
            rx,
            tx,
            status: rx + tx > 0 ? 'up' : 'idle',
            simulated: false,
            origen: 'queue',
            durationMs: Date.now() - inicio,
          };
        }
      } catch (error) {
        // La cola puede no existir todavía; pasamos al monitoreo de interfaz.
      }
    }

    // 2) Fallback: monitoreo de tráfico de la interfaz (PPPoE o IP).
    const objetivo = config.connectionType === 'pppoe' ? config.pppoeUsername : config.ipAddress;
    if (objetivo) {
      const filas = await conexion.write('/interface/monitor-traffic', [`=interface=${objetivo}`, '=once=']);
      const fila = Array.isArray(filas) ? filas[0] : filas || {};
      const rx = Number(fila['rx-bits-per-second'] || 0);
      const tx = Number(fila['tx-bits-per-second'] || 0);
      return {
        ok: true,
        rx,
        tx,
        status: rx + tx > 0 ? 'up' : 'idle',
        simulated: false,
        origen: 'interface',
        durationMs: Date.now() - inicio,
      };
    }

    return { ok: false, rx: 0, tx: 0, status: 'idle', simulated: false, origen: 'sin-destino', error: 'El servicio no tiene cola ni dirección para monitorear.' };
  } catch (error) {
    return { ok: false, rx: 0, tx: 0, status: 'down', simulated: false, origen: 'lectura', error: error.message };
  } finally {
    routeros.cerrar(conexion);
  }
}

/**
 * Aprovisiona en lote los servicios de un router, incluidos los que todavía
 * no tienen router asignado. Es idempotente: repetir el lote no duplica nada.
 */
async function aprovisionarLote(router, { actor = 'admin', limite = 25, todos = false } = {}) {
  /* Solo se adoptan servicios sin router cuyo plan acepte este equipo. */
  const planes = await Plan.find({ active: true }).select('trafficMode routerIds').lean();
  const planesCompatibles = planes
    .filter((plan) => planService.routerPermitido(plan, router))
    .map((plan) => plan._id);
  const filtro = {
    status: { $ne: 'cancelled' },
    $or: [
      { 'serviceConfig.routerId': router._id },
      { 'serviceConfig.routerId': null, planId: { $in: planesCompatibles } },
    ],
  };
  if (!todos) filtro['serviceConfig.provisioningState'] = { $ne: 'ok' };

  const pendientes = await Subscription.find(filtro).sort({ createdAt: 1 }).limit(limite).select('_id');
  const errores = [];
  let creados = 0;
  let fallos = 0;

  for (const item of pendientes) {
    await Subscription.updateOne({ _id: item._id }, { $set: { 'serviceConfig.routerId': router._id } });
    try {
      const resultado = await aprovisionar(item._id, { accion: 'create', actor });
      if (resultado.ok) {
        creados += 1;
      } else {
        fallos += 1;
        const fallo = resultado.resultados.find((fila) => !fila.ok) || {};
        errores.push({ id: String(item._id), mensaje: String(fallo.result || 'Error de aprovisionamiento.') });
      }
    } catch (error) {
      fallos += 1;
      errores.push({ id: String(item._id), mensaje: error.message });
    }
  }

  const restantes = todos ? 0 : await Subscription.countDocuments(filtro);

  await registrar({
    module: 'provisioning',
    entity: 'Router',
    entityId: router._id,
    action: 'provision',
    description: `Aprovisionamiento en lote de ${router.name}: ${creados} correcto(s), ${fallos} fallido(s).`,
    commandResult: errores.map((error) => error.mensaje).join('\n').slice(0, 1900),
    status: fallos ? 'failed' : 'success',
    actor,
  });

  return { total: pendientes.length, creados, fallos, restantes, errores: errores.slice(0, 8) };
}

module.exports = {
  slug,
  nombreCola,
  nombrePerfil,
  limiteVisible,
  leerTraficoCliente,
  construirAprovisionamiento,
  construirBaseAddressList,
  construirPool,
  construirSincronizacionPlan,
  construirEliminacionPlan,
  eliminarPlan,
  obtenerRouter,
  ejecutarComandos,
  aprovisionar,
  aprovisionarLote,
  sincronizarPlan,
  aplicarPool,
  probarConexion,
  leerTrafico,
  cerrarMonitoreo,
  limite,
};
