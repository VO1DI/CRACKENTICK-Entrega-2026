/**
 * Constantes compartidas por modelos, controladores, servicios y vistas.
 */

const MONEDAS = [
  { code: 'USD', label: 'Dólar estadounidense', symbol: '$', locale: 'en-US' },
  { code: 'VES', label: 'Bolívar venezolano', symbol: 'Bs.', locale: 'es-VE' },
  { code: 'COP', label: 'Peso colombiano', symbol: '$', locale: 'es-CO' },
  { code: 'EUR', label: 'Euro', symbol: '€', locale: 'es-ES' },
  { code: 'MXN', label: 'Peso mexicano', symbol: '$', locale: 'es-MX' },
  { code: 'ARS', label: 'Peso argentino', symbol: '$', locale: 'es-AR' },
  { code: 'CLP', label: 'Peso chileno', symbol: '$', locale: 'es-CL' },
  { code: 'PEN', label: 'Sol peruano', symbol: 'S/', locale: 'es-PE' },
  { code: 'BRL', label: 'Real brasileño', symbol: 'R$', locale: 'pt-BR' },
];

const MONEDA_POR_DEFECTO = 'USD';
const LOCALE_POR_DEFECTO = 'es-VE';
const ZONA_POR_DEFECTO = 'America/Caracas';

const ESTADOS_CLIENTE = ['active', 'suspended', 'retired'];
const ESTADOS_SUSCRIPCION = ['active', 'suspended', 'cancelled'];
const ESTADOS_FACTURA = ['draft', 'open', 'paid', 'overdue', 'void'];
const ESTADOS_FIREWALL = ['none', 'pending', 'blocked', 'error'];
const TIPOS_CONEXION = ['pppoe', 'static', 'dhcp'];
const INTERVALOS = ['monthly', 'quarterly', 'annual'];
const METODOS_PAGO = ['cash', 'transfer', 'card', 'pago_movil', 'zelle', 'other'];
const AREAS_EMPLEADO = ['administracion', 'soporte', 'cobranzas', 'tecnicos', 'ventas'];
const ETIQUETAS_AREA_EMPLEADO = {
  administracion: 'Administración',
  soporte: 'Soporte',
  cobranzas: 'Cobranzas',
  tecnicos: 'Técnicos',
  ventas: 'Ventas',
};
const MONEDAS_PAGO = ['USD', 'VES'];
const METODOS_PAGO_USD = ['cash', 'other'];
const METODOS_PAGO_BS = ['transfer', 'pago_movil', 'cash', 'other'];
const ETIQUETAS_MONEDA_PAGO = { USD: 'USD', VES: 'Bs' };
const MODOS_FIREWALL = ['real'];

/** Tipos de factura. Solo `service` participa en la mora y en los cortes. */
const TIPOS_FACTURA = ['service', 'installation', 'sale', 'other'];

/** Estados del subsistema de ventas / instalaciones. */
const ESTADOS_VENTA = ['waiting', 'installed', 'cancelled'];

/** Tickets de soporte técnico. */
const ESTADOS_TICKET = ['open', 'in_progress', 'resolved', 'closed'];
const PRIORIDADES_TICKET = ['low', 'medium', 'high', 'urgent'];
const CATEGORIAS_TICKET = ['technical', 'billing', 'installation', 'other'];

/** Reportes diarios de averías. */
const ESTADOS_AVERIA = ['solved', 'in_progress', 'unsolved'];
const ETIQUETAS_ESTADO_AVERIA = {
  solved: 'Solventada',
  in_progress: 'En proceso',
  unsolved: 'Sin solventar',
};

/** Inventario. */
const CATEGORIAS_INVENTARIO = ['router', 'onu', 'antenna', 'switch', 'cable', 'connector', 'other'];
const TIPOS_INVENTARIO = ['bulk', 'serial'];
const ESTADOS_SERIAL = ['available', 'installed', 'sold', 'defective'];
const TIPOS_MOVIMIENTO_INVENTARIO = ['entrada', 'salida', 'ajuste', 'instalacion', 'venta', 'devolucion'];

/** Monitorización y alertas. */
const ESTADOS_ALERTA = ['active', 'acknowledged', 'resolved'];
const TIPOS_ALERTA = ['wan_down', 'wan_up', 'client_down', 'stock_low', 'wan_latency', 'router_down', 'router_up'];
const TIPOS_ALERTA_RED = ['wan_down', 'wan_up', 'wan_latency', 'router_down', 'router_up'];
const PROPOSITOS_POOL = ['pppoe', 'static', 'dhcp', 'mixed'];

