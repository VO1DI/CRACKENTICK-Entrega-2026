const crypto = require('node:crypto');
const InventoryItem = require('../models/InventoryItem');
const Lock = require('../models/Lock');
const { crearError } = require('../utils/errors');
const { redondear } = require('../utils/money');

function stockDisponible(item) {
  return item.tracking === 'serial' ? (item.serials || []).filter((s) => s.status === 'available').length : Number(item.quantity || 0);
}

function serialesDisponibles(item) {
  return (item.serials || []).filter((s) => s.status === 'available');
}

/** Valida que una lista de líneas pueda consumirse del inventario. */
async function validarConsumo(lineas = []) {
  const agrupadas = new Map();
  for (const linea of lineas) {
    const clave = String(linea.itemId || linea.inventoryItemId || '');
    if (!clave) throw crearError(422, 'Hay una línea sin artículo de inventario.');
    const acumulado = agrupadas.get(clave) || { cantidad: 0, seriales: [], nombre: linea.name || clave };
    acumulado.cantidad += Number(linea.quantity) || 0;
    for (const serial of linea.serials || []) {
      const normal = String(serial).toUpperCase();
      if (acumulado.seriales.includes(normal)) {
        throw crearError(422, `El serial ${normal} está repetido en la venta.`);
      }
      acumulado.seriales.push(normal);
    }
    agrupadas.set(clave, acumulado);
  }

  for (const [id, linea] of agrupadas) {
    const item = await InventoryItem.findById(id);
    if (!item) throw crearError(422, `El artículo ${linea.nombre} no existe en el inventario.`);
    if (item.tracking === 'bulk' && stockDisponible(item) < linea.cantidad) {
      throw crearError(422, `Stock insuficiente de ${item.name}: hay ${stockDisponible(item)} y se requieren ${linea.cantidad}.`);
    }
    if (item.tracking === 'serial') {
      if (linea.seriales.length !== linea.cantidad) {
        throw crearError(422, `Debes indicar ${linea.cantidad} serial(es) de ${item.name}.`);
      }
      for (const serial of linea.seriales) {
        const encontrado = (item.serials || []).find((s) => s.serial === serial);
        if (!encontrado) throw crearError(422, `El serial ${serial} no pertenece a ${item.name}.`);
        if (encontrado.status !== 'available') {
          throw crearError(422, `El serial ${serial} de ${item.name} no está disponible.`);
        }
      }
    }
  }
  return true;
}

/**
 * Descuenta las líneas del inventario y deja el movimiento registrado.
 * @param {'instalacion'|'venta'} tipo
 */
async function consumirLineasBase(lineas = [], { clientId = null, saleId = null, invoiceId = null, actor = 'admin', tipo = 'venta', reason = '' } = {}) {
  await validarConsumo(lineas);
  const consumidos = [];

  for (const linea of lineas) {
    const item = await InventoryItem.findById(linea.itemId || linea.inventoryItemId);
    if (!item) continue;
    const cantidad = Number(linea.quantity) || 0;
    const seriales = (linea.serials || []).map((s) => String(s).toUpperCase());

    if (item.tracking === 'bulk') {
      const disponible = Number(item.quantity || 0);
      if (disponible < cantidad) {
        throw crearError(409, `Stock insuficiente de ${item.name}: hay ${disponible} y se requieren ${cantidad}.`);
      }
      item.quantity = redondear(disponible - cantidad);
    } else {
      for (const serial of seriales) {
        const encontrado = item.serials.find((s) => s.serial === serial && s.status === 'available');
        if (encontrado) {
          encontrado.status = tipo === 'instalacion' ? 'installed' : 'sold';
          encontrado.clientId = clientId;
          encontrado.saleId = saleId;
          encontrado.installedAt = new Date();
        }
      }
    }

    item.movements.push({
      type: tipo,
      quantity: -cantidad,
      reason: reason || `Salida por ${tipo}`,
      saleId,
      invoiceId,
      actor,
    });
    await item.save();
    consumidos.push({ itemId: item._id, name: item.name, quantity: cantidad, serials: seriales });
  }

  return consumidos;
}

/** Devuelve al inventario el contenido de una factura anulada de venta/instalación. */
async function restaurarFacturaBase(factura, { actor = 'admin' } = {}) {
  if (!factura || !['sale', 'installation'].includes(factura.type)) return [];
  const restaurados = [];

  for (const linea of factura.lines || []) {
    if (!linea.inventoryItemId) continue;
    const item = await InventoryItem.findById(linea.inventoryItemId);
    if (!item) continue;
    const cantidad = Number(linea.quantity) || 0;

    if (item.tracking === 'bulk') {
      item.quantity = redondear(Number(item.quantity || 0) + cantidad);
    } else {
      for (const serial of linea.serials || []) {
        const encontrado = item.serials.find((s) => s.serial === String(serial).toUpperCase());
        if (encontrado && ['sold', 'installed'].includes(encontrado.status)) {
          encontrado.status = 'available';
          encontrado.clientId = null;
          encontrado.saleId = null;
          encontrado.installedAt = undefined;
        }
      }
    }

    item.movements.push({
      type: 'entrada',
      quantity: cantidad,
      reason: `Anulación de la factura ${factura.invoiceNumber}`,
      invoiceId: factura._id,
      actor,
    });
    await item.save();
    restaurados.push({ itemId: item._id, name: item.name, quantity: cantidad });
  }

  return restaurados;
}

