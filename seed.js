/**
 * Datos de ejemplo de CRACKENTICK.
 *
 *   npm run seed            -> inserta si la base está vacía
 *   npm run seed -- --reset -> borra la base y vuelve a sembrar
 */
require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
  console.error('La semilla con usuarios y claves de ejemplo no se ejecuta en producción.');
  process.exit(1);
}

const mongoose = require('mongoose');
const Settings = require('./models/Settings');
const Client = require('./models/Client');
const Plan = require('./models/Plan');
const Router = require('./models/Router');
const IpPool = require('./models/IpPool');
const InventoryItem = require('./models/InventoryItem');
const Subscription = require('./models/Subscription');
const Invoice = require('./models/Invoice');
const Ticket = require('./models/Ticket');
const Sale = require('./models/Sale');
const Zone = require('./models/Zone');
const FaultReport = require('./models/FaultReport');
const InstallationReport = require('./models/InstallationReport');
const Alert = require('./models/Alert');
const AuditLog = require('./models/AuditLog');
const User = require('./models/User');
const Employee = require('./models/Employee');
const FinanceEntry = require('./models/FinanceEntry');
const Vlan = require('./models/Vlan');
const FirewallRule = require('./models/FirewallRule');
const EoipTunnel = require('./models/EoipTunnel');
const BalanceConfig = require('./models/BalanceConfig');
const RouterBackup = require('./models/RouterBackup');
const TaskType = require('./models/TaskType');
const payrollService = require('./services/payrollService');
const taskTypeService = require('./services/taskTypeService');
const { ADMIN_PRINCIPAL } = require('./config/constants');
const { cifrar } = require('./services/cryptoService');
const { hashPassword } = require('./utils/password');
const { redondear } = require('./utils/money');
const { sumarMeses, sumarDias, inicioDelMes, sumarIntervalo } = require('./utils/dates');

const MONEDA = 'USD';
const TAX_RATE = 0.16;
const PREFIJO = 'INV';
const LOCALE = 'es-VE';
const ZONA = 'America/Caracas';

const PLANES = [
  {
    name: 'Básico 60',
    description: 'Ideal para navegación, estudio y redes sociales.',
    downloadSpeed: 60,
    uploadSpeed: 20,
    price: 25,
    taxRate: 0,
    billingInterval: 'monthly',
  },
  {
    name: 'Hogar 150',
    description: 'Streaming en varios dispositivos y teletrabajo.',
    downloadSpeed: 150,
    uploadSpeed: 50,
    price: 35,
    billingInterval: 'monthly',
  },
  {
    name: 'Pro 300',
    description: 'Mayor velocidad para hogares conectados.',
    downloadSpeed: 300,
    uploadSpeed: 100,
    price: 49,
    billingInterval: 'monthly',
  },
  {
    name: 'Empresa 600',
    description: 'Conexión dedicada para pequeñas empresas.',
    downloadSpeed: 600,
    uploadSpeed: 300,
    price: 89,
    billingInterval: 'monthly',
  },
  {
    name: 'Fibra 1 Gbps',
    description: 'Máximo rendimiento para gaming y creación de contenido.',
    downloadSpeed: 1000,
    uploadSpeed: 500,
    price: 129,
    billingInterval: 'monthly',
  },
];

/**
 * Los 12 clientes curados conservan el orden original: otros bloques del seed
 * dependen de sus índices (Pedro = 11, Sofía = 4, CL-0011 sin servicio, etc.).
 * Los clientes 13 a 150 se generan para dar volumen realista a la demo.
 */
const CLIENTES_BASE = [
  ['Laura', 'Gómez', 'laura.gomez@example.com', '+58 412-111-2233', 'Av. Libertador, Torre Delta, piso 4', 'Caracas', 'active'],
  ['Carlos', 'Ramírez', 'carlos.ramirez@example.com', '+58 414-222-3344', 'Calle Sucre, Quinta Ana, El Cafetal', 'Caracas', 'active'],
  ['Mariana', 'Torres', 'mariana.torres@example.com', '+58 424-333-4455', 'Av. 5 de Julio, Res. Maracaibo', 'Maracaibo', 'suspended'],
  ['Andrés', 'Felipe', 'andres.felipe@example.com', '+58 416-444-5566', 'Calle 77, Edif. Aurora, Belloso', 'Maracaibo', 'active'],
  ['Sofía', 'Martínez', 'sofia.martinez@example.com', '+58 412-555-6677', 'Av. Bolívar Norte, Torre Valencia', 'Valencia', 'active'],
  ['Julián', 'Castro', 'julian.castro@example.com', '+58 424-666-7788', 'Calle Salom, Quinta Bolívar', 'Barquisimeto', 'active'],
  ['Valentina', 'Rojas', 'valentina.rojas@example.com', '+58 414-777-8899', 'Av. Las Delicias, Res. Aragua', 'Maracay', 'active'],
  ['Diego', 'Herrera', 'diego.herrera@example.com', '+58 416-888-9900', 'Calle Mariño, Edif. Puerto', 'Puerto La Cruz', 'active'],
  ['Camila', 'Vargas', 'camila.vargas@example.com', '+58 412-999-0011', 'Av. Bolívar, Centro Comercial Andino', 'Barquisimeto', 'active'],
  ['Sebastián', 'Moreno', 'sebastian.moreno@example.com', '+58 424-000-1122', 'Calle Real, Quinta Morena', 'San Cristóbal', 'active'],
  ['Isabella', 'Prieto', 'isabella.prieto@example.com', '+58 414-121-3141', 'Av. Universidad, Res. Metropolitana', 'Caracas', 'active'],
  ['Pedro', 'Alvarado', 'pedro.alvarado@example.com', '+58 412-333-2211', 'Sector La Urbina, Calle 8, Casa 22', 'Caracas', 'active'],
];

const TOTAL_CLIENTES = 40;

const NOMBRES_GENERADOS = [
  'Daniel', 'Gabriela', 'Alejandro', 'Paola', 'Ricardo', 'Daniela',
  'Fernando', 'Adriana', 'Manuel', 'Lucía', 'Javier', 'Carolina',
  'Sergio', 'Patricia', 'Óscar', 'Verónica', 'Raúl', 'Natalia',
  'Emilio', 'Claudia', 'Iván', 'Rosa', 'Héctor', 'Mónica',
  'Alberto', 'Elena', 'Gustavo', 'Teresa', 'Mario', 'Beatriz',
];

const APELLIDOS_GENERADOS = [
  'Aguilar', 'Blanco', 'Castillo', 'Delgado', 'Escobar', 'Fuentes',
  'Guerra', 'Hernández', 'Ibarra', 'Jiménez', 'León', 'Mendoza',
  'Navarro', 'Ochoa', 'Paredes', 'Quintero', 'Ramos', 'Salazar',
  'Tovar', 'Urbina', 'Velásquez', 'Wallis', 'Yépez', 'Zambrano',
  'Aponte', 'Bermúdez', 'Contreras', 'Dávila', 'Espinoza', 'Figueroa',
];

const CALLES_GENERADAS = [
  'Av. Principal, Res. Los Jardines',
  'Calle 12, Quinta El Refugio',
  'Av. Bolívar, Torre Centro',
  'Calle Miranda, Casa 45',
  'Av. Las Américas, Res. Aurora',
  'Calle Sucre, Edif. San José',
  'Av. Libertad, Quinta Las Palmas',
  'Calle 8, Res. El Parque',
  'Av. Universidad, Torre Norte',
  'Calle Comercio, Casa 18',
];

const CIUDADES_GENERADAS = [
  'Caracas', 'Maracaibo', 'Valencia', 'Barquisimeto',
  'Maracay', 'Puerto La Cruz', 'San Cristóbal',
];

// Mezcla estable de planes (20 posiciones) para que la demo tenga variedad.
const PATRON_PLANES = [
  'Hogar 150', 'Hogar 150', 'Básico 60', 'Pro 300', 'Hogar 150',
  'Básico 60', 'Pro 300', 'Empresa 600', 'Hogar 150', 'Básico 60',
  'Pro 300', 'Hogar 150', 'Básico 60', 'Fibra 1 Gbps', 'Pro 300',
  'Hogar 150', 'Empresa 600', 'Básico 60', 'Pro 300', 'Hogar 150',
];

const CLIENTES = CLIENTES_BASE.slice();

const CIUDADES = {
  Caracas: { state: 'Distrito Capital', postalCode: '1010' },
  Maracaibo: { state: 'Zulia', postalCode: '4001' },
  Valencia: { state: 'Carabobo', postalCode: '2001' },
  Barquisimeto: { state: 'Lara', postalCode: '3001' },
  Maracay: { state: 'Aragua', postalCode: '2101' },
  'Puerto La Cruz': { state: 'Anzoátegui', postalCode: '6023' },
  'San Cristóbal': { state: 'Táchira', postalCode: '5001' },
};