/** Categorías de aviso que se pueden enrutar a cada bot de Telegram. */
const CATEGORIAS_TELEGRAM = [
  { key: 'red', label: 'Red', detalle: 'WAN caída o restablecida y latencia' },
  { key: 'servicios', label: 'Servicios', detalle: 'Cliente sin conexión' },
  { key: 'almacen', label: 'Almacén', detalle: 'Stock bajo' },
];

/** Autenticación y permisos por nodo. */
const ROLES_USUARIO = ['admin', 'staff'];

/** Identidad fija de la cuenta administradora principal. */
const ADMIN_PRINCIPAL = {
  name: 'Juan Echenique',
  username: 'admin',
  email: 'juan.echenique@crackentick.example',
};

const GRUPOS_PERMISOS = [
  {
    key: 'general',
    label: 'General',
    descripcion: 'Panel y clientes',
    nodos: [
      { key: 'general.dashboard', label: 'Dashboard', ruta: '/' },
      { key: 'general.clientes', label: 'Clientes', ruta: '/clientes' },
    ],
  },
  {
    key: 'clientes',
    label: 'Clientes',
    descripcion: 'Pestañas y acciones dentro de la ficha del cliente',
    nodos: [
      { key: 'clientes.datos', label: 'Datos y portal', ruta: '' },
      { key: 'clientes.servicio', label: 'Servicio técnico', ruta: '' },
      { key: 'clientes.cortes', label: 'Cortes y PPPoE', ruta: '' },
      { key: 'clientes.facturacion', label: 'Facturación del cliente', ruta: '' },
    ],
  },
  {
    key: 'reportes',
    label: 'Reportes',
    descripcion: 'Resumen y reportes de gestión',
    nodos: [
      { key: 'reportes.gestion', label: 'Resumen de reportes', ruta: '/reportes' },
    ],
  },
  {
    key: 'red',
    label: 'Red',
    descripcion: 'Infraestructura y aprovisionamiento',
    nodos: [
      { key: 'red.routers', label: 'Routers', ruta: '/red/routers' },
      { key: 'red.pools', label: 'Pools de IP', ruta: '/red/pools' },
      { key: 'red.planes', label: 'Planes', ruta: '/red/planes' },
      { key: 'red.monitoreo', label: 'Monitorización', ruta: '/red/monitoreo' },
      { key: 'red.zonas', label: 'Zonas', ruta: '/red/zonas' },
      { key: 'red.averias', label: 'Reporte de averías', ruta: '/red/reportes/averias' },
      { key: 'red.instalaciones', label: 'Reporte de instalaciones', ruta: '/red/reportes/instalaciones' },
    ],
  },
  {
    key: 'avanzado',
    label: 'Avanzado',
    descripcion: 'Configuración del router',
    nodos: [
      { key: 'red.vlans', label: 'VLANs', ruta: '/red/vlans' },
      { key: 'red.dhcp', label: 'Servidores DHCP', ruta: '/red/dhcp' },
      { key: 'red.firewall', label: 'Firewall de routers', ruta: '/red/firewall' },
      { key: 'red.eoip', label: 'Túneles EOIP', ruta: '/red/eoip' },
      { key: 'red.balanceo', label: 'Balanceo de WAN', ruta: '/red/balanceo' },
      { key: 'red.respaldos', label: 'Respaldos de routers', ruta: '/red/respaldos' },
    ],
  },
  {
    key: 'ventas',
    label: 'Ventas',
    descripcion: 'Ventas, instalaciones e inventario',
    nodos: [
      { key: 'ventas.ventas', label: 'Ventas', ruta: '/ventas' },
      { key: 'ventas.instalar', label: 'Instalar y completar servicio', ruta: '' },
      { key: 'ventas.inventario', label: 'Inventario', ruta: '/ventas/inventario' },
    ],
  },
  {
    key: 'soporte',
    label: 'Soporte',
    descripcion: 'Mesa de ayuda',
    nodos: [
      { key: 'soporte.tickets', label: 'Tickets', ruta: '/soporte/tickets' },
      { key: 'soporte.asistente', label: 'Asistente IA', ruta: '' },
    ],
  },
  {
    key: 'agenda',
    label: 'Agenda',
    descripcion: 'Tareas de técnicos y empleados',
    nodos: [
      { key: 'agenda.gestion', label: 'Agenda de tareas', ruta: '/agenda' },
    ],
  },
  {
    key: 'hotspot',
    label: 'Hotspot',
    descripcion: 'Vouchers y acceso WiFi',
    nodos: [
      { key: 'hotspot.gestion', label: 'Hotspot y vouchers', ruta: '/hotspot' },
    ],
  },
  {
    key: 'finanzas',
    label: 'Finanzas',
    descripcion: 'Cobros, facturas y gestión',
    nodos: [
      { key: 'finanzas.facturacion', label: 'Facturación', ruta: '/finanzas/facturacion' },
      { key: 'finanzas.facturas', label: 'Facturas', ruta: '/finanzas/facturas' },
      { key: 'finanzas.gestion', label: 'Contabilidad', ruta: '/finanzas' },
    ],
  },
  {
    key: 'admin',
    label: 'Administración',
    descripcion: 'Usuarios, gastos y sistema',
    nodos: [
      { key: 'admin.usuarios', label: 'Usuarios', ruta: '/admin/usuarios' },
      { key: 'admin.empleados', label: 'Empleados y nómina', ruta: '/admin/empleados' },
      { key: 'admin.gastos', label: 'Gastos', ruta: '/admin/gastos' },
      { key: 'admin.configuracion', label: 'Configuración', ruta: '/admin/configuracion' },
      { key: 'admin.auditoria', label: 'Auditoría', ruta: '/admin/auditoria' },
    ],
  },
];

