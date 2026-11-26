const mongoose = require('mongoose');
const WorkTask = require('../models/WorkTask');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');
const taskTypeService = require('../services/taskTypeService');
const { puedeEditar } = require('../utils/permissions');

const ESTADOS = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  done: 'Hecha',
  cancelled: 'Cancelada',
};
const PRIORIDADES = { low: 'Baja', medium: 'Media', high: 'Alta' };
const HORAS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const ETIQUETAS_HORA = HORAS.map((hora) => String(hora).padStart(2, '0'));
const MODOS_DURACION = ['minutos', 'horas', 'rango'];

const inicioDia = (fecha = new Date()) => {
  const dia = new Date(fecha);
  dia.setHours(0, 0, 0, 0);
  return dia;
};
const finDia = (fecha) => new Date(inicioDia(fecha).getTime() + 86400000);
const sumarDias = (fecha, dias) => new Date(inicioDia(fecha).getTime() + dias * 86400000);

function aFecha(valor, fin = false) {
  if (!valor) return null;
  const texto = String(valor).trim();
  const fecha = /T\d{2}:\d{2}/.test(texto)
    ? new Date(texto)
    : new Date(`${texto.slice(0, 10)}T${fin ? '23:59:59' : '00:00:00'}`);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function paraInput(valor) {
  const fecha = valor ? new Date(valor) : new Date();
  const dos = (numero) => String(numero).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}T${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

function paraCampo(valor) {
  const fecha = valor ? new Date(valor) : new Date();
  const dos = (numero) => String(numero).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

function horaTexto(valor) {
  const fecha = new Date(valor);
  return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
}

/** "HH:MM" -> minutos desde medianoche, o null si no es una hora válida. */
function horaAMinutos(valor) {
  const texto = String(valor || '').trim();
  const partes = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(texto);
  if (!partes) return null;
  return Number(partes[1]) * 60 + Number(partes[2]);
}

function minutosAHora(minutos) {
  const total = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(minutos) || 0)));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Convierte la duración del formulario (minutos, horas o rango de horas)
 * a la duración canónica en minutos. En modo rango, la hora "desde" también
 * fija la hora de inicio de la tarea.
 */
function interpretarDuracion(body = {}, fechaBase = null) {
  const modo = MODOS_DURACION.includes(body.durationMode) ? body.durationMode : 'minutos';
  if (modo === 'minutos') {
    const minutos = Number(body.durationMinutes);
    if (!Number.isInteger(minutos) || minutos < 15 || minutos > 720) {
      return { error: 'La duración en minutos debe ser un número entero entre 15 y 720.' };
    }
    return { durationMinutes: minutos, scheduledAt: fechaBase };
  }

  if (modo === 'horas') {
    const horas = Number(body.durationHours);
    if (!Number.isFinite(horas) || horas < 0.25 || horas > 12) {
      return { error: 'La duración en horas debe estar entre 0.25 y 12.' };
    }
    const minutos = Math.round(horas * 60);
    if (minutos < 15 || minutos > 720) {
      return { error: 'La duración debe quedar entre 15 minutos y 12 horas.' };
    }
    return { durationMinutes: minutos, scheduledAt: fechaBase };
  }

  const desde = horaAMinutos(body.durationFrom);
  let hasta = horaAMinutos(body.durationTo);
  if (desde === null || hasta === null) {
    return { error: 'Indica una hora de inicio y una hora de fin válidas (HH:MM).' };
  }
  // "Hasta 00:00" significa medianoche del mismo día.
  if (hasta === 0 && desde > 0) hasta = 24 * 60;
  if (hasta <= desde) {
    return { error: 'La hora de fin debe ser posterior a la hora de inicio.' };
  }
  const minutos = hasta - desde;
  if (minutos < 15) {
    return { error: 'El rango debe durar al menos 15 minutos.' };
  }
  if (minutos > 720) {
    return { error: 'El rango no puede superar 12 horas.' };
  }
  if (!fechaBase || Number.isNaN(new Date(fechaBase).getTime())) {
    return { durationMinutes: minutos, scheduledAt: null };
  }
  const inicio = new Date(fechaBase);
  inicio.setHours(Math.floor(desde / 60), desde % 60, 0, 0);
  return { durationMinutes: minutos, scheduledAt: inicio };
}

/** Valores para volver a pintar el formulario sin perder lo escrito. */
function tareaDeFormulario(body = {}, base = {}) {
  const duracion = Number(base.durationMinutes) || 60;
  const fecha = aFecha(body.scheduledAt) || aFecha(base.scheduledAt) || new Date();
  return {
    ...base,
    title: body.title ?? base.title ?? '',
    description: body.description ?? base.description ?? '',
    assignedTo: body.assignedTo ?? base.assignedTo ?? '',
    scheduledAt: String(body.scheduledAt || base.scheduledAt || paraInput(fecha)),
    durationMode: MODOS_DURACION.includes(body.durationMode) ? body.durationMode : 'minutos',
    durationMinutes: body.durationMinutes ?? base.durationMinutes ?? 60,
    durationHours: body.durationHours ?? duracion / 60,
    durationFrom: body.durationFrom || horaTexto(fecha),
    durationTo: body.durationTo || minutosAHora(fecha.getHours() * 60 + fecha.getMinutes() + duracion),
    priority: body.priority ?? base.priority ?? 'medium',
    category: body.category ?? base.category ?? 'otro',
    location: body.location ?? base.location ?? '',
    notes: body.notes ?? base.notes ?? '',
  };
}

async function renderizarFormulario(req, res, { modo, tarea, errores, status = 422 }) {
  const [personas, { tipos, categorias }] = await Promise.all([cargarPersonas(), cargarTipos()]);
  await incluirCategoriaActual(categorias, tarea.category);
  return res.status(status).render('agenda/form', {
    titulo: modo === 'crear' ? 'Nueva tarea' : 'Editar tarea',
    tarea,
    usuarios: personas,
    estados: ESTADOS,
    prioridades: PRIORIDADES,
    categorias,
    tipos,
    modo,
    errores,
  });
}

function esTecnico(persona) {
  return persona.area === 'tecnicos' || /t[eé]cnic|instalador/i.test(persona.position || '');
}

/** Usuarios activos enriquecidos con su ficha de empleado. */
async function cargarPersonas() {
  const [usuarios, empleados] = await Promise.all([
    User.find({ active: true }).sort({ name: 1 }).select('name username role').lean(),
    Employee.find({ active: true }).select('name position area userId').lean(),
  ]);
  const porUsuario = new Map(empleados.filter((e) => e.userId).map((e) => [String(e.userId), e]));
  const porNombre = new Map(empleados.map((e) => [String(e.name || '').trim().toLowerCase(), e]));
  return usuarios.map((usuario) => {
    const ficha = porUsuario.get(String(usuario._id)) || porNombre.get(String(usuario.name || '').trim().toLowerCase()) || null;
    return {
      _id: usuario._id,
      name: usuario.name || usuario.username,
      username: usuario.username,
      role: usuario.role,
      position: ficha?.position || (usuario.role === 'admin' ? 'Administración' : 'Equipo'),
      area: ficha?.area || '',
      tecnico: ficha ? esTecnico(ficha) : false,
    };
  });
}

const esAdmin = (req) => Boolean(req.usuario) && req.usuario.role === 'admin';
const puedeGestionar = (req) => Boolean(req.usuario) && (req.usuario.role === 'admin' || puedeEditar(req.usuario, 'agenda.gestion'));

async function cargarTipos() {
  const tipos = await taskTypeService.listar();
  return {
    tipos,
    categorias: Object.fromEntries(tipos.map((tipo) => [tipo.key, tipo.name])),
    colores: new Map(tipos.map((tipo) => [tipo.key, tipo.color])),
  };
}

/** Un tipo desactivado sigue visible al editar una tarea que ya lo usaba. */
async function incluirCategoriaActual(categorias, clave) {
  if (!clave || categorias[clave]) return;
  const tipo = (await taskTypeService.mapa()).get(clave);
  if (tipo) categorias[clave] = `${tipo.name} (inactivo)`;
}

/** Mantiene la clave si existe; si no, cae a "otro" o al primer tipo activo. */
function categoriaDe(categoria, tipos) {
  const clave = String(categoria || '');
  if (tipos.some((tipo) => tipo.key === clave)) return clave;
  if (tipos.some((tipo) => tipo.key === 'otro')) return 'otro';
  return tipos[0]?.key || 'otro';
}

async function index(req, res, next) {
  try {
    const admin = esAdmin(req);
    const hoy = inicioDia();
    const dia = aFecha(req.query.fecha) || hoy;
    const grupo = req.query.grupo === 'tecnicos' ? 'tecnicos' : 'todos';
    const { tipos, categorias, colores } = await cargarTipos();
    const personas = await cargarPersonas();
    const visibles = admin ? personas : personas.filter((persona) => String(persona._id) === String(req.usuario._id));
    const filtradas = grupo === 'tecnicos' ? visibles.filter((persona) => persona.tecnico) : visibles;
    const base = admin ? {} : { assignedTo: req.usuario._id };
    const mes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const [tareas, pendientesHoy, enCurso, hechasMes] = await Promise.all([
      WorkTask.find({ ...base, scheduledAt: { $gte: dia, $lt: finDia(dia) } })
        .populate('assignedTo', 'name username')
        .populate('clientId', 'clientCode firstName lastName')
        .sort({ scheduledAt: 1 })
        .lean(),
      WorkTask.countDocuments({ ...base, status: 'pending', scheduledAt: { $gte: hoy, $lt: finDia(hoy) } }),
      WorkTask.countDocuments({ ...base, status: 'in_progress' }),
      WorkTask.countDocuments({ ...base, status: 'done', finishedAt: { $gte: mes } }),
    ]);

    const porPersona = new Map(filtradas.map((persona) => [String(persona._id), []]));
    const fuera = [];
    for (const tarea of tareas) {
      const clave = String(tarea.assignedTo?._id || tarea.assignedTo);
      const inicio = new Date(tarea.scheduledAt);
      const hora = inicio.getHours() + inicio.getMinutes() / 60;
      const duracion = Math.max(15, Number(tarea.durationMinutes) || 60);
      if (hora < HORAS[0] || hora >= HORAS[HORAS.length - 1] + 1) {
        fuera.push({ ...tarea, hora: horaTexto(tarea.scheduledAt) });
        continue;
      }
      const columna = Math.max(0, Math.min(HORAS.length - 1, Math.floor(hora - HORAS[0])));
      const tramo = Math.max(1, Math.min(HORAS.length - columna, Math.round(duracion / 60)));
      const bloque = { ...tarea, columna, tramo, hora: horaTexto(tarea.scheduledAt), color: colores.get(tarea.category) || '#94a3b8' };
      if (!porPersona.has(clave)) continue;
      porPersona.get(clave).push(bloque);
    }

    const filas = filtradas.map((persona) => {
      const tareasPersona = [...(porPersona.get(String(persona._id)) || [])].sort((a, b) => a.columna - b.columna);
      const carriles = [];
      tareasPersona.forEach((tarea) => {
        const inicio = tarea.columna;
        const fin = tarea.columna + tarea.tramo;
        let carril = 0;
        while (
          carriles[carril] &&
          carriles[carril].some((ocupado) => !(fin <= ocupado.inicio || inicio >= ocupado.fin))
        ) {
          carril += 1;
        }
        tarea.carril = carril;
        if (!carriles[carril]) carriles[carril] = [];
        carriles[carril].push({ inicio, fin });
      });
      return { ...persona, tareas: tareasPersona };
    });

    res.render('agenda/index', {
      titulo: 'Agenda',
      filas,
      fuera,
      horas: HORAS,
      etiquetasHora: ETIQUETAS_HORA,
      admin,
      puedeGestionar: puedeGestionar(req),
      personas: visibles,
      estados: ESTADOS,
      prioridades: PRIORIDADES,
      categorias,
      tipos,
      filtros: { fecha: paraCampo(dia), grupo },
      navegacion: {
        anterior: paraCampo(sumarDias(dia, -1)),
        siguiente: paraCampo(sumarDias(dia, 1)),
        hoy: paraCampo(hoy),
      },
      resumen: { pendientesHoy, enCurso, hechasMes },
    });
  } catch (error) {
    next(error);
  }
}

async function formNuevo(req, res, next) {
  try {
    if (!puedeGestionar(req)) throw crearError(403, 'No tienes permiso para crear tareas.');
    const personas = await cargarPersonas();
    const { tipos, categorias } = await cargarTipos();
    const asignado = mongoose.isValidObjectId(req.query.asignado) ? String(req.query.asignado) : '';
    const fecha = req.query.fecha ? paraInput(aFecha(req.query.fecha)) : paraInput(new Date(Date.now() + 3600000));
    res.render('agenda/form', {
      titulo: 'Nueva tarea',
      tarea: tareaDeFormulario({}, {
        scheduledAt: fecha,
        priority: 'medium',
        durationMinutes: 60,
        assignedTo: asignado,
        category: 'instalacion',
      }),
      usuarios: personas,
      estados: ESTADOS,
      prioridades: PRIORIDADES,
      categorias,
      tipos,
      modo: 'crear',
      errores: [],
    });
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/agenda');
    }
    next(error);
  }
}

