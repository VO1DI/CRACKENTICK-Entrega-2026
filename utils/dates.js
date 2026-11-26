const INTERVALOS_MESES = { monthly: 1, quarterly: 3, annual: 12 };

/** Convierte fechas sin hora (`YYYY-MM-DD`) al inicio del día local. */
function fechaLocal(valor) {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) {
    return new Date(`${valor.trim()}T00:00:00`);
  }
  return new Date(valor);
}

/** Suma meses conservando el último día válido del mes destino. */
function sumarMeses(fecha, meses) {
  const base = fechaLocal(fecha);
  const dia = base.getDate();
  const resultado = new Date(base);
  resultado.setDate(1);
  resultado.setMonth(resultado.getMonth() + meses);
  const ultimoDia = new Date(resultado.getFullYear(), resultado.getMonth() + 1, 0).getDate();
  resultado.setDate(Math.min(dia, ultimoDia));
  return resultado;
}

/** Suma el intervalo de facturación a una fecha. */
function sumarIntervalo(fecha, intervalo) {
  return sumarMeses(fecha, INTERVALOS_MESES[intervalo] || 1);
}

function sumarDias(fecha, dias) {
  const resultado = fechaLocal(fecha);
  resultado.setDate(resultado.getDate() + Number(dias || 0));
  return resultado;
}

function inicioDelDia(fecha = new Date()) {
  const resultado = fechaLocal(fecha);
  resultado.setHours(0, 0, 0, 0);
  return resultado;
}

function finDelDia(fecha = new Date()) {
  const resultado = fechaLocal(fecha);
  resultado.setHours(23, 59, 59, 999);
  return resultado;
}

function inicioDelMes(fecha = new Date()) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), 1, 0, 0, 0, 0);
}

function finDelMes(fecha = new Date()) {
  return new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0, 23, 59, 59, 999);
}

function rangoPeriodo(periodo = 'mes') {
  const ahora = new Date();
  if (periodo === 'anterior') {
    const referencia = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
    return { desde: inicioDelMes(referencia), hasta: finDelMes(referencia), etiqueta: 'Mes anterior' };
  }
  if (periodo === '90d') {
    return { desde: inicioDelDia(sumarDias(ahora, -89)), hasta: finDelDia(ahora), etiqueta: 'Últimos 90 días' };
  }
  return { desde: inicioDelMes(ahora), hasta: finDelMes(ahora), etiqueta: 'Este mes' };
}

function claveMes(fecha) {
  const d = new Date(fecha);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `YYYY-MM` -> primer día de ese mes; cualquier otro valor usa la fecha actual. */
function interpretarMes(valor) {
  const coincidencia = /^(\d{4})-(\d{2})$/.exec(String(valor || '').trim());
  if (coincidencia) {
    const anio = Number(coincidencia[1]);
    const mes = Number(coincidencia[2]) - 1;
    if (mes >= 0 && mes <= 11) return new Date(anio, mes, 1);
  }
  return new Date();
}

function etiquetaMes(fecha, locale = 'es-VE') {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(fecha)).replace('.', '');
  } catch (error) {
    return claveMes(fecha);
  }
}

/** Últimos seis meses, del más antiguo al actual. */
function ultimosMeses(cantidad = 6) {
  const ahora = new Date();
  const meses = [];
  for (let i = cantidad - 1; i >= 0; i -= 1) {
    const fecha = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    meses.push({
      clave: claveMes(fecha),
      etiqueta: etiquetaMes(fecha),
      desde: inicioDelMes(fecha),
      hasta: finDelMes(fecha),
    });
  }
  return meses;
}

function diasEntre(desde, hasta = new Date()) {
  const ms = inicioDelDia(hasta) - inicioDelDia(desde);
  return Math.max(0, Math.floor(ms / 86400000));
}

function formatearFecha(fecha, locale = 'es-VE', opciones = { dateStyle: 'medium' }) {
  if (!fecha) return '—';
  try {
    return new Intl.DateTimeFormat(locale, opciones).format(fechaLocal(fecha));
  } catch (error) {
    return fechaLocal(fecha).toISOString().slice(0, 10);
  }
}

function formatearFechaHora(fecha, locale = 'es-VE') {
  return formatearFecha(fecha, locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Fecha `YYYY-MM-DD` para un <input type="date">; una fecha inválida usa el valor por defecto. */
function fechaParaInput(valor, defecto = new Date()) {
  let fecha = valor ? new Date(valor) : new Date(defecto);
  if (Number.isNaN(fecha.getTime())) fecha = new Date(defecto);
  if (Number.isNaN(fecha.getTime())) fecha = new Date();
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

/** Minutos -> "1 h 30 min". Usado en agenda y en la ficha de la tarea. */
function duracionTexto(minutos) {
  const total = Math.max(0, Math.round(Number(minutos) || 0));
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  if (horas && resto) return `${horas} h ${resto} min`;
  if (horas) return `${horas} h`;
  return `${resto} min`;
}

/** Fecha y hora con segundos, para la auditoría. */
function formatearFechaHoraExacta(fecha, locale = 'es-VE') {
  return formatearFecha(fecha, locale, { dateStyle: 'medium', timeStyle: 'medium' });
}

module.exports = {
  fechaLocal,
  sumarMeses,
  sumarIntervalo,
  sumarDias,
  inicioDelDia,
  finDelDia,
  inicioDelMes,
  finDelMes,
  rangoPeriodo,
  claveMes,
  interpretarMes,
  etiquetaMes,
  ultimosMeses,
  diasEntre,
  formatearFecha,
  formatearFechaHora,
  formatearFechaHoraExacta,
  duracionTexto,
  fechaParaInput,
};
