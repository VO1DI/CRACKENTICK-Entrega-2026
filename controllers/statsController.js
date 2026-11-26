const Employee = require('../models/Employee');
const Ticket = require('../models/Ticket');
const Sale = require('../models/Sale');
const FaultReport = require('../models/FaultReport');
const InstallationReport = require('../models/InstallationReport');
const AuditLog = require('../models/AuditLog');
const Invoice = require('../models/Invoice');
const WorkTask = require('../models/WorkTask');
const taskTypeService = require('../services/taskTypeService');
const User = require('../models/User');
const mongoose = require('mongoose');
const { redondear } = require('../utils/money');

const PERIODOS = [7, 30, 90];
const AREAS = [
  { key: 'soporte', titulo: 'Soporte', detalle: 'Tickets atendidos y tiempos de resolución' },
  { key: 'cobranzas', titulo: 'Cobranzas', detalle: 'Pagos registrados e importe cobrado' },
  { key: 'tecnicos', titulo: 'Técnicos', detalle: 'Instalaciones y averías resueltas' },
  { key: 'ventas', titulo: 'Ventas', detalle: 'Ventas registradas e importe vendido' },
  { key: 'administracion', titulo: 'Administración', detalle: 'Actividad registrada' },
  { key: 'sin-ficha', titulo: 'Sin ficha', detalle: 'Nombres con actividad pero sin trabajador registrado' },
];

