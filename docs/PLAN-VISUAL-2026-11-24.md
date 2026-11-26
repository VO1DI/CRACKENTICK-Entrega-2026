# Plan visual CRACKENTICK — 24/11/2026

## Lo aplicado en esta ronda

1. **Tres temas de interfaz**
   - `oscuro` (predeterminado).
   - `claro` (arena cálida, el tema claro anterior).
   - `claro-suave` (lavanda/blanco, el lenguaje visual del portal de clientes).
   - Selector con muestra de color en la barra superior; se guarda en `localStorage` y se aplica antes de pintar para evitar parpadeos.

2. **Capa visual común (`public/css/rework.css`)**
   - Radios y sombras coherentes en tarjetas, KPIs y paneles.
   - Barra lateral con indicador activo, hover suave y separadores.
   - Cabecera con borde y transición de color entre temas.
   - Botones primarios con degradado y elevación mínima.
   - Campos con anillo de foco lavanda.
   - Tablas con cabecera tintada y hover de fila.
   - Chips, insignias y avisos unificados.

3. **Motion (motion.dev) en lugar de anime.js**
   - Entrada de secciones del contenido con opacidad y desplazamiento corto.
   - Animación de contadores con `requestAnimationFrame`.
   - Barras, dona, leyenda y progreso con Motion.
   - Límites: 12 elementos como máximo por página, 0,28–0,7 s, solo `opacity` y `transform`.
   - No se animan filas de tablas ni listas largas.
   - Se desactiva con `prefers-reduced-motion` y cuando la pestaña está oculta.
   - `anime.min.js` eliminado.

4. **Temas por usuario y por cliente**
   - El panel guarda el tema del usuario en `User.theme`; se aplica desde el servidor y se actualiza al elegir en el menú.
   - El portal guarda `Client.portalTheme`; el login usa `localStorage` y al entrar se aplica la preferencia del cliente.
   - El portal tiene su propio selector de tres temas.

5. **Fase 1 aplicada**
   - Contraste de `--faint` ajustado en los tres temas, foco visible y jerarquía de títulos.
   - Tablas de listado convertidas en tarjetas legibles en móvil.
   - Estados vacíos con icono, texto y fondo suave.

6. **Fase 2 aplicada**
   - Grupos del menú lateral plegables con estado recordado.
   - Migas de pan y cabecera con estilos más claros.
   - Acciones rápidas existentes (buscador, nuevo cliente, campana) integradas en la nueva cabecera.
   - Set de iconos existente reutilizado en todo el panel.

7. **Fase 3 aplicada**
   - Gráficos de consumo y economía leen los colores del tema activo y se actualizan al cambiarlo.
   - Filtros y paginación ya viven en la URL en las listas.
   - Modo compacto/amplio desde el menú de tema, persistido en el navegador.
   - Clase `.esqueleto` lista para cargas diferidas.

8. **Fase 4 aplicada**
   - Foco visible para teclado.
   - Confirmaciones nativas sin animación para no retrasar acciones críticas.
   - Tema por usuario y por cliente.
   - Portal documentado como estilo de referencia de la casa.

9. **Login del panel renovado**
   - Dos columnas con presentación del producto y tarjeta de acceso.
   - Fondo de rejilla, orbes, canvas de líneas reactivo y luz que sigue al puntero con Motion.
   - Menú de tema en el propio login para elegir Oscuro, Claro arena o Claro lavanda.
   - Entrada escalonada de marca, titular, características, tarjeta y campos.
   - En móvil se oculta el texto secundario para que el formulario quede primero.
   - Campos y contornos corregidos en los tres temas, en el panel y en el portal.

## Fases siguientes (mejora continua)

### Fase 1 — Consistencia fina
- Auditar la escala de espaciado (4/8/12/16/24/32) en las vistas con más formularios.
- Revisar títulos y subtítulos en las fichas de cliente, factura y ticket.
- Revisar contraste WCAG AA de cada tono en los tres temas.
- Añadir acciones principales a los estados vacíos que aún no las tienen.

### Fase 2 — Identidad y navegación
- Menú de acciones rápidas (Nuevo cliente, Nueva venta, Nuevo ticket) según permisos.
- Encabezado de dashboard con resumen del día y accesos directos.
- Terminar de unificar el set de iconos en las vistas antiguas.
- Mejoras de migas en las fichas con más de dos niveles.

### Fase 3 — Datos y gráficos
- Tarjetas de gráfico con título, subtítulo y enlace a su reporte.
- Usar `.esqueleto` en tablas/gráficos que consultan router o red.
- Revisar el modo compacto en pantallas muy pequeñas.

### Fase 4 — Detalle y accesibilidad
- Prueba completa de teclado en menús, modales y formularios.
- Animación de confirmación corta en acciones críticas, sin bloquear el guardado.
- Documentar el tema del portal como estilo de referencia para futuras pantallas.

## Reglas de rendimiento para no generar lag
- Animar solo `transform` y `opacity`; nunca `height`, `width` de bloques grandes ni `box-shadow` en listas.
- Máximo 12 elementos animados por carga.
- Nada de animaciones por fila en tablas o listas de más de 10 elementos.
- Respetar `prefers-reduced-motion` y `document.hidden`.
- No animar dentro de bucles de actualización de datos.

## Verificación por módulo
- Dashboard, clientes, ventas, inventario.
- Facturación y facturas.
- Tickets, agenda y tipos de tarea.
- Router, pools, IPAM, monitoreo.
- Usuarios, presets, empleados, gastos y configuración.
- Portal de clientes.
- Los tres temas en cada módulo y persistencia tras recargar.
