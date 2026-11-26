const routeros = require('./routeros');
const ciscoService = require('./ciscoService');
const { registrar } = require('./auditService');
const { crearError } = require('../utils/errors');
const { analizarCidr } = require('../utils/ip');

const NOMBRE_SEGURO = /^[A-Za-z0-9._/-]+$/;

function validarVlan(vlan) {
  const numero = Number(vlan.vlanId);
  if (!Number.isInteger(numero) || numero < 1 || numero > 4094) {
    throw crearError(422, 'El VLAN ID debe estar entre 1 y 4094.');
  }
  const nombre = String(vlan.name || '').trim();
  if (!nombre) throw crearError(422, 'El nombre de la VLAN es obligatorio.');
  /* Sin saltos ni caracteres de control: en Cisco el nombre se envía a la consola. */
  if (/[\u0000-\u001f\u007f]/.test(nombre)) {
    throw crearError(422, 'El nombre de la VLAN no puede contener saltos de línea ni caracteres de control.');
  }
  if (vlan.interface && !NOMBRE_SEGURO.test(vlan.interface)) {
    throw crearError(422, 'La interfaz contiene caracteres no válidos.');
  }
  const address = String(vlan.address || '').trim();
  if (address && !analizarCidr(address).ok) {
    throw crearError(422, 'La dirección debe tener formato 10.0.0.1/24.');
  }
  return { numero, nombre, address, interface: String(vlan.interface || '').trim() };
}

function comandoMikrotik(path, params, lookup, descripcion, upsert = false) {
  const legible = params.map((p) => p.replace(/^=/, '')).join(' ');
  return { path, params, lookup, upsert, descripcion, comando: `${path} ${legible}` };
}

const lookupNombre = (nombre) => ({ path: '/interface/vlan/print', filters: [`?name=${nombre}`] });
const lookupAddress = (address) => ({ path: '/ip/address/print', filters: [`?address=${address}`] });

/**
 * Cada paso lleva su comando de reversión. Si un paso falla, se deshacen los
 * anteriores en orden inverso para no dejar objetos a medias en el router.
 */