const clave = (valor) => String(valor || '').trim().toLowerCase();
const aFecha = (texto, fin) => {
  if (!texto) return null;
  const fecha = new Date(`${String(texto).slice(0, 10)}T${fin ? '23:59:59' : '00:00:00'}`);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

function crearFila(empleado) {
  return {
    empleado,
    ticketsAbiertos: 0,
    ticketsResueltos: 0,
    horas: [],
    instalaciones: 0,
    averias: 0,
    ventas: 0,
    vendido: 0,
    pagos: 0,
    cobrado: 0,
    tareasAsignadas: 0,
    tareasHechas: 0,
    tareasEnCurso: 0,
    horasTarea: [],
    tareasPorTipo: {},
    tiemposPorTipo: {},
  };
}

function promedio(valores) {
  if (!valores.length) return null;
  return valores.reduce((total, valor) => total + valor, 0) / valores.length;
}

/** Importe en USD de un pago: manda el total de la factura; si no existe, el cambio. */
function montoCobradoUsd(pago, totalesFactura) {
  const total = pago.entityId ? totalesFactura.get(String(pago.entityId)) : undefined;
  if (Number.isFinite(total)) return total;
  const cambios = (pago.changes && pago.changes.after) || {};
  const monto = Number(cambios.paymentAmount) || 0;
  const tasa = Number(cambios.exchangeRate) || 0;
  return cambios.paymentCurrency === 'VES' ? (tasa > 0 ? redondear(monto / tasa) : 0) : monto;
}

async function index(req, res, next) {
  try {
    const dias = PERIODOS.includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
    const desdePersonalizado = aFecha(req.query.desde, false);
    const hastaPersonalizado = aFecha(req.query.hasta, true);
    const hasta = hastaPersonalizado || new Date();
    const desde = desdePersonalizado || new Date(hasta.getTime() - dias * 86400000);
    if (desde > hasta) {
      const temporal = new Date(desde.getTime());
      desde.setTime(hasta.getTime());
      hasta.setTime(temporal.getTime());
    }

    const [empleados, tickets, instalaciones, averias, ventas, usuarios, pagos, tareas, tiposTarea] = await Promise.all([
      Employee.find({ active: true }).sort({ area: 1, name: 1 }).lean(),
      Ticket.find({ createdAt: { $gte: desde, $lte: hasta } }).select('assignedTo assigneeId status resolvedAt createdAt').lean(),
      InstallationReport.find({ installedAt: { $gte: desde, $lte: hasta } }).select('technician technicianId').lean(),
      FaultReport.find({ createdAt: { $gte: desde, $lte: hasta } }).select('technician technicianId status').lean(),
      Sale.find({ createdAt: { $gte: desde, $lte: hasta }, status: 'installed' }).select('promoterId total status').lean(),
      User.find().select('name username').lean(),
      AuditLog.find({ action: 'payment', timestamp: { $gte: desde, $lte: hasta } })
        .select('actor entityId changes')
        .lean(),
      WorkTask.find({ scheduledAt: { $gte: desde, $lte: hasta } })
        .populate('assignedTo', 'name username')
        .select('title category status startedAt finishedAt scheduledAt assignedTo')
        .lean(),
      taskTypeService.listar({ soloActivos: false }),
    ]);

    const usuarioPorLogin = new Map(usuarios.map((usuario) => [clave(usuario.username), usuario]));
    const nombreUsuario = new Map(usuarios.map((usuario) => [String(usuario._id), usuario.name || usuario.username]));
    const idsFacturasPago = [...new Set(
      pagos.map((pago) => pago.entityId).filter((id) => id && mongoose.isValidObjectId(id))
    )];
    const totalesFactura = new Map(
      (await Invoice.find({ _id: { $in: idsFacturasPago } }).select('total').lean())
        .map((factura) => [String(factura._id), Number(factura.total) || 0])
    );
    const filas = new Map(empleados.map((empleado) => [clave(empleado.name), crearFila(empleado)]));
    const porUsuario = new Map();
    for (const empleado of empleados) {
      if (empleado.userId) porUsuario.set(String(empleado.userId), filas.get(clave(empleado.name)));
    }
    const sueltos = new Map();

    const filaDe = (nombre) => {
      const llave = clave(nombre);
      if (!llave) return null;
      if (filas.has(llave)) return filas.get(llave);
      if (!sueltos.has(llave)) {
        sueltos.set(llave, crearFila({ name: nombre, position: 'Sin ficha', area: 'sin-ficha' }));
      }
      return sueltos.get(llave);
    };

    const filaDePersona = (id, nombre) => {
      if (id && porUsuario.has(String(id))) return porUsuario.get(String(id));
      return filaDe(nombre);
    };

    for (const ticket of tickets) {
      const fila = filaDePersona(ticket.assigneeId, ticket.assignedTo);
      if (!fila) continue;
      if (['open', 'in_progress'].includes(ticket.status)) fila.ticketsAbiertos += 1;
      if (ticket.resolvedAt && ticket.resolvedAt >= desde) {
        fila.ticketsResueltos += 1;
        const horas = (ticket.resolvedAt - ticket.createdAt) / 3600000;
        if (horas >= 0) fila.horas.push(horas);
      }
    }

    for (const instalacion of instalaciones) {
      const fila = filaDePersona(instalacion.technicianId, instalacion.technician);
      if (fila) fila.instalaciones += 1;
    }

    for (const averia of averias) {
      if (averia.status !== 'solved') continue;
      const fila = filaDePersona(averia.technicianId, averia.technician);
      if (fila) fila.averias += 1;
    }

    for (const venta of ventas) {
      const vendedor = nombreUsuario.get(String(venta.promoterId)) || '';
      const fila = filaDe(vendedor);
      if (fila) {
        fila.ventas += 1;
        fila.vendido += Number(venta.total) || 0;
      }
    }

    /* Cobranzas: pagos registrados por el usuario que los capturó. */
    for (const pago of pagos) {
      const usuario = usuarioPorLogin.get(clave(pago.actor));
      const fila = usuario ? porUsuario.get(String(usuario._id)) : null;
      if (!fila) continue;
      fila.pagos += 1;
      fila.cobrado += montoCobradoUsd(pago, totalesFactura);
    }

    /* Agenda: tareas asignadas, hechas y tiempo real de ejecución. */
    for (const tarea of tareas) {
      const fila = filaDe(tarea.assignedTo?.name);
      if (!fila) continue;
      fila.tareasAsignadas += 1;
      if (tarea.status === 'done') {
        fila.tareasHechas += 1;
        if (tarea.startedAt && tarea.finishedAt) {
          const horas = (tarea.finishedAt - tarea.startedAt) / 3600000;
          if (horas >= 0) {
            fila.horasTarea.push(horas);
            if (!fila.tiemposPorTipo[tarea.category]) fila.tiemposPorTipo[tarea.category] = [];
            fila.tiemposPorTipo[tarea.category].push(horas);
          }
        }
      } else if (tarea.status === 'in_progress') {
        fila.tareasEnCurso += 1;
      }
      fila.tareasPorTipo[tarea.category] = (fila.tareasPorTipo[tarea.category] || 0) + 1;
    }

    const todas = [...filas.values(), ...sueltos.values()].map((fila) => ({
      ...fila,
      promedioHoras: promedio(fila.horas),
      promedioHorasTarea: promedio(fila.horasTarea),
      promedioPorTipo: Object.fromEntries(
        Object.entries(fila.tiemposPorTipo).map(([categoria, tiempos]) => [categoria, promedio(tiempos)])
      ),
      horas: undefined,
      horasTarea: undefined,
      tiemposPorTipo: undefined,
    }));

    const secciones = AREAS.map((area) => ({
      ...area,
      filas: todas
        .filter((fila) => fila.empleado.area === area.key)
        .filter((fila) => fila.ticketsAbiertos || fila.ticketsResueltos || fila.instalaciones || fila.averias || fila.ventas || fila.pagos || fila.tareasAsignadas)
        .sort((a, b) => (b.ticketsResueltos + b.instalaciones + b.averias + b.ventas + b.pagos + b.tareasHechas) - (a.ticketsResueltos + a.instalaciones + a.averias + a.ventas + a.pagos + a.tareasHechas)),
    })).filter((seccion) => seccion.filas.length);

    const resumenGlobal = {
      ticketsResueltos: todas.reduce((total, fila) => total + fila.ticketsResueltos, 0),
      promedioHoras: promedio(todas.map((fila) => fila.promedioHoras).filter((valor) => valor !== null)),
      instalaciones: todas.reduce((total, fila) => total + fila.instalaciones, 0),
      averias: todas.reduce((total, fila) => total + fila.averias, 0),
      ventas: todas.reduce((total, fila) => total + fila.ventas, 0),
      vendido: todas.reduce((total, fila) => total + fila.vendido, 0),
      pagos: todas.reduce((total, fila) => total + fila.pagos, 0),
      cobrado: todas.reduce((total, fila) => total + fila.cobrado, 0),
      tareasAsignadas: todas.reduce((total, fila) => total + fila.tareasAsignadas, 0),
      tareasHechas: todas.reduce((total, fila) => total + fila.tareasHechas, 0),
      tareasEnCurso: todas.reduce((total, fila) => total + fila.tareasEnCurso, 0),
      promedioHorasTarea: promedio(todas.map((fila) => fila.promedioHorasTarea).filter((valor) => valor !== null)),
    };

    const seleccionado = todas.find((fila) => fila.empleado._id && String(fila.empleado._id) === String(req.query.empleado)) || null;

    /* Con un trabajador elegido, el resumen y las tablas son solo suyos. */
    const resumen = seleccionado
      ? {
          ticketsResueltos: seleccionado.ticketsResueltos,
          promedioHoras: seleccionado.promedioHoras,
          instalaciones: seleccionado.instalaciones,
          averias: seleccionado.averias,
          ventas: seleccionado.ventas,
          vendido: seleccionado.vendido,
          pagos: seleccionado.pagos,
          cobrado: seleccionado.cobrado,
          tareasAsignadas: seleccionado.tareasAsignadas,
          tareasHechas: seleccionado.tareasHechas,
          tareasEnCurso: seleccionado.tareasEnCurso,
          promedioHorasTarea: seleccionado.promedioHorasTarea,
        }
      : resumenGlobal;

    const seccionesVisibles = seleccionado
      ? secciones
          .map((seccion) => ({
            ...seccion,
            filas: seccion.filas.filter((fila) => String(fila.empleado._id) === String(seleccionado.empleado._id)),
          }))
          .filter((seccion) => seccion.filas.length)
      : secciones;

    res.render('employees/stats', {
      titulo: 'Rendimiento',
      dias,
      periodos: PERIODOS,
      secciones: seccionesVisibles,
      resumen,
      desde,
      hasta,
      filtroDesde: req.query.desde || '',
      filtroHasta: req.query.hasta || '',
      empleados: todas.filter((fila) => fila.empleado._id).map((fila) => ({ id: String(fila.empleado._id), name: fila.empleado.name })),
      empleadoId: req.query.empleado || '',
      seleccionado,
      categoriasTarea: Object.fromEntries(tiposTarea.map((tipo) => [tipo.key, tipo.name])),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { index };
