/* Token CSRF: lo agrega a todos los formularios y a fetch de escritura. */
(function () {
  var meta = document.querySelector('meta[name="csrf-token"]');
  var token = meta ? meta.getAttribute('content') : '';
  if (!token) return;

  function agregar(form) {
    if (!form || String(form.method || 'get').toLowerCase() === 'get') return;
    if (form.querySelector('input[name="_csrf"]')) return;
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = '_csrf';
    input.value = token;
    form.appendChild(input);
  }

  document.querySelectorAll('form').forEach(agregar);
  document.addEventListener('submit', function (evento) { agregar(evento.target); }, true);

  var original = window.fetch;
  window.fetch = function (entrada, opciones) {
    opciones = opciones || {};
    var metodo = String(opciones.method || (entrada && entrada.method) || 'GET').toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].indexOf(metodo) === -1) {
      var cabeceras = new Headers(opciones.headers || (entrada && entrada.headers) || {});
      if (!cabeceras.has('X-CSRF-Token')) cabeceras.set('X-CSRF-Token', token);
      opciones.headers = cabeceras;
    }
    return original.call(this, entrada, opciones);
  };
})();
