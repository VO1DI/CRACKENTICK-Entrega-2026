const { descifrar } = require('../cryptoService');
const routeros = require('../routeros');

/**
 * Construye el comando RouterOS que representa una acción de firewall.
 * No ejecuta nada: solo arma el texto y los metadatos.
 */
function construirComando(accion, subscription) {
  const config = subscription?.serviceConfig || {};
  const cliente = subscription?.clientId;
  const codigo = cliente?.clientCode || 'CLIENTE';
  const nombre = cliente?.fullName || '';
  const comentario = `CRACKENTICK ${codigo}${nombre ? ` ${nombre}` : ''}`.replace(/"/g, "'");

  if (accion === 'pppoe-disable' || accion === 'pppoe-enable') {
    const usuario = config.pppoeUsername || 'sin-usuario';
    return {
      accion,
      tipo: 'pppoe',
      comando: `/ppp/secret/${accion === 'pppoe-disable' ? 'disable' : 'enable'} [find name="${usuario}"]`,
      descripcion: `${accion === 'pppoe-disable' ? 'Deshabilitar' : 'Habilitar'} el secret PPPoE ${usuario}`,
    };
  }

  const ip = config.ipAddress || '0.0.0.0';
  if (accion === 'block') {
    return {
      accion,
      tipo: 'address-list',
      comando: `/ip/firewall/address-list/add list=MOROSOS address=${ip} comment="${comentario}"`,
      descripcion: `Agregar ${ip} a la lista MOROSOS y asegurar las reglas de corte`,
    };
  }

  return {
    accion,
    tipo: 'address-list',
    comando: `/ip/firewall/address-list/remove [find list=MOROSOS address=${ip}]`,
    descripcion: `Quitar ${ip} de la lista MOROSOS`,
  };
}

class SimulatedDriver {
  constructor(settings) {
    this.settings = settings;
  }

  async block(subscription) {
    const plan = construirComando('block', subscription);
    return {
      ok: true,
      command: plan.comando,
      result: 'SIMULATED: comando registrado, no ejecutado.',
      simulated: true,
      durationMs: 2,
    };
  }

  async unblock(subscription) {
    const plan = construirComando('unblock', subscription);
    return {
      ok: true,
      command: plan.comando,
      result: 'SIMULATED: comando registrado, no ejecutado.',
      simulated: true,
      durationMs: 2,
    };
  }

  async pppoeDisable(subscription) {
    return this.simular('pppoe-disable', subscription);
  }

  async pppoeEnable(subscription) {
    return this.simular('pppoe-enable', subscription);
  }

  async simular(accion, subscription) {
    const plan = construirComando(accion, subscription);
    return {
      ok: true,
      command: plan.comando,
      result: 'SIMULATED: comando registrado, no ejecutado.',
      simulated: true,
      durationMs: 2,
    };
  }

  async testConnection() {
    return {
      ok: true,
      command: '/system/identity/print',
      result: 'SIMULATED: conexión simulada con el router principal.',
      simulated: true,
      durationMs: 1,
    };
  }
}

class MikroTikDriver {
  constructor(settings) {
    this.settings = settings;
  }

  async conectar() {
    let RouterOSAPI;
    try {
      RouterOSAPI = routeros.cargarApi();
    } catch (error) {
      throw new Error('No se pudo cargar el controlador de RouterOS (node-routeros). Reinstala las dependencias con npm install.');
    }

    const config = this.settings.firewall;
    if (!config.host || !config.username) {
      throw new Error('Faltan el host y el usuario de la API del router.');
    }

    const password = descifrar(config.passwordEnc || '');
    const conexion = new RouterOSAPI({
      host: config.host,
      user: config.username,
      password,
      port: config.port || 8728,
      timeout: 8,
      tls: config.tls ? { rejectUnauthorized: config.verifyTls === true } : undefined,
    });
    await conexion.connect();
    return conexion;
  }

  async block(subscription) {
    return this.ejecutar('block', subscription);
  }

  async unblock(subscription) {
    return this.ejecutar('unblock', subscription);
  }

  async pppoeDisable(subscription) {
    return this.ejecutar('pppoe-disable', subscription);
  }

  async pppoeEnable(subscription) {
    return this.ejecutar('pppoe-enable', subscription);
  }

  /** Crea una sola vez las reglas que descartan el tráfico de la lista MOROSOS. */
  async asegurarReglasMorosos(conexion) {
    const reglas = [
      { chain: 'forward', comment: 'CRACKENTICK morosos forward' },
      { chain: 'input', comment: 'CRACKENTICK morosos input' },
    ];
    for (const regla of reglas) {
      const existentes = await conexion.write('/ip/firewall/filter/print', [`?comment=${regla.comment}`]);
      if (!existentes || !existentes.length) {
        await conexion.write('/ip/firewall/filter/add', [
          `=chain=${regla.chain}`,
          '=src-address-list=MOROSOS',
          '=action=drop',
          `=comment=${regla.comment}`,
        ]);
      }
    }
  }

  async ejecutar(accion, subscription) {
    const inicio = Date.now();
    const plan = construirComando(accion, subscription);
    const conexion = await this.conectar();
    try {
      const config = subscription.serviceConfig || {};
      const comentario = `CRACKENTICK ${subscription.clientId?.clientCode || ''}`.trim();
      const notas = [];
      let respuesta;

      if (accion === 'pppoe-disable' || accion === 'pppoe-enable') {
        const secretos = await conexion.write('/ppp/secret/print', [`?name=${config.pppoeUsername}`]);
        if (!secretos || !secretos.length) {
          throw new Error(`No se encontró el secret PPPoE ${config.pppoeUsername}.`);
        }
        respuesta = await conexion.write(`/ppp/secret/${accion === 'pppoe-disable' ? 'disable' : 'enable'}`, [`=.id=${secretos[0]['.id']}`]);
      } else if (accion === 'block') {
        if (!config.ipAddress) {
          if (config.connectionType === 'pppoe' && config.pppoeUsername) {
            const secretos = await conexion.write('/ppp/secret/print', [`?name=${config.pppoeUsername}`]);
            if (!secretos || !secretos.length) {
              throw new Error(`No se encontró el secret PPPoE ${config.pppoeUsername}.`);
            }
            respuesta = await conexion.write('/ppp/secret/disable', [`=.id=${secretos[0]['.id']}`]);
            return {
              ok: true,
              command: plan.comando,
              result: 'El servicio no tiene IP fija; se deshabilitó el PPPoE como respaldo.',
              simulated: false,
              durationMs: Date.now() - inicio,
              fallbackPppoe: true,
            };
          }
          throw new Error('El servicio no tiene una IP para agregar a la lista MOROSOS.');
        }
        await this.asegurarReglasMorosos(conexion);
        const entradas = await conexion.write('/ip/firewall/address-list/print', [
          '?list=MOROSOS',
          `?address=${config.ipAddress}`,
        ]);
        if (entradas && entradas.length) {
          notas.push('La IP ya estaba en MOROSOS.');
        } else {
          respuesta = await conexion.write('/ip/firewall/address-list/add', [
            '=list=MOROSOS',
            `=address=${config.ipAddress}`,
            `=comment=${comentario}`,
          ]);
        }
      } else {
        const entradas = await conexion.write('/ip/firewall/address-list/print', [
          '?list=MOROSOS',
          `?address=${config.ipAddress}`,
        ]);
        if (!entradas || !entradas.length) {
          notas.push('La dirección no estaba en MOROSOS.');
        } else {
          respuesta = await conexion.write('/ip/firewall/address-list/remove', [`=.id=${entradas[0]['.id']}`]);
        }

        if (subscription.pppoeDisabled && config.pppoeUsername) {
          const secretos = await conexion.write('/ppp/secret/print', [`?name=${config.pppoeUsername}`]);
          if (secretos && secretos.length) {
            await conexion.write('/ppp/secret/enable', [`=.id=${secretos[0]['.id']}`]);
            notas.push('PPPoE habilitado.');
          }
        }
      }

      return {
        ok: true,
        command: plan.comando,
        result: `${JSON.stringify(respuesta ?? { ok: true })}${notas.length ? ` · ${notas.join(' · ')}` : ''}`.slice(0, 1800),
        simulated: false,
        durationMs: Date.now() - inicio,
      };
    } finally {
      try {
        conexion.close();
      } catch (error) {
        /* conexión ya cerrada */
      }
    }
  }

  async testConnection() {
    const inicio = Date.now();
    const conexion = await this.conectar();
    try {
      const identidad = await conexion.write('/system/identity/print');
      return {
        ok: true,
        command: '/system/identity/print',
        result: JSON.stringify(identidad ?? {}).slice(0, 1800),
        simulated: false,
        durationMs: Date.now() - inicio,
      };
    } finally {
      try {
        conexion.close();
      } catch (error) {
        /* conexión ya cerrada */
      }
    }
  }
}

function crearDriver(settings, router = null) {
  const modo = router?.mode || settings.firewall.mode;
  if (modo !== 'real') return new SimulatedDriver(settings);

  // Cada servicio se corta en su router asignado; Settings es solo el respaldo.
  const firewall = router
    ? {
        host: router.host,
        port: router.port,
        username: router.username,
        passwordEnc: router.passwordEnc,
        tls: router.tls,
        verifyTls: router.verifyTls,
        mode: 'real',
      }
    : settings.firewall;

  return new MikroTikDriver({ ...settings, firewall });
}

module.exports = { construirComando, crearDriver, SimulatedDriver, MikroTikDriver };
