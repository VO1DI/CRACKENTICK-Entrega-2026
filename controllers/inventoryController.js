const InventoryItem = require('../models/InventoryItem');
const Alert = require('../models/Alert');
const inventoryService = require('../services/inventoryService');
const notifyService = require('../services/notifyService');
const alertBadgeCache = require('../services/alertBadgeCache');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');
const {
  INVENTARIO_POR_PAGINA,
  CATEGORIAS_INVENTARIO,
  TIPOS_INVENTARIO,
  ESTADOS_SERIAL,
} = require('../config/constants');
const { escaparRegex } = require('../utils/strings');
const { normalizarMac } = require('../utils/mac');

/** Convierte líneas "SERIAL, MAC" en objetos de serial. */
function parseSeriales(texto = '') {
  return String(texto)
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea) => {
      const [serial, mac] = linea.split(/[,;\t]/).map((parte) => String(parte || '').trim());
      return { serial: serial?.toUpperCase(), mac: normalizarMac(mac) || String(mac || '').toUpperCase(), status: 'available' };
    })
    .filter((item) => item.serial);
}

function deduplicarSeriales(existentes = [], nuevos = []) {
  const vistos = new Set(existentes.map((s) => s.serial));
  return nuevos.filter((s) => {
    if (vistos.has(s.serial)) return false;
    vistos.add(s.serial);
    return true;
  });
}

function payloadItem(body = {}) {
  const tracking = TIPOS_INVENTARIO.includes(body.tracking) ? body.tracking : 'bulk';
  return {
    name: body.name || '',
    category: CATEGORIAS_INVENTARIO.includes(body.category) ? body.category : 'other',
    tracking,
    unit: body.unit || 'unidad',
    minStock: Number(body.minStock) || 0,
    cost: Number(body.cost) || 0,
    price: Number(body.price) || 0,
    location: body.location || '',
    supplier: body.supplier || '',
    notes: body.notes || '',
    active: body.active === 'on' || body.active === 'true',
  };
}