function pasosMikrotik(vlan, accion, datos, anterior = null) {
  const { numero, nombre, address, interface: interfaz } = datos;
  const pasos = [];

  if (accion === 'crear') {
    pasos.push({
      cmd: comandoMikrotik(
        '/interface/vlan/add',
        [`=name=${nombre}`, `=vlan-id=${numero}`, `=interface=${interfaz}`, `=comment=CRACKENTICK VLAN ${nombre}`, '=disabled=no'],
        lookupNombre(nombre),
        `Crear VLAN ${nombre} (${numero})`,
        true
      ),
      deshacer: comandoMikrotik('/interface/vlan/remove', [], lookupNombre(nombre), `Revertir VLAN ${nombre}`),
    });
    if (address) {
      pasos.push({
        cmd: comandoMikrotik(
          '/ip/address/add',
          [`=address=${address}`, `=interface=${nombre}`, `=comment=CRACKENTICK VLAN ${nombre}`],
          lookupAddress(address),
          `Asignar ${address} a ${nombre}`,
          true
        ),
        deshacer: comandoMikrotik('/ip/address/remove', [], lookupAddress(address), `Revertir dirección ${address}`),
      });
    }
    return pasos;
  }

  if (accion === 'actualizar') {
    const previo = anterior || {};
    const nombrePrevio = String(previo.name || nombre);
    const addressPrevia = String(previo.address || '');
    if (nombrePrevio !== nombre || Number(previo.vlanId) !== numero) {
      const revertir = [`=name=${nombrePrevio}`];
      if (Number.isInteger(Number(previo.vlanId))) revertir.push(`=vlan-id=${previo.vlanId}`);
      pasos.push({
        cmd: comandoMikrotik(
          '/interface/vlan/set',
          [`=name=${nombre}`, `=vlan-id=${numero}`],
          lookupNombre(nombrePrevio),
          `Renombrar VLAN ${nombrePrevio} a ${nombre}`
        ),
        deshacer: comandoMikrotik('/interface/vlan/set', revertir, lookupNombre(nombre), `Restaurar nombre ${nombrePrevio}`),
      });
    }
    if (addressPrevia !== address) {
      if (addressPrevia) {
        pasos.push({
          cmd: comandoMikrotik('/ip/address/remove', [], lookupAddress(addressPrevia), `Quitar dirección anterior ${addressPrevia}`),
          deshacer: comandoMikrotik(
            '/ip/address/add',
            [`=address=${addressPrevia}`, `=interface=${nombrePrevio}`],
            lookupAddress(addressPrevia),
            `Restaurar dirección ${addressPrevia}`,
            true
          ),
        });
      }
      if (address) {
        pasos.push({
          cmd: comandoMikrotik(
            '/ip/address/add',
            [`=address=${address}`, `=interface=${nombre}`, `=comment=CRACKENTICK VLAN ${nombre}`],
            lookupAddress(address),
            `Asignar ${address} a ${nombre}`,
            true
          ),
          deshacer: comandoMikrotik('/ip/address/remove', [], lookupAddress(address), `Revertir dirección ${address}`),
        });
      }
    }
    if (vlan.enabled === false) {
      pasos.push({
        cmd: comandoMikrotik('/interface/vlan/set', ['=disabled=yes'], lookupNombre(nombre), `Inhabilitar la VLAN ${nombre}`),
        deshacer: comandoMikrotik('/interface/vlan/set', ['=disabled=no'], lookupNombre(nombre), `Rehabilitar la VLAN ${nombre}`),
      });
    } else if (previo.enabled === false) {
      pasos.push({
        cmd: comandoMikrotik('/interface/vlan/set', ['=disabled=no'], lookupNombre(nombre), `Habilitar la VLAN ${nombre}`),
        deshacer: comandoMikrotik('/interface/vlan/set', ['=disabled=yes'], lookupNombre(nombre), `Inhabilitar la VLAN ${nombre}`),
      });
    }
    return pasos;
  }

  if (accion === 'eliminar') {
    if (address) {
      pasos.push({
        cmd: comandoMikrotik('/ip/address/remove', [], lookupAddress(address), `Quitar la dirección ${address}`),
        deshacer: comandoMikrotik(
          '/ip/address/add',
          [`=address=${address}`, `=interface=${nombre}`],
          lookupAddress(address),
          `Restaurar dirección ${address}`,
          true
        ),
      });
    }
    pasos.push({
      cmd: comandoMikrotik('/interface/vlan/remove', [], lookupNombre(nombre), `Eliminar la VLAN ${nombre}`),
      deshacer: comandoMikrotik(
        '/interface/vlan/add',
        [`=name=${nombre}`, `=vlan-id=${numero}`, `=interface=${interfaz}`, `=comment=CRACKENTICK VLAN ${nombre}`, '=disabled=no'],
        lookupNombre(nombre),
        `Restaurar VLAN ${nombre}`,
        true
      ),
    });
    return pasos;
  }

  const habilitar = accion === 'habilitar';
  return [
    {
      cmd: comandoMikrotik(
        '/interface/vlan/set',
        [`=disabled=${habilitar ? 'no' : 'yes'}`],
        lookupNombre(nombre),
        `${habilitar ? 'Habilitar' : 'Inhabilitar'} la VLAN ${nombre}`
      ),
      deshacer: comandoMikrotik(
        '/interface/vlan/set',
        [`=disabled=${habilitar ? 'yes' : 'no'}`],
        lookupNombre(nombre),
        `Revertir estado de la VLAN ${nombre}`
      ),
    },
  ];
}

function mascaraCisco(address) {
  const [ip, prefijo] = String(address || '').split('/');
  const bits = Number(prefijo);
  if (!ip || !Number.isInteger(bits) || bits < 0 || bits > 32) return address;
  const mascara = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return `${ip} ${[(mascara >>> 24) & 255, (mascara >>> 16) & 255, (mascara >>> 8) & 255, mascara & 255].join('.')}`;
}

function comandosCisco(vlan, accion, { numero, nombre, address, interface: interfaz }) {
  const nombreSeguro = String(nombre).replace(/[\r\n]/g, ' ').trim();
  if (accion === 'crear' || accion === 'actualizar') {
    const comandos = [`vlan ${numero}`, `name ${nombreSeguro}`, 'exit'];
    if (interfaz) {
      comandos.push(
        `interface ${interfaz}`,
        'switchport mode access',
        `switchport access vlan ${numero}`,
        'no shutdown',
        'exit'
      );
    }
    if (address) {
      comandos.push(`interface Vlan${numero}`, `ip address ${mascaraCisco(address)}`, 'no shutdown', 'exit');
    }
    return comandos;
  }
  if (accion === 'eliminar') return [`no vlan ${numero}`];
  if (accion === 'habilitar') return [`interface Vlan${numero}`, 'no shutdown', 'exit'];
  return [`interface Vlan${numero}`, 'shutdown', 'exit'];
}