async function crear(req, res, next) {
  try {
    if (!puedeGestionar(req)) throw crearError(403, 'No tienes permiso para crear tareas.');
    const tipos = await taskTypeService.listar();
    const title = String(req.body.title || '').trim();
    const fecha = aFecha(req.body.scheduledAt);
    const duracion = interpretarDuracion(req.body, fecha);
    const errores = [];
    if (!title) errores.push('El título es obligatorio.');
    else if (title.length > 120) errores.push('El título no puede superar 120 caracteres.');
    if (!mongoose.isValidObjectId(req.body.assignedTo)) errores.push('Selecciona un responsable válido.');
    if (!fecha) errores.push('Indica la fecha y hora de la tarea.');
    if (duracion.error) errores.push(duracion.error);
    if (errores.length) {
      return renderizarFormulario(req, res, {
        modo: 'crear',
        tarea: tareaDeFormulario(req.body),
        errores,
      });
    }

    const datos = {
      title,
      description: String(req.body.description || '').trim(),
      assignedTo: req.body.assignedTo,
      scheduledAt: duracion.scheduledAt,
      durationMinutes: duracion.durationMinutes,
      priority: PRIORIDADES[req.body.priority] ? req.body.priority : 'medium',
      category: categoriaDe(req.body.category, tipos),
      location: String(req.body.location || '').trim(),
      notes: String(req.body.notes || '').trim(),
      createdBy: req.usuario._id,
    };
    const tarea = await WorkTask.create(datos);
    await registrar({
      module: 'agenda',
      entity: 'WorkTask',
      entityId: tarea._id,
      action: 'create',
      description: `Tarea "${tarea.title}" asignada para ${tarea.scheduledAt.toLocaleString('es-VE')}.`,
      actor: req.usuario.username,
    });
    req.flash('exito', 'Tarea creada.');
    res.redirect(`/agenda?fecha=${paraCampo(tarea.scheduledAt)}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.status) {
      const mensajes = error.name === 'ValidationError'
        ? Object.values(error.errors).map((detalle) => detalle.message)
        : [error.message];
      return renderizarFormulario(req, res, {
        modo: 'crear',
        tarea: tareaDeFormulario(req.body),
        errores: mensajes,
        status: 422,
      });
    }
    next(error);
  }
}

async function ver(req, res, next) {
  try {
    const tarea = await WorkTask.findById(req.params.id)
      .populate('assignedTo', 'name username')
      .populate('clientId', 'clientCode firstName lastName')
      .lean();
    if (!tarea) throw crearError(404, 'La tarea no existe.');
    if (!puedeGestionar(req) && String(tarea.assignedTo?._id || tarea.assignedTo) !== String(req.usuario._id)) {
      throw crearError(403, 'No puedes ver esta tarea.');
    }
    res.render('agenda/show', {
      titulo: tarea.title,
      tarea,
      estados: ESTADOS,
      prioridades: PRIORIDADES,
      categorias: (await cargarTipos()).categorias,
      puedeGestionar: puedeGestionar(req),
    });
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/agenda');
    }
    next(error);
  }
}

async function formEditar(req, res, next) {
  try {
    if (!puedeGestionar(req)) throw crearError(403, 'No tienes permiso para editar tareas.');
    const tarea = await WorkTask.findById(req.params.id).lean();
    if (!tarea) throw crearError(404, 'La tarea no existe.');
    const personas = await cargarPersonas();
    const { tipos, categorias } = await cargarTipos();
    await incluirCategoriaActual(categorias, tarea.category);
    res.render('agenda/form', {
      titulo: 'Editar tarea',
      tarea: tareaDeFormulario({}, { ...tarea, scheduledAt: paraInput(tarea.scheduledAt) }),
      usuarios: personas,
      estados: ESTADOS,
      prioridades: PRIORIDADES,
      categorias,
      tipos,
      modo: 'editar',
      errores: [],
    });
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/agenda');
    }
    next(error);
  }
}

async function actualizar(req, res, next) {
  try {
    if (!puedeGestionar(req)) throw crearError(403, 'No tienes permiso para editar tareas.');
    const tarea = await WorkTask.findById(req.params.id);
    if (!tarea) throw crearError(404, 'La tarea no existe.');
    const tipos = await taskTypeService.listar();

    const title = String(req.body.title || '').trim() || tarea.title;
    const fecha = aFecha(req.body.scheduledAt) || tarea.scheduledAt;
    const duracion = interpretarDuracion(req.body, fecha);
    const errores = [];
    if (!title) errores.push('El título es obligatorio.');
    else if (title.length > 120) errores.push('El título no puede superar 120 caracteres.');
    if (!fecha) errores.push('Indica la fecha y hora de la tarea.');
    if (duracion.error) errores.push(duracion.error);
    if (errores.length) {
      return renderizarFormulario(req, res, {
        modo: 'editar',
        tarea: tareaDeFormulario(req.body, { ...tarea.toObject(), scheduledAt: paraInput(tarea.scheduledAt) }),
        errores,
      });
    }

    tarea.title = title;
    tarea.description = String(req.body.description || '').trim();
    if (mongoose.isValidObjectId(req.body.assignedTo)) tarea.assignedTo = req.body.assignedTo;
    tarea.scheduledAt = duracion.scheduledAt;
    tarea.durationMinutes = duracion.durationMinutes;
    if (PRIORIDADES[req.body.priority]) tarea.priority = req.body.priority;
    if (req.body.category) {
      const activa = tipos.some((tipo) => tipo.key === req.body.category);
      if (activa || req.body.category === tarea.category) tarea.category = req.body.category;
    }
    tarea.location = String(req.body.location || '').trim();
    tarea.notes = String(req.body.notes || '').trim();
    await tarea.save();
    await registrar({
      module: 'agenda',
      entity: 'WorkTask',
      entityId: tarea._id,
      action: 'update',
      description: `Tarea "${tarea.title}" actualizada.`,
      actor: req.usuario.username,
    });
    req.flash('exito', 'Tarea actualizada.');
    res.redirect(`/agenda?fecha=${paraCampo(tarea.scheduledAt)}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.status) {
      const tarea = await WorkTask.findById(req.params.id).lean();
      const mensajes = error.name === 'ValidationError'
        ? Object.values(error.errors).map((detalle) => detalle.message)
        : [error.message];
      return renderizarFormulario(req, res, {
        modo: 'editar',
        tarea: tareaDeFormulario(req.body, tarea ? { ...tarea, scheduledAt: paraInput(tarea.scheduledAt) } : {}),
        errores: mensajes,
        status: 422,
      });
    }
    next(error);
  }
}