/** GET /inventario */
async function index(req, res, next) {
  try {
    const { q = '', categoria = '', tipo = '', stock = '', page = 1 } = req.query;
    const consulta = {};
    if (q.trim()) {
      const regex = new RegExp(escaparRegex(q.trim()), 'i');
      consulta.$or = [{ name: regex }, { code: regex }, { supplier: regex }, { 'serials.serial': regex }];
    }
    if (CATEGORIAS_INVENTARIO.includes(categoria)) consulta.category = categoria;
    if (TIPOS_INVENTARIO.includes(tipo)) consulta.tracking = tipo;

    let total = 0;
    let items = [];
    let paginas = 1;
    let actual = 1;

    if (stock === 'bajo') {
      // `bajoMinimo` es virtual: se calcula en memoria y luego se pagina.
      const todos = await InventoryItem.find(consulta).sort({ active: -1, name: 1 });
      const bajos = todos.filter((item) => item.bajoMinimo);
      total = bajos.length;
      paginas = Math.max(1, Math.ceil(total / INVENTARIO_POR_PAGINA));
      actual = Math.min(Math.max(1, Number(page) || 1), paginas);
      items = bajos.slice((actual - 1) * INVENTARIO_POR_PAGINA, actual * INVENTARIO_POR_PAGINA);
    } else {
      total = await InventoryItem.countDocuments(consulta);
      paginas = Math.max(1, Math.ceil(total / INVENTARIO_POR_PAGINA));
      actual = Math.min(Math.max(1, Number(page) || 1), paginas);
      items = await InventoryItem.find(consulta)
        .sort({ active: -1, name: 1 })
        .skip((actual - 1) * INVENTARIO_POR_PAGINA)
        .limit(INVENTARIO_POR_PAGINA);
    }

    const inventario = await InventoryItem.find({});
    const activos = inventario.filter((item) => item.active);
    const alertasStock = await Alert.find({
      type: 'stock_low',
      status: { $in: ['active', 'acknowledged'] },
    })
      .sort({ startedAt: -1 })
      .limit(50)
      .lean();

    res.render('inventory/index', {
      titulo: 'Inventario',
      items,
      filtros: { q, categoria, tipo, stock },
      paginacion: { actual, paginas, total },
      alertasStock,
      resumen: {
        total: await InventoryItem.countDocuments(),
        articulos: activos.length,
        bajoMinimo: activos.filter((i) => i.bajoMinimo).length,
        // Costo de todas las existencias (activas o no) al costo unitario actual.
        costo: inventario.reduce((suma, i) => suma + (i.stock || 0) * (i.cost || 0), 0),
        seriales: activos.reduce((suma, i) => suma + (i.tracking === 'serial' ? i.serials?.length || 0 : 0), 0),
      },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /inventario/nuevo */
function formNuevo(req, res) {
  res.render('inventory/form', {
    titulo: 'Nuevo artículo',
    item: new InventoryItem({ tracking: 'bulk', unit: 'unidad', active: true }),
    modo: 'crear',
    errores: [],
  });
}

/** POST /inventario */
async function crear(req, res, next) {
  try {
    const datos = payloadItem(req.body);
    const seriales = datos.tracking === 'serial' ? parseSeriales(req.body.seriales) : [];
    if (datos.tracking === 'serial' && !seriales.length) {
      throw crearError(422, 'Un artículo serializado necesita al menos un serial.');
    }

    const item = new InventoryItem({
      ...datos,
      code: await InventoryItem.siguienteCodigo(),
      serials: seriales,
      quantity: datos.tracking === 'bulk' ? Number(req.body.quantity) || 0 : seriales.length,
    });

    if (datos.tracking === 'bulk' && item.quantity > 0) {
      item.movements.push({ type: 'entrada', quantity: item.quantity, reason: 'Carga inicial de inventario' });
    }
    if (datos.tracking === 'serial') {
      item.movements.push({ type: 'entrada', quantity: seriales.length, reason: 'Carga inicial de seriales' });
    }

    await item.save();
    await registrar({
      module: 'inventory',
      entity: 'InventoryItem',
      entityId: item._id,
      action: 'create',
      description: `Artículo ${item.code} ${item.name} creado (${item.tracking}).`,
      changes: { after: { code: item.code, name: item.name, stock: item.stock } },
    });
    req.flash('exito', `Artículo ${item.name} agregado al inventario.`);
    res.redirect(`/inventario/${item._id}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000 || error.status) {
      const { lista, campos } = normalizarErrores(error);
      return res.status(422).render('inventory/form', {
        titulo: 'Nuevo artículo',
        item: new InventoryItem({ ...payloadItem(req.body), serials: parseSeriales(req.body.seriales) }),
        modo: 'crear',
        errores: lista,
        erroresCampo: campos,
      });
    }
    next(error);
  }
}

/** GET /inventario/:id */
async function show(req, res, next) {
  try {
    const item = await InventoryItem.findById(req.params.id).populate('serials.clientId');
    if (!item) throw crearError(404, 'El artículo no existe.');
    const movimientos = [...item.movements].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 30);
    res.render('inventory/show', { titulo: `${item.name} · Inventario`, item, movimientos });
  } catch (error) {
    next(error);
  }
}

/** GET /inventario/:id/editar */
async function formEditar(req, res, next) {
  try {
    const item = await InventoryItem.findById(req.params.id);
    if (!item) throw crearError(404, 'El artículo no existe.');
    res.render('inventory/form', {
      titulo: `Editar ${item.name}`,
      item,
      modo: 'editar',
      errores: [],
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /inventario/:id */
async function actualizar(req, res, next) {
  try {
    let item = await InventoryItem.findById(req.params.id);
    if (!item) throw crearError(404, 'El artículo no existe.');

    if (item.tracking === 'serial') {
      item = await inventoryService.enCola(async () => {
        const actual = await InventoryItem.findById(req.params.id);
        if (!actual) throw crearError(404, 'El artículo no existe.');
        const trackingAnterior = actual.tracking;
        Object.assign(actual, payloadItem(req.body));
        if (trackingAnterior !== actual.tracking && actual.serials.length) {
          const error = crearError(422, 'No puedes cambiar el tipo de seguimiento de un artículo con seriales registrados.');
          error.campos = { tracking: 'Este artículo ya tiene seriales; no puedes cambiar el tipo.' };
          throw error;
        }
        if (actual.tracking === 'serial') {
          const nuevos = deduplicarSeriales(actual.serials, parseSeriales(req.body.seriales));
          if (nuevos.length) {
            actual.serials.push(...nuevos);
            actual.movements.push({ type: 'entrada', quantity: nuevos.length, reason: 'Seriales agregados manualmente' });
          }
          actual.quantity = inventoryService.stockDisponible(actual);
        }
        await actual.save();
        return actual;
      });
    } else {
      const trackingAnterior = item.tracking;
      Object.assign(item, payloadItem(req.body));
      if (trackingAnterior !== item.tracking && item.serials.length) {
        const error = crearError(422, 'No puedes cambiar el tipo de seguimiento de un artículo con seriales registrados.');
        error.campos = { tracking: 'Este artículo ya tiene seriales; no puedes cambiar el tipo.' };
        throw error;
      }
      if (trackingAnterior !== item.tracking && item.tracking === 'serial' && item.quantity > 0) {
        const error = crearError(422, 'Antes de pasar a serializado deja el stock en 0 y agrega los seriales.');
        error.campos = { tracking: 'Ajusta el stock a 0 antes de cambiar el tipo.' };
        throw error;
      }

      let ajustePendiente = null;
      if (req.body.quantity !== undefined && req.body.quantity !== '') {
        const objetivo = Number(req.body.quantity);
        if (Number.isFinite(objetivo) && objetivo >= 0 && objetivo !== item.quantity) {
          ajustePendiente = objetivo;
        }
      }

      await item.save();
      if (ajustePendiente !== null) {
        item = await inventoryService.fijarStock(item._id, ajustePendiente, {
          reason: 'Ajuste desde la edición del artículo',
          actor: req.usuario ? req.usuario.username : 'admin',
        });
      }
    }
    await registrar({
      module: 'inventory',
      entity: 'InventoryItem',
      entityId: item._id,
      action: 'update',
      description: `Artículo ${item.code} ${item.name} actualizado.`,
      changes: { after: { name: item.name, stock: item.stock, price: item.price } },
    });
    req.flash('exito', 'Artículo actualizado.');
    res.redirect(`/inventario/${item._id}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000 || error.status) {
      const item = await InventoryItem.findById(req.params.id);
      if (item) Object.assign(item, payloadItem(req.body));
      const { lista, campos } = normalizarErrores(error);
      return res.status(422).render('inventory/form', {
        titulo: `Editar ${item?.name || 'artículo'}`,
        item: item || new InventoryItem(payloadItem(req.body)),
        modo: 'editar',
        errores: lista,
        erroresCampo: campos,
      });
    }
    next(error);
  }
}

/** POST /inventario/:id/ajustar */
async function ajustar(req, res, next) {
  try {
    const item = await InventoryItem.findById(req.params.id);
    if (!item) throw crearError(404, 'El artículo no existe.');
    const action = req.body.action === 'quitar' ? -1 : 1;
    const cantidad = Number(req.body.cantidad);
    await inventoryService.ajustar(item._id, {
      delta: action * cantidad,
      reason: req.body.reason || 'Ajuste manual',
    });

    const actualizado = await InventoryItem.findById(item._id);
    const patronAlerta = new RegExp(`^Stock bajo de ${escaparRegex(actualizado.name)}:`);
    if (actualizado.bajoMinimo) {
      /* No duplicar el aviso si ya hay uno pendiente para este artículo. */
      const existe = await Alert.exists({
        type: 'stock_low',
        status: { $in: ['active', 'acknowledged'] },
        message: patronAlerta,
      });
      if (!existe) {
        const alerta = await Alert.create({
          routerId: null,
          routerName: '',
          wan: '',
          type: 'stock_low',
          severity: 'warning',
          message: `Stock bajo de ${actualizado.name}: quedan ${actualizado.stock} ${actualizado.unit}.`,
          value: String(actualizado.stock),
          status: 'active',
        });
        notifyService.notificarAlerta(alerta);
      }
    } else {
      /* Reponer el stock cierra el aviso que quedó pendiente. */
      await Alert.updateMany(
        { type: 'stock_low', status: { $in: ['active', 'acknowledged'] }, message: patronAlerta },
        { $set: { status: 'resolved', resolvedAt: new Date() } }
      );
    }
    alertBadgeCache.invalidar();

    await registrar({
      module: 'inventory',
      entity: 'InventoryItem',
      entityId: item._id,
      action: 'adjust',
      description: `Ajuste de ${action * cantidad} ${item.unit} en ${item.name}.`,
      changes: { after: { stock: actualizado.stock } },
    });
    req.flash('exito', 'Stock ajustado.');
    res.redirect(`/inventario/${item._id}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect(`/inventario/${req.params.id}`);
    }
    next(error);
  }
}

/** POST /inventario/:id/seriales */
async function agregarSeriales(req, res, next) {
  try {
    const resultado = await inventoryService.enCola(async () => {
      const item = await InventoryItem.findById(req.params.id);
      if (!item) throw crearError(404, 'El artículo no existe.');
      if (item.tracking !== 'serial') throw crearError(422, 'Este artículo no usa seriales.');
      const nuevos = deduplicarSeriales(item.serials, parseSeriales(req.body.seriales));
      if (!nuevos.length) return { vacio: true, itemId: item._id };
      item.serials.push(...nuevos);
      item.quantity = inventoryService.stockDisponible(item);
      item.movements.push({ type: 'entrada', quantity: nuevos.length, reason: 'Seriales agregados manualmente' });
      await item.save();
      return { item, nuevos };
    });

    if (resultado.vacio) {
      req.flash('error', 'No se detectaron seriales nuevos.');
      return res.redirect(`/inventario/${resultado.itemId}`);
    }

    const { item, nuevos } = resultado;
    await registrar({
      module: 'inventory',
      entity: 'InventoryItem',
      entityId: item._id,
      action: 'update',
      description: `${nuevos.length} serial(es) agregados a ${item.name}.`,
      changes: { after: { seriales: nuevos.map((s) => s.serial) } },
    });
    req.flash('exito', `${nuevos.length} serial(es) agregados.`);
    res.redirect(`/inventario/${item._id}`);
  } catch (error) {
    next(error);
  }
}

/** POST /inventario/:id/seriales/:serialId/estado */
async function cambiarSerial(req, res, next) {
  try {
    const resultado = await inventoryService.enCola(async () => {
      const item = await InventoryItem.findById(req.params.id);
      if (!item) throw crearError(404, 'El artículo no existe.');
      const serial = item.serials.id(req.params.serialId);
      if (!serial) throw crearError(404, 'El serial no existe.');
      const estado = req.body.status;
      if (!ESTADOS_SERIAL.includes(estado)) throw crearError(422, 'Estado de serial no válido.');
      if (['installed', 'sold'].includes(estado)) {
        throw crearError(422, 'Los estados instalado/vendido se asignan desde una venta.');
      }
      const anterior = serial.status;
      if (estado === 'available' && ['installed', 'sold'].includes(anterior) && (serial.clientId || serial.saleId)) {
        throw crearError(422, 'El serial está instalado o vendido: anula la factura o registra una devolución.');
      }
      serial.status = estado;
      if (estado === 'available') {
        serial.clientId = null;
        serial.saleId = null;
        serial.installedAt = undefined;
      }
      item.quantity = inventoryService.stockDisponible(item);
      item.movements.push({
        type: 'ajuste',
        quantity: 0,
        reason: `Serial ${serial.serial}: ${anterior} → ${estado}`,
      });
      await item.save();
      return { item, serial, anterior, estado };
    });

    const { item, serial, anterior, estado } = resultado;
    await registrar({
      module: 'inventory',
      entity: 'InventoryItem',
      entityId: item._id,
      action: 'update',
      description: `Serial ${serial.serial} de ${item.name}: ${anterior} → ${estado}.`,
      changes: { before: { status: anterior }, after: { status: estado } },
    });
    req.flash('exito', 'Estado del serial actualizado.');
    res.redirect(`/inventario/${item._id}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect(`/inventario/${req.params.id}`);
    }
    next(error);
  }
}

async function cambiarEstadoAlertaStock(req, res, next, estado) {
  try {
    const alerta = await Alert.findOne({ _id: req.params.id, type: 'stock_low' });
    if (!alerta) throw crearError(404, 'La alerta de stock no existe.');

    const anterior = alerta.status;
    alerta.status = estado;
    if (estado === 'acknowledged') alerta.acknowledgedAt = new Date();
    else alerta.resolvedAt = new Date();
    await alerta.save();

    await registrar({
      module: 'inventory',
      entity: 'Alert',
      entityId: alerta._id,
      action: 'update',
      description: `Alerta de stock ${estado === 'acknowledged' ? 'reconocida' : 'resuelta'}: ${alerta.message}`,
      changes: { before: { status: anterior }, after: { status: estado } },
      actor: req.usuario ? req.usuario.username : 'admin',
    });

    req.flash('exito', estado === 'acknowledged' ? 'Alerta reconocida.' : 'Alerta de stock resuelta.');
    res.redirect('/inventario#alertas-stock');
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/inventario#alertas-stock');
    }
    next(error);
  }
}

function reconocerAlertaStock(req, res, next) {
  return cambiarEstadoAlertaStock(req, res, next, 'acknowledged');
}

function resolverAlertaStock(req, res, next) {
  return cambiarEstadoAlertaStock(req, res, next, 'resolved');
}

async function cambiarMacSerial(req, res, next) {
  try {
    const mac = normalizarMac(req.body.mac);
    if (req.body.mac && !mac) {
      req.flash('error', 'La MAC no es válida. Usa el formato AA:BB:CC:DD:EE:FF.');
      return res.redirect(`/inventario/${req.params.id}`);
    }

    const resultado = await inventoryService.enCola(async () => {
      const item = await InventoryItem.findById(req.params.id);
      if (!item) throw crearError(404, 'El artículo no existe.');
      const serial = item.serials.id(req.params.serialId);
      if (!serial) throw crearError(404, 'El serial no existe.');
      const anterior = serial.mac || '';
      serial.mac = mac;
      await item.save();
      return { item, serial, anterior, mac };
    });

    const { item, serial, anterior } = resultado;
    await registrar({
      module: 'inventory',
      entity: 'InventoryItem',
      entityId: item._id,
      action: 'update',
      description: `MAC del serial ${serial.serial} de ${item.name}: ${anterior || 'sin MAC'} -> ${mac || 'sin MAC'}.`,
      changes: { before: { mac: anterior }, after: { mac } },
      actor: req.usuario ? req.usuario.username : 'admin',
    });
    req.flash('exito', 'MAC del serial actualizada.');
    res.redirect(`/inventario/${item._id}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect(`/inventario/${req.params.id}`);
    }
    next(error);
  }
}

module.exports = {
  index,
  formNuevo,
  crear,
  show,
  formEditar,
  actualizar,
  ajustar,
  agregarSeriales,
  cambiarSerial,
  cambiarMacSerial,
  reconocerAlertaStock,
  resolverAlertaStock,
};
