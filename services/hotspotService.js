const crypto = require('node:crypto');
const Router = require('../models/Router');
const HotspotPlan = require('../models/HotspotPlan');
const HotspotBatch = require('../models/HotspotBatch');
const HotspotVoucher = require('../models/HotspotVoucher');
const FinanceEntry = require('../models/FinanceEntry');
const routeros = require('./routeros');
const exchangeRateService = require('./exchangeRateService');
const { registrar } = require('./auditService');
const { crearError } = require('../utils/errors');
const { redondear } = require('../utils/money');

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let limpiezaIniciada = false;
let limpiezaEnCurso = false;

function codigo(longitud = 8) {
  const bytes = crypto.randomBytes(longitud);
  return Array.from(bytes).map((byte) => ALFABETO[byte % ALFABETO.length]).join('');
}

function clave(longitud = 6) {
  const bytes = crypto.randomBytes(longitud);
  return Array.from(bytes).map((byte) => String(byte % 10)).join('');
}

function slug(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

/** 150 -> "2h30m"; 0 o vacío -> "". */
function minutosTexto(minutos) {
  const total = Math.max(0, Math.round(Number(minutos) || 0));
  if (!total) return '';
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  return `${horas ? `${horas}h` : ''}${resto ? `${resto}m` : ''}`;
}

function perfilDePlan(plan) {
  return `ct-hotspot-${slug(plan.name)}`;
}

async function detectar(router) {
  const conexion = await routeros.conectar(router);
  try {
    const [servidores, perfiles] = await Promise.all([
      conexion.write('/ip/hotspot/print'),
      conexion.write('/ip/hotspot/user/profile/print'),
    ]);
    return {
      servidores: (servidores || []).map((fila) => ({ name: fila.name, interface: fila.interface || '' })),
      perfiles: (perfiles || []).map((fila) => fila.name).filter(Boolean),
    };
  } finally {
    routeros.cerrar(conexion);
  }
}

function borrarUsuarioHotspot(router, nombre) {
  return routeros
    .ejecutar(router, {
      path: '/ip/hotspot/user/remove',
      lookup: { path: '/ip/hotspot/user/print', filters: [`?name=${nombre}`] },
      comando: `/ip/hotspot/user/remove [find name="${nombre}"]`,
    })
    .catch(() => null);
}

async function crearLote({ router, planId, cantidad, actor = 'admin' }) {
  if (!router.hotspotEnabled) throw crearError(422, 'Este router no está habilitado para hotspot.');
  const plan = await HotspotPlan.findById(planId);
  if (!plan || !plan.active) throw crearError(422, 'Selecciona un plan de hotspot activo.');

  const perfil = perfilDePlan(plan);
  const limite = plan.downloadMbps || plan.uploadMbps
    ? `${plan.downloadMbps ? `${plan.downloadMbps}M` : '0'}/${plan.uploadMbps ? `${plan.uploadMbps}M` : '0'}`
    : '';
  const total = Math.min(200, Math.max(1, Number(cantidad) || 1));

  const respuestaPerfil = await routeros
    .ejecutar(router, {
      path: '/ip/hotspot/user/profile/add',
      lookup: { path: '/ip/hotspot/user/profile/print', filters: [`?name=${perfil}`] },
      upsert: true,
      params: [`=name=${perfil}`, '=shared-users=1', ...(limite ? [`=rate-limit=${limite}`] : [])],
      paramsSet: limite ? [`=rate-limit=${limite}`] : [],
      comando: `/ip/hotspot/user/profile/add name=${perfil}${limite ? ` rate-limit=${limite}` : ''}`,
    })
    .catch((error) => ({ ok: false, result: error.message }));
  if (!respuestaPerfil.ok) {
    throw crearError(502, `El router rechazó el perfil ${perfil}; no se creó el lote: ${respuestaPerfil.result}`);
  }

  const lote = await HotspotBatch.create({
    routerId: router._id,
    routerName: router.name,
    planId: plan._id,
    profile: plan.name,
    quantity: total,
    durationMinutes: plan.durationMinutes,
    durationHours: Math.round((plan.durationMinutes || 0) / 6) / 10,
    dataLimitMB: plan.dataLimitMB,
    price: plan.price,
    createdBy: actor,
  });

  const uptime = minutosTexto(plan.durationMinutes);
  const vouchers = [];
  const errores = [];
  const usados = new Set();

  for (let i = 0; i < total; i += 1) {
    let nombre = codigo();
    while (usados.has(nombre)) nombre = codigo();
    usados.add(nombre);
    const pass = clave();
    const parametros = [`=name=${nombre}`, `=password=${pass}`, `=profile=${perfil}`, `=comment=CRACKENTICK ${lote._id}`];
    if (uptime) parametros.push(`=limit-uptime=${uptime}`);
    if (plan.dataLimitMB > 0) parametros.push(`=limit-bytes-total=${Math.round(plan.dataLimitMB * 1048576)}`);

    const respuesta = await routeros
      .ejecutar(router, {
        path: '/ip/hotspot/user/add',
        lookup: { path: '/ip/hotspot/user/print', filters: [`?name=${nombre}`] },
        upsert: true,
        params: parametros,
        paramsSet: parametros.filter((parametro) => !parametro.startsWith('=name=')),
        comando: `/ip/hotspot/user/add name=${nombre} profile=${perfil}${uptime ? ` limit-uptime=${uptime}` : ''}`,
      })
      .catch((error) => ({ ok: false, result: error.message }));

    if (!respuesta.ok) {
      errores.push({ code: nombre, mensaje: respuesta.result });
      continue;
    }

    try {
      const voucher = await HotspotVoucher.create({
        batchId: lote._id,
        routerId: router._id,
        planId: plan._id,
        code: nombre,
        password: pass,
        profile: plan.name,
        durationMinutes: plan.durationMinutes,
        durationHours: Math.round((plan.durationMinutes || 0) / 6) / 10,
        dataLimitMB: plan.dataLimitMB,
        price: plan.price,
        status: 'available',
      });
      vouchers.push(voucher);
    } catch (error) {
      await borrarUsuarioHotspot(router, nombre);
      errores.push({ code: nombre, mensaje: `No se guardó en la base: ${error.message}` });
    }
  }

  if (errores.length) {
    lote.status = 'incomplete';
    lote.lastErrors = errores.map((error) => `${error.code}: ${error.mensaje}`.slice(0, 200));
    await lote.save();
  }

  await registrar({
    module: 'provisioning',
    entity: 'HotspotBatch',
    entityId: lote._id,
    action: 'create',
    description: `Lote de ${vouchers.length}/${total} vouchers hotspot en ${router.name} (${plan.name}).`,
    commandResult: errores.map((error) => `${error.code}: ${error.mensaje}`).join('\n').slice(0, 1900),
    status: errores.length ? 'failed' : 'success',
    actor,
  });

  return { lote, vouchers, errores };
}

async function vender(
  voucher,
  router,
  { actor = 'admin', clientId = null, paymentMethod = 'cash', currency = 'USD', amount = null, exchangeRate = null, reference = '' } = {}
) {
  const moneda = String(currency).toUpperCase() === 'VES' ? 'VES' : 'USD';
  let monto = Number(amount);
  if (!Number.isFinite(monto) || monto <= 0) monto = Number(voucher.price) || 0;
  let tasa = Number(exchangeRate) || 0;
  let montoUsd = monto;
  if (moneda === 'VES') {
    if (!(tasa > 0)) {
      const actual = await exchangeRateService.tasaActual();
      tasa = actual.ok ? Number(actual.rate) : 0;
    }
    if (!(tasa > 0)) throw crearError(422, 'No hay tasa BCV disponible para cobrar en bolívares. Registra la tasa o cobra en USD.');
    montoUsd = redondear(monto / tasa);
  } else {
    tasa = 0;
  }

  const reclamado = await HotspotVoucher.findOneAndUpdate(
    { _id: voucher._id, status: 'available' },
    {
      $set: {
        status: 'sold',
        soldAt: new Date(),
        soldBy: actor,
        clientId: clientId || null,
        paymentCurrency: moneda,
        paymentAmount: monto,
        exchangeRate: tasa,
        amountUsd: montoUsd,
        paymentReference: String(reference || '').slice(0, 80),
      },
    },
    { new: true }
  );
  if (!reclamado) throw crearError(409, 'El voucher ya fue vendido o no está disponible.');

  let entrada = null;
  try {
    if (monto > 0) {
      entrada = await FinanceEntry.create({
        type: 'income',
        category: 'ventas',
        concept: `Voucher hotspot ${reclamado.code}`,
        amount: monto,
        currency: moneda,
        exchangeRate: tasa,
        paymentMethod,
        amountUsd: montoUsd,
        date: new Date(),
        status: 'paid',
        reference: reclamado.paymentReference || `HOTSPOT-${reclamado.code}`,
        notes: `Router ${router.name} · perfil ${reclamado.profile}`,
        createdBy: actor,
      });
      reclamado.financeEntryId = entrada._id;
      await reclamado.save();
    }
  } catch (error) {
    await HotspotVoucher.updateOne(
      { _id: reclamado._id, status: 'sold' },
      {
        $set: {
          status: 'available',
          soldAt: null,
          soldBy: '',
          clientId: null,
          financeEntryId: null,
          paymentCurrency: 'USD',
          paymentAmount: 0,
          exchangeRate: 0,
          amountUsd: 0,
          paymentReference: '',
        },
      }
    ).catch(() => null);
    if (entrada) await FinanceEntry.deleteOne({ _id: entrada._id }).catch(() => null);
    throw error;
  }

  await registrar({
    module: 'financial',
    entity: 'HotspotVoucher',
    entityId: reclamado._id,
    action: 'payment',
    description: `Voucher ${reclamado.code} vendido (${monto} ${moneda}${moneda === 'VES' ? ` · tasa ${tasa} · ${montoUsd} USD` : ''}).`,
    changes: { after: { paymentCurrency: moneda, paymentAmount: monto, exchangeRate: tasa, amountUsd: montoUsd } },
    status: 'success',
    actor,
  });

  return { voucher: reclamado, entrada };
}

async function revocar(voucher, router, { actor = 'admin' } = {}) {
  if (voucher.status === 'revoked') return voucher;
  await routeros
    .ejecutar(router, {
      path: '/ip/hotspot/active/remove',
      lookup: { path: '/ip/hotspot/active/print', filters: [`?user=${voucher.code}`] },
      comando: `/ip/hotspot/active/remove [find user="${voucher.code}"]`,
    })
    .catch(() => null);
  const respuesta = await routeros
    .ejecutar(router, {
      path: '/ip/hotspot/user/set',
      lookup: { path: '/ip/hotspot/user/print', filters: [`?name=${voucher.code}`] },
      params: ['=disabled=yes'],
      comando: `/ip/hotspot/user/disable [find name="${voucher.code}"]`,
    })
    .catch((error) => ({ ok: false, result: error.message }));

  if (!respuesta.ok && !/no existe/i.test(String(respuesta.result))) {
    throw crearError(502, respuesta.result || 'No se pudo deshabilitar el usuario en el router.');
  }

  voucher.status = 'revoked';
  await voucher.save();
  await registrar({
    module: 'provisioning',
    entity: 'HotspotVoucher',
    entityId: voucher._id,
    action: 'update',
    description: `Voucher ${voucher.code} revocado.`,
    status: 'success',
    actor,
  });
  return voucher;
}

/** "1h2m3s", "5m20s", "30s" o "2d" -> segundos. */
function segundosUptime(texto) {
  const valor = String(texto || '');
  const partes = { w: 0, d: 0, h: 0, m: 0, s: 0 };
  const regex = /(\d+)([wdhms])/g;
  let marca = regex.exec(valor);
  while (marca) {
    partes[marca[2]] = Number(marca[1]);
    marca = regex.exec(valor);
  }
  return partes.w * 604800 + partes.d * 86400 + partes.h * 3600 + partes.m * 60 + partes.s;
}

/**
 * Elimina del router los usuarios de vouchers vendidos cuyo tiempo ya terminó.
 * El reloj empieza en la primera conexión del voucher, no en la venta. Borra
 * la sesión activa y el usuario, y marca el voucher como vencido.
 */
async function limpiarVencidos() {
  const vendidos = await HotspotVoucher.find({ status: 'sold', durationMinutes: { $gt: 0 } }).lean();
  if (!vendidos.length) return { eliminados: 0 };

  const porRouter = new Map();
  for (const voucher of vendidos) {
    const llave = String(voucher.routerId);
    if (!porRouter.has(llave)) porRouter.set(llave, []);
    porRouter.get(llave).push(voucher);
  }

  let eliminados = 0;
  for (const [routerId, vouchers] of porRouter) {
    const router = await Router.findById(routerId).select('+passwordEnc');
    if (!router) continue;

    let conexion;
    try {
      conexion = await routeros.conectar(router);
    } catch (error) {
      continue;
    }
    try {
      const activos = await conexion.write('/ip/hotspot/active/print').catch(() => []);
      for (const voucher of vouchers) {
        const sesion = (activos || []).find((fila) => fila.user === voucher.code);
        let inicio = voucher.startedAt ? new Date(voucher.startedAt) : null;
        if (!inicio) {
          /* Un voucher sin usar no corre: el tiempo empieza con la primera sesión. */
          if (!sesion) continue;
          inicio = new Date(Date.now() - segundosUptime(sesion.uptime) * 1000);
          await HotspotVoucher.updateOne({ _id: voucher._id }, { $set: { startedAt: inicio } });
        }
        if (Date.now() < inicio.getTime() + voucher.durationMinutes * 60000) continue;

        let borradoOk = true;
        if (sesion) {
          try {
            await conexion.write('/ip/hotspot/active/remove', [`=.id=${sesion['.id']}`]);
          } catch (error) {
            borradoOk = false;
          }
        }
        if (borradoOk) {
          try {
            const usuarios = await conexion.write('/ip/hotspot/user/print', [`?name=${voucher.code}`]);
            for (const usuario of usuarios || []) {
              try {
                await conexion.write('/ip/hotspot/user/remove', [`=.id=${usuario['.id']}`]);
              } catch (error) {
                borradoOk = false;
              }
            }
          } catch (error) {
            borradoOk = false;
          }
        }
        /* Si el router no confirmó el borrado, sigue `sold` para reintentar. */
        if (!borradoOk) continue;

        await HotspotVoucher.updateOne(
          { _id: voucher._id, status: 'sold' },
          { $set: { status: 'expired', expiredAt: new Date() } }
        );
        eliminados += 1;
      }
    } finally {
      routeros.cerrar(conexion);
    }
  }

  if (eliminados) {
    await registrar({
      module: 'provisioning',
      entity: 'HotspotVoucher',
      action: 'update',
      description: `Vouchers vencidos: ${eliminados} usuario(s) eliminados del router.`,
      status: 'success',
      actor: 'scheduler',
    }).catch(() => null);
  }
  return { eliminados };
}

function iniciarLimpieza() {
  if (limpiezaIniciada) return;
  limpiezaIniciada = true;
  const ejecutar = function () {
    if (limpiezaEnCurso) return;
    limpiezaEnCurso = true;
    limpiarVencidos()
      .catch((error) => console.error('Hotspot vencidos:', error.message))
      .finally(() => { limpiezaEnCurso = false; });
  };
  const inicial = setTimeout(ejecutar, 2 * 60 * 1000);
  if (inicial.unref) inicial.unref();
  const temporizador = setInterval(ejecutar, 5 * 60 * 1000);
  temporizador.unref();
}

module.exports = {
  detectar,
  crearLote,
  vender,
  revocar,
  limpiarVencidos,
  iniciarLimpieza,
  perfilDePlan,
  minutosTexto,
  segundosUptime,
  codigo,
  clave,
};