const PERMISOS = GRUPOS_PERMISOS.flatMap((grupo) => grupo.nodos.map((nodo) => nodo.key));

const ETIQUETAS_PERMISO = GRUPOS_PERMISOS.reduce((mapa, grupo) => {
  grupo.nodos.forEach((nodo) => {
    mapa[nodo.key] = nodo.label;
  });
  return mapa;
}, {});

/** Finanzas: gastos mensuales e ingresos manuales. */
const TIPOS_MOVIMIENTO_FINANZAS = ['expense', 'income'];
const ESTADOS_MOVIMIENTO_FINANZAS = ['pending', 'paid'];
const CATEGORIAS_FINANZAS = [
  'proveedores',
  'empleados',
  'autos',
  'renta',
  'servicios',
  'impuestos',
  'instalaciones',
  'inventario',
  'ventas',
  'ajustes',
  'otros',
];

const ETIQUETAS_CATEGORIA_FINANZA = {
  proveedores: 'Proveedores',
  empleados: 'Empleados',
  autos: 'Autos y transporte',
  renta: 'Renta',
  servicios: 'Servicios',
  impuestos: 'Impuestos',
  instalaciones: 'Instalaciones',
  inventario: 'Compra de inventario (activo)',
  ventas: 'Ventas',
  ajustes: 'Ajustes',
  otros: 'Otros',
};

const ETIQUETAS_ROL = {
  admin: 'Administrador',
  staff: 'Operador',
};

const ETIQUETAS_ESTADO = {
  active: 'Activo',
  suspended: 'Suspendido',
  retired: 'Retirado',
  cancelled: 'Cancelado',
  open: 'Pendiente',
  paid: 'Pagada',
  overdue: 'Vencida',
  void: 'Anulada',
  draft: 'Borrador',
  none: 'Sin acción',
  pending: 'Pendiente',
  blocked: 'Bloqueado',
  error: 'Error',
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
  pago_movil: 'Pago Móvil',
  zelle: 'Zelle',
  other: 'Otro',
  pppoe: 'PPPoE',
  static: 'IP estática',
  dhcp: 'DHCP',
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  annual: 'Anual',
  simulated: 'Simulado',
  real: 'Real',
  // Ventas
  waiting: 'En espera',
  installed: 'Instalado',
  // Tickets
  in_progress: 'En proceso',
  resolved: 'Resuelto',
  closed: 'Cerrado',
  solved: 'Solventada',
  unsolved: 'Sin solventar',
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente',
  technical: 'Técnico',
  billing: 'Facturación',
  installation: 'Instalación',
  // Inventario
  router: 'Router',
  onu: 'ONU',
  antenna: 'Antena',
  switch: 'Switch',
  cable: 'Cable',
  connector: 'Conector',
  bulk: 'Por cantidad',
  serial: 'Serializado',
  available: 'Disponible',
  sold: 'Vendido',
  defective: 'Defectuoso',
  // Facturas
  service: 'Servicio',
  sale: 'Venta',
  // Monitorización
  acknowledged: 'Reconocida',
  wan_down: 'WAN caída',
  wan_up: 'WAN restablecida',
  wan_latency: 'Latencia WAN',
  router_down: 'Router caído',
  router_up: 'Router restablecido',
  client_down: 'Cliente sin conexión',
  stock_low: 'Stock bajo',
  critical: 'Crítica',
  warning: 'Advertencia',
  info: 'Informativa',
  applied: 'Aplicado',
  incomplete: 'Incompleto',
  mixed: 'Mixto',
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste',
  instalacion: 'Instalación',
  venta: 'Venta',
  // Finanzas
  expense: 'Gasto',
  income: 'Ingreso',
};

