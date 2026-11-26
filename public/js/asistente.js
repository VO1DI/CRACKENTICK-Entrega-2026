(function () {
  var raiz = document.querySelector('[data-asistente]');
  if (!raiz) return;

  var CLAVE_ESQUINA = 'crackentick-asistente-esquina';
  var CLAVE_OCULTO = 'crackentick-asistente-oculto';

  function leer(clave) {
    try { return window.localStorage.getItem(clave); } catch (error) { return null; }
  }

  function guardar(clave, valor) {
    try { window.localStorage.setItem(clave, valor); } catch (error) { /* sin almacenamiento */ }
  }

  if (leer(CLAVE_OCULTO) === '1') {
    raiz.classList.add('is-oculto');
  }

  var burbuja = raiz.querySelector('[data-asistente-abrir]');
  var ocultarBtn = raiz.querySelector('[data-asistente-ocultar]');
  var panel = raiz.querySelector('[data-asistente-panel]');
  var cerrarBtn = raiz.querySelector('[data-asistente-cerrar]');
  var mensajes = raiz.querySelector('[data-asistente-mensajes]');
  var formulario = raiz.querySelector('[data-asistente-form]');
  var texto = raiz.querySelector('[data-asistente-texto]');
  var estado = raiz.querySelector('[data-asistente-estado]');
  var pendienteCaja = raiz.querySelector('[data-asistente-pendiente]');
  var pendienteResumen = raiz.querySelector('[data-asistente-resumen]');
  var confirmarBtn = raiz.querySelector('[data-asistente-confirmar]');
  var cancelarBtn = raiz.querySelector('[data-asistente-cancelar]');
  var vozBtn = raiz.querySelector('[data-asistente-voz]');
  var microfono = raiz.querySelector('[data-asistente-microfono]');
  var enviar = raiz.querySelector('[data-asistente-enviar]');

  var historial = [];
  var vozActiva = true;
  var saludado = false;
  var habilitado = false;
  var ocupado = false;

  function agregar(textoMensaje, tipo) {
    var bloque = document.createElement('div');
    bloque.className = 'asistente__mensaje asistente__mensaje--' + (tipo || 'bot');
    bloque.textContent = textoMensaje;
    mensajes.appendChild(bloque);
    mensajes.scrollTop = mensajes.scrollHeight;
    return bloque;
  }

  function limpiarParaVoz(texto) {
    return String(texto || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/https?:\/\/\S+/g, ' un enlace ')
      .replace(/[*_#>`|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
  }

  /** Prefiere una voz española local; suena menos robótica y no depende de la red. */
  function vozPreferida() {
    try {
      var voces = window.speechSynthesis.getVoices() || [];
      var espanol = voces.filter(function (voz) { return /^es/i.test(voz.lang); });
      var locales = espanol.filter(function (voz) { return voz.localService; });
      return locales[0] || espanol[0] || null;
    } catch (error) {
      return null;
    }
  }

  function hablar(textoMensaje) {
    if (!vozActiva || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var elegida = vozPreferida();
      var voz = new SpeechSynthesisUtterance(limpiarParaVoz(textoMensaje));
      voz.lang = elegida ? elegida.lang : 'es-VE';
      if (elegida) voz.voice = elegida;
      voz.rate = 0.98;
      voz.pitch = 1;
      window.speechSynthesis.speak(voz);
    } catch (error) {
      /* sin voz disponible */
    }
  }

  function actualizarVoz() {
    vozBtn.setAttribute('aria-pressed', String(vozActiva));
    vozBtn.classList.toggle('is-activo', vozActiva);
    if (!vozActiva && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  function abrir() {
    panel.hidden = false;
    burbuja.setAttribute('aria-expanded', 'true');
    texto.focus();
    if (!saludado) {
      saludado = true;
      var saludo = 'Hola. Soy el asistente de CRACKENTICK. Puedo consultar clientes, tickets, red, averías e instalaciones según tus permisos. ¿Qué necesitas?';
      agregar(saludo, 'bot');
      hablar(saludo);
    }
  }

  function cerrar() {
    panel.hidden = true;
    burbuja.setAttribute('aria-expanded', 'false');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  /* Arrastre con imán a las cuatro esquinas del contenido. */
  function limites() {
    var principal = document.querySelector('.app-main');
    var barra = document.querySelector('.topbar');
    var izquierda = principal ? principal.getBoundingClientRect().left : 0;
    var arriba = barra ? barra.getBoundingClientRect().bottom : 0;
    return {
      izquierda: izquierda + 16,
      derecha: Math.max(izquierda + 16, window.innerWidth - 16 - raiz.offsetWidth),
      arriba: arriba + 12,
      /* 48px libra el pie de página cuando la página es corta. */
      abajo: Math.max(arriba + 12, window.innerHeight - 48 - raiz.offsetHeight),
    };
  }

  function aplicarEsquina(esquina, animar) {
    if (!esquina) return;
    var caja = limites();
    var derecha = esquina.indexOf('derecha') !== -1;
    var abajo = esquina.indexOf('abajo') !== -1;
    raiz.classList.toggle('is-derecha', derecha);
    raiz.classList.toggle('is-arriba', !abajo);
    raiz.style.transition = animar ? '' : 'none';
    raiz.style.left = (derecha ? caja.derecha : caja.izquierda) + 'px';
    raiz.style.top = (abajo ? caja.abajo : caja.arriba) + 'px';
    raiz.style.bottom = 'auto';
    raiz.style.right = 'auto';
    if (!animar) {
      void raiz.offsetWidth;
      raiz.style.transition = '';
    }
  }

  function ocultarAsistente() {
    guardar(CLAVE_OCULTO, '1');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    cerrar();
    raiz.classList.add('is-oculto');
  }

  function mostrarAsistente() {
    guardar(CLAVE_OCULTO, '0');
    raiz.classList.remove('is-oculto');
    abrir();
  }

  var arrastre = { activo: false, movido: false, dx: 0, dy: 0, x: 0, y: 0 };
  var suprimirClic = false;

  burbuja.addEventListener('pointerdown', function (evento) {
    if (evento.button !== 0) return;
    var caja = raiz.getBoundingClientRect();
    arrastre.activo = true;
    arrastre.movido = false;
    arrastre.dx = evento.clientX - caja.left;
    arrastre.dy = evento.clientY - caja.top;
    arrastre.x = evento.clientX;
    arrastre.y = evento.clientY;
    try { burbuja.setPointerCapture(evento.pointerId); } catch (error) { /* sin captura */ }
  });

  burbuja.addEventListener('pointermove', function (evento) {
    if (!arrastre.activo) return;
    if (!arrastre.movido && Math.abs(evento.clientX - arrastre.x) < 4 && Math.abs(evento.clientY - arrastre.y) < 4) return;
    if (!arrastre.movido) {
      arrastre.movido = true;
      raiz.classList.add('is-arrastrando');
      if (!panel.hidden) cerrar();
    }
    var x = Math.min(Math.max(8, evento.clientX - arrastre.dx), window.innerWidth - raiz.offsetWidth - 8);
    var y = Math.min(Math.max(8, evento.clientY - arrastre.dy), window.innerHeight - raiz.offsetHeight - 8);
    raiz.style.left = x + 'px';
    raiz.style.top = y + 'px';
    raiz.style.bottom = 'auto';
    raiz.style.right = 'auto';
  });

  function terminarArrastre() {
    if (!arrastre.activo) return;
    arrastre.activo = false;
    raiz.classList.remove('is-arrastrando');
    suprimirClic = arrastre.movido;
    if (!arrastre.movido) return;
    var caja = raiz.getBoundingClientRect();
    var area = limites();
    var vertical = (caja.top + caja.height / 2) < (area.arriba + area.abajo) / 2 ? 'arriba' : 'abajo';
    var horizontal = (caja.left + caja.width / 2) < (area.izquierda + area.derecha) / 2 ? 'izquierda' : 'derecha';
    var esquina = vertical + '-' + horizontal;
    guardar(CLAVE_ESQUINA, esquina);
    aplicarEsquina(esquina, true);
  }

  burbuja.addEventListener('pointerup', terminarArrastre);
  burbuja.addEventListener('pointercancel', terminarArrastre);

  window.addEventListener('resize', function () {
    aplicarEsquina(leer(CLAVE_ESQUINA), false);
  });

  aplicarEsquina(leer(CLAVE_ESQUINA), false);

  function mostrarPendiente(resumen) {
    pendienteResumen.textContent = resumen || '';
    pendienteCaja.hidden = false;
  }

  function ocultarPendiente() {
    pendienteCaja.hidden = true;
    pendienteResumen.textContent = '';
  }

  async function consultarEstado() {
    try {
      var respuesta = await fetch('/asistente/estado', { headers: { Accept: 'application/json' } });
      var datos = await respuesta.json();
      habilitado = Boolean(datos.habilitado);
      estado.textContent = habilitado
        ? 'Modelo: ' + (datos.modelo || 'configurado')
        : 'Asistente desactivado en Configuración';
      if (!habilitado) {
        texto.disabled = true;
        enviar.disabled = true;
        microfono.disabled = true;
      }
    } catch (error) {
      estado.textContent = 'No se pudo comprobar el asistente';
    }
  }

  async function enviarMensaje(evento) {
    evento.preventDefault();
    if (ocupado || !habilitado) return;
    var contenido = texto.value.trim();
    if (!contenido) return;

    ocupado = true;
    enviar.disabled = true;
    texto.value = '';
    agregar(contenido, 'usuario');
    var espera = agregar('Pensando…', 'bot asistente__mensaje--espera');

    try {
      var respuesta = await fetch('/asistente/mensaje', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ mensaje: contenido, historial: historial }),
      });
      var datos = await respuesta.json();
      espera.remove();
      if (!respuesta.ok || datos.error) {
        agregar(datos.error || 'No pude responder ahora mismo.', 'bot');
        return;
      }
      agregar(datos.mensaje, 'bot');
      hablar(datos.mensaje);
      historial.push({ role: 'user', content: contenido });
      historial.push({ role: 'assistant', content: datos.mensaje });
      if (historial.length > 20) historial = historial.slice(-20);
      if (datos.pendiente) mostrarPendiente(datos.pendiente.resumen);
    } catch (error) {
      espera.remove();
      agregar('No se pudo conectar con el asistente.', 'bot');
    } finally {
      ocupado = false;
      enviar.disabled = false;
      texto.focus();
    }
  }

  async function confirmar() {
    if (ocupado) return;
    ocupado = true;
    try {
      var respuesta = await fetch('/asistente/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      var datos = await respuesta.json();
      if (!respuesta.ok || datos.error) {
        agregar(datos.error || 'No se pudo aplicar la acción.', 'bot');
        return;
      }
      ocultarPendiente();
      agregar(datos.mensaje, 'bot');
      hablar(datos.mensaje);
      if (datos.enlace) {
        var enlace = document.createElement('a');
        enlace.className = 'asistente__enlace';
        enlace.href = datos.enlace;
        enlace.textContent = 'Abrir el registro';
        mensajes.appendChild(enlace);
        mensajes.scrollTop = mensajes.scrollHeight;
      }
    } catch (error) {
      agregar('No se pudo confirmar la acción.', 'bot');
    } finally {
      ocupado = false;
    }
  }

  async function cancelarPendiente() {
    ocultarPendiente();
    agregar('Acción cancelada. No se cambió nada.', 'bot');
    try {
      await fetch('/asistente/cancelar', { method: 'POST', headers: { Accept: 'application/json' } });
    } catch (error) {
      /* sin conexión: la acción sigue pendiente en sesión */
    }
  }

  function dictar() {
    var Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Reconocimiento) {
      agregar('Este navegador no soporta dictado por voz.', 'bot');
      return;
    }
    var reconocimiento = new Reconocimiento();
    reconocimiento.lang = 'es-VE';
    reconocimiento.interimResults = false;
    reconocimiento.onresult = function (evento) {
      var dictado = evento.results[0][0].transcript;
      texto.value = dictado;
      texto.focus();
    };
    reconocimiento.onerror = function () {
      agregar('No pude escuchar el micrófono.', 'bot');
    };
    try {
      reconocimiento.start();
      microfono.classList.add('is-activo');
      reconocimiento.onend = function () { microfono.classList.remove('is-activo'); };
    } catch (error) {
      microfono.classList.remove('is-activo');
    }
  }

  burbuja.addEventListener('click', function () {
    if (suprimirClic) {
      suprimirClic = false;
      return;
    }
    if (panel.hidden) abrir();
    else cerrar();
  });
  cerrarBtn.addEventListener('click', cerrar);
  if (ocultarBtn) ocultarBtn.addEventListener('click', ocultarAsistente);
  document.querySelectorAll('[data-asistente-mostrar]').forEach(function (boton) {
    boton.addEventListener('click', mostrarAsistente);
  });
  formulario.addEventListener('submit', enviarMensaje);
  confirmarBtn.addEventListener('click', confirmar);
  cancelarBtn.addEventListener('click', cancelarPendiente);
  microfono.addEventListener('click', dictar);
  vozBtn.addEventListener('click', function () {
    vozActiva = !vozActiva;
    actualizarVoz();
  });
  texto.addEventListener('keydown', function (evento) {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      formulario.requestSubmit();
    }
  });

  actualizarVoz();
  consultarEstado();
})();
