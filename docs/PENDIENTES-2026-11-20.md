# Objetivos para la sesión del 20/11/2026

1. Seguir mejorando el aspecto visual del proyecto.
2. Dar al asistente IA una voz más humana y empezar las pruebas de voz.
3. Rehacer el seeder con todo lo nuevo y dejar menos clientes para simplificar las vistas.
4. Estadísticas por usuario según su cargo:
   - Hecho: Rendimiento por cargo en Empleados, con períodos de 7/30/90 días.
   - Soporte: tickets abiertos, resueltos y tiempo medio.
   - Técnicos: instalaciones y averías resueltas.
   - Ventas: ventas registradas e importe vendido.
   - Pendiente: ficha estable por usuario (hoy se cruza por nombre).
5. Pruebas generales y búsqueda de bugs o errores.
6. Botón en Routers para reparar/reaprovisionar toda la configuración:
   - Hecho: repone desde la base de datos VLANs, firewall, EOIP y balanceo ECMP, con respaldo previo.
   - Hecho: pestaña Respaldos con crear, listar, descargar, cargar al router y eliminar.
   - Pendiente: incluir PPPoE, address list y queues administrados por servicio.
   - Pendiente: respaldo binario `.backup` (restaurarlo reinicia el equipo) y descarga del archivo binario.
   - Cisco experimental: respaldo descargable, sin carga automática.

## Estado al cerrar

- IVA global con interruptor en Configuración → Facturación.
- Contabilidad con base Caja/Devengo y gráficos Chart.js.
- Notificaciones con Telegram.
- VLANs, firewall, EOIP y balanceo ECMP en Red, con selector de router.
- Balanceo con filas dinámicas de 2 a 256 WAN.
- Reparación de router desde Red → Routers con respaldo previo.
- Monitorización WAN con conexión API persistente.
- Routers con fabricante/modelo y Cisco experimental por SSH.
- Documentación, informe PDF y ZIP de laptop actualizados a v2.16.