const CATEGORIAS_TAREA = {
  instalacion: 'Instalación',
  soporte: 'Soporte',
  ip_publica: 'Cambio de IP pública',
  desbaneo: 'Desbaneo de IP',
  mantenimiento: 'Mantenimiento',
  otro: 'Otro',
};

const MODULOS_AUDITORIA = [
  'commercial',
  'technical',
  'financial',
  'firewall',
  'settings',
  'provisioning',
  'inventory',
  'support',
  'monitoring',
  'agenda',
  'auth',
];

const ACCIONES_AUDITORIA = [
  'create',
  'update',
  'delete',
  'billing_preview',
  'billing_issue',
  'billing_overdue',
  'payment',
  'void',
  'block',
  'unblock',
  'pppoe_disable',
  'pppoe_enable',
  'config_change',
  'test_connection',
  'simulation',
  'provision',
  'sync',
  'install',
  'cancel',
  'adjust',
  'alert',
  'reply',
  'login',
  'logout',
  'assistant',
];

const PERIODOS_DASHBOARD = {
  mes: 'Este mes',
  anterior: 'Mes anterior',
  '90d': 'Últimos 90 días',
};

const PLANES_POR_PAGINA = 9;
const CLIENTES_POR_PAGINA = 10;
const FACTURAS_POR_PAGINA = 12;
const LOGS_POR_PAGINA = 20;
const TICKETS_POR_PAGINA = 12;
const INVENTARIO_POR_PAGINA = 15;
const VENTAS_POR_PAGINA = 12;

const ETIQUETAS_MODULO = {
  commercial: 'Comercial',
  technical: 'Técnico',
  financial: 'Financiero',
  firewall: 'Firewall',
  settings: 'Configuración',
  provisioning: 'Aprovisionamiento',
  inventory: 'Inventario',
  support: 'Soporte',
  monitoring: 'Monitorización',
  auth: 'Acceso',
  agenda: 'Agenda',
};

module.exports = {
  MONEDAS,
  MONEDA_POR_DEFECTO,
  LOCALE_POR_DEFECTO,
  ZONA_POR_DEFECTO,
  ESTADOS_CLIENTE,
  ESTADOS_SUSCRIPCION,
  ESTADOS_FACTURA,
  ESTADOS_FIREWALL,
  TIPOS_CONEXION,
  INTERVALOS,
  METODOS_PAGO,
  AREAS_EMPLEADO,
  ETIQUETAS_AREA_EMPLEADO,
  MONEDAS_PAGO,
  METODOS_PAGO_USD,
  METODOS_PAGO_BS,
  ETIQUETAS_MONEDA_PAGO,
  MODOS_FIREWALL,
  TIPOS_FACTURA,
  ESTADOS_VENTA,
  ESTADOS_TICKET,
  PRIORIDADES_TICKET,
  CATEGORIAS_TICKET,
  ESTADOS_AVERIA,
  ETIQUETAS_ESTADO_AVERIA,
  CATEGORIAS_INVENTARIO,
  TIPOS_INVENTARIO,
  ESTADOS_SERIAL,
  TIPOS_MOVIMIENTO_INVENTARIO,
  ESTADOS_ALERTA,
  TIPOS_ALERTA,
  TIPOS_ALERTA_RED,
  PROPOSITOS_POOL,
  CATEGORIAS_TELEGRAM,
  ROLES_USUARIO,
  ADMIN_PRINCIPAL,
  GRUPOS_PERMISOS,
  PERMISOS,
  ETIQUETAS_PERMISO,
  ETIQUETAS_ROL,
  TIPOS_MOVIMIENTO_FINANZAS,
  ESTADOS_MOVIMIENTO_FINANZAS,
  CATEGORIAS_FINANZAS,
  ETIQUETAS_CATEGORIA_FINANZA,
  ETIQUETAS_ESTADO,
  ETIQUETAS_MODULO,
  CATEGORIAS_TAREA,
  MODULOS_AUDITORIA,
  ACCIONES_AUDITORIA,
  PERIODOS_DASHBOARD,
  PLANES_POR_PAGINA,
  CLIENTES_POR_PAGINA,
  FACTURAS_POR_PAGINA,
  LOGS_POR_PAGINA,
  TICKETS_POR_PAGINA,
  INVENTARIO_POR_PAGINA,
  VENTAS_POR_PAGINA,
};