async function cambiarEstado(req, res, next) {
  try {
    const tarea = await WorkTask.findById(req.params.id);
    if (!tarea) throw crearError(404, 'La tarea no existe.');
    const gestor = puedeGestionar(req);
    if (!gestor && String(tarea.assignedTo) !== String(req.usuario._id)) {
      throw crearError(403, 'Solo puedes marcar tus propias tareas.');
    }
    const accion = String(req.body.accion || '');
    if (accion === 'iniciar') {
      tarea.status = 'in_progress';
      tarea.startedAt = new Date();
    } else if (accion === 'finalizar') {
      tarea.status = 'done';
      tarea.startedAt = tarea.startedAt || new Date();
      tarea.finishedAt = new Date();
    } else if (accion === 'cancelar' && gestor) {
      tarea.status = 'cancelled';
    } else if (accion === 'reabrir' && gestor) {
      tarea.status = 'pending';
      tarea.startedAt = null;
      tarea.finishedAt = null;
    } else {
      throw crearError(422, 'Acción no válida.');
    }
    await tarea.save();
    await registrar({
      module: 'agenda',
      entity: 'WorkTask',
      entityId: tarea._id,
      action: 'update',
      description: `Tarea "${tarea.title}": ${ESTADOS[tarea.status]}.`,
      actor: req.usuario.username,
    });
    req.flash('exito', `Tarea ${ESTADOS[tarea.status].toLowerCase()}.`);
    res.redirect(`/agenda?fecha=${paraCampo(tarea.scheduledAt)}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/agenda');
    }
    next(error);
  }
}

async function eliminar(req, res, next) {
  try {
    if (!puedeGestionar(req)) throw crearError(403, 'No tienes permiso para eliminar tareas.');
    const tarea = await WorkTask.findById(req.params.id);
    if (!tarea) throw crearError(404, 'La tarea no existe.');
    const fecha = paraCampo(tarea.scheduledAt);
    await tarea.deleteOne();
    await registrar({
      module: 'agenda',
      entity: 'WorkTask',
      entityId: tarea._id,
      action: 'delete',
      description: `Tarea "${tarea.title}" eliminada.`,
      actor: req.usuario.username,
    });
    req.flash('exito', 'Tarea eliminada.');
    res.redirect(`/agenda?fecha=${fecha}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/agenda');
    }
    next(error);
  }
}

module.exports = { index, formNuevo, crear, ver, formEditar, actualizar, cambiarEstado, eliminar };
