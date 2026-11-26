const mongoose = require('mongoose');
const Router = require('../models/Router');
const RouterBackup = require('../models/RouterBackup');
const backupService = require('../services/backupService');
const { descifrarBuffer } = require('../services/cryptoService');
const { crearError } = require('../utils/errors');

async function conteos() {
  const filas = await RouterBackup.aggregate([{ $group: { _id: '$routerId', total: { $sum: 1 } } }]);
  return Object.fromEntries(filas.map((fila) => [String(fila._id), fila.total]));
}

async function index(req, res, next) {
  try {
    const routers = await Router.find().sort({ active: -1, name: 1 }).lean();
    const routerId = mongoose.isValidObjectId(req.query.routerId) ? req.query.routerId : '';
    const seleccionado = routerId ? routers.find((router) => String(router._id) === String(routerId)) : null;
    const respaldos = seleccionado ? await backupService.listar(seleccionado._id) : [];
    const grupos = [];
    if (!seleccionado) {
      const todos = await backupService.listarTodos();
      const porRouter = new Map();
      for (const respaldo of todos) {
        const llave = String(respaldo.routerId);
        if (!porRouter.has(llave)) {
          const router = routers.find((fila) => String(fila._id) === llave);
          porRouter.set(llave, {
            router: router || { name: respaldo.routerName || 'Router eliminado', vendor: 'mikrotik' },
            respaldos: [],
          });
        }
        porRouter.get(llave).respaldos.push(respaldo);
      }
      grupos.push(...porRouter.values());
    }
    res.render('network/backups', {
      titulo: 'Respaldos',
      routers,
      conteos: await conteos(),
      selectedRouter: seleccionado,
      respaldos,
      grupos,
      aplicar: req.query.aplicar === '1',
      modulo: 'respaldos',
    });
  } catch (error) {
    next(error);
  }
}

async function crear(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.body.routerId)) throw crearError(422, 'Selecciona un router.');
    const router = await Router.findById(req.body.routerId).select('+passwordEnc +enablePasswordEnc');
    if (!router) throw crearError(404, 'El router no existe.');
    const binario = req.body.formato === 'binario';
    const respaldo = await backupService.crear(router, { actor: req.usuario ? req.usuario.username : 'admin', binario });
    req.flash(
      'exito',
      respaldo.simulated
        ? 'Respaldo simulado guardado: el router está en modo simulado.'
        : `Respaldo ${respaldo.name} guardado (${Math.round(respaldo.size / 1024)} KB).`
    );
    res.redirect(`/red/respaldos?routerId=${router._id}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect(`/red/respaldos?routerId=${req.body.routerId || ''}`);
    }
    next(error);
  }
}

async function descargar(req, res, next) {
  try {
    const respaldo = await RouterBackup.findById(req.params.id);
    if (!respaldo) throw crearError(404, 'El respaldo no existe.');
    if (respaldo.format === 'backup') {
      const binario = descifrarBuffer(respaldo.binary || Buffer.alloc(0));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${respaldo.name}"`);
      return res.send(binario);
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${respaldo.name}"`);
    res.send(respaldo.content);
  } catch (error) {
    next(error);
  }
}

async function restaurar(req, res, next) {
  try {
    const respaldo = await RouterBackup.findById(req.params.id);
    if (!respaldo) throw crearError(404, 'El respaldo no existe.');
    const router = await Router.findById(respaldo.routerId).select('+passwordEnc +enablePasswordEnc');
    if (!router) throw crearError(404, 'El router del respaldo ya no existe.');
    const resultado = await backupService.restaurar(respaldo, router, { actor: req.usuario ? req.usuario.username : 'admin' });
    if (resultado.simulado) {
      req.flash('exito', 'Restauración simulada: no se tocó el equipo.');
    } else if (resultado.ok) {
      req.flash('exito', `Comandos importados en ${router.name}. Revisa la salida; los objetos duplicados no se reemplazan.`);
    } else {
      req.flash('error', `La carga terminó con errores: ${String(resultado.salida || '').slice(0, 200)}`);
    }
    res.redirect(`/red/respaldos?routerId=${router._id}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/red/respaldos');
    }
    next(error);
  }
}

async function eliminar(req, res, next) {
  try {
    const respaldo = await RouterBackup.findById(req.params.id);
    if (!respaldo) throw crearError(404, 'El respaldo no existe.');
    const routerId = respaldo.routerId;
    await backupService.eliminar(respaldo, { actor: req.usuario ? req.usuario.username : 'admin' });
    req.flash('exito', 'Respaldo eliminado.');
    res.redirect(`/red/respaldos?routerId=${routerId}`);
  } catch (error) {
    next(error);
  }
}

module.exports = { index, crear, descargar, restaurar, eliminar };