const CONEXIONES = [
  { type: 'pppoe', user: 'laura.gomez', router: 0, pool: 'pppoeCaracas', ip: '10.10.0.11' },
  { type: 'pppoe', user: 'carlos.ramirez', router: 0, pool: 'pppoeCaracas', ip: '10.10.0.12' },
  { type: 'pppoe', user: 'mariana.torres', router: 1, pool: 'pppoeMaracaibo', ip: '10.20.0.21' },
  { type: 'static', router: 1, pool: 'estaticasOccidente', ip: '192.168.30.18' },
  { type: 'pppoe', user: 'sofia.martinez', router: 0, pool: 'pppoeCaracas', ip: '10.10.0.14' },
  { type: 'dhcp', router: 1, pool: 'estaticasOccidente', ip: '192.168.30.51' },
  { type: 'pppoe', user: 'valentina.rojas', router: 0, pool: 'pppoeCaracas', ip: '10.10.0.16' },
  { type: 'pppoe', user: 'diego.herrera', router: 0, pool: 'pppoeCaracas', ip: '10.10.0.17' },
  { type: 'pppoe', user: 'camila.vargas', router: 0, pool: 'pppoeCaracas', ip: '10.10.0.18' },
  { type: 'static', router: 0, pool: 'estaticasCaracas', ip: '192.168.10.18' },
  { type: 'pppoe', user: 'isabella.prieto', router: 0, pool: 'pppoeCaracas', ip: '10.10.0.20' },
  { type: 'pppoe', user: 'pedro.alvarado', router: 0, pool: 'pppoeCaracas', ip: '10.10.0.19' },
];

const PLAN_POR_CLIENTE = [
  'Hogar 150', 'Pro 300', 'Básico 60', 'Empresa 600', 'Hogar 150',
  'Pro 300', 'Fibra 1 Gbps', 'Hogar 150', 'Pro 300', 'Empresa 600', 'Básico 60', 'Pro 300',
];

/**
 * Clientes 13 a 150: se generan de forma determinista para que la demo tenga
 * 150 clientes sin repetir usuarios PPPoE, correos, identificaciones ni IP.
 */