/** Ajuste manual de stock con movimiento. */
async function ajustarBase(itemId, { delta, reason = '', actor = 'admin' } = {}) {
  const item = await InventoryItem.findById(itemId);
  if (!item) throw crearError(404, 'El artículo no existe.');
  if (item.tracking === 'serial') {
    throw crearError(422, 'Los artículos serializados se gestionan desde su lista de seriales.');
  }
  const variacion = Number(delta);
  if (!Number.isFinite(variacion) || variacion === 0) throw crearError(422, 'El ajuste debe ser un número distinto de cero.');
  const nuevo = redondear(Number(item.quantity || 0) + variacion);
  if (nuevo < 0) throw crearError(422, 'El ajuste dejaría el stock en negativo.');
  item.quantity = nuevo;
  item.movements.push({
    type: variacion > 0 ? 'entrada' : 'salida',
    quantity: variacion,
    reason: reason || 'Ajuste manual de inventario',
    actor,
  });
  await item.save();
  return item;
}

/** Serializa stock en este proceso y, mediante un lease en Mongo, entre procesos. */
const ESPERA_LOCK_MS = 15000;
// shortcut: el lease no se renueva; las tareas envueltas son escrituras cortas. Si alguna llega a 30 s, subirlo o renovarlo.
const LEASE_LOCK_MS = 30000;
let colaInventario = Promise.resolve();

async function conBloqueo(tarea) {
  const owner = crypto.randomUUID();
  const limite = Date.now() + ESPERA_LOCK_MS;
  while (Date.now() < limite) {
    const ahora = new Date();
    try {
      const doc = await Lock.findOneAndUpdate(
        { _id: 'inventory', $or: [{ expiresAt: { $lt: ahora } }, { expiresAt: null }] },
        { $set: { owner, expiresAt: new Date(Date.now() + LEASE_LOCK_MS) } },
        { new: true, upsert: true }
      );
      if (doc && doc.owner === owner) {
        try {
          return await tarea();
        } finally {
          await Lock.deleteOne({ _id: 'inventory', owner }).catch(() => null);
        }
      }
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 80 + Math.random() * 80));
  }
  throw crearError(503, 'El inventario está ocupado; intenta de nuevo en unos segundos.');
}

function enCola(tarea) {
  const siguiente = colaInventario.then(() => conBloqueo(tarea), () => conBloqueo(tarea));
  colaInventario = siguiente.catch(() => null);
  return siguiente;
}

function consumirLineas(lineas, opciones) {
  return enCola(() => consumirLineasBase(lineas, opciones));
}

/* También los ajustes manuales entran en la cola: antes se pisaban entre sí. */
function ajustar(itemId, opciones) {
  return enCola(() => ajustarBase(itemId, opciones));
}

/** Fija una cantidad absoluta dentro de la cola (edición del artículo). */
function fijarStock(itemId, objetivo, { reason = 'Ajuste desde la edición del artículo', actor = 'admin' } = {}) {
  return enCola(async () => {
    const item = await InventoryItem.findById(itemId);
    if (!item) throw crearError(404, 'El artículo no existe.');
    if (item.tracking === 'serial') {
      throw crearError(422, 'Los artículos serializados se gestionan desde su lista de seriales.');
    }
    const nuevo = redondear(Number(objetivo));
    if (!Number.isFinite(nuevo) || nuevo < 0) {
      throw crearError(422, 'La cantidad debe ser un número mayor o igual a 0.');
    }
    const delta = redondear(nuevo - Number(item.quantity || 0));
    if (!delta) return item;
    item.quantity = nuevo;
    item.movements.push({
      type: delta > 0 ? 'entrada' : 'salida',
      quantity: delta,
      reason,
      actor,
    });
    await item.save();
    return item;
  });
}

function restaurarFactura(factura, opciones) {
  return enCola(() => restaurarFacturaBase(factura, opciones));
}

/** Devuelve al stock los artículos consumidos sin factura (reversión de instalación). */
function devolverLineas(consumidos = [], { saleId = null, actor = 'admin', reason = '' } = {}) {
  return enCola(async () => {
    for (const consumido of consumidos) {
      const item = await InventoryItem.findById(consumido.itemId);
      if (!item) continue;
      const cantidad = Number(consumido.quantity) || 0;
      if (item.tracking === 'bulk') {
        item.quantity = redondear(Number(item.quantity || 0) + cantidad);
      } else {
        for (const serial of consumido.serials || []) {
          const encontrado = item.serials.find((fila) => fila.serial === String(serial).toUpperCase());
          if (encontrado && ['sold', 'installed'].includes(encontrado.status)) {
            encontrado.status = 'available';
            encontrado.clientId = null;
            encontrado.saleId = null;
            encontrado.installedAt = undefined;
          }
        }
        item.quantity = stockDisponible(item);
      }
      /* La instalación no llegó a completarse: el consumo original deja de
         contar para que el reintento vuelva a descontar el stock. */
      if (saleId) {
        item.movements = item.movements.filter(
          (mov) => !(mov.saleId && String(mov.saleId) === String(saleId) && ['instalacion', 'venta'].includes(mov.type))
        );
      }
      item.movements.push({
        type: 'devolucion',
        quantity: cantidad,
        reason: reason || 'Reversión de instalación',
        saleId,
        actor,
      });
      await item.save();
    }
    return consumidos;
  });
}

module.exports = {
  stockDisponible,
  serialesDisponibles,
  validarConsumo,
  consumirLineas,
  restaurarFactura,
  devolverLineas,
  ajustar,
  fijarStock,
  enCola,
};
