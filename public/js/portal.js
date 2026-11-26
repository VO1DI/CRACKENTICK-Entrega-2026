/* Portal de clientes: animaciones con Motion (motion.dev) y mejoras de UI. */
(function () {
  'use strict';

  var Motion = window.Motion;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var puedeAnimar = Motion && typeof Motion.animate === 'function' && !reduce;

  /* Temas del portal: oscuro, claro arena y claro lavanda. */
  var TEMAS = ['oscuro', 'claro', 'claro-suave'];
  var CLAVE_TEMA = 'crackentick-portal-tema';
  var ICONO_SOL = '<svg class="p-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  var ICONO_LUNA = '<svg class="p-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  function temaPortal() {
    var actual = document.documentElement.dataset.tema;
    return TEMAS.indexOf(actual) !== -1 ? actual : 'claro-suave';
  }

  function sincronizarTemaPortal() {
    var tema = temaPortal();
    document.querySelectorAll('[data-p-tema]').forEach(function (selector) {
      var boton = selector.querySelector('[data-p-tema-btn]');
      if (boton) {
        var icono = boton.querySelector('[data-p-tema-icono]');
        if (icono) icono.innerHTML = tema === 'oscuro' ? ICONO_SOL : ICONO_LUNA;
        var nombres = { oscuro: 'Oscuro', claro: 'Claro arena', 'claro-suave': 'Claro lavanda' };
        boton.setAttribute('title', 'Tema ' + nombres[tema]);
        boton.setAttribute('aria-label', 'Cambiar tema (actual: ' + nombres[tema] + ')');
      }
      selector.querySelectorAll('[data-p-tema-opcion]').forEach(function (opcion) {
        var activo = opcion.getAttribute('data-p-tema-opcion') === tema;
        opcion.classList.toggle('is-activo', activo);
        opcion.setAttribute('aria-checked', activo ? 'true' : 'false');
      });
    });
  }

  function aplicarTemaPortal(tema) {
    var elegido = TEMAS.indexOf(tema) !== -1 ? tema : 'claro-suave';
    document.documentElement.dataset.tema = elegido;
    try { localStorage.setItem(CLAVE_TEMA, elegido); } catch (error) { /* sin almacenamiento */ }
    sincronizarTemaPortal();
    if (document.querySelector('.p-user') && window.fetch) {
      window.fetch('/portal/preferencia-tema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ tema: elegido }),
      }).catch(function () { /* la preferencia local queda aplicada */ });
    }
  }

  document.querySelectorAll('[data-p-tema]').forEach(function (selector) {
    var boton = selector.querySelector('[data-p-tema-btn]');
    var menu = selector.querySelector('[data-p-tema-menu]');
    if (!boton || !menu) return;
    function cerrar() {
      menu.hidden = true;
      boton.setAttribute('aria-expanded', 'false');
    }
    boton.addEventListener('click', function (evento) {
      evento.stopPropagation();
      var abrir = menu.hidden;
      menu.hidden = !abrir;
      boton.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    });
    menu.addEventListener('click', function (evento) {
      var opcion = evento.target.closest('[data-p-tema-opcion]');
      if (!opcion) return;
      aplicarTemaPortal(opcion.getAttribute('data-p-tema-opcion'));
      cerrar();
    });
    document.addEventListener('click', function (evento) {
      if (!menu.hidden && !evento.target.closest('[data-p-tema]')) cerrar();
    });
    document.addEventListener('keydown', function (evento) {
      if (evento.key === 'Escape') cerrar();
    });
  });

  sincronizarTemaPortal();

  function animar(objetivo, keyframes, opciones) {
    if (!puedeAnimar || !objetivo) return null;
    try {
      return Motion.animate(objetivo, keyframes, opciones);
    } catch (error) {
      return null;
    }
  }

  /* Entradas de la pantalla de acceso. */
  animar('[data-motion="intro"]', { opacity: [0, 1], x: [-18, 0] }, { duration: 0.7, easing: [0.22, 1, 0.36, 1] });
  animar('[data-motion="panel"]', { opacity: [0, 1], y: [26, 0], scale: [0.98, 1] }, { duration: 0.7, delay: 0.12, easing: [0.22, 1, 0.36, 1] });

  var campos = document.querySelectorAll('[data-motion="form"] .p-field');
  if (campos.length) {
    animar(campos, { opacity: [0, 1], y: [12, 0] }, { duration: 0.45, delay: Motion && Motion.stagger ? Motion.stagger(0.07) : 0.2, easing: [0.22, 1, 0.36, 1] });
  }

  /* Entrada de tarjetas del panel. */
  document.querySelectorAll('[data-motion="stagger"]').forEach(function (grupo) {
    var hijos = grupo.children;
    if (!hijos.length) return;
    animar(hijos, { opacity: [0, 1], y: [16, 0] }, { duration: 0.5, delay: Motion && Motion.stagger ? Motion.stagger(0.06) : 0, easing: [0.22, 1, 0.36, 1] });
  });

  document.querySelectorAll('[data-motion="fade"]').forEach(function (elemento, indice) {
    if (!puedeAnimar) return;
    if (Motion && typeof Motion.inView === 'function') {
      Motion.inView(elemento, function () {
        if (elemento.dataset.motionVisto) return;
        elemento.dataset.motionVisto = '1';
        animar(elemento, { opacity: [0, 1], y: [14, 0] }, { duration: 0.5, delay: Math.min(indice * 0.03, 0.18), easing: [0.22, 1, 0.36, 1] });
      }, { margin: '0px 0px -10% 0px' });
    } else {
      animar(elemento, { opacity: [0, 1], y: [14, 0] }, { duration: 0.5, delay: Math.min(indice * 0.04, 0.24) });
    }
  });

  /* Botones con respuesta táctil. */
  document.querySelectorAll('.p-btn').forEach(function (boton) {
    boton.addEventListener('pointerdown', function () { animar(boton, { scale: 0.97 }, { duration: 0.12 }); });
    boton.addEventListener('pointerup', function () { animar(boton, { scale: 1 }, { duration: 0.18 }); });
    boton.addEventListener('pointerleave', function () { animar(boton, { scale: 1 }, { duration: 0.18 }); });
  });

  /* Orbes de fondo, muy lentos para no distraer. */
  document.querySelectorAll('.p-orb').forEach(function (orb, indice) {
    animar(orb, { x: [0, 26 + indice * 8], y: [0, -18 - indice * 6], scale: [1, 1.07] }, { duration: 9 + indice * 2, repeat: Infinity, direction: 'alternate', easing: 'ease-in-out' });
  });

  /* Mostrar u ocultar la clave. */
  document.querySelectorAll('[data-ver-clave]').forEach(function (boton) {
    boton.addEventListener('click', function () {
      var campo = document.getElementById(boton.getAttribute('data-objetivo'));
      if (!campo) return;
      var oculta = campo.type === 'password';
      campo.type = oculta ? 'text' : 'password';
      boton.textContent = oculta ? 'Ocultar' : 'Ver';
      boton.setAttribute('aria-label', oculta ? 'Ocultar clave' : 'Mostrar clave');
    });
  });

  /* Cerrar y desvanecer avisos. */
  function cerrarToast(toast) {
    if (!toast) return;
    if (puedeAnimar) {
      var salida = animar(toast, { opacity: [1, 0], x: [0, 18] }, { duration: 0.25 });
      if (salida && salida.finished) salida.finished.then(function () { toast.remove(); }).catch(function () { toast.remove(); });
      else toast.remove();
    } else {
      toast.remove();
    }
  }
  document.querySelectorAll('[data-toast]').forEach(function (toast) {
    var cerrar = toast.querySelector('[data-toast-cerrar]');
    if (cerrar) cerrar.addEventListener('click', function () { cerrarToast(toast); });
    setTimeout(function () { cerrarToast(toast); }, 6500);
  });

  /* Imprimir factura. */
  document.querySelectorAll('[data-imprimir]').forEach(function (boton) {
    boton.addEventListener('click', function () { window.print(); });
  });
})();