async function ejecutarPasos(router, pasos, resultados) {
  const aplicados = [];
  for (const paso of pasos) {
    let respuesta;
    try {
      respuesta = await routeros.ejecutar(router, paso.cmd);
    } catch (error) {
      respuesta = { ok: false, result: error.message };
    }
    resultados.push({ comando: paso.cmd.comando, ok: respuesta.ok, result: respuesta.result });
    if (!respuesta.ok) {
      const reversiones = [];
      for (const previo of [...aplicados].reverse()) {
        if (!previo.deshacer) continue;
        try {
          const rev = await routeros.ejecutar(router, previo.deshacer);
          reversiones.push({ comando: previo.deshacer.comando, ok: rev.ok, result: rev.result });
        } catch (error) {
          reversiones.push({ comando: previo.deshacer.comando, ok: false, result: error.message });
        }
      }
      if (reversiones.length) {
        resultados.push({
          comando: 'REVERSIÓN',
          ok: reversiones.every((r) => r.ok),
          result: reversiones.map((r) => `${r.ok ? 'OK' : 'ERROR'} · ${r.result}`).join(' | ').slice(0, 900),
        });
      }
      return { ok: false, resultados, revertido: reversiones.length > 0 };
    }
    aplicados.push(paso);
  }
  return { ok: true, resultados, revertido: false };
}

async function aplicar(router, vlan, accion, { actor = 'admin', anterior = null } = {}) {
  const datos = validarVlan(vlan);
  if (router.vendor === 'cisco' && datos.nombre.length > 32) {
    throw crearError(422, 'Cisco admite nombres de VLAN de hasta 32 caracteres.');
  }
  if (router.vendor === 'mikrotik' && accion === 'crear' && !datos.interface) {
    throw crearError(422, 'En MikroTik, la interfaz física es obligatoria para crear la VLAN.');
  }

  const simulado = !router || router.mode !== 'real';
  const inicio = Date.now();
  const resultados = [];

  if (simulado) {
    return {
      ok: true,
      simulado: true,
      resultados: [{ comando: 'SIMULADO', ok: true, result: 'VLAN registrada sin ejecutar en el equipo.' }],
      salida: 'VLAN simulada.',
      revertido: false,
      durationMs: 0,
    };
  }

  let revertido = false;
  try {
    if (router.vendor === 'cisco') {
      const comandos = comandosCisco(vlan, accion, datos);
      const salida = await ciscoService.ejecutar(router, comandos, { config: true });
      resultados.push({ comando: comandos.join('\n'), ok: salida.ok, result: salida.result });
    } else {
      const ejecucion = await ejecutarPasos(router, pasosMikrotik(vlan, accion, datos, anterior), resultados);
      revertido = ejecucion.revertido;
    }
  } catch (error) {
    resultados.push({ comando: 'ERROR', ok: false, result: error.message });
  }

  const ok = resultados.length > 0 && resultados.every((r) => r.ok);
  const salida = resultados.map((r) => `${r.ok ? 'OK' : 'ERROR'} · ${r.result}`).join('\n');
  const acciones = { crear: 'create', actualizar: 'update', eliminar: 'delete', habilitar: 'update', inhabilitar: 'update' };

  await registrar({
    module: 'provisioning',
    entity: 'Vlan',
    entityId: vlan._id,
    action: acciones[accion] || 'update',
    description: `VLAN ${datos.nombre} (${datos.numero}) ${accion} en ${router.name}.`,
    command: resultados.map((r) => r.comando).join('\n'),
    commandResult: salida.slice(0, 1900),
    status: ok ? 'success' : 'failed',
    durationMs: Date.now() - inicio,
    actor,
  });

  return { ok, simulado: false, resultados, salida, revertido, durationMs: Date.now() - inicio };
}

module.exports = { aplicar, validarVlan };
