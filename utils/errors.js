/** Error de negocio con código HTTP y mensaje para el usuario. */
function crearError(status, mensaje, detalles = []) {
  const error = new Error(mensaje);
  error.status = status;
  error.esOperacional = true;
  error.detalles = detalles;
  return error;
}

function erroresDeValidacion(error) {
  if (!error || error.name !== 'ValidationError') return [];
  return Object.values(error.errors).map((detalle) => detalle.message);
}

/** Traduce un error de Mongoose a un mensaje comprensible. */
function mensajeDeError(error) {
  if (!error) return 'Ocurrió un problema inesperado.';

  if (error.name === 'ValidationError') {
    return erroresDeValidacion(error).join(' ') || 'Algunos datos no son válidos.';
  }

  if (error.name === 'CastError') {
    return 'El identificador enviado no tiene el formato correcto.';
  }

  if (error.code === 11000) {
    const campo = Object.keys(error.keyPattern || {})[0] || 'valor';
    const mensajes = {
      clientCode: 'El código de cliente ya existe.',
      email: 'El correo ya está registrado.',
      taxId: 'La identificación ya está registrada.',
      name: 'Ya existe un plan con ese nombre.',
      invoiceNumber: 'El número de factura ya existe.',
      clientId: 'El cliente ya tiene un servicio contratado.',
      pppoeUsername: 'El usuario PPPoE ya está en uso.',
      ipAddress: 'La dirección IP ya está en uso.',
      'serviceConfig.macAddress': 'La MAC ya está autenticada en otro servicio.',
      'service.macAddress': 'La MAC ya está autenticada en otra venta.',
      'serials.serial': 'El serial ya está registrado en otro artículo.',
    };
    return mensajes[campo] || 'Ya existe un registro con ese valor.';
  }

  return error.message || 'Ocurrió un problema inesperado.';
}

module.exports = { crearError, erroresDeValidacion, mensajeDeError };
