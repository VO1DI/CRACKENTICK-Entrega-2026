/* Recorre las páginas con sesión de admin y reporta respuestas >= 400.
   Uso: node pruebas/auditar-paginas.js [http://localhost:3000]
*/
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.argv[2] || process.env.APP_URL || 'http://localhost:3000';
const USUARIO = process.env.APP_USER || 'admin';
const CLAVE = process.env.APP_PASS || 'admin123';
const MAX = Number(process.env.MAX_PAGINAS || 160);
const SALTAR = /(salir|logout|descargar|exportar|imprimir|\/api\/tasa|\.pdf|\.csv|\.zip|\.rsc|\.backup)/i;

(async () => {
  let cookie = '';
  const previa = await fetch(`${BASE}/login`);
  const html = await previa.text();
  const token = (html.match(/name="csrf-token" content="([^"]+)"/) || [])[1] || '';
  const cookiePrevio = (previa.headers.getSetCookie?.() || [previa.headers.get('set-cookie')])
    .filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookiePrevio },
    body: new URLSearchParams({ usuario: USUARIO, password: CLAVE, _csrf: token }).toString(),
  });
  cookie = (login.headers.getSetCookie?.() || [login.headers.get('set-cookie')])
    .filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) {
    console.error('No se pudo iniciar sesión.');
    process.exit(1);
  }

  const pendientes = ['/'];
  const vistas = new Set();
  const resultados = [];
  let activas = 0;

  const pedir = async (ruta) => {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), 12000);
    try {
      const respuesta = await fetch(new URL(ruta, BASE), {
        headers: { cookie, Accept: 'text/html' },
        redirect: 'manual',
        signal: control.signal,
      });
      const cuerpo = await respuesta.text();
      return { status: respuesta.status, cuerpo, location: respuesta.headers.get('location') };
    } finally {
      clearTimeout(temporizador);
    }
  };

  const procesar = async (ruta) => {
    if (vistas.has(ruta) || resultados.length >= MAX) return;
    vistas.add(ruta);
    let datos;
    try {
      datos = await pedir(ruta);
    } catch (error) {
      resultados.push({ ruta, status: 0, error: error.message });
      return;
    }
    resultados.push({ ruta, status: datos.status, location: datos.location || '' });
    if (datos.status !== 200) return;
    const enlaces = [...datos.cuerpo.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => m[1]);
    for (const enlace of enlaces) {
      if (SALTAR.test(enlace)) continue;
      let url;
      try { url = new URL(enlace, new URL(ruta, BASE)); } catch { continue; }
      if (url.origin !== new URL(BASE).origin) continue;
      if (url.pathname === '/salir' || url.pathname === '/login') continue;
      const destino = `${url.pathname}${url.search}`;
      if (!vistas.has(destino) && pendientes.length < MAX * 2) pendientes.push(destino);
    }
  };

  while (pendientes.length && resultados.length < MAX) {
    const lote = pendientes.splice(0, 4);
    activas = lote.length;
    await Promise.all(lote.map((ruta) => procesar(ruta)));
    activas = 0;
  }

  const fallos = resultados.filter((fila) => fila.status === 0 || fila.status >= 400);
  const salida = path.join(__dirname, 'auditoria.json');
  fs.writeFileSync(salida, JSON.stringify({ base: BASE, total: resultados.length, fallos, resultados }, null, 2), 'utf8');

  console.log(`Páginas revisadas: ${resultados.length}`);
  console.log(`Con error: ${fallos.length}`);
  for (const fila of fallos) {
    console.log(`${fila.status || 'ERR'} ${fila.ruta}${fila.location ? ` -> ${fila.location}` : ''}${fila.error ? ` (${fila.error})` : ''}`);
  }
  console.log(`Detalle: ${salida}`);
  process.exit(fallos.length ? 1 : 0);
})();
