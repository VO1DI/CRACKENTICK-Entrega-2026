/* Entrada del login: animaciones cortas con Motion (motion.dev). */
(function () {
  'use strict';

  var Motion = window.Motion;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!Motion || typeof Motion.animate !== 'function' || reduce || document.hidden) return;

  var CURVA = [0.22, 1, 0.36, 1];

  function animar(objetivo, keyframes, opciones) {
    if (!objetivo) return null;
    try {
      return Motion.animate(objetivo, keyframes, Object.assign({ easing: CURVA }, opciones));
    } catch (error) {
      return null;
    }
  }

  animar('.marca--auth', { opacity: [0, 1], y: [-8, 0] }, { duration: 0.4 });
  animar('.login-hero__pill', { opacity: [0, 1], y: [8, 0] }, { duration: 0.35, delay: 0.06 });
  animar('.login-hero h1', { opacity: [0, 1], y: [16, 0] }, { duration: 0.55, delay: 0.12 });
  animar('.login-hero > p', { opacity: [0, 1], y: [12, 0] }, { duration: 0.45, delay: 0.2 });

  var caracteristicas = document.querySelectorAll('.login-hero__lista li');
  if (caracteristicas.length) {
    animar(caracteristicas, { opacity: [0, 1], y: [12, 0] }, {
      duration: 0.4,
      delay: Motion.stagger ? Motion.stagger(0.07) : 0.2,
    });
  }

  animar('[data-login="panel"]', { opacity: [0, 1], y: [22, 0], scale: [0.985, 1] }, {
    duration: 0.55,
    delay: 0.08,
  });

  var campos = document.querySelectorAll('[data-login="field"]');
  if (campos.length) {
    animar(campos, { opacity: [0, 1], y: [10, 0] }, {
      duration: 0.35,
      delay: Motion.stagger ? Motion.stagger(0.06) : 0.2,
    });
  }

  animar('[data-login="alerta"]', { opacity: [0, 1], y: [-6, 0] }, { duration: 0.3, delay: 0.1 });
  animar('[data-login="submit"]', { opacity: [0, 1], y: [8, 0] }, { duration: 0.35, delay: 0.28 });

  document.querySelectorAll('.login-orb').forEach(function (orb, indice) {
    animar(orb, { x: [0, 18 + indice * 6], y: [0, -14 - indice * 5], scale: [1, 1.06] }, {
      duration: 10 + indice * 2,
      repeat: Infinity,
      direction: 'alternate',
      easing: 'ease-in-out',
    });
  });

  /* Reacción suave al puntero: una luz y partículas con profundidad. */
  var luz = document.querySelector('[data-login-luz]');
  var particulas = Array.prototype.slice.call(document.querySelectorAll('[data-login-particula]'));
  if (luz || particulas.length) {
    var ultimo = 0;
    var pendiente = false;
    var puntero = { x: window.innerWidth / 2, y: window.innerHeight * 0.45 };

    function aplicarPuntero() {
      pendiente = false;
      var dx = puntero.x - window.innerWidth / 2;
      var dy = puntero.y - window.innerHeight * 0.45;
      animar(luz, { x: dx * 0.28, y: dy * 0.28 }, { duration: 0.7 });
      particulas.forEach(function (punto, indice) {
        var profundidad = 0.05 + indice * 0.018;
        animar(punto, { x: dx * profundidad, y: dy * profundidad }, { duration: 0.8 });
      });
    }

    window.addEventListener('pointermove', function (evento) {
      var ahora = Date.now();
      if (ahora - ultimo < 90) return;
      ultimo = ahora;
      puntero.x = evento.clientX;
      puntero.y = evento.clientY;
      if (!pendiente) {
        pendiente = true;
        window.requestAnimationFrame(aplicarPuntero);
      }
    }, { passive: true });
  }
})();
