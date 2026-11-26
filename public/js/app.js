/* ==========================================================================
   CRACKENTICK — interacciones del cliente
   Menú, tema, copiado de comandos, confirmaciones y ayudas de formulario.
   ========================================================================== */
(function () {
  'use strict';

  const raiz = document.documentElement;
  const CLAVE_TEMA = 'crackentick-tema';
  const TEMAS = ['oscuro', 'claro', 'claro-suave'];

  /* ------------------------------------------------------------------
     Temas: oscuro (por defecto), claro arena y claro lavanda
     ------------------------------------------------------------------ */
  const ICONO_SOL =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  const ICONO_LUNA =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  function temaActual() {
    return TEMAS.includes(raiz.dataset.tema) ? raiz.dataset.tema : 'oscuro';
  }

  function sincronizarBotonTema() {
    const tema = temaActual();
    const boton = document.getElementById('btnTema');
    if (boton) {
      const icono = boton.querySelector('.boton-tema__icono') || boton;
      icono.innerHTML = tema === 'oscuro' ? ICONO_SOL : ICONO_LUNA;
      const etiquetas = { oscuro: 'Tema oscuro', claro: 'Tema claro arena', 'claro-suave': 'Tema claro lavanda' };
      boton.setAttribute('aria-label', `Cambiar tema (actual: ${etiquetas[tema]})`);
      boton.setAttribute('title', etiquetas[tema]);
    }
    document.querySelectorAll('[data-tema-opcion]').forEach(function (opcion) {
      const activo = opcion.getAttribute('data-tema-opcion') === tema;
      opcion.classList.toggle('is-activo', activo);
      opcion.setAttribute('aria-checked', activo ? 'true' : 'false');
    });
  }

  function aplicarTema(tema) {
    const elegido = TEMAS.includes(tema) ? tema : 'oscuro';
    raiz.dataset.tema = elegido;
    try {
      localStorage.setItem(CLAVE_TEMA, elegido);
    } catch (error) {
      /* almacenamiento no disponible */
    }
    sincronizarBotonTema();
    if (document.getElementById('temaMenu') && document.querySelector('.app-shell') && window.fetch) {
      window.fetch('/api/preferencias/tema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ tema: elegido }),
      }).catch(function () { /* la preferencia local queda aplicada */ });
    }
  }

  sincronizarBotonTema();

  const botonTema = document.getElementById('btnTema');
  const menuTema = document.getElementById('temaMenu');
  if (botonTema && menuTema) {
    const cerrarMenuTema = function () {
      menuTema.hidden = true;
      botonTema.setAttribute('aria-expanded', 'false');
    };
    botonTema.addEventListener('click', function (evento) {
      evento.stopPropagation();
      const abrir = menuTema.hidden;
      menuTema.hidden = !abrir;
      botonTema.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    });
    menuTema.addEventListener('click', function (evento) {
      const opcion = evento.target.closest('[data-tema-opcion]');
      if (!opcion) return;
      aplicarTema(opcion.getAttribute('data-tema-opcion'));
      cerrarMenuTema();
    });
    document.addEventListener('click', function (evento) {
      if (!menuTema.hidden && !evento.target.closest('[data-tema-selector]')) cerrarMenuTema();
    });
    document.addEventListener('keydown', function (evento) {
      if (evento.key === 'Escape') cerrarMenuTema();
    });
  } else if (botonTema) {
    /* En la pantalla de acceso no hay menú: el botón recorre los tres temas. */
    botonTema.addEventListener('click', function () {
      const actual = TEMAS.indexOf(temaActual());
      aplicarTema(TEMAS[(actual + 1) % TEMAS.length]);
    });
  }

  /* Vista compacta: más filas visibles, recordada en el navegador. */
  const CLAVE_COMPACTA = 'crackentick-compacta';
  function sincronizarCompacta() {
    const activa = document.body.classList.contains('vista-compacta');
    document.querySelectorAll('[data-vista-compacta]').forEach(function (boton) {
      boton.classList.toggle('is-activo', activa);
      boton.setAttribute('aria-checked', activa ? 'true' : 'false');
    });
  }
  function aplicarCompacta(activa) {
    document.body.classList.toggle('vista-compacta', activa);
    try { localStorage.setItem(CLAVE_COMPACTA, activa ? '1' : '0'); } catch (error) { /* sin almacenamiento */ }
    sincronizarCompacta();
  }
  try {
    if (localStorage.getItem(CLAVE_COMPACTA) === '1') document.body.classList.add('vista-compacta');
  } catch (error) { /* sin almacenamiento */ }
  sincronizarCompacta();
  document.querySelectorAll('[data-vista-compacta]').forEach(function (boton) {
    boton.addEventListener('click', function () {
      aplicarCompacta(!document.body.classList.contains('vista-compacta'));
    });
  });

  /* Recordar qué grupos de la barra lateral están plegados. */
  document.querySelectorAll('.sidebar__menu').forEach(function (grupo, indice) {
    const resumen = grupo.querySelector(':scope > summary');
    const etiqueta = (resumen ? resumen.textContent : String(indice)).trim().replace(/\s+/g, '-').toLowerCase();
    const clave = `crackentick-menu-${etiqueta || indice}`;
    if (grupo.querySelector('.sidebar__enlace.is-activo')) {
      grupo.open = true;
      return;
    }
    try {
      const guardado = localStorage.getItem(clave);
      if (guardado !== null) grupo.open = guardado === '1';
    } catch (error) { /* sin almacenamiento */ }
    grupo.addEventListener('toggle', function () {
      try { localStorage.setItem(clave, grupo.open ? '1' : '0'); } catch (error) { /* sin almacenamiento */ }
    });
  });

  /* ------------------------------------------------------------------
     Menú lateral: drawer en móvil y plegado en escritorio
     ------------------------------------------------------------------ */
  const sidebar = document.getElementById('sidebar');
  const fondo = document.getElementById('sidebarFondo');
  const botonMenu = document.getElementById('btnMenu');
  const botonCerrar = document.getElementById('btnCerrarMenu');
  const appShell = document.querySelector('.app-shell');
  const esMovil = () => window.innerWidth <= 980;

  function menuAbierto() {
    if (!sidebar) return false;
    if (esMovil()) return sidebar.classList.contains('is-abierto');
    return !(appShell && appShell.classList.contains('is-menu-oculto'));
  }

  function aplicarMenu(abierto) {
    if (!sidebar) return;
    if (esMovil()) {
      sidebar.classList.toggle('is-abierto', abierto);
      if (fondo) fondo.hidden = !abierto;
      document.body.style.overflow = abierto ? 'hidden' : '';
    } else {
      sidebar.classList.remove('is-abierto');
      if (fondo) fondo.hidden = true;
      document.body.style.overflow = '';
      if (appShell) appShell.classList.toggle('is-menu-oculto', !abierto);
    }
    if (botonMenu) botonMenu.setAttribute('aria-expanded', String(abierto));
  }

  if (botonMenu) {
    botonMenu.addEventListener('click', function () {
      aplicarMenu(!menuAbierto());
    });
  }

  if (botonCerrar) {
    botonCerrar.addEventListener('click', function () {
      aplicarMenu(false);
    });
  }

  if (fondo) {
    fondo.addEventListener('click', function () {
      aplicarMenu(false);
    });
  }

  if (sidebar) {
    sidebar.querySelectorAll('a').forEach(function (enlace) {
      enlace.addEventListener('click', function () {
        if (esMovil()) aplicarMenu(false);
      });
    });
  }

  document.addEventListener('keydown', function (evento) {
    if (evento.key === 'Escape' && menuAbierto()) {
      aplicarMenu(false);
      if (botonMenu) botonMenu.focus();
    }
  });

  window.addEventListener('resize', function () {
    if (!esMovil()) {
      sidebar?.classList.remove('is-abierto');
      if (fondo) fondo.hidden = true;
      document.body.style.overflow = '';
    }
  });

  /* ------------------------------------------------------------------
     Avisos: cerrar
     ------------------------------------------------------------------ */
  document.querySelectorAll('.aviso__cerrar').forEach(function (boton) {
    boton.addEventListener('click', function () {
      const aviso = boton.closest('.aviso');
      if (aviso) aviso.remove();
      const contenedor = document.getElementById('avisos');
      if (contenedor && !contenedor.querySelector('.aviso')) contenedor.remove();
    });
  });

  /* ------------------------------------------------------------------
     Filtros que se envían solos
     ------------------------------------------------------------------ */
  document.querySelectorAll('[data-auto-enviar]').forEach(function (control) {
    control.addEventListener('change', function () {
      const formulario = control.closest('form');
      if (formulario) formulario.submit();
    });
  });

  /* Planes: los routers solo aplican al modo address list. */
  document.querySelectorAll('[data-plan-traffic]').forEach(function (selector) {
    const formulario = selector.closest('form');
    const bloqueRouters = formulario ? formulario.querySelector('[data-plan-routers]') : null;
    const actualizar = function () {
      if (bloqueRouters) bloqueRouters.hidden = selector.value !== 'address_list';
    };
    selector.addEventListener('change', actualizar);
    actualizar();
  });

  /* Filtra planes según el modo y los routers habilitados. */
  function planCompatible(planModo, planRouters, routerModo, routerId) {
    if (!routerId) return true;
    if (planModo !== routerModo) return false;
    if (planModo === 'address_list') {
      return String(planRouters || '').split(',').filter(Boolean).includes(routerId);
    }
    return true;
  }

  function filtrarPlanes(formulario) {
    const routerSelect = formulario.querySelector('[data-router-servicio], [data-router-venta]');
    if (!routerSelect) return;
    const opcionRouter = routerSelect.selectedOptions[0];
    const routerModo = opcionRouter ? opcionRouter.dataset.routerPlanMode || '' : '';
    const routerId = routerSelect.value;

    formulario.querySelectorAll('option[data-plan-modo]').forEach(function (opcion) {
      const ok = planCompatible(opcion.dataset.planModo, opcion.dataset.planRouters, routerModo, routerId);
      opcion.hidden = !ok;
      opcion.disabled = !ok;
      if (!ok && opcion.selected) {
        const primera = formulario.querySelector('option[data-plan-modo]:not([disabled])');
        if (primera) primera.selected = true;
      }
    });

    const opcionesRadio = formulario.querySelectorAll('[data-plan-opcion]');
    opcionesRadio.forEach(function (etiqueta) {
      const input = etiqueta.querySelector('input[name="planId"]');
      const ok = planCompatible(etiqueta.dataset.planModo, etiqueta.dataset.planRouters, routerModo, routerId);
      etiqueta.hidden = !ok;
      if (input) {
        input.disabled = !ok;
        if (!ok && input.checked) input.checked = false;
      }
    });
    if (opcionesRadio.length) {
      const marcado = formulario.querySelector('[data-plan-opcion] input[name="planId"]:checked');
      if (!marcado) {
        const primera = formulario.querySelector('[data-plan-opcion]:not([hidden]) input[name="planId"]');
        if (primera) primera.checked = true;
      }
    }
  }

  document.querySelectorAll('[data-router-servicio], [data-router-venta]').forEach(function (routerSelect) {
    const formulario = routerSelect.closest('form');
    if (!formulario) return;
    routerSelect.addEventListener('change', function () { filtrarPlanes(formulario); });
    filtrarPlanes(formulario);
  });

  /* Averías: el ticket completa y bloquea cliente, problema y prioridad. */
  document.querySelectorAll('[data-ticket-averia]').forEach(function (selector) {
    const formulario = selector.closest('form');
    if (!formulario) return;
    const cliente = formulario.querySelector('[data-cliente-averia]');
    const problema = formulario.querySelector('[name="problem"]');
    const prioridad = formulario.querySelector('[name="priority"]');
    const tecnico = formulario.querySelector('[name="technician"]');
    const aviso = formulario.querySelector('[data-aviso-ticket]');

    const actualizar = function () {
      const opcion = selector.selectedOptions[0];
      const vinculado = Boolean(selector.value);
      if (cliente) cliente.disabled = vinculado;
      if (prioridad) prioridad.disabled = vinculado;
      if (problema) problema.readOnly = vinculado;
      if (aviso) aviso.hidden = !vinculado;
      if (!vinculado || !opcion) return;

      if (cliente) cliente.value = opcion.dataset.cliente || '';
      if (problema) {
        problema.value = [opcion.dataset.asunto, opcion.dataset.descripcion].filter(Boolean).join(': ');
      }
      if (prioridad && opcion.dataset.prioridad) prioridad.value = opcion.dataset.prioridad;
      if (tecnico && !tecnico.value) tecnico.value = opcion.dataset.tecnico || '';
    };

    selector.addEventListener('change', actualizar);
    actualizar();
  });

  /* Router: sugerir capacidad contratada sumando las WAN. */
  document.querySelectorAll('[data-sugerir-capacidad]').forEach(function (boton) {
    boton.addEventListener('click', function () {
      const formulario = boton.closest('form');
      if (!formulario) return;
      const suma = function (nombre) {
        return Array.from(formulario.querySelectorAll(`input[name="${nombre}"]`))
          .reduce((total, input) => total + (Number(input.value) || 0), 0);
      };
      const bajada = formulario.querySelector('#contractedDownloadMbps');
      const subida = formulario.querySelector('#contractedUploadMbps');
      if (bajada) bajada.value = suma('wanDownload');
      if (subida) subida.value = suma('wanUpload');
    });
  });

  /* Dólar BCV: ventana flotante desde la esquina superior derecha. */
  document.querySelectorAll('[data-tasa]').forEach(function (caja) {
    const boton = caja.querySelector('[data-tasa-boton]');
    const panel = caja.querySelector('[data-tasa-panel]');
    const actualizar = caja.querySelector('[data-tasa-actualizar]');
    const textoBoton = caja.querySelector('[data-tasa-texto]');
    if (!boton || !panel) return;

    const abrir = function (visible) {
      panel.hidden = !visible;
      boton.setAttribute('aria-expanded', String(visible));
    };

    boton.addEventListener('click', function (evento) {
      evento.stopPropagation();
      abrir(panel.hidden);
    });

    document.addEventListener('click', function (evento) {
      if (panel.hidden || caja.contains(evento.target)) return;
      abrir(false);
    });

    document.addEventListener('keydown', function (evento) {
      if (evento.key === 'Escape' && !panel.hidden) {
        abrir(false);
        boton.focus();
      }
    });

    if (!actualizar) return;

    actualizar.addEventListener('click', async function () {
      caja.classList.add('is-cargando');
      actualizar.disabled = true;
      if (textoBoton) textoBoton.textContent = 'Consultando…';
      const aviso = caja.querySelector('[data-tasa-error]');
      const mostrarAviso = function (mensaje) {
        if (!aviso) return;
        aviso.textContent = mensaje || '';
        aviso.hidden = !mensaje;
      };
      mostrarAviso('');
      try {
        const respuesta = await fetch('/api/tasa/actualizar', { method: 'POST', headers: { Accept: 'application/json' } });
        const datos = await respuesta.json();
        if (datos.ok && !datos.stale) {
          const formateada = 'Bs ' + Number(datos.rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          caja.querySelectorAll('[data-tasa-valor]').forEach(function (valor) { valor.textContent = formateada; });
          const origen = caja.querySelector('[data-tasa-origen]');
          if (origen) {
            origen.textContent = datos.source || 'guardada';
            origen.className = 'insignia insignia--' + (datos.source === 'dolarapi' ? 'active' : 'pending');
          }
          const fecha = caja.querySelector('[data-tasa-fecha]');
          if (fecha && datos.updatedAt) {
            fecha.textContent = 'Actualizado: ' + new Date(datos.updatedAt).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
          }
          if (textoBoton) textoBoton.textContent = 'Actualizado';
          setTimeout(function () { if (textoBoton) textoBoton.textContent = 'Actualizar ahora'; }, 1800);
        } else {
          mostrarAviso(
            datos.error
              ? 'No se pudo actualizar: ' + datos.error + '. Se mantiene la última tasa guardada.'
              : 'No se pudo actualizar la tasa. Se mantiene la última guardada.'
          );
          if (textoBoton) textoBoton.textContent = 'Sin actualizar';
          setTimeout(function () { if (textoBoton) textoBoton.textContent = 'Actualizar ahora'; }, 2600);
        }
      } catch (error) {
        mostrarAviso('No hay conexión con el servidor. Se mantiene la última tasa guardada.');
        if (textoBoton) textoBoton.textContent = 'Sin conexión';
        setTimeout(function () { if (textoBoton) textoBoton.textContent = 'Actualizar ahora'; }, 2600);
      }
      caja.classList.remove('is-cargando');
      actualizar.disabled = false;
    });
  });

  /* Asistente: restaurar el botón flotante oculto en este navegador. */
  document.querySelectorAll('[data-asistente-restaurar]').forEach(function (boton) {
    boton.addEventListener('click', function () {
      try {
        window.localStorage.removeItem('crackentick-asistente-oculto');
      } catch (error) {
        /* sin almacenamiento */
      }
      window.location.reload();
    });
  });

  /* Balanceo: filas de WAN dinámicas. */
  document.querySelectorAll('[data-balanceo]').forEach(function (formulario) {
    const contenedor = formulario.querySelector('[data-balanceo-filas]');
    const plantilla = formulario.querySelector('[data-balanceo-plantilla]');
    const contador = formulario.querySelector('[data-balanceo-contador]');
    if (!contenedor || !plantilla) return;

    const actualizar = function () {
      const filas = contenedor.querySelectorAll('[data-balanceo-fila]');
      if (contador) contador.textContent = `${filas.length} WAN`;
      filas.forEach(function (fila) {
        const boton = fila.querySelector('[data-quitar-wan]');
        if (boton) boton.disabled = filas.length <= 2;
      });
    };

    formulario.querySelectorAll('[data-agregar-wan]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        const fila = plantilla.content.firstElementChild.cloneNode(true);
        contenedor.appendChild(fila);
        const primerCampo = fila.querySelector('input[name="wanGateway"]');
        if (primerCampo) primerCampo.focus();
        actualizar();
      });
    });

    contenedor.addEventListener('click', function (evento) {
      const boton = evento.target.closest('[data-quitar-wan]');
      if (!boton) return;
      if (contenedor.querySelectorAll('[data-balanceo-fila]').length <= 2) return;
      boton.closest('[data-balanceo-fila]').remove();
      actualizar();
    });

    actualizar();
  });
  document.querySelectorAll('[data-vendor-router]').forEach(function (selector) {
    const formulario = selector.closest('form');
    if (!formulario) return;
    const puerto = formulario.querySelector('#port');
    const aviso = formulario.querySelector('[data-vendor-aviso]');
    const bloqueCisco = formulario.querySelector('[data-vendor-cisco]');
    const etiquetaUsuario = formulario.querySelector('[data-vendor-usuario]');
    const ayudaPuerto = formulario.querySelector('[data-port-ayuda]');

    const actualizar = function () {
      const cisco = selector.value === 'cisco';
      if (aviso) aviso.textContent = cisco ? 'Cisco se conecta por SSH y queda en modo experimental.' : '';
      if (bloqueCisco) bloqueCisco.hidden = !cisco;
      if (etiquetaUsuario) etiquetaUsuario.textContent = cisco ? 'SSH' : 'API';
      if (ayudaPuerto) ayudaPuerto.textContent = cisco ? 'Cisco: 22 (SSH).' : 'MikroTik: 8728 (API) o 8729 con TLS.';
      if (puerto) {
        if (cisco && String(puerto.value) === '8728') puerto.value = '22';
        if (!cisco && String(puerto.value) === '22') puerto.value = '8728';
      }
    };

    selector.addEventListener('change', actualizar);
    actualizar();
  });

  /* ------------------------------------------------------------------
     Validación del navegador antes de enviar: enfoca la casilla exacta
     y evita perder lo escrito por un submit incompleto.
     ------------------------------------------------------------------ */
  document.querySelectorAll('form').forEach(function (formulario) {
    formulario.addEventListener('submit', function (evento) {
      if (evento.defaultPrevented) return;
      if (formulario.checkValidity()) return;
      evento.preventDefault();
      formulario.reportValidity();
      const invalido = formulario.querySelector(':invalid');
      if (invalido) {
        invalido.focus({ preventScroll: true });
        invalido.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  });

  /* Enfoca el primer campo con error del servidor al recargar el formulario. */
  const primerCampoError = document.querySelector('.campo--error input, .campo--error select, .campo--error textarea');
  if (primerCampoError) {
    primerCampoError.focus({ preventScroll: true });
    primerCampoError.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* ------------------------------------------------------------------
     Confirmación de acciones destructivas
     ------------------------------------------------------------------ */
  document.querySelectorAll('form[data-confirmar]').forEach(function (formulario) {
    formulario.addEventListener('submit', function (evento) {
      if (evento.defaultPrevented) return;
      const mensaje = formulario.getAttribute('data-confirmar') || '¿Confirmas esta acción?';
      if (!window.confirm(mensaje)) {
        evento.preventDefault();
      }
    });
  });

  /* ------------------------------------------------------------------
     Copiar comandos
     ------------------------------------------------------------------ */
  function copiarTexto(texto) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(texto);
    }
    return new Promise(function (resolver, rechazar) {
      try {
        const area = document.createElement('textarea');
        area.value = texto;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
        resolver();
      } catch (error) {
        rechazar(error);
      }
    });
  }

  document.querySelectorAll('[data-copiar]').forEach(function (boton) {
    boton.addEventListener('click', function () {
      const destino = document.querySelector(boton.getAttribute('data-copiar'));
      if (!destino) return;
      const texto = destino.textContent.trim();
      const original = boton.innerHTML;
      copiarTexto(texto).then(
        function () {
          boton.innerHTML = '<span aria-hidden="true">✓</span> Copiado';
          setTimeout(function () {
            boton.innerHTML = original;
          }, 1600);
        },
        function () {
          boton.innerHTML = '<span aria-hidden="true">!</span> No se pudo copiar';
          setTimeout(function () {
            boton.innerHTML = original;
          }, 1800);
        }
      );
    });
  });

  /* ------------------------------------------------------------------
     Mostrar / ocultar contraseña
     ------------------------------------------------------------------ */
  const botonOjo = document.getElementById('btnOjo');
  if (botonOjo) {
    botonOjo.addEventListener('click', function () {
      const campo = document.getElementById('password');
      if (!campo) return;
      const visible = campo.type === 'text';
      campo.type = visible ? 'password' : 'text';
      botonOjo.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
      campo.focus();
    });
  }

  /* ------------------------------------------------------------------
     Fondo animado del login: líneas que se deforman con el ratón
     ------------------------------------------------------------------ */
  const loginCanvas = document.getElementById('loginCanvas');
  if (loginCanvas && loginCanvas.getContext) {
    const ctx = loginCanvas.getContext('2d');
    const reducir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const puntero = { x: -9999, y: -9999, activo: false };
    let ancho = 0;
    let alto = 0;
    let lineas = [];
    let cuadro = 0;
    let tiempo = 0;

    function medirLienzo() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ancho = window.innerWidth;
      alto = window.innerHeight;
      loginCanvas.width = Math.round(ancho * dpr);
      loginCanvas.height = Math.round(alto * dpr);
      loginCanvas.style.width = ancho + 'px';
      loginCanvas.style.height = alto + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cantidad = Math.max(14, Math.min(34, Math.round(alto / 34)));
      lineas = Array.from({ length: cantidad }, function (_, indice) {
        return {
          base: (alto / (cantidad + 1)) * (indice + 1),
          amplitud: 18 + (indice % 5) * 9,
          frecuencia: 0.0016 + (indice % 7) * 0.00045,
          desfase: indice * 0.55,
          velocidad: 0.00022 + (indice % 4) * 0.00007,
          opacidad: 0.05 + (indice % 6) * 0.014,
          grosor: indice % 5 === 0 ? 1.5 : 1,
        };
      });
    }

    function dibujar() {
      ctx.clearRect(0, 0, ancho, alto);
      tiempo += reducir ? 0 : 1;

      lineas.forEach(function (linea) {
        // La cercanía del puntero incrementa la deformación de la línea.
        let cerca = 0;
        if (puntero.activo) {
          const distancia = Math.abs(puntero.y - linea.base);
          cerca = Math.max(0, 1 - distancia / 320);
          cerca = cerca * cerca;
        }

        ctx.beginPath();
        for (let x = -40; x <= ancho + 40; x += 22) {
          const ondaBase =
            Math.sin(x * linea.frecuencia + tiempo * linea.velocidad + linea.desfase) * linea.amplitud;
          const ondaPuntero = puntero.activo
            ? Math.sin(x * 0.006 - tiempo * 0.002) * 46 * cerca
            : 0;
          const atraccion = puntero.activo
            ? Math.exp(-Math.pow((x - puntero.x) / 260, 2)) * (puntero.y - linea.base) * 0.32 * cerca
            : 0;
          const y = linea.base + ondaBase + ondaPuntero + atraccion;
          if (x <= -40) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(124, 92, 255, ' + Math.min(0.6, linea.opacidad + cerca * 0.35) + ')';
        ctx.lineWidth = linea.grosor + cerca * 0.9;
        ctx.stroke();
      });

      cuadro = window.requestAnimationFrame(dibujar);
    }

    window.addEventListener('pointermove', function (evento) {
      puntero.x = evento.clientX;
      puntero.y = evento.clientY;
      puntero.activo = true;
    });
    window.addEventListener('pointerleave', function () {
      puntero.activo = false;
    });
    window.addEventListener('resize', medirLienzo);

    medirLienzo();
    if (reducir) {
      dibujar();
    } else {
      cuadro = window.requestAnimationFrame(dibujar);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        window.cancelAnimationFrame(cuadro);
      } else if (!reducir) {
        cuadro = window.requestAnimationFrame(dibujar);
      }
    });
  }

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', function () {
      const boton = loginForm.querySelector('button[type="submit"]');
      if (boton) {
        boton.disabled = true;
        boton.classList.add('is-cargando');
        boton.innerHTML = 'Entrando…';
      }
    });
  }

  /* ------------------------------------------------------------------
     Campos de conexión del servicio
     ------------------------------------------------------------------ */
  const selectorConexion = document.querySelector('[data-conexion]');
  if (selectorConexion) {
    const actualizarCampos = function () {
      const tipo = selectorConexion.value;
      const esPppoe = tipo === 'pppoe';
      document.querySelectorAll('[data-campo="pppoe"]').forEach(function (campo) {
        campo.hidden = !esPppoe;
        campo.querySelectorAll('input').forEach(function (input) {
          input.disabled = !esPppoe;
        });
      });
      document.querySelectorAll('[data-campo="ip-manual"]').forEach(function (campo) {
        campo.hidden = tipo !== 'static';
      });

      document.querySelectorAll('[data-campo="dhcp"]').forEach(function (campo) {
        campo.hidden = tipo !== 'dhcp';
        campo.querySelectorAll('input').forEach(function (input) {
          input.disabled = tipo !== 'dhcp';
        });
      });
    };
    selectorConexion.addEventListener('change', actualizarCampos);
    actualizarCampos();
  }

  /* ------------------------------------------------------------------
     Movimientos manuales: moneda y método de pago
     ------------------------------------------------------------------ */
  const tipoMovimiento = document.querySelector('[data-tipo-movimiento]');
  if (tipoMovimiento) {
    const monedaMovimiento = document.querySelector('[data-moneda-movimiento]');
    const metodoMovimiento = document.querySelector('[data-metodo-movimiento]');
    const requeridoMetodo = document.querySelector('[data-requerido-metodo]');
    const ayudaMetodo = document.querySelector('[data-ayuda-metodo]');
    const METODOS_INGRESO = {
      USD: ['cash', 'other'],
      VES: ['transfer', 'pago_movil', 'cash', 'other'],
    };

    const actualizarMetodo = function () {
      if (!monedaMovimiento || !metodoMovimiento) return;
      const esIngreso = tipoMovimiento.value === 'income';
      const codigo = monedaMovimiento.value;
      Array.from(metodoMovimiento.options).forEach(function (opcion) {
        if (!opcion.value) return;
        const monedas = (opcion.dataset.moneda || '').split(' ');
        const compatible = monedas.includes(codigo);
        const permitido = !esIngreso || (METODOS_INGRESO[codigo] || []).includes(opcion.value);
        opcion.hidden = !(compatible && permitido);
        opcion.disabled = !(compatible && permitido);
      });
      const elegida = metodoMovimiento.selectedOptions[0];
      if (elegida && elegida.disabled) metodoMovimiento.value = '';
      metodoMovimiento.required = esIngreso;
      if (requeridoMetodo) requeridoMetodo.hidden = !esIngreso;
      if (ayudaMetodo) {
        ayudaMetodo.textContent = esIngreso
          ? 'Obligatorio en ingresos: moneda y forma de pago.'
          : 'Opcional en gastos.';
      }
    };

    tipoMovimiento.addEventListener('change', actualizarMetodo);
    if (monedaMovimiento) monedaMovimiento.addEventListener('change', actualizarMetodo);
    actualizarMetodo();
  }

  /* ------------------------------------------------------------------
     Resumen de precio del plan en la contratación
     ------------------------------------------------------------------ */
  function datosMoneda() {
    const metaMoneda = document.querySelector('meta[name="moneda"]');
    const metaLocale = document.querySelector('meta[name="locale"]');
    return {
      moneda: metaMoneda ? metaMoneda.getAttribute('content') : 'USD',
      locale: metaLocale ? metaLocale.getAttribute('content') : 'es-VE',
    };
  }

  function formatearImporte(valor) {
    const { moneda, locale } = datosMoneda();
    const numero = Number(valor);
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: moneda,
        minimumFractionDigits: moneda === 'CLP' ? 0 : 2,
        maximumFractionDigits: moneda === 'CLP' ? 0 : 2,
      }).format(numero);
    } catch (error) {
      return `${moneda} ${numero.toFixed(2)}`;
    }
  }

  const planes = document.querySelectorAll('input[name="planId"][data-precio]');
  if (planes.length) {
    const resumenPlan = document.getElementById('resumenPlan');
    const resumenVelocidad = document.getElementById('resumenVelocidad');
    const resumenPrecio = document.getElementById('resumenPrecio');
    const resumenIntervalo = document.getElementById('resumenIntervalo');

    const actualizarResumen = function () {
      const elegido = document.querySelector('input[name="planId"]:checked');
      if (!elegido) return;
      const etiqueta = elegido.closest('.plan-opcion');
      const nombre = etiqueta ? etiqueta.querySelector('.plan-opcion__cabecera strong') : null;
      if (resumenPlan) resumenPlan.textContent = nombre ? nombre.textContent.trim() : '—';
      if (resumenVelocidad) resumenVelocidad.textContent = elegido.dataset.velocidad || '—';
      if (resumenPrecio) resumenPrecio.textContent = formatearImporte(elegido.dataset.precio || 0);
      if (resumenIntervalo) resumenIntervalo.textContent = elegido.dataset.intervalo || '—';
    };

    planes.forEach(function (radio) {
      radio.addEventListener('change', actualizarResumen);
    });
    actualizarResumen();
  }

  /* ------------------------------------------------------------------
     Contadores de caracteres
     ------------------------------------------------------------------ */
  document.querySelectorAll('[data-contador-de]').forEach(function (campo) {
    const id = campo.getAttribute('data-contador-de');
    const salida = document.querySelector(`[data-contador-para="${id}"]`);
    if (!salida) return;
    const maximo = Number(campo.getAttribute('maxlength')) || 0;
    const actualizar = function () {
      salida.textContent = `${campo.value.length}${maximo ? ` / ${maximo}` : ''}`;
    };
    campo.addEventListener('input', actualizar);
    actualizar();
  });

  /* ------------------------------------------------------------------
     Animaciones ligeras con Motion (motion.dev)
     Solo opacidad y transformaciones cortas; nunca se animan tablas completas.
     ------------------------------------------------------------------ */
  const Motion = window.Motion;
  const movimientoReducido =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CURVA = [0.22, 1, 0.36, 1];

  function animar(objetivo, keyframes, opciones) {
    if (!Motion || typeof Motion.animate !== 'function' || movimientoReducido || !objetivo) return null;
    try {
      return Motion.animate(objetivo, keyframes, Object.assign({ easing: CURVA }, opciones));
    } catch (error) {
      return null;
    }
  }

  function formatearContador(valor, formato) {
    const { moneda, locale } = datosMoneda();
    const numero = Number(valor) || 0;
    if (formato === 'moneda') {
      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: moneda,
          minimumFractionDigits: moneda === 'CLP' ? 0 : 2,
          maximumFractionDigits: moneda === 'CLP' ? 0 : 2,
        }).format(numero);
      } catch (error) {
        return `${moneda} ${numero.toFixed(2)}`;
      }
    }
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(numero));
    } catch (error) {
      return String(Math.round(numero));
    }
  }

  function animarEntrada() {
    if (!Motion || movimientoReducido || document.hidden) return;

    const bloques = document.querySelectorAll('.contenido > *');
    if (bloques.length) {
      animar(bloques, { opacity: [0, 1], y: [12, 0] }, {
        duration: 0.42,
        delay: Motion.stagger ? Motion.stagger(0.045) : 0,
      });
    }

    const marca = document.querySelector('.marca');
    if (marca) animar(marca, { opacity: [0, 1], y: [8, 0] }, { duration: 0.38 });

    const avisos = document.querySelectorAll('.aviso');
    if (avisos.length) {
      animar(avisos, { opacity: [0, 1], y: [-5, 0] }, {
        duration: 0.28,
        delay: Motion.stagger ? Motion.stagger(0.05) : 0,
      });
    }
  }

  function animarContadores() {
    if (movimientoReducido || document.hidden) return;
    document.querySelectorAll('[data-contador]').forEach(function (salida) {
      const objetivo = Number(salida.getAttribute('data-valor')) || 0;
      const formato = salida.getAttribute('data-formato') || 'entero';
      const inicio = performance.now();
      const duracion = 780;
      salida.textContent = formatearContador(0, formato);
      function paso(ahora) {
        const progreso = Math.min(1, (ahora - inicio) / duracion);
        const suave = 1 - Math.pow(1 - progreso, 4);
        salida.textContent = formatearContador(objetivo * suave, formato);
        if (progreso < 1) window.requestAnimationFrame(paso);
      }
      window.requestAnimationFrame(paso);
    });
  }

  function animarGraficos() {
    if (!Motion || movimientoReducido || document.hidden) return;

    const barras = document.querySelectorAll('.grafico__barra');
    if (barras.length) {
      animar(barras, { scaleY: [0, 1] }, {
        duration: 0.55,
        delay: Motion.stagger ? Motion.stagger(0.025) : 0,
      });
    }

    const dona = document.querySelector('[data-dona]');
    if (dona) {
      animar(dona, { scale: [0.9, 1], opacity: [0, 1] }, { duration: 0.5 });
      const leyenda = dona.closest('.dona-contenedor')?.querySelectorAll('.dona__leyenda li');
      if (leyenda && leyenda.length) {
        animar(leyenda, { opacity: [0, 1], x: [-7, 0] }, {
          duration: 0.3,
          delay: Motion.stagger ? Motion.stagger(0.05) : 0,
        });
      }
    }

    document.querySelectorAll('[data-progreso]').forEach(function (barra) {
      const destino = barra.style.width || '0%';
      animar(barra, { width: ['0%', destino] }, { duration: 0.7 });
    });
  }

  animarEntrada();
  animarContadores();
  animarGraficos();

  /* ------------------------------------------------------------------
     Importes, inventario y ventas
     ------------------------------------------------------------------ */
  function aNumero(valor) {
    const numero = Number(String(valor == null ? '' : valor).replace(',', '.'));
    return Number.isFinite(numero) ? numero : 0;
  }

  function formatearBps(valor) {
    const bps = Math.max(0, Number(valor) || 0);
    if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`;
    if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mbps`;
    if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} Kbps`;
    return `${Math.round(bps)} bps`;
  }

  function pintarImporte(elemento, valor) {
    if (elemento) elemento.textContent = formatearImporte(valor);
  }

  /* Formulario de venta: precio automático y totales en vivo. */
  const formVenta = document.querySelector('[data-form-venta]');
  if (formVenta) {
    const filas = formVenta.querySelectorAll('[data-linea-venta]');
    const mapaSeriales = (function () {
      const nodo = document.querySelector('[data-seriales-por-item]');
      if (!nodo) return {};
      try {
        return JSON.parse(nodo.textContent || '{}');
      } catch (error) {
        return {};
      }
    })();

    const nodoMac = document.querySelector('[data-mac-por-serial]');
    const mapaMac = (function () {
      if (!nodoMac) return {};
      try {
        return JSON.parse(nodoMac.textContent || '{}');
      } catch (error) {
        return {};
      }
    })();
    const macServicio = formVenta.querySelector('[data-mac-servicio]');

    /* La MAC del servicio se toma del serial elegido, salvo que se edite a mano. */
    const actualizarMacSeriales = function () {
      if (!macServicio) return;
      const seriales = Array.from(formVenta.querySelectorAll('[data-seriales-venta]'))
        .map((select) => select.value)
        .filter(Boolean);
      const mac = seriales.map((serial) => mapaMac[serial]).find(Boolean) || '';
      const automatica = macServicio.dataset.autoMac === '1' || macServicio.value.trim() === '';
      if (!automatica) return;
      macServicio.value = mac;
      macServicio.dataset.autoMac = '1';
    };
    if (macServicio) {
      macServicio.addEventListener('input', function () {
        macServicio.dataset.autoMac = '0';
      });
    }

    /* Seriales: solo se muestran para artículos serializados y se eligen de la lista. */
    const prepararSeriales = function (fila) {
      const item = fila.querySelector('[data-item-venta]');
      const celda = fila.querySelector('[data-celda-serial]');
      const select = fila.querySelector('[data-seriales-venta]');
      const vacio = fila.querySelector('[data-serial-no-aplica]');
      const cantidad = fila.querySelector('[data-cantidad-venta]');
      if (!item || !celda || !select) return;

      const pintar = function () {
        const opcion = item.selectedOptions[0];
        const serializado = Boolean(opcion && opcion.dataset.tipo === 'serial');
        const inicial = select.dataset.serialInicial || '';
        select.innerHTML = '';
        select.add(new Option('Elegir serial', ''));
        if (!serializado) {
          celda.classList.add('serial-celda--oculta');
          select.classList.add('serial-select--oculto');
          if (vacio) vacio.hidden = false;
          if (cantidad) cantidad.readOnly = false;
          return;
        }
        celda.classList.remove('serial-celda--oculta');
        select.classList.remove('serial-select--oculto');
        if (vacio) vacio.hidden = true;
        const lista = mapaSeriales[item.value] || [];
        lista.forEach(function (serial) {
          select.add(new Option(serial, serial));
        });
        if (inicial && lista.indexOf(inicial) === -1) select.add(new Option(inicial + ' (actual)', inicial));
        select.value = inicial || '';
        if (cantidad) {
          cantidad.value = 1;
          cantidad.readOnly = true;
        }
      };

      item.addEventListener('change', function () {
        select.dataset.serialInicial = '';
        pintar();
        actualizarTotales();
        actualizarMacSeriales();
      });
      select.addEventListener('change', actualizarMacSeriales);
      pintar();
      actualizarMacSeriales();
    };

    const actualizarFila = function (fila) {
      const item = fila.querySelector('[data-item-venta]');
      const cantidad = fila.querySelector('[data-cantidad-venta]');
      const precio = fila.querySelector('[data-precio-venta]');
      if (!item || !cantidad || !precio) return 0;
      const importe = aNumero(cantidad.value) * aNumero(precio.value);
      pintarImporte(fila.querySelector('[data-importe-venta]'), importe);
      return importe;
    };

    const actualizarTotales = function () {
      let materiales = 0;
      filas.forEach(function (fila) {
        materiales += actualizarFila(fila);
      });
      const instalacion = aNumero(formVenta.querySelector('[data-instalacion-venta]')?.value);
      const ivaPct = aNumero(formVenta.querySelector('[data-iva-venta]')?.value);
      const subtotal = materiales + instalacion;
      const iva = subtotal * (ivaPct / 100);
      pintarImporte(formVenta.querySelector('[data-total-materiales]'), materiales);
      pintarImporte(formVenta.querySelector('[data-total-instalacion]'), instalacion);
      pintarImporte(formVenta.querySelector('[data-total-subtotal]'), subtotal);
      pintarImporte(formVenta.querySelector('[data-total-iva]'), iva);
      pintarImporte(formVenta.querySelector('[data-total-final]'), subtotal + iva);
    };

    filas.forEach(function (fila) {
      const item = fila.querySelector('[data-item-venta]');
      const cantidad = fila.querySelector('[data-cantidad-venta]');
      const precio = fila.querySelector('[data-precio-venta]');
      if (item) {
        item.addEventListener('change', function () {
          const opcion = item.selectedOptions[0];
          if (opcion && opcion.value) {
            if (precio) precio.value = opcion.dataset.precio || 0;
            if (cantidad && opcion.dataset.tipo === 'serial') cantidad.value = 1;
          }
          actualizarTotales();
        });
      }
      [cantidad, precio].forEach(function (control) {
        if (control) control.addEventListener('input', actualizarTotales);
      });
      prepararSeriales(fila);
    });

    ['[data-instalacion-venta]', '[data-iva-venta]'].forEach(function (selector) {
      const control = formVenta.querySelector(selector);
      if (control) control.addEventListener('input', actualizarTotales);
    });

    actualizarTotales();
  }

  /* Formulario de factura de venta: líneas y totales. */
  const formFactura = document.querySelector('[data-form-factura-venta]');
  if (formFactura) {
    const filas = formFactura.querySelectorAll('[data-linea-factura]');

    const actualizarTotales = function () {
      let subtotal = 0;
      filas.forEach(function (fila) {
        const cantidad = aNumero(fila.querySelector('[data-cantidad-factura]')?.value);
        const precio = aNumero(fila.querySelector('[data-precio-factura]')?.value);
        const importe = cantidad * precio;
        subtotal += importe;
        pintarImporte(fila.querySelector('[data-importe-factura]'), importe);
      });

      const tipo = formFactura.querySelector('#discountType')?.value || 'none';
      const descuento = aNumero(formFactura.querySelector('#discount')?.value);
      let descuentoAplicado = 0;
      if (tipo === 'percent') descuentoAplicado = Math.min(subtotal, subtotal * (Math.min(descuento, 100) / 100));
      if (tipo === 'amount') descuentoAplicado = Math.min(subtotal, descuento);
      const base = subtotal - descuentoAplicado;
      const ivaPct = aNumero(formFactura.querySelector('[data-iva-factura]')?.value);
      const iva = base * (ivaPct / 100);

      pintarImporte(formFactura.querySelector('[data-factura-subtotal]'), subtotal);
      pintarImporte(formFactura.querySelector('[data-factura-iva]'), iva);
      pintarImporte(formFactura.querySelector('[data-factura-total]'), base + iva);
    };

    filas.forEach(function (fila) {
      const item = fila.querySelector('[data-item-factura]');
      const descripcion = fila.querySelector('input[name="description"]');
      const cantidad = fila.querySelector('[data-cantidad-factura]');
      const precio = fila.querySelector('[data-precio-factura]');
      if (item) {
        item.addEventListener('change', function () {
          const opcion = item.selectedOptions[0];
          if (opcion && opcion.value) {
            if (precio) precio.value = opcion.dataset.precio || 0;
            if (descripcion && !descripcion.value.trim()) descripcion.value = opcion.dataset.nombre || '';
            if (cantidad && aNumero(cantidad.value) === 0) cantidad.value = 1;
          }
          actualizarTotales();
        });
      }
      [cantidad, precio].forEach(function (control) {
        if (control) control.addEventListener('input', actualizarTotales);
      });
    });

    ['[data-iva-factura]', '#discount', '#discountType'].forEach(function (selector) {
      const control = formFactura.querySelector(selector);
      if (control) {
        control.addEventListener('input', actualizarTotales);
        control.addEventListener('change', actualizarTotales);
      }
    });

    actualizarTotales();
  }

  /* Inventario: alternar entre control por cantidad y serializado. */
  const selectorInventario = document.querySelector('[data-tipo-inventario]');
  if (selectorInventario) {
    const seccionSeriales = document.querySelector('[data-seccion-seriales]');
    const campoCantidad = document.querySelector('[data-campo-cantidad]');
    const actualizar = function () {
      const serial = selectorInventario.value === 'serial';
      if (seccionSeriales) seccionSeriales.hidden = !serial;
      if (campoCantidad) {
        campoCantidad.hidden = serial;
        const input = campoCantidad.querySelector('input');
        if (input) input.disabled = serial;
      }
    };
    selectorInventario.addEventListener('change', actualizar);
    actualizar();
  }

  /* Filtra pools por router en formularios de servicio y venta. */
  function conectarRouterPool(routerSelector, poolSelector) {
    const router = document.querySelector(routerSelector);
    const pool = document.querySelector(poolSelector);
    if (!router || !pool) return;
    const filtrar = function () {
      const elegido = router.value;
      Array.from(pool.options).forEach(function (opcion) {
        if (!opcion.value) return;
        const coincide = !elegido || !opcion.dataset.router || opcion.dataset.router === elegido;
        opcion.hidden = !coincide;
        opcion.disabled = !coincide;
      });
      const actual = pool.selectedOptions[0];
      if (actual && actual.disabled) pool.value = '';
    };
    router.addEventListener('change', filtrar);
    filtrar();
  }

  conectarRouterPool('[data-router-servicio]', '[data-pool-servicio]');
  conectarRouterPool('[data-router-venta]', '[data-pool-venta]');

  /* Tickets: mostrar solo servicios del cliente elegido. */
  const clienteTicket = document.querySelector('[data-cliente-ticket]');
  if (clienteTicket) {
    const servicioTicket = document.getElementById('subscriptionId');
    const filtrar = function () {
      if (!servicioTicket) return;
      const cliente = clienteTicket.value;
      Array.from(servicioTicket.options).forEach(function (opcion) {
        if (!opcion.value) return;
        const coincide = !cliente || opcion.dataset.cliente === cliente;
        opcion.hidden = !coincide;
        opcion.disabled = !coincide;
      });
      const actual = servicioTicket.selectedOptions[0];
      if (actual && actual.disabled) servicioTicket.value = '';
    };
    clienteTicket.addEventListener('change', filtrar);
    filtrar();
  }

  /* Selector de monitor de cliente. */
  const selectorMonitor = document.querySelector('[data-monitor-selector]');
  if (selectorMonitor) {
    selectorMonitor.addEventListener('change', function () {
      if (selectorMonitor.value) window.location.href = selectorMonitor.value;
    });
  }

  /* ------------------------------------------------------------------
     Monitorización WAN (polling del endpoint JSON)
     ------------------------------------------------------------------ */
  function construirPuntos(muestras, tope, ancho, alto, campo) {
    const lista = (muestras || []).slice(-40);
    if (lista.length < 2) return '';
    const maximo = Math.max(1, tope);
    return lista
      .map(function (muestra, indice) {
        const x = (indice / (lista.length - 1)) * ancho;
        const y = alto - Math.min(alto, (Number(muestra[campo]) || 0) / maximo * alto);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  const panelWan = document.querySelector('[data-monitor-wan]');
  if (panelWan) {
    const intervalo = Number(panelWan.getAttribute('data-intervalo')) || 5000;
    const apiWan = panelWan.getAttribute('data-api') || '/red/monitoreo/api/wan';
    let cargando = false;

    const pintar = function (data) {
      const tarjetas = document.querySelectorAll('[data-wan-card]');
      (data.wan || []).forEach(function (item) {
        let tarjeta = null;
        tarjetas.forEach(function (candidata) {
          if (candidata.dataset.router === item.routerId && candidata.dataset.wan === item.wan) tarjeta = candidata;
        });
        if (!tarjeta) return;
        const caida = item.status === 'down';
        tarjeta.classList.toggle('wan-card--down', caida);
        const estado = tarjeta.querySelector('[data-wan-estado]');
        if (estado) {
          estado.className = `insignia insignia--${caida ? 'overdue' : 'active'}`;
          estado.textContent = caida ? 'Caída' : 'En línea';
        }
        const rx = tarjeta.querySelector('[data-wan-rx]');
        const tx = tarjeta.querySelector('[data-wan-tx]');
        if (rx) rx.textContent = formatearBps(item.rx);
        if (tx) tx.textContent = formatearBps(item.tx);

        const rxExacto = tarjeta.querySelector('[data-wan-rx-exact]');
        const txExacto = tarjeta.querySelector('[data-wan-tx-exact]');
        const totalExacto = tarjeta.querySelector('[data-wan-total-exact]');
        const rxLegible = tarjeta.querySelector('[data-wan-rx-legible]');
        const txLegible = tarjeta.querySelector('[data-wan-tx-legible]');
        if (rxExacto) rxExacto.textContent = `${Number(item.rx || 0).toLocaleString('es-VE')} bps`;
        if (txExacto) txExacto.textContent = `${Number(item.tx || 0).toLocaleString('es-VE')} bps`;
        if (totalExacto) totalExacto.textContent = `${Number((item.rx || 0) + (item.tx || 0)).toLocaleString('es-VE')} bps`;
        if (rxLegible) rxLegible.textContent = formatearBps(item.rx);
        if (txLegible) txLegible.textContent = formatearBps(item.tx);

        const tope = Number(tarjeta.dataset.tope) || 1e6;
        const lineaRx = tarjeta.querySelector('[data-wan-linea-rx]');
        const lineaTx = tarjeta.querySelector('[data-wan-linea-tx]');
        if (lineaRx) lineaRx.setAttribute('points', construirPuntos(item.muestras, tope, 240, 60, 'rx'));
        if (lineaTx) lineaTx.setAttribute('points', construirPuntos(item.muestras, tope, 240, 60, 'tx'));
        const alerta = tarjeta.querySelector('[data-wan-alerta]');
        if (alerta) {
          alerta.textContent = item.alerta
            ? `Alerta activa desde ${new Date(item.alerta.startedAt).toLocaleString('es-VE')}.`
            : '';
        }
      });
    };

    const cargar = function () {
      if (cargando || document.hidden) return;
      cargando = true;
      fetch(apiWan, { headers: { Accept: 'application/json' } })
        .then(function (respuesta) {
          if (!respuesta.ok) throw new Error('Respuesta no válida');
          return respuesta.json();
        })
        .then(function (data) {
          if (data && data.ok) pintar(data);
        })
        .catch(function () {
          /* el siguiente ciclo reintenta */
        })
        .finally(function () {
          cargando = false;
        });
    };

    cargar();
    setInterval(cargar, intervalo);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) cargar();
    });

    /* Alternar entre vista de tarjetas y vista de bloques. */
    const selectorVista = document.querySelector('[data-wan-vista]');
    if (selectorVista) {
      const botones = selectorVista.querySelectorAll('[data-vista]');
      const aplicar = function (vista) {
        panelWan.classList.toggle('wan-grid--bloques', vista === 'bloques');
        botones.forEach(function (boton) {
          const activo = boton.dataset.vista === vista;
          boton.classList.toggle('is-activo', activo);
          boton.setAttribute('aria-pressed', String(activo));
        });
        try {
          window.localStorage.setItem('crackentick-wan-vista', vista);
        } catch (error) {
          /* almacenamiento no disponible */
        }
      };
      let inicial = 'tarjetas';
      try {
        inicial = window.localStorage.getItem('crackentick-wan-vista') || 'tarjetas';
      } catch (error) {
        inicial = 'tarjetas';
      }
      aplicar(inicial === 'bloques' ? 'bloques' : 'tarjetas');
      botones.forEach(function (boton) {
        boton.addEventListener('click', function () {
          aplicar(boton.dataset.vista);
        });
      });
    }
  }

  /* ------------------------------------------------------------------
     Monitorización puntual de un cliente (TTL 60 s)
     ------------------------------------------------------------------ */
  const monitorCliente = document.querySelector('[data-monitor-cliente]');
  if (monitorCliente) {
    const id = monitorCliente.dataset.subscription;
    const ttl = Number(monitorCliente.dataset.ttl) || 60000;
    const tope = Number(monitorCliente.dataset.tope) || 1e6;
    const base = monitorCliente.dataset.base || `/red/monitoreo/api/cliente/${id}`;
    const salidaRx = monitorCliente.querySelector('[data-monitor-rx]');
    const salidaTx = monitorCliente.querySelector('[data-monitor-tx]');
    const salidaTtl = monitorCliente.querySelector('[data-monitor-ttl]');
    const salidaMuestras = document.querySelector('[data-monitor-muestras]');
    const salidaModo = monitorCliente.querySelector('[data-monitor-modo]');
    const salidaEnlace = monitorCliente.querySelector('[data-monitor-enlace]');
    const estado = monitorCliente.querySelector('[data-monitor-estado]');
    const aviso = monitorCliente.querySelector('[data-monitor-aviso]');
    const lineaRx = monitorCliente.querySelector('[data-monitor-linea-rx]');
    const lineaTx = monitorCliente.querySelector('[data-monitor-linea-tx]');
    const botonDetener = document.querySelector('[data-monitor-detener]');
    const botonIniciar = document.querySelector('[data-monitor-iniciar]');
    let intervalo = null;
    let reloj = null;
    let ultimaLectura = Date.now();
    let activo = false;
    let finalizado = false;

    const pintar = function (lectura) {
      ultimaLectura = Date.now();
      if (salidaRx) salidaRx.textContent = formatearBps(lectura.rx);
      if (salidaTx) salidaTx.textContent = formatearBps(lectura.tx);
      if (salidaMuestras) salidaMuestras.textContent = String((lectura.muestras || []).length);
      if (lineaRx) lineaRx.setAttribute('points', construirPuntos(lectura.muestras, tope, 640, 140, 'rx'));
      if (lineaTx) lineaTx.setAttribute('points', construirPuntos(lectura.muestras, tope, 640, 140, 'tx'));
      if (salidaEnlace && lectura.link) salidaEnlace.textContent = lectura.link;
      if (salidaModo) {
        const real = lectura.modo === 'real';
        salidaModo.className = `insignia insignia--${real ? 'active' : 'pending'}`;
        salidaModo.textContent = real
          ? lectura.origen === 'queue'
            ? 'API real · cola'
            : lectura.origen === 'interface'
              ? 'API real · interfaz'
              : 'API real'
          : 'Modo simulado';
      }
    };

    const tick = function () {
      if (!salidaTtl) return;
      const restante = Math.max(0, ttl - (Date.now() - ultimaLectura));
      salidaTtl.textContent = `${Math.ceil(restante / 1000)} s`;
      if (restante <= 0 && activo) detener(false, 'La monitorización expiró por inactividad.');
    };

    const marcarDetenido = function (mensaje) {
      activo = false;
      if (intervalo) clearInterval(intervalo);
      if (reloj) clearInterval(reloj);
      intervalo = null;
      reloj = null;
      if (estado) {
        estado.className = 'insignia insignia--none';
        estado.textContent = 'Detenido';
      }
      if (aviso) {
        aviso.hidden = false;
        aviso.textContent = mensaje;
      }
      if (botonDetener) botonDetener.disabled = true;
      if (botonIniciar) botonIniciar.disabled = false;
    };

    function detener(manual, mensaje) {
      if (finalizado) return;
      finalizado = true;
      marcarDetenido(mensaje || 'Monitorización detenida. Pulsa «Iniciar lectura» para volver a consultar.');
      fetch(`${base}/detener`, { method: 'POST', headers: { Accept: 'application/json' } }).catch(function () {
        /* sin conexión: la sesión expirará sola */
      });
    }

    const leer = function () {
      if (!activo || document.hidden) return;
      fetch(`${base}/leer`, { headers: { Accept: 'application/json' } })
        .then(function (respuesta) {
          if (respuesta.status === 410) {
            marcarDetenido('La monitorización expiró por inactividad.');
            return null;
          }
          if (!respuesta.ok) throw new Error('Lectura no válida');
          return respuesta.json();
        })
        .then(function (lectura) {
          if (lectura && lectura.ok) pintar(lectura);
        })
        .catch(function () {
          /* el siguiente ciclo reintenta */
        });
    };

    const iniciar = function () {
      if (activo) return;
      if (botonIniciar) botonIniciar.disabled = true;
      if (aviso) aviso.hidden = true;

      fetch(`${base}/iniciar`, { method: 'POST', headers: { Accept: 'application/json' } })
        .then(function (respuesta) {
          if (!respuesta.ok) throw new Error('No se pudo iniciar');
          return respuesta.json();
        })
        .then(function (lectura) {
          if (!lectura || !lectura.ok) throw new Error('No se pudo iniciar');
          activo = true;
          finalizado = false;
          ultimaLectura = Date.now();
          if (estado) {
            estado.className = 'insignia insignia--active';
            estado.innerHTML = '<span class="punto punto--verde"></span> Monitoreando';
          }
          if (botonDetener) botonDetener.disabled = false;
          pintar(lectura);
          intervalo = setInterval(leer, 3000);
          reloj = setInterval(tick, 1000);
          tick();
        })
        .catch(function () {
          if (botonIniciar) botonIniciar.disabled = false;
          marcarDetenido('No se pudo iniciar la monitorización. Revisa la conexión e intenta de nuevo.');
        });
    };

    if (botonIniciar) {
      botonIniciar.addEventListener('click', iniciar);
    }

    if (botonDetener) {
      botonDetener.addEventListener('click', function () {
        detener(true);
      });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (intervalo) clearInterval(intervalo);
        intervalo = null;
      } else if (activo && !intervalo) {
        leer();
        intervalo = setInterval(leer, 3000);
      }
    });

    window.addEventListener('beforeunload', function () {
      if (activo && !finalizado && navigator.sendBeacon) {
        navigator.sendBeacon(`${base}/detener`);
        finalizado = true;
      }
    });
  }

  /* ------------------------------------------------------------------
     Pago de factura: moneda, método y equivalente en Bs
     ------------------------------------------------------------------ */
  function formatearBs(valor) {
    const numero = Number(valor);
    try {
      return new Intl.NumberFormat('es-VE', {
        style: 'currency',
        currency: 'VES',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number.isFinite(numero) ? numero : 0);
    } catch (error) {
      return `Bs ${Number.isFinite(numero) ? numero.toFixed(2) : '0.00'}`;
    }
  }

  const formPago = document.querySelector('[data-pago-form]');
  if (formPago) {
    const moneda = formPago.querySelector('[data-pago-moneda]');
    const metodo = formPago.querySelector('[data-pago-metodo]');
    const tasa = formPago.querySelector('#exchangeRate');
    const salidaBs = formPago.querySelector('[data-pago-total-bs]');
    const totalUsd = Number(formPago.dataset.totalUsd) || 0;

    const actualizarPago = function () {
      if (moneda && metodo) {
        Array.from(metodo.options).forEach(function (opcion) {
          if (!opcion.value) return;
          const coincide = opcion.dataset.moneda === moneda.value;
          opcion.hidden = !coincide;
          opcion.disabled = !coincide;
        });
        const seleccionada = metodo.selectedOptions[0];
        if (!metodo.value || (seleccionada && seleccionada.disabled)) metodo.value = '';
      }

      const rate = Number((tasa && tasa.value) || formPago.dataset.tasa) || 0;
      if (salidaBs) salidaBs.textContent = rate > 0 ? formatearBs(totalUsd * rate) : '—';
    };

    if (moneda) moneda.addEventListener('change', actualizarPago);
    if (tasa) tasa.addEventListener('input', actualizarPago);
    const botonTasa = formPago.querySelector('[data-tasa-editar]');
    const ayudaTasa = formPago.querySelector('[data-tasa-ayuda]');
    if (botonTasa && tasa) {
      botonTasa.addEventListener('click', function () {
        if (tasa.readOnly) {
          tasa.readOnly = false;
          botonTasa.textContent = 'Bloquear';
          botonTasa.setAttribute('aria-label', 'Bloquear la tasa de este cobro');
          if (ayudaTasa) ayudaTasa.textContent = 'Tasa manual solo para este cobro. Pulsa Bloquear para confirmarla.';
          tasa.focus();
          tasa.select();
        } else {
          const valor = Number(tasa.value);
          if (!Number.isFinite(valor) || valor <= 0) tasa.value = formPago.dataset.tasa || '';
          tasa.readOnly = true;
          botonTasa.textContent = 'Cambiar';
          botonTasa.setAttribute('aria-label', 'Cambiar la tasa de este cobro');
          if (ayudaTasa) ayudaTasa.textContent = 'Se toma la tasa BCV guardada. Pulsa Cambiar solo si necesitas otra tasa para este cobro.';
        }
        actualizarPago();
      });
    }
    actualizarPago();
  }

  /* ------------------------------------------------------------------
     Gráficos interactivos: tooltip del mes (dashboard y contabilidad)
     ------------------------------------------------------------------ */
  document.querySelectorAll('[data-grafico-interactivo]').forEach(function (grafico) {
    const columnas = grafico.querySelectorAll('[data-grafico-columna]');
    const resumen = grafico.parentElement.querySelector('[data-grafico-resumen]');
    const campos = resumen ? Array.from(resumen.querySelectorAll('[data-resumen]')) : [];
    const inicial = new Map(campos.map(function (campo) { return [campo.dataset.resumen, campo.textContent]; }));

    const pintarResumen = function (columna) {
      campos.forEach(function (campo) {
        const clave = campo.dataset.resumen;
        const valor = columna ? columna.dataset[clave] : '';
        campo.textContent = valor || inicial.get(clave);
      });
    };

    const cerrarOtras = function (excepto) {
      columnas.forEach(function (columna) {
        if (columna === excepto) return;
        columna.classList.remove('is-abierto');
        columna.setAttribute('aria-expanded', 'false');
      });
    };

    const alternar = function (columna) {
      const abierto = columna.classList.toggle('is-abierto');
      columna.setAttribute('aria-expanded', String(abierto));
      if (abierto) cerrarOtras(columna);
      pintarResumen(abierto ? columna : null);
    };

    columnas.forEach(function (columna) {
      columna.addEventListener('click', function () {
        alternar(columna);
      });
      columna.addEventListener('keydown', function (evento) {
        if (evento.key === 'Enter' || evento.key === ' ') {
          evento.preventDefault();
          alternar(columna);
        }
      });
    });

    document.addEventListener('click', function (evento) {
      if (!grafico.contains(evento.target)) {
        cerrarOtras(null);
        pintarResumen(null);
      }
    });
  });

  /* ------------------------------------------------------------------
     Imprimir / guardar como PDF
     ------------------------------------------------------------------ */
  document.querySelectorAll('[data-imprimir]').forEach(function (boton) {
    boton.addEventListener('click', function () {
      window.print();
    });
  });

  /* ------------------------------------------------------------------
     Marca la fila del formulario que se está guardando
     ------------------------------------------------------------------ */
  document.querySelectorAll('form').forEach(function (formulario) {
    formulario.addEventListener('submit', function (evento) {
      if (evento.defaultPrevented) return;
      const boton = formulario.querySelector('button[type="submit"]');
      if (!boton || boton.disabled) return;
      boton.disabled = true;
      boton.classList.add('is-cargando');
      boton.style.opacity = '0.7';
    });
  });

  /* ------------------------------------------------------------------
     Permisos: marcar un grupo activa todos sus nodos
     ------------------------------------------------------------------ */
  const seccionPermisos = document.querySelector('[data-seccion-permisos]');
  if (seccionPermisos) {
    const grupos = seccionPermisos.querySelectorAll('[data-grupo-permiso]');
    const nodos = seccionPermisos.querySelectorAll('[data-permiso-grupo]');

    const sincronizarGrupo = function (grupo) {
      const clave = grupo.dataset.grupoPermiso;
      const hijos = seccionPermisos.querySelectorAll(`[data-permiso-grupo="${clave}"]`);
      if (!hijos.length) return;
      const marcados = Array.from(hijos).filter(function (hijo) {
        return hijo.checked;
      }).length;
      grupo.checked = marcados === hijos.length;
      grupo.indeterminate = marcados > 0 && marcados < hijos.length;
    };

    grupos.forEach(function (grupo) {
      sincronizarGrupo(grupo);
      grupo.addEventListener('change', function () {
        const clave = grupo.dataset.grupoPermiso;
        seccionPermisos.querySelectorAll(`[data-permiso-grupo="${clave}"]`).forEach(function (hijo) {
          hijo.checked = grupo.checked;
        });
        grupo.indeterminate = false;
      });
    });

    nodos.forEach(function (nodo) {
      nodo.addEventListener('change', function () {
        const grupo = seccionPermisos.querySelector(`[data-grupo-permiso="${nodo.dataset.permisoGrupo}"]`);
        if (grupo) sincronizarGrupo(grupo);
      });
    });

    const rol = document.querySelector('[data-rol-usuario]');
    if (rol) {
      const alternarRol = function () {
        seccionPermisos.classList.toggle('is-deshabilitado', rol.value === 'admin');
      };
      rol.addEventListener('change', alternarRol);
      alternarRol();
    }
  }

  /* ------------------------------------------------------------------
     Interfaces WAN dinámicas en el formulario de router
     ------------------------------------------------------------------ */
  const filasWan = document.querySelector('[data-wan-rows]');
  const plantillaWan = document.getElementById('plantillaWan');
  if (filasWan && plantillaWan) {
    const renumerar = function () {
      filasWan.querySelectorAll('[data-wan-row]').forEach(function (fila, indice) {
        const numero = fila.querySelector('[data-wan-numero]');
        if (numero) numero.textContent = String(indice + 1);
      });
    };

    const agregarFila = function () {
      const clon = plantillaWan.content.firstElementChild.cloneNode(true);
      filasWan.appendChild(clon);
      renumerar();
      const primerCampo = clon.querySelector('input[name="wanName"]');
      if (primerCampo) primerCampo.focus();
    };

    document.querySelectorAll('[data-agregar-wan]').forEach(function (boton) {
      boton.addEventListener('click', agregarFila);
    });

    filasWan.addEventListener('click', function (evento) {
      const boton = evento.target.closest('[data-quitar-wan]');
      if (!boton) return;
      const fila = boton.closest('[data-wan-row]');
      if (!fila) return;
      if (filasWan.querySelectorAll('[data-wan-row]').length <= 1) {
        fila.querySelectorAll('input').forEach(function (campo) {
          campo.value = '';
        });
        return;
      }
      fila.remove();
      renumerar();
    });
  }

  /* ------------------------------------------------------------------
     Selector de pool → IP disponible por cliente
     ------------------------------------------------------------------ */
  document.querySelectorAll('[data-pool-servicio]').forEach(function (poolSelect) {
    const formulario = poolSelect.closest('form');
    if (!formulario) return;
    const ipSelect = formulario.querySelector('[data-ip-servicio]');
    const ipManual = formulario.querySelector('[data-ip-manual]');
    const ayudaIp = formulario.querySelector('[data-ip-ayuda]');
    const ayudaPool = formulario.querySelector('[data-pool-ayuda]');
    if (!ipSelect || !ipManual) return;

    const libre = formulario.hasAttribute('data-ip-manual-libre');
    let peticion = 0;

    const mostrarManual = function (mensaje) {
      if (libre) {
        ipSelect.hidden = false;
        ipSelect.disabled = true;
        ipSelect.innerHTML = '<option value="">Selecciona un pool</option>';
        ipManual.hidden = false;
        if (ayudaIp && mensaje) ayudaIp.textContent = mensaje;
        return;
      }
      ipSelect.hidden = true;
      ipSelect.disabled = true;
      ipManual.hidden = false;
      if (ayudaIp && mensaje) ayudaIp.textContent = mensaje;
    };

    const cargarIps = function () {
      const opcion = poolSelect.options[poolSelect.selectedIndex];
      const url = opcion && opcion.dataset.ipsUrl;
      if (!url) {
        mostrarManual('Sin pool: escribe la IP manualmente.');
        if (ayudaPool) ayudaPool.textContent = 'Sin pool seleccionado.';
        return;
      }

      const actual = String(ipSelect.dataset.ipActual || ipManual.value || '').trim();
      const token = ++peticion;
      ipSelect.hidden = false;
      ipManual.hidden = false;
      ipSelect.disabled = true;
      ipSelect.innerHTML = '<option value="">Cargando IPs disponibles…</option>';
      if (ayudaIp) ayudaIp.textContent = 'Consultando direcciones disponibles…';

      const destino = actual ? `${url}?actual=${encodeURIComponent(actual)}` : url;
      fetch(destino, { headers: { Accept: 'application/json' } })
        .then(function (respuesta) {
          if (!respuesta.ok) throw new Error('No se pudo leer el pool');
          return respuesta.json();
        })
        .then(function (datos) {
          if (token !== peticion) return;
          if (!datos || !datos.ok) throw new Error('Respuesta no válida');
          const ips = datos.ips || [];
          ipSelect.innerHTML = '';
          if (!ips.length) {
            const vacio = document.createElement('option');
            vacio.value = '';
            vacio.textContent = 'Sin IP disponibles';
            ipSelect.appendChild(vacio);
          } else {
            ips.forEach(function (ip) {
              const opcionIp = document.createElement('option');
              opcionIp.value = ip;
              opcionIp.textContent = ip;
              if (ip === actual) opcionIp.selected = true;
              ipSelect.appendChild(opcionIp);
            });
          }
          ipSelect.disabled = false;
          ipManual.hidden = libre ? false : true;
          ipManual.value = ipSelect.value || '';
          if (ayudaIp) {
            ayudaIp.textContent = `${datos.pool.name} · ${datos.pool.disponibles} IP(s) disponible(s) de ${datos.pool.total}`;
          }
          if (ayudaPool) ayudaPool.textContent = `${datos.pool.name} · ${datos.pool.cidr}`;
          ipSelect.dataset.ipActual = ipSelect.value || '';
        })
        .catch(function () {
          if (token !== peticion) return;
          mostrarManual('No se pudieron cargar las IP. Escribe una manualmente.');
          if (ayudaPool) ayudaPool.textContent = 'No se pudo consultar el pool.';
        });
    };

    poolSelect.addEventListener('change', function () {
      ipSelect.dataset.ipActual = '';
      ipManual.value = '';
      cargarIps();
    });

    const routerSelect = formulario.querySelector('[data-router-servicio], [data-router-venta]');
    if (routerSelect) {
      routerSelect.addEventListener('change', function () {
        ipSelect.dataset.ipActual = '';
        ipManual.value = '';
        cargarIps();
      });
    }

    ipSelect.addEventListener('change', function () {
      ipManual.value = ipSelect.value;
      ipSelect.dataset.ipActual = ipSelect.value;
    });

    if (poolSelect.value) {
      cargarIps();
    } else {
      mostrarManual('Selecciona un pool para elegir una IP disponible.');
    }
  });
})();

/* ==========================================================================
   Secciones plegables: cada tarjeta con cabecera se puede contraer.
   Las secciones de formulario sin campos obligatorios nacen plegadas para
   que la pantalla quede compacta; el estado se recuerda por página.
   ========================================================================== */
(function () {
  'use strict';

  const CLAVE = 'crackentick-plegado:';
  let contadorFormularios = 0;

  const secciones = Array.prototype.slice.call(document.querySelectorAll('section.tarjeta'));

  secciones.forEach(function (seccion, indice) {
    const cabecera = seccion.querySelector(':scope > .formulario__cabecera, :scope > .panel__cabecera');
    if (!cabecera || cabecera.querySelector('.seccion-toggle')) return;

    const esFormulario = seccion.classList.contains('formulario__seccion');
    const posicion = esFormulario ? contadorFormularios++ : -1;
    const titulo = ((cabecera.querySelector('h3, h2') || {}).textContent || 'seccion ' + indice).trim().slice(0, 48);
    const clave = CLAVE + location.pathname + ':' + titulo;

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'seccion-toggle';
    boton.setAttribute('aria-label', 'Mostrar u ocultar la sección');
    boton.innerHTML = '<span class="seccion-toggle__icono" aria-hidden="true"></span>';
    cabecera.appendChild(boton);

    const aplicar = function (plegado) {
      seccion.classList.toggle('is-plegado', plegado);
      boton.setAttribute('aria-expanded', String(!plegado));
      /* Al reabrir, los gráficos recuperan el tamaño real del contenedor. */
      if (!plegado) window.dispatchEvent(new Event('resize'));
    };

    boton.addEventListener('click', function () {
      const plegado = !seccion.classList.contains('is-plegado');
      aplicar(plegado);
      try {
        localStorage.setItem(clave, plegado ? '1' : '0');
      } catch (error) {
        /* sin almacenamiento disponible */
      }
    });

    let guardado = null;
    try {
      guardado = localStorage.getItem(clave);
    } catch (error) {
      guardado = null;
    }

    if (guardado === '1') {
      aplicar(true);
    } else if (guardado === null && esFormulario && posicion > 0 && !seccion.querySelector('[required]')) {
      aplicar(true);
    }
  });

  /* Si el navegador detecta un campo inválido en una sección plegada, se abre. */
  document.addEventListener(
    'invalid',
    function (evento) {
      const objetivo = evento.target;
      const seccion = objetivo && objetivo.closest ? objetivo.closest('section.is-plegado') : null;
      if (!seccion) return;
      seccion.classList.remove('is-plegado');
      const boton = seccion.querySelector('.seccion-toggle');
      if (boton) boton.setAttribute('aria-expanded', 'true');
    },
    true
  );
})();

/* Agenda: muestra solo el campo de duracion del modo elegido. */
(function () {
  document.querySelectorAll('[data-duracion]').forEach(function (formulario) {
    var selector = formulario.querySelector('[name="durationMode"]');
    if (!selector) return;
    var grupos = Array.prototype.slice.call(formulario.querySelectorAll('[data-duracion-grupo]'));
    var aplicar = function () {
      grupos.forEach(function (grupo) {
        var activo = grupo.getAttribute('data-duracion-grupo') === selector.value;
        grupo.hidden = !activo;
        grupo.querySelectorAll('input, select').forEach(function (campo) {
          campo.disabled = !activo;
        });
      });
    };
    selector.addEventListener('change', aplicar);
    aplicar();
  });
})();


/* Usuarios: aplica un preset de permisos al formulario. No guarda nada. */
(function () {
  var datos = document.querySelector('[data-presets-permisos]');
  if (!datos) return;
  var presets = [];
  try { presets = JSON.parse(datos.textContent || '[]'); } catch (error) { return; }
  var selector = document.querySelector('[data-preset-select]');
  var boton = document.querySelector('[data-preset-aplicar]');
  if (!selector || !boton) return;
  boton.addEventListener('click', function () {
    var preset = presets.filter(function (fila) { return fila.id === selector.value; })[0];
    if (!preset) return;
    document.querySelectorAll('select[name^="perm__"]').forEach(function (campo) {
      var clave = campo.name.slice(6).replace(/__/g, '.');
      var permisos = preset.permissions || [];
      campo.value = permisos.indexOf(clave) !== -1 ? 'editar' : (permisos.indexOf(clave + ':read') !== -1 ? 'ver' : 'none');
    });
  });
})();