function normalizarSlug(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

const CLIENTES_EN_MORA = new Set();
const usuariosPppoeUsados = new Set(CONEXIONES.filter((c) => c.user).map((c) => c.user));
const contadorIp = {
  pppoeCaracas: 10,
  estaticasCaracas: 100,
  pppoeMaracaibo: 100,
  estaticasOccidente: 100,
};

for (let n = 0; n < TOTAL_CLIENTES - CLIENTES_BASE.length; n += 1) {
  const indice = CLIENTES_BASE.length + n;
  const firstName = NOMBRES_GENERADOS[Math.floor(n / APELLIDOS_GENERADOS.length) % NOMBRES_GENERADOS.length];
  const lastName = APELLIDOS_GENERADOS[n % APELLIDOS_GENERADOS.length];
  const city = CIUDADES_GENERADAS[(n * 3 + 1) % CIUDADES_GENERADAS.length];
  const street = CALLES_GENERADAS[(n * 7 + 2) % CALLES_GENERADAS.length];
  const enMora = n % 19 === 4;
  const status = n % 29 === 12 ? 'retired' : enMora || n % 37 === 14 ? 'suspended' : 'active';
  const email = `${normalizarSlug(firstName)}.${normalizarSlug(lastName)}${indice + 1}@example.com`;
  const phone = `+58 4${String(10 + (n % 80)).padStart(2, '0')}-${String(100 + ((n * 7) % 900)).padStart(3, '0')}-${String(1000 + ((n * 13) % 9000))}`;

  CLIENTES.push([firstName, lastName, email, phone, street, city, status]);

  const caracas = n % 2 === 0;
  const grupo = Math.floor(n / 2);
  let tipo;
  let router;
  let poolClave;

  if (caracas) {
    router = 0;
    if (grupo % 9 === 4) {
      tipo = 'static';
      poolClave = 'estaticasCaracas';
    } else {
      tipo = 'pppoe';
      poolClave = 'pppoeCaracas';
    }
  } else {
    router = 1;
    if (grupo % 9 === 3) {
      tipo = 'dhcp';
      poolClave = 'pppoeMaracaibo';
    } else if (grupo % 9 === 6) {
      tipo = 'static';
      poolClave = 'estaticasOccidente';
    } else {
      tipo = 'pppoe';
      poolClave = 'pppoeMaracaibo';
    }
  }

  const ip = poolClave === 'pppoeCaracas'
    ? `10.10.1.${contadorIp.pppoeCaracas++}`
    : poolClave === 'estaticasCaracas'
      ? `192.168.10.${contadorIp.estaticasCaracas++}`
      : poolClave === 'pppoeMaracaibo'
        ? `10.20.0.${contadorIp.pppoeMaracaibo++}`
        : `192.168.30.${contadorIp.estaticasOccidente++}`;

  let user = '';
  if (tipo === 'pppoe') {
    const base = `${normalizarSlug(firstName)}.${normalizarSlug(lastName)}`;
    user = base;
    let sufijo = 2;
    while (usuariosPppoeUsados.has(user)) {
      user = `${base}${sufijo}`;
      sufijo += 1;
    }
    usuariosPppoeUsados.add(user);
  }

  CONEXIONES.push({ type: tipo, user, router, pool: poolClave, ip });
  PLAN_POR_CLIENTE.push(PATRON_PLANES[n % PATRON_PLANES.length]);

  if (enMora) {
    CLIENTES_EN_MORA.add(`CL-${String(indice + 1).padStart(4, '0')}`);
  }
}

const INVENTARIO = [
  {
    code: 'ART-0001',
    name: 'Router MikroTik hEX S',
    category: 'router',
    tracking: 'serial',
    unit: 'unidad',
    quantity: 0,
    minStock: 2,
    cost: 70,
    price: 95,
    location: 'Almacén Caracas · Estante A1',
    supplier: 'MikroTik Distribuidor VE',
    serials: [
      { serial: 'HEXS-A1B2C3', mac: '48:8F:5A:11:22:33', status: 'installed' },
      { serial: 'HEXS-D4E5F6', mac: '48:8F:5A:44:55:66', status: 'sold' },
      { serial: 'HEXS-G7H8I9', mac: '48:8F:5A:77:88:99', status: 'available' },
      { serial: 'HEXS-J1K2L3', mac: '48:8F:5A:AA:BB:CC', status: 'available' },
    ],
    notes: 'Equipo de instalación estándar para clientes nuevos.',
  },
  {
    code: 'ART-0002',
    name: 'ONU Huawei HG8010',
    category: 'onu',
    tracking: 'serial',
    unit: 'unidad',
    quantity: 0,
    minStock: 2,
    cost: 30,
    price: 45,
    location: 'Almacén Caracas · Estante A2',
    supplier: 'Huawei Fiber Solutions',
    serials: [
      { serial: 'ONU-9F8E7D', mac: 'A0:B1:C2:D3:E4:F5', status: 'available' },
      { serial: 'ONU-6C5B4A', mac: 'A0:B1:C2:11:22:33', status: 'available' },
      { serial: 'ONU-3A2B1C', mac: 'A0:B1:C2:44:55:66', status: 'available' },
    ],
    notes: 'Reservada para ventas en espera de fibra.',
  },
  {
    code: 'ART-0003',
    name: 'Antena Ubiquiti LiteBeam 5AC',
    category: 'antenna',
    tracking: 'serial',
    unit: 'unidad',
    quantity: 0,
    minStock: 1,
    cost: 55,
    price: 75,
    location: 'Almacén Maracaibo · Estante B1',
    supplier: 'Ubiquiti Networks',
    serials: [
      { serial: 'LBE-5G-001', mac: 'F4:E5:D6:C7:B8:A9', status: 'available' },
      { serial: 'LBE-5G-002', mac: 'F4:E5:D6:12:34:56', status: 'available' },
    ],
    notes: '',
  },
  {
    code: 'ART-0004',
    name: 'Switch TP-Link SG108 8 puertos',
    category: 'switch',
    tracking: 'serial',
    unit: 'unidad',
    quantity: 0,
    minStock: 1,
    cost: 40,
    price: 60,
    location: 'Almacén Caracas · Estante A3',
    supplier: 'TP-Link Venezuela',
    serials: [
      { serial: 'TPL-SG108-01', mac: '3C:46:D8:00:11:22', status: 'available' },
    ],
    notes: '',
  },
  {
    code: 'ART-0005',
    name: 'Cable UTP Cat6',
    category: 'cable',
    tracking: 'bulk',
    unit: 'metro',
    quantity: 480,
    minStock: 100,
    cost: 0.45,
    price: 0.8,
    location: 'Almacén Caracas · Rollo C1',
    supplier: 'Cables del Sur',
    serials: [],
    notes: 'Se vende por metro lineales.',
  },
  {
    code: 'ART-0006',
    name: 'Conector RJ45 Cat6',
    category: 'connector',
    tracking: 'bulk',
    unit: 'unidad',
    quantity: 296,
    minStock: 80,
    cost: 0.7,
    price: 1.5,
    location: 'Almacén Caracas · Cajón D2',
    supplier: 'Cables del Sur',
    serials: [],
    notes: '',
  },
  {
    code: 'ART-0007',
    name: 'Roseta óptica SC/APC',
    category: 'other',
    tracking: 'bulk',
    unit: 'unidad',
    quantity: 6,
    minStock: 10,
    cost: 2.1,
    price: 4,
    location: 'Almacén Caracas · Cajón D4',
    supplier: 'Fiber Home VE',
    serials: [],
    notes: 'Stock por debajo del mínimo configurado.',
  },
  {
    code: 'ART-0008',
    name: 'Patch cord fibra SC/APC 3 m',
    category: 'cable',
    tracking: 'bulk',
    unit: 'unidad',
    quantity: 40,
    minStock: 12,
    cost: 1.3,
    price: 2.5,
    location: 'Almacén Caracas · Cajón D5',
    supplier: 'Fiber Home VE',
    serials: [],
    notes: '',
  },
];

function numeroFactura(consecutivo) {
  return `${PREFIJO}-${String(consecutivo).padStart(6, '0')}`;
}

function snapshotPlan(plan) {
  return {
    name: plan.name,
    downloadSpeed: plan.downloadSpeed,
    uploadSpeed: plan.uploadSpeed,
    price: plan.price,
    taxRate: plan.taxRate ?? null,
    billingInterval: plan.billingInterval,
    capturedAt: new Date(),
  };
}

function construirFactura({ consecutivo, cliente, subscription, plan, periodStart, periodEnd, status, issueDate, dueDate, paidAt, voidedAt, voidReason }) {
  const subtotal = redondear(plan.price);
  const taxRate = plan.taxRate === null || plan.taxRate === undefined ? TAX_RATE : Number(plan.taxRate);
  const tax = redondear(subtotal * taxRate);
  const total = redondear(subtotal + tax);
  return {
    invoiceNumber: numeroFactura(consecutivo),
    clientId: cliente._id,
    subscriptionId: subscription._id,
    type: 'service',
    affectsService: true,
    periodStart,
    periodEnd,
    issueDate,
    dueDate,
    planSnapshot: snapshotPlan(plan),
    lines: [
      {
        description: `Servicio ${plan.name} · ${periodStart.toISOString().slice(0, 10)} al ${periodEnd.toISOString().slice(0, 10)}`,
        quantity: 1,
        unitPrice: subtotal,
        amount: subtotal,
      },
    ],
    subtotal,
    discountType: 'none',
    discount: 0,
    discountAmount: 0,
    taxBase: subtotal,
    taxRate,
    tax,
    total,
    currency: MONEDA,
    status,
    paidAt,
    paymentMethod: paidAt ? 'cash' : null,
    paymentCurrency: paidAt ? 'USD' : undefined,
    paymentAmount: paidAt ? total : undefined,
    exchangeRate: paidAt ? 40 : undefined,
    paymentRateSource: paidAt ? 'demo' : '',
    paymentRateDate: paidAt || undefined,
    paymentReference: paidAt ? `TRF-${consecutivo}` : '',
    voidedAt,
    voidReason: voidReason || '',
    notes: '',
  };
}

function calcularVenta(items, installationCost, taxRatePercent) {
  const lines = items.map((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = redondear(Number(item.unitPrice) || 0);
    return {
      itemId: item.itemId,
      name: item.name,
      tracking: item.tracking || 'bulk',
      unit: item.unit || 'unidad',
      quantity,
      unitPrice,
      amount: redondear(quantity * unitPrice),
      serials: item.serials || [],
    };
  });
  const materialsTotal = redondear(lines.reduce((suma, linea) => suma + linea.amount, 0));
  const instalacion = redondear(Number(installationCost) || 0);
  const subtotal = redondear(materialsTotal + instalacion);
  const tasa = Number(taxRatePercent) || 0;
  const tax = redondear(subtotal * (tasa / 100));
  return {
    lines,
    materialsTotal,
    installationCost: instalacion,
    subtotal,
    taxRatePercent: tasa,
    tax,
    total: redondear(subtotal + tax),
  };
}

function construirFacturaManual({ consecutivo, cliente, subscription, saleId, type, lines, taxRatePercent, status, issueDate, dueDate, paidAt, notes }) {
  const normalizadas = lines.map((linea) => ({
    description: linea.description,
    quantity: linea.quantity,
    unitPrice: redondear(linea.unitPrice),
    amount: redondear(linea.quantity * linea.unitPrice),
    inventoryItemId: linea.inventoryItemId || null,
    serials: linea.serials || [],
  }));
  const subtotal = redondear(normalizadas.reduce((suma, linea) => suma + linea.amount, 0));
  const tasa = Number(taxRatePercent) || 0;
  const tax = redondear(subtotal * (tasa / 100));
  return {
    invoiceNumber: numeroFactura(consecutivo),
    clientId: cliente._id,
    subscriptionId: subscription ? subscription._id : null,
    saleId: saleId || null,
    type,
    affectsService: false,
    periodStart: null,
    periodEnd: null,
    issueDate,
    dueDate,
    lines: normalizadas,
    subtotal,
    discountType: 'none',
    discount: 0,
    discountAmount: 0,
    taxBase: subtotal,
    taxRate: redondear(tasa) / 100,
    tax,
    total: redondear(subtotal + tax),
    currency: MONEDA,
    status,
    paidAt,
    paymentMethod: paidAt ? 'cash' : null,
    paymentCurrency: paidAt ? 'USD' : undefined,
    paymentAmount: paidAt ? redondear(subtotal + tax) : undefined,
    exchangeRate: paidAt ? 40 : undefined,
    paymentRateSource: paidAt ? 'demo' : '',
    paymentRateDate: paidAt || undefined,
    paymentReference: paidAt ? `TRF-${consecutivo}` : '',
    notes: notes || '',
  };
}

async function limpiarBase() {
  // Se elimina la base completa para que también se reconstruyan los índices
  // (la factura cambió su índice único por periodo a un índice parcial).
  await mongoose.connection.dropDatabase();
  console.log('🧹 Base de datos vaciada (--reset).');
}

async function ejecutar() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/crackentick';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  const reset = process.argv.includes('--reset');
  const laptop = process.argv.includes('--laptop');
  const existentes = await Client.countDocuments();

  if (reset) {
    await limpiarBase();
  } else if (existentes > 0) {
    console.log(`ℹ️  Ya existen ${existentes} clientes. Usa "npm run seed -- --reset" para reiniciar.`);
    await mongoose.disconnect();
    return;
  }

  await Promise.all([
    Settings.init(),
    Client.init(),
    Plan.init(),
    Router.init(),
    IpPool.init(),
    InventoryItem.init(),
    Subscription.init(),
    Invoice.init(),
    Ticket.init(),
    Sale.init(),
    Zone.init(),
    FaultReport.init(),
    InstallationReport.init(),
    Alert.init(),
    AuditLog.init(),
    User.init(),
    Employee.init(),
    FinanceEntry.init(),
    Vlan.init(),
    FirewallRule.init(),
    EoipTunnel.init(),
    BalanceConfig.init(),
    RouterBackup.init(),
    TaskType.init(),
  ]);

  await taskTypeService.asegurarTipos();

  const settings = await Settings.getSingleton();
  settings.company = {
    name: 'CRACKENTICK Telecom, C.A.',
    taxId: 'J-40555222-1',
    address: 'Av. Francisco de Miranda, Torre Delta, piso 4, Caracas',
    phone: '+58 212-555-0110',
    email: 'hola@crackentick.example',
  };
  settings.billing.currency = MONEDA;
  settings.billing.locale = LOCALE;
  settings.billing.timezone = ZONA;
  settings.billing.taxRate = TAX_RATE;
  settings.billing.invoicePrefix = PREFIJO;
  settings.billing.dueDays = 5;
  settings.billing.graceDays = 3;
  settings.billing.previewDays = 5;
  settings.billing.bcvRate = 40;
  settings.billing.bcvUpdatedAt = new Date();
  settings.billing.bcvSource = 'demo';
  settings.billing.nextInvoiceNumber = 1;
  settings.firewall.mode = 'real';
            await settings.save();

  const planes = await Plan.insertMany(PLANES);
  const planPorNombre = new Map(planes.map((plan) => [plan.name, plan]));

  const ahora = new Date();

  /* ------------------------------------------------------------------
     Usuarios y permisos por nodo
     ------------------------------------------------------------------ */
  const usuarios = await User.insertMany([
    {
      name: ADMIN_PRINCIPAL.name,
      username: ADMIN_PRINCIPAL.username,
      email: ADMIN_PRINCIPAL.email,
      passwordHash: hashPassword('admin123'),
      role: 'admin',
      permissions: [],
      active: true,
      lastLoginAt: sumarDias(ahora, -1),
    },
    {
      name: 'Luis Pérez',
      username: 'tecnico',
      email: 'luis.perez@crackentick.example',
      passwordHash: hashPassword('tecnico123'),
      role: 'staff',
      permissions: [
        'general.dashboard',
        'general.clientes',
        'clientes.datos',
        'clientes.servicio',
        'clientes.cortes',
        'red.routers',
        'red.monitoreo',
        'ventas.ventas',
        'soporte.tickets',
        'agenda.gestion',
        'ventas.instalar',
      ],
      active: true,
      lastLoginAt: sumarDias(ahora, -2),
    },
    {
      name: 'María Torres',
      username: 'ventas',
      email: 'maria.torres@crackentick.example',
      passwordHash: hashPassword('ventas123'),
      role: 'staff',
      permissions: [
        'general.dashboard',
        'general.clientes',
        'clientes.datos',
        'clientes.facturacion',
        'ventas.ventas',
        'ventas.inventario',
        'finanzas.facturas',
      ],
      active: true,
      lastLoginAt: sumarDias(ahora, -3),
    },
    {
      name: 'Carlos Méndez',
      username: 'finanzas',
      email: 'carlos.mendez@crackentick.example',
      passwordHash: hashPassword('finanzas123'),
      role: 'staff',
      permissions: [
        'general.dashboard',
        'clientes.facturacion',
        'finanzas.facturacion',
        'finanzas.facturas',
        'finanzas.gestion',
        'admin.gastos',
      ],
      active: true,
      lastLoginAt: sumarDias(ahora, -4),
    },
    {
      name: 'Soporte N1',
      username: 'soporte',
      email: 'soporte@crackentick.example',
      passwordHash: hashPassword('soporte123'),
      role: 'staff',
      permissions: ['general.dashboard', 'general.clientes', 'clientes.datos', 'red.monitoreo', 'soporte.tickets', 'soporte.asistente', 'agenda.gestion'],
      active: true,
      lastLoginAt: sumarDias(ahora, -1),
    },
  ]);
  const empleados = await Employee.insertMany([
    {
      name: 'Juan Echenique',
      position: 'Gerente de operaciones',
      area: 'administracion',
      salary: 70,
      currency: 'USD',
      paymentMethod: 'transfer',
      active: true,
      startDate: sumarDias(ahora, -240),
      email: 'juan.echenique@crackentick.example',
      phone: '+58 412-100-1000',
    },
    {
      name: 'Valentina Rojas',
      position: 'Asistente administrativa',
      area: 'administracion',
      salary: 45,
      currency: 'USD',
      paymentMethod: 'transfer',
      active: true,
      startDate: sumarDias(ahora, -210),
      email: 'valentina.rojas@crackentick.example',
      phone: '+58 412-111-2233',
    },
    {
      name: 'Carlos Méndez',
      position: 'Agente de cobranzas',
      area: 'cobranzas',
      salary: 50,
      currency: 'USD',
      paymentMethod: 'transfer',
      active: true,
      startDate: sumarDias(ahora, -180),
      email: 'carlos.mendez@crackentick.example',
      phone: '+58 412-222-3344',
    },
    {
      name: 'Soporte N1',
      position: 'Agente de soporte N1',
      area: 'soporte',
      salary: 50,
      currency: 'USD',
      paymentMethod: 'transfer',
      active: true,
      startDate: sumarDias(ahora, -160),
      email: 'soporte@crackentick.example',
      phone: '+58 412-333-4455',
    },
    {
      name: 'Luis Pérez',
      position: 'Técnico instalador',
      area: 'tecnicos',
      salary: 50,
      currency: 'USD',
      paymentMethod: 'transfer',
      active: true,
      startDate: sumarDias(ahora, -150),
      email: 'luis.perez@crackentick.example',
      phone: '+58 412-444-5566',
    },
    {
      name: 'María Torres',
      position: 'Ejecutiva de ventas',
      area: 'ventas',
      salary: 50,
      currency: 'USD',
      paymentMethod: 'transfer',
      active: true,
      startDate: sumarDias(ahora, -120),
      email: 'maria.torres@crackentick.example',
      phone: '+58 412-555-6677',
    },
  ]);

  const usuarioPorClave = new Map([
    ['admin', usuarios[0]],
    ['tecnico', usuarios[1]],
    ['ventas', usuarios[2]],
    ['finanzas', usuarios[3]],
    ['soporte', usuarios[4]],
  ]);

  /* Vínculo estable trabajador -> usuario para medir rendimiento. */
  const usuarioPorNombre = new Map(usuarios.map((usuario) => [usuario.name.toLowerCase(), usuario._id]));
  for (const empleado of empleados) {
    const usuarioId = usuarioPorNombre.get(empleado.name.toLowerCase());
    if (usuarioId) await Employee.updateOne({ _id: empleado._id }, { $set: { userId: usuarioId } });
  }

  /* ------------------------------------------------------------------
     Gastos e ingresos manuales de la empresa
     ------------------------------------------------------------------ */
  const fechaEnMes = (mesesAtras, dia) => {
    const base = sumarMeses(ahora, -mesesAtras);
    return new Date(base.getFullYear(), base.getMonth(), dia, 12, 0, 0);
  };

  const movimientosFinancieros = await FinanceEntry.insertMany([
    { type: 'expense', category: 'renta', concept: 'Alquiler mensual de oficina', amount: 400, date: fechaEnMes(0, 1), vendor: 'Inversiones Delta', status: 'paid', recurring: true, reference: 'RENTA-2026', createdBy: 'admin' },
    { type: 'expense', category: 'renta', concept: 'Alquiler mensual de oficina', amount: 400, date: fechaEnMes(1, 1), vendor: 'Inversiones Delta', status: 'paid', recurring: true, reference: 'RENTA-2026', createdBy: 'admin' },
  ].map((movimiento) => ({
    ...movimiento,
    currency: 'USD',
    paymentMethod: 'transfer',
    amountUsd: movimiento.amount,
  })));

  /* ------------------------------------------------------------------
     Routers y pools CIDR
     ------------------------------------------------------------------ */
  /* En la laptop, el CHR incluido en el paquete es el unico router. */
  const routers = [];
  let routerLaptop = null;
  if (laptop) {
    routerLaptop = await Router.create({
      name: 'CHR QEMU (prueba)',
      description: 'RouterOS 7.20.2 virtual incluido en el paquete de la laptop.',
      vendor: 'mikrotik',
      model: 'CHR 7.20.2',
      mode: 'real',
      host: '127.0.0.1',
      port: 8728,
      sshPort: 2222,
      username: 'crackentick-api',
      passwordEnc: cifrar(process.env.CHR_API_PASSWORD || ''),
      transport: 'api',
      active: true,
      wanInterfaces: [{ name: 'ether1', provider: 'QEMU NAT', downloadMbps: 100, uploadMbps: 100 }],
      notes: 'API 127.0.0.1:8728 / WinBox 127.0.0.1:8291 / SSH 127.0.0.1:2222',
    });
    routers.push(routerLaptop);
  }

  const pools = await IpPool.insertMany([
    {
      name: 'PPPoE Caracas',
      cidr: '10.10.0.0/22',
      routerId: routerLaptop ? routerLaptop._id : null,
      purpose: 'pppoe',
      autoProvision: true,
      appliedAt: sumarDias(ahora, -10),
      lastApplyResult: 'Pool registrado; pendiente de aplicar al router.',
      active: true,
      notes: 'Bloque para clientes PPPoE del nodo Caracas.',
    },
    {
      name: 'Estáticas Caracas',
      cidr: '192.168.10.0/24',
      routerId: routerLaptop ? routerLaptop._id : null,
      purpose: 'static',
      autoProvision: true,
      appliedAt: sumarDias(ahora, -10),
      lastApplyResult: 'Pool registrado; pendiente de aplicar al router.',
      active: true,
      notes: '',
    },
    {
      name: 'PPPoE Maracaibo',
      cidr: '10.20.0.0/24',
      routerId: routerLaptop ? routerLaptop._id : null,
      purpose: 'mixed',
      autoProvision: true,
      appliedAt: sumarDias(ahora, -8),
      lastApplyResult: 'Pool registrado; pendiente de aplicar al router.',
      active: true,
      notes: 'Incluye clientes PPPoE y DHCP.',
    },
    {
      name: 'Estáticas Occidente',
      cidr: '192.168.30.0/24',
      routerId: routerLaptop ? routerLaptop._id : null,
      purpose: 'static',
      autoProvision: false,
      active: true,
      notes: '',
    },
  ]);

  const poolPorClave = new Map([
    ['pppoeCaracas', pools[0]],
    ['estaticasCaracas', pools[1]],
    ['pppoeMaracaibo', pools[2]],
    ['estaticasOccidente', pools[3]],
  ]);

  /* ------------------------------------------------------------------
     Clientes
     ------------------------------------------------------------------ */
  const clientes = [];
  for (let i = 0; i < CLIENTES.length; i += 1) {
    const [firstName, lastName, email, phone, street, city, status] = CLIENTES[i];
    const ubicacion = CIUDADES[city] || { state: '', postalCode: '' };
    const taxId = `V-${String(10000000 + i * 137).padStart(8, '0')}-${(i % 9) + 1}`;
    clientes.push({
      clientCode: `CL-${String(i + 1).padStart(4, '0')}`,
      firstName,
      lastName,
      taxId,
      email,
      phone,
      address: { street, city, state: ubicacion.state, postalCode: ubicacion.postalCode },
      billingData: {
        legalName: `${firstName} ${lastName}`,
        taxId,
        email,
        address: `${street}, ${city}, ${ubicacion.state}`,
      },
      status,
      notes: i === 2 ? 'Cliente en mora, servicio suspendido.'
        : i === 3 ? 'Pendiente reintentar restauración.'
          : i === 10 ? 'Cliente nuevo, aún sin servicio contratado.'
            : i === 11 ? 'Alta generada desde la venta VEN-0001.'
              : status === 'retired' ? 'Cliente retirado; conserva su historial.'
                : status === 'suspended' ? 'Cliente en mora, servicio suspendido.' : '',
    });
  }
  const clientesCreados = await Client.insertMany(clientes);
  const clientePedro = clientesCreados[11];
  const clienteSofia = clientesCreados[4];

  /* ------------------------------------------------------------------
     Inventario
     ------------------------------------------------------------------ */
  const inventario = INVENTARIO.map((item) => ({
    ...item,
    serials: (item.serials || []).map((serial) => {
      if (serial.status === 'installed' && item.code === 'ART-0001') {
        return {
          ...serial,
          clientId: clientePedro._id,
          installedAt: sumarDias(ahora, -2),
        };
      }
      if (serial.status === 'sold' && item.code === 'ART-0001') {
        return {
          ...serial,
          clientId: clienteSofia._id,
          installedAt: sumarDias(ahora, -14),
        };
      }
      return serial;
    }),
  }));

  inventario[4].movements = [
    { type: 'entrada', quantity: 500, reason: 'Compra inicial de cable', actor: 'admin', date: sumarDias(ahora, -20) },
    { type: 'instalacion', quantity: -20, reason: 'Instalación de la venta VEN-0001', actor: 'admin', date: sumarDias(ahora, -2) },
  ];
  inventario[5].movements = [
    { type: 'entrada', quantity: 300, reason: 'Compra inicial de conectores', actor: 'admin', date: sumarDias(ahora, -20) },
    { type: 'instalacion', quantity: -4, reason: 'Instalación de la venta VEN-0001', actor: 'admin', date: sumarDias(ahora, -2) },
  ];
  inventario[6].movements = [
    { type: 'entrada', quantity: 6, reason: 'Compra de reposición pendiente', actor: 'admin', date: sumarDias(ahora, -6) },
  ];
  inventario[0].movements = [
    { type: 'entrada', quantity: 4, reason: 'Compra inicial de routers', actor: 'admin', date: sumarDias(ahora, -25) },
    { type: 'instalacion', quantity: -1, reason: 'Instalación de la venta VEN-0001', actor: 'admin', date: sumarDias(ahora, -2) },
    { type: 'venta', quantity: -1, reason: 'Venta directa a CL-0005', actor: 'admin', date: sumarDias(ahora, -14) },
  ];

  const inventarioCreado = await InventoryItem.insertMany(inventario);
  const articuloPorCodigo = new Map(inventarioCreado.map((item) => [item.code, item]));
  const routerItem = articuloPorCodigo.get('ART-0001');
  const onuItem = articuloPorCodigo.get('ART-0002');
  const antenaItem = articuloPorCodigo.get('ART-0003');
  const cableItem = articuloPorCodigo.get('ART-0005');
  const conectorItem = articuloPorCodigo.get('ART-0006');
  const rosetaItem = articuloPorCodigo.get('ART-0007');

  /* ------------------------------------------------------------------
     Servicios (todos los clientes menos CL-0011, que queda sin servicio)
     ------------------------------------------------------------------ */
  const suscripciones = [];
  const subPorCliente = new Map();

  for (let i = 0; i < clientesCreados.length; i += 1) {
    if (i === 10) continue; // Isabella Prieto: cliente sin servicio para el estado vacío.
    const cliente = clientesCreados[i];
    if (cliente.status === 'retired') continue; // Retirado: conserva historial sin servicio activo.
    const plan = planPorNombre.get(PLAN_POR_CLIENTE[i]);
    const conexion = CONEXIONES[i];
    const pool = poolPorClave.get(conexion.pool);
    const pronto = i === 4 || i === 5;
    const inicio = pronto ? sumarDias(ahora, -28) : inicioDelMes(ahora);
    const fin = sumarIntervalo(inicio, plan.billingInterval);

    const config = {
      connectionType: conexion.type,
      ipAddress: conexion.ip || '',
      pppoeUsername: conexion.user || '',
      pppoePasswordEnc: conexion.user ? cifrar(`clave-${conexion.user}-2026`) : '',
      routerId: routerLaptop ? routerLaptop._id : null,
      ipPoolId: pool._id,
      queueName: 'ct-' + (conexion.user || cliente.clientCode.toLowerCase()),
      provisioningState: 'none',
    };

    const estadoFirewall = cliente.status === 'suspended' ? 'blocked' : i === 3 ? 'error' : 'none';

    const sub = await Subscription.create({
      clientId: cliente._id,
      planId: plan._id,
      planSnapshot: snapshotPlan(plan),
      serviceConfig: config,
      status: cliente.status === 'suspended' ? 'suspended' : 'active',
      currentPeriodStart: inicio,
      currentPeriodEnd: fin,
      installedAt: sumarMeses(ahora, -(3 + (i % 30))),
      firewallState: estadoFirewall,
      firewallBlockedAt: estadoFirewall === 'blocked' ? sumarDias(ahora, -2) : undefined,
      lastStatusChangeAt: ahora,
      notes: '',
    });
    const entrada = { sub, cliente, plan };
    suscripciones.push(entrada);
    subPorCliente.set(i, entrada);
  }

  /* ------------------------------------------------------------------
     Facturas de servicio
     ------------------------------------------------------------------ */
  let consecutivo = 1;
  const facturas = [];
  const logs = [];

  for (const { sub, cliente, plan } of suscripciones) {
    // Dos facturas anteriores pagadas.
    for (let atras = 2; atras >= 1; atras -= 1) {
      const inicio = sumarMeses(sub.currentPeriodStart, -atras);
      const fin = sumarMeses(inicio, 1);
      const emision = sumarDias(inicio, 1);
      const pago = sumarDias(inicio, 2);
      facturas.push(
        construirFactura({
          consecutivo: consecutivo++,
          cliente,
          subscription: sub,
          plan,
          periodStart: inicio,
          periodEnd: fin,
          status: 'paid',
          issueDate: emision,
          dueDate: sumarDias(emision, 5),
          paidAt: pago,
        })
      );
    }

    const emision = sub.currentPeriodStart;
    let status = 'open';
    let dueDate = sumarDias(emision, 5);
    let paidAt = null;
    let voidedAt = null;
    let voidReason = '';

    if (cliente.status === 'suspended') {
      status = 'overdue';
      dueDate = sumarDias(ahora, -7);
    } else if (['CL-0005', 'CL-0007'].includes(cliente.clientCode) || CLIENTES_EN_MORA.has(cliente.clientCode)) {
      status = 'overdue';
      dueDate = sumarDias(ahora, -4);
    } else if (cliente.clientCode === 'CL-0009') {
      status = 'void';
      voidedAt = sumarDias(ahora, -3);
      voidReason = 'Factura emitida por error de periodo.';
    }

    facturas.push(
      construirFactura({
        consecutivo: consecutivo++,
        cliente,
        subscription: sub,
        plan,
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
        status,
        issueDate: emision,
        dueDate,
        paidAt,
        voidedAt,
        voidReason,
      })
    );
  }

  // Una factura pagada adicional para el mes actual, con fecha reciente.
  const extra = suscripciones[0];
  facturas.push(
    construirFactura({
      consecutivo: consecutivo++,
      cliente: extra.cliente,
      subscription: extra.sub,
      plan: extra.plan,
      periodStart: sumarMeses(extra.sub.currentPeriodStart, 1),
      periodEnd: sumarMeses(extra.sub.currentPeriodStart, 2),
      status: 'paid',
      issueDate: sumarDias(ahora, -4),
      dueDate: sumarDias(ahora, 1),
      paidAt: sumarDias(ahora, -3),
    })
  );

  const facturasCreadas = await Invoice.insertMany(facturas);

  /* ------------------------------------------------------------------
     Venta instalada (crea cliente + servicio + factura de instalación)
     ------------------------------------------------------------------ */
  const ventaInstaladaTotales = calcularVenta(
    [
      { itemId: routerItem._id, name: routerItem.name, tracking: 'serial', unit: routerItem.unit, quantity: 1, unitPrice: routerItem.price, serials: ['HEXS-A1B2C3'] },
      { itemId: cableItem._id, name: `${cableItem.name} (20 m)`, tracking: 'bulk', unit: cableItem.unit, quantity: 20, unitPrice: cableItem.price },
      { itemId: conectorItem._id, name: `${conectorItem.name} (4 unidades)`, tracking: 'bulk', unit: conectorItem.unit, quantity: 4, unitPrice: conectorItem.price },
    ],
    30,
    16
  );

  const pedro = subPorCliente.get(11);

  const facturaInstalacion = construirFacturaManual({
    consecutivo: consecutivo++,
    cliente: clientePedro,
    subscription: pedro.sub,
    type: 'installation',
    lines: [
      { description: 'Instalación del servicio Pro 300', quantity: 1, unitPrice: 30 },
      { description: `Router MikroTik hEX S (HEXS-A1B2C3)`, quantity: 1, unitPrice: routerItem.price, inventoryItemId: routerItem._id, serials: ['HEXS-A1B2C3'] },
      { description: `${cableItem.name} (20 m)`, quantity: 20, unitPrice: cableItem.price, inventoryItemId: cableItem._id },
      { description: `${conectorItem.name} (4 unidades)`, quantity: 4, unitPrice: conectorItem.price, inventoryItemId: conectorItem._id },
    ],
    taxRatePercent: 16,
    status: 'open',
    issueDate: sumarDias(ahora, -2),
    dueDate: sumarDias(ahora, 5),
    notes: `Instalación generada por la venta VEN-0001. Esta factura no participa en el corte del servicio.`,
  });

  const ventaInstalada = await Sale.create({
    code: 'VEN-0001',
    status: 'installed',
    technicianId: usuarioPorClave.get('tecnico')._id,
    promoterId: usuarioPorClave.get('ventas')._id,
    clientId: clientePedro._id,
    customer: {
      firstName: clientePedro.firstName,
      lastName: clientePedro.lastName,
      taxId: clientePedro.taxId,
      email: clientePedro.email,
      phone: clientePedro.phone,
      address: clientePedro.address.street,
      city: clientePedro.address.city,
      state: clientePedro.address.state,
    },
    service: {
      planId: pedro.plan._id,
      routerId: pedro.sub.serviceConfig.routerId,
      connectionType: pedro.sub.serviceConfig.connectionType,
      ipPoolId: pedro.sub.serviceConfig.ipPoolId,
      ipAddress: pedro.sub.serviceConfig.ipAddress,
      pppoeUsername: pedro.sub.serviceConfig.pppoeUsername,
    },
    items: ventaInstaladaTotales.lines,
    materialsTotal: ventaInstaladaTotales.materialsTotal,
    installationCost: ventaInstaladaTotales.installationCost,
    subtotal: ventaInstaladaTotales.subtotal,
    taxRatePercent: ventaInstaladaTotales.taxRatePercent,
    tax: ventaInstaladaTotales.tax,
    total: ventaInstaladaTotales.total,
    scheduledAt: sumarDias(ahora, -3),
    installedAt: sumarDias(ahora, -2),
    notes: 'Venta de instalación completa con equipo y materiales.',
  });

  facturaInstalacion.saleId = ventaInstalada._id;
  const facturaInstalacionCreada = await Invoice.create(facturaInstalacion);

  ventaInstalada.subscriptionId = pedro.sub._id;
  ventaInstalada.invoiceId = facturaInstalacionCreada._id;
  await ventaInstalada.save();

  pedro.sub.serviceConfig.provisioningState = 'none';
  await pedro.sub.save();

  /* ------------------------------------------------------------------
     Factura de venta directa (no corta el servicio)
     ------------------------------------------------------------------ */
  const facturaVenta = construirFacturaManual({
    consecutivo: consecutivo++,
    cliente: clienteSofia,
    subscription: subPorCliente.get(4).sub,
    type: 'sale',
    lines: [
      { description: 'Router MikroTik hEX S (HEXS-D4E5F6)', quantity: 1, unitPrice: routerItem.price, inventoryItemId: routerItem._id, serials: ['HEXS-D4E5F6'] },
    ],
    taxRatePercent: 16,
    status: 'paid',
    issueDate: sumarDias(ahora, -14),
    dueDate: sumarDias(ahora, -9),
    paidAt: sumarDias(ahora, -13),
    notes: 'Venta de equipo adicional. No genera corte del servicio.',
  });
  const facturaVentaCreada = await Invoice.create(facturaVenta);

  /* ------------------------------------------------------------------
     Ventas en espera y cancelada
     ------------------------------------------------------------------ */
  const ventaEsperaTotales = calcularVenta(
    [
      { itemId: onuItem._id, name: onuItem.name, tracking: 'serial', unit: onuItem.unit, quantity: 1, unitPrice: onuItem.price, serials: ['ONU-6C5B4A'] },
      { itemId: cableItem._id, name: `${cableItem.name} (25 m)`, tracking: 'bulk', unit: cableItem.unit, quantity: 25, unitPrice: cableItem.price },
    ],
    30,
    16
  );

  const ventaEspera = await Sale.create({
    code: 'VEN-0002',
    status: 'waiting',
    technicianId: usuarioPorClave.get('tecnico')._id,
    promoterId: usuarioPorClave.get('ventas')._id,
    customer: {
      firstName: 'Gabriela',
      lastName: 'Núñez',
      taxId: 'V-18765432-4',
      email: 'gabriela.nunez@example.com',
      phone: '+58 424-555-7788',
      address: 'Av. Bella Vista, Res. Las Palmas',
      city: 'Maracaibo',
      state: 'Zulia',
    },
    service: {
      planId: planPorNombre.get('Hogar 150')._id,
      routerId: routerLaptop ? routerLaptop._id : null,
      connectionType: 'pppoe',
      ipPoolId: poolPorClave.get('pppoeMaracaibo')._id,
    },
    items: ventaEsperaTotales.lines,
    materialsTotal: ventaEsperaTotales.materialsTotal,
    installationCost: ventaEsperaTotales.installationCost,
    subtotal: ventaEsperaTotales.subtotal,
    taxRatePercent: ventaEsperaTotales.taxRatePercent,
    tax: ventaEsperaTotales.tax,
    total: ventaEsperaTotales.total,
    scheduledAt: sumarDias(ahora, 2),
    notes: 'Instalación agendada para el turno de la tarde.',
  });

  const ventaCanceladaTotales = calcularVenta(
    [
      { itemId: antenaItem._id, name: antenaItem.name, tracking: 'serial', unit: antenaItem.unit, quantity: 1, unitPrice: antenaItem.price, serials: ['LBE-5G-001'] },
    ],
    25,
    16
  );

  const ventaCancelada = await Sale.create({
    code: 'VEN-0003',
    status: 'cancelled',
    technicianId: usuarioPorClave.get('tecnico')._id,
    promoterId: usuarioPorClave.get('ventas')._id,
    customer: {
      firstName: 'Óscar',
      lastName: 'Medina',
      taxId: 'V-16543210-9',
      email: 'oscar.medina@example.com',
      phone: '+58 414-888-1122',
      address: 'Calle 5, Quinta El Carmen',
      city: 'Barquisimeto',
      state: 'Lara',
    },
    service: {
      planId: planPorNombre.get('Básico 60')._id,
      routerId: routerLaptop ? routerLaptop._id : null,
      connectionType: 'pppoe',
      ipPoolId: poolPorClave.get('pppoeCaracas')._id,
    },
    items: ventaCanceladaTotales.lines,
    materialsTotal: ventaCanceladaTotales.materialsTotal,
    installationCost: ventaCanceladaTotales.installationCost,
    subtotal: ventaCanceladaTotales.subtotal,
    taxRatePercent: ventaCanceladaTotales.taxRatePercent,
    tax: ventaCanceladaTotales.tax,
    total: ventaCanceladaTotales.total,
    cancelledAt: sumarDias(ahora, -5),
    cancelReason: 'El cliente no concretó la instalación.',
    notes: 'Cancelada sin mover inventario ni emitir factura.',
  });

  settings.billing.nextInvoiceNumber = consecutivo;
  await settings.save();

  /* ------------------------------------------------------------------
     Tickets de soporte
     ------------------------------------------------------------------ */
  const tickets = await Ticket.insertMany([
    {
      code: 'TCK-00001',
      clientId: clientesCreados[0]._id,
      subscriptionId: subPorCliente.get(0).sub._id,
      subject: 'Internet intermitente en la noche',
      description: 'Desde hace tres noches la conexión se corta entre 9 y 11 pm. El router muestra la WAN en rojo.',
      category: 'technical',
      priority: 'high',
      status: 'in_progress',
      assignedTo: 'Soporte N1',
      createdAt: sumarDias(ahora, -2),
      updatedAt: sumarDias(ahora, -1),
      messages: [
        { author: 'Laura Gómez', body: 'Desde hace tres noches la conexión se corta entre 9 y 11 pm. El router muestra la WAN en rojo.', createdAt: sumarDias(ahora, -2) },
        { author: 'Soporte N1', body: 'Estamos revisando el enlace wan1 del Nodo Caracas. Te mantenemos informada por este medio.', createdAt: sumarDias(ahora, -2) },
        { author: 'Laura Gómez', body: 'Gracias, anoche funcionó un poco mejor pero igual se cayó una vez.', createdAt: sumarDias(ahora, -1) },
      ],
    },
    {
      code: 'TCK-00002',
      clientId: clientesCreados[2]._id,
      subscriptionId: subPorCliente.get(2).sub._id,
      subject: 'No tengo servicio desde ayer',
      description: 'El servicio aparece suspendido. Quisiera saber si es por la factura vencida y cómo pagar.',
      category: 'billing',
      priority: 'urgent',
      status: 'open',
      assignedTo: 'Carlos Méndez',
      createdAt: sumarDias(ahora, -1),
      updatedAt: sumarDias(ahora, -1),
      messages: [
        { author: 'Mariana Torres', body: 'El servicio aparece suspendido. Quisiera saber si es por la factura vencida y cómo pagar.', createdAt: sumarDias(ahora, -1) },
      ],
    },
    {
      code: 'TCK-00003',
      clientId: clientesCreados[4]._id,
      subscriptionId: subPorCliente.get(4).sub._id,
      subject: 'Cambio de contraseña del WiFi',
      description: 'Necesito cambiar la clave del WiFi porque se mudó una persona a la casa.',
      category: 'technical',
      priority: 'low',
      status: 'resolved',
      assignedTo: 'Soporte N1',
      createdAt: sumarDias(ahora, -7),
      updatedAt: sumarDias(ahora, -6),
      resolvedAt: sumarDias(ahora, -6),
      messages: [
        { author: 'Sofía Martínez', body: 'Necesito cambiar la clave del WiFi porque se mudó una persona a la casa.', createdAt: sumarDias(ahora, -7) },
        { author: 'Soporte N1', body: 'Se cambió la clave y se envió por correo. Cierra este ticket si todo está bien.', createdAt: sumarDias(ahora, -6) },
      ],
    },
    {
      code: 'TCK-00004',
      clientId: clientesCreados[6]._id,
      subscriptionId: subPorCliente.get(6).sub._id,
      subject: 'Solicitud de mudanza del servicio',
      description: 'Me mudo a otra urbanización el próximo mes. ¿El traslado mantiene el mismo plan?',
      category: 'installation',
      priority: 'medium',
      status: 'open',
      assignedTo: 'Luis Pérez',
      createdAt: sumarDias(ahora, -3),
      updatedAt: sumarDias(ahora, -3),
      messages: [
        { author: 'Valentina Rojas', body: 'Me mudo a otra urbanización el próximo mes. ¿El traslado mantiene el mismo plan?', createdAt: sumarDias(ahora, -3) },
      ],
    },
    {
      code: 'TCK-00005',
      clientId: clientesCreados[7]._id,
      subscriptionId: subPorCliente.get(7).sub._id,
      subject: 'Posible factura duplicada',
      description: 'Veo dos facturas del mismo mes en el portal. ¿Pueden revisar cuál es la válida?',
      category: 'billing',
      priority: 'high',
      status: 'closed',
      assignedTo: 'Carlos Méndez',
      createdAt: sumarDias(ahora, -10),
      updatedAt: sumarDias(ahora, -8),
      resolvedAt: sumarDias(ahora, -9),
      closedAt: sumarDias(ahora, -8),
      messages: [
        { author: 'Diego Herrera', body: 'Veo dos facturas del mismo mes en el portal. ¿Pueden revisar cuál es la válida?', createdAt: sumarDias(ahora, -10) },
        { author: 'Carlos Méndez', body: 'La segunda factura fue anulada por error de periodo. No debes pagarla.', createdAt: sumarDias(ahora, -9) },
      ],
    },
  ], { timestamps: false });

  /* ------------------------------------------------------------------
     Zonas y reportes diarios
     ------------------------------------------------------------------ */
  const zonas = await Zone.insertMany([
    { name: 'Zona Norte', description: 'Municipio Chacao y alrededores', order: 1, active: true },
    { name: 'Zona Centro', description: 'Centro y casco histórico', order: 2, active: true },
    { name: 'Zona Sur', description: 'Municipio Baruta', order: 3, active: true },
  ]);

  await FaultReport.insertMany([
    {
      zoneId: zonas[0]._id,
      priority: 'high',
      faultDate: sumarDias(ahora, -1),
      reportedAt: sumarDias(ahora, -1),
      clientId: clientesCreados[0]._id,
      clientName: `${clientesCreados[0].firstName} ${clientesCreados[0].lastName}`,
      problem: 'Fibra cortada por obra en la avenida principal.',
      note: 'Se coordinó Faena N1 para el mediodía.',
      technician: 'Soporte N1',
      location: 'Av. Francisco de Miranda, torre Este',      status: 'in_progress',
      ticketId: tickets[0]._id,
    },
    {
      zoneId: zonas[0]._id,
      priority: 'low',
      faultDate: sumarDias(ahora, -1),
      reportedAt: sumarDias(ahora, -1),
      clientId: clientesCreados[1]._id,
      clientName: `${clientesCreados[1].firstName} ${clientesCreados[1].lastName}`,
      problem: 'WiFi lento en el segundo piso.',
      note: 'Se recomendó cambiar de canal y ubicar mejor el router.',
      technician: 'Soporte N1',
      location: 'Calle Los Cedros, quinta 12',
      status: 'solved',
      resolvedAt: sumarDias(ahora, -1),
    },
    {
      zoneId: zonas[1]._id,
      priority: 'urgent',
      faultDate: sumarDias(ahora, -1),
      reportedAt: sumarDias(ahora, -1),
      clientId: clientesCreados[2]._id,
      clientName: `${clientesCreados[2].firstName} ${clientesCreados[2].lastName}`,
      problem: 'Cliente sin servicio por factura suspendida.',
      note: 'Atención administrativa; no requiere visita técnica.',
      technician: 'Carlos Méndez',
      location: 'Av. Urdaneta, edificio Centro',
      status: 'unsolved',
    },
  ]);

  await InstallationReport.create({
    saleId: ventaInstalada._id,
    clientId: clientePedro._id,
    subscriptionId: pedro.sub._id,
    clientName: `${clientePedro.firstName} ${clientePedro.lastName}`,
    planName: pedro.plan.name,
    zoneId: zonas[2]._id,
    technician: usuarioPorClave.get('tecnico').name,
    installedAt: sumarDias(ahora, -2),
    notes: 'Instalación con equipo propio y 20 m de cable.',
  });

  /* Vínculo estable en tickets, averías e instalaciones. */
  const mapaUsuarios = new Map(usuarios.map((usuario) => [usuario.name.toLowerCase(), usuario._id]));
  for (const ticket of tickets) {
    const usuarioId = mapaUsuarios.get(String(ticket.assignedTo).toLowerCase());
    if (usuarioId) await Ticket.updateOne({ _id: ticket._id }, { $set: { assigneeId: usuarioId } });
  }
  for (const averia of await FaultReport.find()) {
    const usuarioId = mapaUsuarios.get(String(averia.technician).toLowerCase());
    if (usuarioId) await FaultReport.updateOne({ _id: averia._id }, { $set: { technicianId: usuarioId } });
  }
  for (const instalacion of await InstallationReport.find()) {
    const usuarioId = mapaUsuarios.get(String(instalacion.technician).toLowerCase());
    if (usuarioId) await InstallationReport.updateOne({ _id: instalacion._id }, { $set: { technicianId: usuarioId } });
  }

  /* ------------------------------------------------------------------
     Alertas
     ------------------------------------------------------------------ */
  const alertas = await Alert.insertMany([
    {
      routerId: routerLaptop ? routerLaptop._id : null,
      routerName: routerLaptop ? routerLaptop.name : '',
      wan: 'wan2',
      type: 'wan_down',
      severity: 'critical',
      message: 'La WAN wan2 (Inter) del Nodo Caracas dejó de responder.',
      status: 'active',
      value: '0 Mbps',
      startedAt: sumarDias(ahora, -2 / 24),
    },
    {
      routerId: routerLaptop ? routerLaptop._id : null,
      routerName: routerLaptop ? routerLaptop.name : '',
      wan: 'wan1',
      type: 'wan_up',
      severity: 'info',
      message: 'La WAN wan1 (NetUno) se restableció correctamente.',
      status: 'resolved',
      value: '500 / 100 Mbps',
      startedAt: sumarDias(ahora, -1),
      resolvedAt: sumarDias(ahora, -1),
    },
    {
      routerId: null,
      routerName: '',
      wan: '',
      type: 'stock_low',
      severity: 'warning',
      message: 'Stock bajo de Roseta óptica SC/APC: 6 unidades y el mínimo es 10.',
      status: 'active',
      value: `${rosetaItem.quantity} / ${rosetaItem.minStock}`,
      startedAt: sumarDias(ahora, -4),
    },
    {
      routerId: routerLaptop ? routerLaptop._id : null,
      routerName: routerLaptop ? routerLaptop.name : '',
      wan: 'ether1',
      type: 'client_down',
      severity: 'warning',
      message: 'El servicio de Mariana Torres no responde a la lectura de tráfico.',
      status: 'acknowledged',
      value: '0 bps',
      startedAt: sumarDias(ahora, -5 / 24),
      acknowledgedAt: sumarDias(ahora, -4 / 24),
    },
  ]);

  /* ------------------------------------------------------------------
     Auditoría
     ------------------------------------------------------------------ */
  const pagadas = facturasCreadas.filter((f) => f.status === 'paid').slice(0, 8);
  for (const factura of pagadas) {
    logs.push({
      module: 'financial',
      entity: 'Invoice',
      entityId: String(factura._id),
      action: 'payment',
      description: `Pago total de ${factura.invoiceNumber} (${MONEDA} ${factura.total.toFixed(2)}).`,
      status: 'success',
      actor: 'admin',
      durationMs: 2,
    });
  }

  for (const { sub, cliente } of suscripciones) {
    if (cliente.status === 'suspended') {
      logs.push({
        module: 'firewall',
        entity: 'Subscription',
        entityId: String(sub._id),
        action: 'block',
        description: `Corte por mora de ${cliente.clientCode}.`,
        command: sub.serviceConfig.connectionType === 'pppoe'
          ? `/ppp/secret/disable [find name="${sub.serviceConfig.pppoeUsername}"]`
          : `/ip/firewall/address-list/add list=MOROSOS address=${sub.serviceConfig.ipAddress} comment="CRACKENTICK ${cliente.clientCode}"`,
        commandResult: 'Comando de ejemplo registrado en la auditoría.',
        status: sub.firewallState === 'error' ? 'failed' : 'success',
        durationMs: 3,
        actor: 'system',
      });
    }
  }

  const subError = suscripciones.find(({ sub }) => sub.firewallState === 'error');
  if (subError) {
    logs.push({
      module: 'firewall',
      entity: 'Subscription',
      entityId: String(subError.sub._id),
      action: 'unblock',
      description: `Restauración fallida de ${subError.cliente.clientCode}: el router no respondió.`,
      command: subError.sub.serviceConfig.connectionType === 'pppoe'
        ? `/ppp/secret/enable [find name="${subError.sub.serviceConfig.pppoeUsername}"]`
        : `/ip/firewall/address-list/remove [find list=MOROSOS address=${subError.sub.serviceConfig.ipAddress}]`,
      commandResult: 'ERROR: timeout al conectar con la API del router.',
      status: 'failed',
      durationMs: 8000,
      actor: 'system',
    });
  }

  logs.push(
    {
      module: 'provisioning',
      entity: 'Subscription',
      entityId: String(pedro.sub._id),
      action: 'provision',
      description: 'Aprovisionamiento PPPoE + IP + cola simple del cliente CL-0012.',
      command: [
        '/ppp/secret/add name="pedro.alvarado" service=pppoe',
        '/queue/simple/add name="ct-pedro.alvarado" max-limit=100M/100M',
      ].join('\n'),
      commandResult: 'Comandos de ejemplo registrados en la auditoría.',
      status: 'success',
      actor: 'admin',
      durationMs: 4,
    },
    {
      module: 'provisioning',
      entity: 'Plan',
      entityId: String(planPorNombre.get('Pro 300')._id),
      action: 'sync',
      description: 'Sincronización de la cola simple del plan Pro 300 en 3 servicios.',
      command: '/queue/simple/set [find name~"ct-"] max-limit=300M/100M',
      commandResult: 'Sincronización de ejemplo registrada en la auditoría.',
      status: 'success',
      actor: 'admin',
      durationMs: 6,
    },
    {
      module: 'commercial',
      entity: 'Sale',
      entityId: String(ventaInstalada._id),
      action: 'install',
      description: 'Venta VEN-0001 instalada: Pedro Alvarado, plan Pro 300, equipo y materiales descontados.',
      status: 'success',
      actor: 'admin',
      durationMs: 12,
    },
    {
      module: 'commercial',
      entity: 'Sale',
      entityId: String(ventaCancelada._id),
      action: 'cancel',
      description: 'Venta VEN-0003 cancelada sin mover inventario.',
      status: 'success',
      actor: 'admin',
      durationMs: 2,
    },
    {
      module: 'inventory',
      entity: 'InventoryItem',
      entityId: String(rosetaItem._id),
      action: 'alert',
      description: 'Stock bajo detectado en Roseta óptica SC/APC (6 de 10).',
      status: 'success',
      actor: 'system',
      durationMs: 1,
    },
    {
      module: 'support',
      entity: 'Ticket',
      entityId: String(tickets[0]._id),
      action: 'create',
      description: 'Ticket TCK-00001 creado para Laura Gómez por intermitencia del servicio.',
      status: 'success',
      actor: 'admin',
      durationMs: 3,
    },
    {
      module: 'support',
      entity: 'Ticket',
      entityId: String(tickets[0]._id),
      action: 'reply',
      description: 'Respuesta de Soporte N1 en TCK-00001.',
      status: 'success',
      actor: 'admin',
      durationMs: 2,
    },
    {
      module: 'monitoring',
      entity: 'Alert',
      entityId: String(alertas[0]._id),
      action: 'alert',
      description: 'WAN wan2 del Nodo Caracas marcada como caída.',
      status: 'success',
      actor: 'system',
      durationMs: 1,
    },
    {
      module: 'financial',
      entity: 'Invoice',
      entityId: String(facturaVentaCreada._id),
      action: 'billing_issue',
      description: 'Factura de venta de equipo emitida sin efecto sobre el corte del servicio.',
      status: 'success',
      actor: 'admin',
      durationMs: 3,
    }
  );

  logs.push({
    module: 'settings',
    entity: 'Settings',
    entityId: String(settings._id),
    action: 'config_change',
    description: 'Configuración inicial de la empresa, pools y catálogos.',
    status: 'success',
    actor: 'admin',
    durationMs: 1,
  });

  logs.push({
    module: 'financial',
    entity: 'Invoice',
    action: 'billing_issue',
    description: `Corrida inicial de facturación con ${facturasCreadas.length} facturas de servicio.`,
    status: 'success',
    actor: 'system',
    durationMs: 12,
  });

  /* Pagos capturados por cobranzas para que Rendimiento tenga datos. */
  const montosCobrados = [40.6, 25, 35, 49, 56.84, 40.6, 35];
  montosCobrados.forEach((monto, indice) => {
    logs.push({
      module: 'financial',
      entity: 'Invoice',
      action: 'payment',
      description: `Pago total registrado por cobranzas (${indice + 1}).`,
      changes: { after: { status: 'paid', paymentAmount: monto } },
      status: 'success',
      actor: 'finanzas',
      timestamp: sumarDias(ahora, -(indice + 1)),
      durationMs: 8,
    });
  });

  await AuditLog.insertMany(logs);

  const nominaInicial = await payrollService.procesarPendientes({ actor: 'seed' });

  const resumen = {
    routers: routers.length,
    pools: pools.length,
    planes: planes.length,
    usuarios: usuarios.length,
    empleados: empleados.length,
    movimientosFinancieros: movimientosFinancieros.length,
    pagosNomina: nominaInicial.creados.length,
    clientes: clientesCreados.length,
    servicios: suscripciones.length,
    inventario: inventarioCreado.length,
    ventas: 3,
    tickets: tickets.length,
    alertas: alertas.length,
    facturas: facturasCreadas.length + 2,
    logs: logs.length,
  };

  console.log('🌱 Datos de ejemplo cargados:');
  console.table(resumen);
  console.log(`   Moneda: ${settings.billing.currency} · IVA ${Math.round(settings.billing.taxRate * 100)} % · Firewall ${settings.firewall.mode}`);
  console.log(`   Venta en espera: ${ventaEspera.code} · Venta instalada: ${ventaInstalada.code} · Venta cancelada: ${ventaCancelada.code}`);
  console.log(`   Factura de instalación: ${facturaInstalacionCreada.invoiceNumber} · Factura de venta: ${facturaVentaCreada.invoiceNumber}`);
  console.log('   Acceso demo: admin / admin123 · tecnico / tecnico123 · ventas / ventas123 · finanzas / finanzas123 · soporte / soporte123');

  await mongoose.disconnect();
}

ejecutar().catch(async (error) => {
  console.error('❌ Error al cargar los datos de ejemplo:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
