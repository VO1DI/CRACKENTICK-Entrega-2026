const routeros = require('./routeros');
const { registrar } = require('./auditService');
const { crearError } = require('../utils/errors');
const { analizarCidr, esIpValida, ipEnCidr, ipAEntero } = require('../utils/ip');

const LEASES = ['10m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '7d', '30d'];
const DNS_POR_DEFECTO = '1.1.1.1,8.8.8.8';

function limpiar(texto, max = 60) {
  return String(texto || '').trim().slice(0, max);
}

function nombreSeguro(texto) {
  return limpiar(texto, 60).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || '';
}

function validarDatos(datos = {}) {
  const interfaz = limpiar(datos.interface, 60);
  if (!interfaz) throw crearError(422, 'Selecciona o escribe la interfaz del DHCP.');

  const info = analizarCidr(datos.cidr);
  if (!info.ok) throw crearError(422, info.error);

  const gateway = limpiar(datos.gateway, 45);
  if (!esIpValida(gateway) || !ipEnCidr(gateway, info.rangeLabel)) {
    throw crearError(422, 'El gateway debe ser una IP dentro de la red indicada.');
  }

  const inicio = limpiar(datos.rangeStart, 45);
  const fin = limpiar(datos.rangeEnd, 45);
  if (!esIpValida(inicio) || !esIpValida(fin)) {
    throw crearError(422, 'El rango inicial y final deben ser IPs válidas.');
  }
  if (!ipEnCidr(inicio, info.rangeLabel) || !ipEnCidr(fin, info.rangeLabel)) {
    throw crearError(422, 'El rango debe estar dentro de la red indicada.');
  }
  const enteroInicio = ipAEntero(inicio);
  const enteroFin = ipAEntero(fin);
  if (enteroInicio > enteroFin) throw crearError(422, 'La IP inicial no puede ser mayor que la final.');
  const enteroGateway = ipAEntero(gateway);
  if (enteroGateway >= enteroInicio && enteroGateway <= enteroFin) {
    throw crearError(422, 'El gateway no puede estar dentro del rango que entrega el DHCP.');
  }
  if ([info.networkInt, info.broadcastInt].some((valor) => valor >= enteroInicio && valor <= enteroFin)) {
    throw crearError(422, 'El rango no debe incluir la dirección de red ni la de broadcast.');
  }

  const dns = limpiar(datos.dns || DNS_POR_DEFECTO, 120)
    .split(/[,\s]+/)
    .map((ip) => ip.trim())
    .filter(Boolean);
  if (!dns.length || dns.some((ip) => !esIpValida(ip))) {
    throw crearError(422, 'Los servidores DNS deben ser IPs válidas separadas por coma.');
  }

  const leaseTime = LEASES.includes(datos.leaseTime) ? datos.leaseTime : '1d';
  const nombre = nombreSeguro(datos.name) || `dhcp-${nombreSeguro(interfaz)}`;
  return {
    routerId: datos.routerId,
    name: nombre,
    poolName: `${nombre}-pool`,
    interface: interfaz,
    cidr: info.rangeLabel,
    gateway,
    rangeStart: inicio,
    rangeEnd: fin,
    range: `${inicio}-${fin}`,
    dns: dns.join(','),
    leaseTime,
    addAddress: datos.addAddress === true || datos.addAddress === 'on' || datos.addAddress === 'true',
  };
}

async function listar(router) {
  const conexion = await routeros.conectar(router);
  try {
    const [interfaces, servidores, pools, redes, direcciones] = await Promise.all([
      conexion.write('/interface/print').catch(() => []),
      conexion.write('/ip/dhcp-server/print').catch(() => []),
      conexion.write('/ip/pool/print').catch(() => []),
      conexion.write('/ip/dhcp-server/network/print').catch(() => []),
      conexion.write('/ip/address/print').catch(() => []),
    ]);
    return {
      ok: true,
      interfaces: (interfaces || [])
        .filter((fila) => fila.name && !fila.dynamic)
        .map((fila) => ({
          name: fila.name,
          type: fila.type || '',
          running: fila.running === 'true',
          disabled: fila.disabled === 'true',
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      servidores: (servidores || []).map((fila) => ({
        id: fila['.id'],
        name: fila.name,
        interface: fila.interface || '',
        pool: fila['address-pool'] || '',
        leaseTime: fila['lease-time'] || '',
        disabled: fila.disabled === 'true',
      })),
      pools: (pools || []).map((fila) => ({
        id: fila['.id'],
        name: fila.name,
        ranges: fila.ranges || '',
      })),
      redes: (redes || []).map((fila) => ({
        id: fila['.id'],
        address: fila.address || '',
        gateway: fila.gateway || '',
        dns: fila['dns-server'] || '',
      })),
      direcciones: (direcciones || []).map((fila) => ({
        id: fila['.id'],
        address: fila.address || '',
        interface: fila.interface || '',
      })),
    };
  } finally {
    routeros.cerrar(conexion);
  }
}

async function crear(router, datos, { actor = 'admin' } = {}) {
  const d = validarDatos(datos);
  if (router.mode !== 'real') {
    return { ...d, ok: true, pasos: ['SIMULADO'], simulado: true };
  }
  const prefijo = analizarCidr(d.cidr).prefix;
  let estado;
  try {
    estado = await listar(router);
  } catch (error) {
    throw crearError(502, `No se pudo leer el estado del router antes de crear el DHCP: ${error.message}`);
  }

  const orden = [];
  const agregar = (cmd, descripcion, { nuevo = true, revertir = null } = {}) =>
    orden.push({ cmd, descripcion, nuevo, revertir });

  if (d.addAddress) {
    const direccion = `${d.gateway}/${prefijo}`;
    const existe = estado.direcciones.some((fila) => fila.address === direccion);
    agregar(
      {
        path: '/ip/address/add',
        lookup: { path: '/ip/address/print', filters: [`?address=${direccion}`] },
        upsert: true,
        params: [`=address=${direccion}`, `=interface=${d.interface}`, `=comment=CRACKENTICK DHCP ${d.name}`],
        paramsSet: [`=interface=${d.interface}`, `=comment=CRACKENTICK DHCP ${d.name}`],
        comando: `/ip/address/add address=${direccion} interface=${d.interface} comment="CRACKENTICK DHCP ${d.name}"`,
      },
      'Asignar gateway a la interfaz',
      {
        nuevo: !existe,
        revertir: {
          path: '/ip/address/remove',
          lookup: { path: '/ip/address/print', filters: [`?address=${direccion}`] },
          comando: `/ip/address/remove address=${direccion}`,
        },
      }
    );
  }

  const poolExiste = estado.pools.some((fila) => fila.name === d.poolName);
  agregar(
    {
      path: '/ip/pool/add',
      lookup: { path: '/ip/pool/print', filters: [`?name=${d.poolName}`] },
      upsert: true,
      params: [`=name=${d.poolName}`, `=ranges=${d.range}`],
      paramsSet: [`=ranges=${d.range}`],
      comando: `/ip/pool/add name=${d.poolName} ranges=${d.range}`,
    },
    'Crear pool de direcciones',
    {
      nuevo: !poolExiste,
      revertir: {
        path: '/ip/pool/remove',
        lookup: { path: '/ip/pool/print', filters: [`?name=${d.poolName}`] },
        comando: `/ip/pool/remove name=${d.poolName}`,
      },
    }
  );

  const redExiste = estado.redes.some((fila) => fila.address === d.cidr);
  agregar(
    {
      path: '/ip/dhcp-server/network/add',
      lookup: { path: '/ip/dhcp-server/network/print', filters: [`?address=${d.cidr}`] },
      upsert: true,
      params: [`=address=${d.cidr}`, `=gateway=${d.gateway}`, `=dns-server=${d.dns}`, `=comment=CRACKENTICK DHCP ${d.name}`],
      paramsSet: [`=gateway=${d.gateway}`, `=dns-server=${d.dns}`, `=comment=CRACKENTICK DHCP ${d.name}`],
      comando: `/ip/dhcp-server/network/add address=${d.cidr} gateway=${d.gateway} dns-server=${d.dns} comment="CRACKENTICK DHCP ${d.name}"`,
    },
    'Crear red DHCP',
    {
      nuevo: !redExiste,
      revertir: {
        path: '/ip/dhcp-server/network/remove',
        lookup: { path: '/ip/dhcp-server/network/print', filters: [`?address=${d.cidr}`] },
        comando: `/ip/dhcp-server/network/remove address=${d.cidr}`,
      },
    }
  );

  const servidorExiste = estado.servidores.some((fila) => fila.name === d.name);
  agregar(
    {
      path: '/ip/dhcp-server/add',
      lookup: { path: '/ip/dhcp-server/print', filters: [`?name=${d.name}`] },
      upsert: true,
      params: [
        `=name=${d.name}`,
        `=interface=${d.interface}`,
        `=address-pool=${d.poolName}`,
        `=lease-time=${d.leaseTime}`,
        '=disabled=no',
        `=comment=CRACKENTICK DHCP ${d.name}`,
      ],
      paramsSet: [
        `=interface=${d.interface}`,
        `=address-pool=${d.poolName}`,
        `=lease-time=${d.leaseTime}`,
        '=disabled=no',
        `=comment=CRACKENTICK DHCP ${d.name}`,
      ],
      comando: `/ip/dhcp-server/add name=${d.name} interface=${d.interface} address-pool=${d.poolName} lease-time=${d.leaseTime} disabled=no comment="CRACKENTICK DHCP ${d.name}"`,
    },
    'Crear servidor DHCP',
    {
      nuevo: !servidorExiste,
      revertir: {
        path: '/ip/dhcp-server/remove',
        lookup: { path: '/ip/dhcp-server/print', filters: [`?name=${d.name}`] },
        comando: `/ip/dhcp-server/remove name=${d.name}`,
      },
    }
  );

  const resultados = await routeros.ejecutarVarios(router, orden.map((paso) => paso.cmd));
  const fallo = resultados.findIndex((resultado) => !resultado.ok);
  if (fallo !== -1) {
    const reversiones = [];
    for (const paso of orden.slice(0, fallo).reverse()) {
      if (!paso.nuevo || !paso.revertir) continue;
      try {
        const rev = await routeros.ejecutar(router, paso.revertir);
        reversiones.push({ comando: paso.revertir.comando, ok: rev.ok, result: rev.result });
      } catch (error) {
        reversiones.push({ comando: paso.revertir.comando, ok: false, result: error.message });
      }
    }
    const detalleReversion = reversiones.length
      ? ` Se revirtieron los pasos aplicados: ${reversiones.map((r) => `${r.ok ? 'OK' : 'ERROR'} ${r.comando}`).join('; ')}.`
      : '';
    await registrar({
      module: 'provisioning',
      entity: 'Router',
      entityId: router._id,
      action: 'create',
      description: `Servidor DHCP ${d.name} rechazado en ${router.name}: ${orden[fallo].descripcion}.`,
      commandResult: `${resultados[fallo].result}\n${detalleReversion}`.slice(0, 1800),
      status: 'failed',
      actor,
    });
    throw crearError(502, `${orden[fallo].descripcion}: ${resultados[fallo].result}.${detalleReversion}`);
  }
  const pasos = orden.map((paso) => paso.descripcion);

  await registrar({
    module: 'provisioning',
    entity: 'Router',
    entityId: router._id,
    action: 'create',
    description: `Servidor DHCP ${d.name} creado en ${router.name} (${d.interface}, ${d.cidr}, ${d.range}).`,
    commandResult: pasos.join('\n').slice(0, 1800),
    status: 'success',
    actor,
  });

  return { ...d, ok: true, pasos };
}

module.exports = { listar, crear, validarDatos, LEASES, DNS_POR_DEFECTO };
