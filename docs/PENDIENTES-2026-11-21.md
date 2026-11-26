# Objetivos para la sesión del 21/11/2026

## Prioridad 1 — Seeder reducido y coherente

**Listo para ejecutar, pendiente de confirmación** (`npm run seed -- --reset` borra la base actual).

1. Reducido a 40 clientes (antes 150).
2. Incluye lo nuevo de las últimas sesiones:
   - 3 zonas, 3 averías y 1 reporte de instalación.
   - 5 tickets con fechas coherentes y asignados a empleados reales.
   - 3 VLANs, 2 reglas de firewall, 1 EOIP, 1 balanceo ECMP de 3 WAN y 1 respaldo simulado en el router principal.
   - 6 empleados alineados con los usuarios y con el área correcta (`administracion`, `soporte`, `tecnicos`, `ventas`).
3. Corregido el tiempo medio negativo: los tickets ahora tienen `createdAt` explícito anterior a `resolvedAt` (24 h en los resueltos).
4. Probado en una base aparte (`crackentick_seed_test`) con Rendimiento mostrando 3 secciones y promedio positivo; la base de prueba se eliminó.

## Prioridad 2 — Rendimiento con vínculo estable

1. Hecho: `Employee.userId`, `Ticket.assigneeId`, `FaultReport.technicianId` e `InstallationReport.technicianId`, resolución por nombre al guardar y cruce por id en Rendimiento.
2. Hecho: selector de usuario en el formulario de empleado.
3. Hecho: pestañas Trabajadores / Pagos / Rendimiento, rango personalizado, selector de trabajador y sección de Cobranzas con pagos e importe.
4. Pendiente: usar selects de usuario en los formularios de ticket, avería e instalación (hoy se resuelve por el nombre escrito).

## Prioridad 3 — Completar reparación de router
1. Hecho: la reparación incluye PPPoE, address list y colas de cada servicio activo (máximo 200 por corrida).
2. Hecho: respaldo binario `.backup` por SSH/SFTP, descargable. La carga se deja manual (reinicia el equipo).
3. Cisco: VLANs, balanceo y respaldo descargable; sin reparación automática.

## Prioridad 4 — Pruebas generales

1. Hecho: 35 rutas en 200, permisos por rol con 403 correcto, 24 comprobaciones de alta/edición/borrado, integridad sin huérfanos ni duplicados y revisión visual en móvil.
2. Hecho: la auditoría y el historial del cliente muestran el nombre del usuario que hizo el cambio.
3. Pendiente: probar el asistente IA con un proveedor real y revisar tablas densas de Contabilidad en escritorio.

## Prioridad 5 — Pruebas profundas con GNS3 (al final)

1. Hecho: EOIP entre R1-CORE y R2-DIST, ping por el túnel 3/3.
2. Hecho: balanceo ECMP validado contra el CHR real (3 rutas creadas y eliminadas). Se corrigió el servicio: RouterOS 7 requiere una ruta por gateway.
3. Hecho: respaldo de texto creado, descargado (893 B) y eliminado; reparación de router con respaldo previo; monitorización WAN y su API en 200.
4. Hecho: topología con 2 routers (R1-CORE, R2-DIST) y 3 ONU de clientes; ONU-2 hace ping al router principal (ONU-1 y ONU-3 responden a su puerta pero no al núcleo; queda como detalle del laboratorio).
5. Hecho: la app gestiona el CHR **de GNS3** por API. El nodo se expone con una tarjeta en modo usuario de QEMU y reenvío `127.0.0.1:28728 -> :8728` (se añade en caliente desde el monitor de QEMU; GNS3 rechaza `-netdev` en las opciones del nodo). El reenvío se pierde al reiniciar el nodo.
6. Hecho: desde la app se aplicaron VLAN 150 en `ether8` (10.150.0.1/24), regla de firewall `forward drop tcp/3389`, túnel EOIP `eoip-gns3` y balanceo ECMP con 2 WAN; el reparar repuso 4/4 elementos y quedó en auditoría.
7. Pendiente: balanceo con varias WAN **físicas** en el laboratorio (el nodo NAT de GNS3 exige VMware).
8. Pendiente: limpiar la imagen base del CHR para que los nodos nuevos usen `ether2..ether5` sin restos (`vlan-clientes` 110 y reglas "morosos").

## Cierre

1. Actualizar documentación, informe PDF y ZIP de laptop.

## Notas de esta sesión

- Texto: se corrigió el mojibake en todo el proyecto (`ConexiÃ³n` → `Conexión`) y se revisaron acentos.
- Empleados: pestañas Trabajadores / Pagos / Rendimiento.
- Rendimiento: rango de fechas personalizado, selector de trabajador y sección de Cobranzas con pagos e importe.
- Clientes: 3 estados (activo, suspendido, retirado) y verificación de facturación.
- Suspensión: no se emiten facturas mientras el cliente esté suspendido o retirado; al reactivar, el período arranca de nuevo para no cobrar meses cortados.
- Borrado de clientes: bloqueado si hay historial; se sugiere marcarlo como retirado.
- Red: VLANs, firewall, EOIP y balanceo tienen edición y eliminación aplicadas al router.

---

## Futuro — quitar el modo simulado para producción

No hacer todavía. Cuando se decida, estos son los puntos que lo sostienen para poder retirarlo sin buscar a ciegas:

1. **Constante y validación:** `MODOS_FIREWALL = ['simulated', 'real']` en `config/constants.js`. Dejarla solo con `real` y quitar los `includes` de validación.
2. **Modelos:** `Router.mode`, `Settings.firewall.mode` y los `status: 'simulated'` de `Vlan`, `FirewallRule`, `EoipTunnel`, `BalanceConfig`. Revisar los `enum` de estado.
3. **Servicios con rama simulada** (10 archivos, 16 comprobaciones `mode !== 'real'`): `routerService`, `vlanService`, `routerConfigService`, `balanceService`, `experimentalService`, `backupService`, `firewallService`, `monitoringService`, `salesService`, `repairService`.
4. **Vistas y textos** (38 archivos, 151 menciones de “simulado”): sidebar (indicador), Routers (formulario y tarjetas), Red (avisos de cada pestaña), Configuración → Firewall, dashboard y modo de sesión.
5. **Seeder:** cambiar el router del CHR a `real` y quitar el aviso de “Firewall simulated” del resumen.
6. **Rendimiento/estadísticas:** revisar los textos que digan “simulado” en los estados de reparación y respaldo.
7. **Pruebas:** el laboratorio GNS3 sustituye al modo simulado para probar sin tocar equipos reales. Antes de retirarlo, validar EOIP, balanceo, respaldos y reparación contra los CHR.

Orden sugerido: primero los servicios y modelos, luego las vistas, y al final el seeder y la documentación. Un commit por capa para poder revertir.

## Estado al cerrar el 20/11/2026

- IVA global con interruptor en Configuración → Facturación.
- Contabilidad Caja/Devengo con gráficos Chart.js.
- Notificaciones con Telegram y filtros por permiso.
- Red con router primero: VLANs, Firewall, EOIP, Balanceo y **Respaldos**.
- Balanceo ECMP de 2 a 256 WAN con filas dinámicas.
- Reparación de router desde Routers, con respaldo previo de las secciones de red.
- Respaldos por SSH (`export hide-sensitive` / `/import`) con descarga y carga al equipo.
- Grupo **Avanzado** en el menú y en los permisos por usuario.
- **Rendimiento por cargo** en Empleados con períodos de 7/30/90 días.
- Asistente: burbuja arrastrable con imán a las esquinas, botón para ocultar y recuperar desde la barra superior, voz española local.
- GNS3 2.2.61 operativo con HAXM y Npcap; laboratorio `CRACKENTICK-Lab` con dos CHR enlazados y ping verificado.
- Documentación, PDF y ZIP de laptop actualizados a v2.16.

## Entorno

- App: `node server.js` en `http://localhost:3000` (admin / admin123). MongoDB como servicio de Windows.
- CHR del host: API `127.0.0.1:8728` con `crackentick-api` / `CAMBIAR_CLAVE_CHR`; admin `CAMBIAR_CLAVE_ADMIN`; SSH publicado en `127.0.0.1:2222` y `sshPort=2222` guardado en su ficha.
- GNS3: servidor en `127.0.0.1:3080`, proyecto `CRACKENTICK-Lab`, consola de R1-CORE en 5002 y R2-DIST en 5000, credenciales `admin` / `CAMBIAR_CLAVE_ADMIN`.
- CHR de GNS3 en la app: ficha `GNS3 R1-CORE`, host `127.0.0.1`, puerto `28728` (`crackentick-api` / `CAMBIAR_CLAVE_CHR`). El puerto existe mientras el nodo tenga la tarjeta en modo usuario añadida por el monitor de QEMU.
- SSH: `services/mikrotikSsh.js` ya respalda y restaura; `ssh.ejecutar(router, comandos)` envía comandos a la consola y devuelve la salida (probado contra el CHR del host en `127.0.0.1:2222`). Los aprovisionamientos siguen usando la API.
- TLS: probado contra el CHR del host en `127.0.0.1:8729` (ficha `CHR TLS 8729`). RouterOS exige crear un certificado y asignarlo a `api-ssl`; sin certificado rechaza el saludo. Con certificado autofirmado hay que dejar **desmarcado** «verificar certificado»; al marcarlo la prueba falla con un aviso claro. Para validar de verdad hace falta un certificado de una CA (la app aún no permite cargar la CA; `NODE_EXTRA_CA_CERTS` sirve como apaño).
- Imagen GNS3: `%USERPROFILE%\GNS3\images\QEMU\chr-7.20.2.qcow2` (y `-b.qcow2` para el segundo nodo).
- Sin repositorio git: los cambios viven en la carpeta del proyecto.
- Respaldos: `CRACKENTICK-laptop.zip` e informe PDF en el Escritorio.

## Actualización 2026-11-22

1. Hecho: secciones plegables en todas las tarjetas con cabecera. Las secciones de formulario nacen plegadas (salvo la primera y las que tienen campos obligatorios) y el estado se recuerda por página.
2. Hecho: panel de inicio más compacto y con más presencia (tarjetas con degradado, cifras mayores, hover) y ajustes para móvil.
3. Hecho: en la venta e instalación, el serial se elige de un desplegable con los seriales disponibles del artículo; la columna desaparece si el artículo no es serializado. El servidor rechaza seriales vacíos, ajenos o ya usados.
4. Hecho: documento `docs/INVESTIGACION-MIKROWISP-WISPRO.md` con la comparación y la factibilidad de registro de IPs, consumo diario, hotspot, RADIUS, OLT y portal del cliente.
5. Multimodo: PPPoE e IP estática completos; **DHCP está a medias** (se trata como IP fija y no se crea la reserva de lease porque no se guarda la MAC).
6. Pendiente: implementar registro de IPs, consumo diario y portal del cliente (ver el documento de investigación).

## Próxima sesión (2026-11-23)

### 1. Arreglo previo
- “Reparar router” devuelve 500 si el equipo no responde: el respaldo previo se ejecuta fuera del manejo de errores. Debe responder un mensaje claro y no romper la página.

### 2. Respaldos: aplicar uno existente y crear en cualquier momento
- **Aplicar respaldo con selección:** el modo “Aplicar respaldo” debe listar los respaldos guardados de ese router (fecha, formato `rsc`/`backup`, tamaño, autor) y aplicar el elegido, no solo regenerar desde la base de datos.
  - `.rsc`: subir por SFTP y ejecutar `/import file-name=...` por SSH.
  - `.backup` binario: subir y ejecutar `/system backup load name=...` (pide confirmación y reinicia).
  - Mantener el respaldo previo automático antes de aplicar.
  - Solo MikroTik de red; en Cisco no hay restauración automática.
- **Crear respaldo nuevo cuando se quiera:** botón en la ficha del router y en Respaldos para tomar la configuración completa en ese momento.
  - Texto: `/export verbose` (y `/export show-sensitive` si se decide guardar secretos).
  - Binario: `/system backup save name=...` y descarga por SFTP.
  - Registrar autor, fecha y resultado en auditoría.
- Revisar retención: cuántos respaldos se guardan por router y si se pueden borrar.

### 3. Agenda de tareas (técnicos y empleados)
- Modelo de tarea: título, descripción, asignado, fecha/hora, prioridad, estado (`pendiente`, `en curso`, `hecha`), cliente/servicio opcional y notas.
- Administradores: crear, asignar, reprogramar y tablero por día/semana.
- Empleado: marcar inicio/fin y comentario.

### 4. Portal del cliente
- Autenticación separada (cédula o código + clave), límite de intentos.
- Ver facturas pendientes y total adeudado.
- Crear y consultar tickets de soporte.
- Permisos propios; no reutilizar la sesión del personal.

### 5. Pruebas con Cisco emulado
- Requiere una imagen IOS/IOSv/ASAv (licencia); sin imagen no se puede montar el nodo. Si aparece, ponerla en `C:\Users\Jcrac\GNS3\images\` y crear el nodo.
- Matriz de pruebas por SSH (Cisco no usa API ni TLS):
  - prueba de conexión y lectura de `show version` / interfaces;
  - respaldo de configuración y descarga;
  - balanceo por defecto (`ip route`);
  - reparación (hoy no soportada en Cisco);
  - errores y reconexión.
- Aclarar en la ficha que Cisco es SSH, no API; TLS aplica solo a MikroTik.

### 6. Eliminar el modo simulado
- Quitar `simulated` del modelo de router y dejar `real` como único modo.
- Eliminar las ramas de simulación en servicios, controladores y vistas (incluidos textos y filtros de “modo”).
- Revisar el modo de firewall simulado en Configuración y la monitorización simulada.
- **Seeder:** dejar de crear routers y datos simulados; conservar solo catálogos base necesarios (planes, usuarios, configuración).
- Decidir qué hacer con routers ya guardados como simulados: borrarlos o convertirlos (documentar antes de migrar).

### 7. Aprovisionamiento masivo de servicios
- Al usar el seeder, los clientes existen en el sistema pero sus PPPoE, IP, colas y address list no están en el router.
- Crear una acción “Aprovisionar servicios” (en el router o en Red) que:
  - liste los servicios pendientes con filtros por router, plan, zona y estado;
  - muestre el conteo antes de ejecutar;
  - ejecute por lotes con concurrencia limitada, respetando el transporte API/SSH;
  - sea idempotente (no duplica PPPoE, colas ni direcciones);
  - muestre resumen de creados, actualizados y fallidos, con opción de reintentar;
  - registre todo en auditoría y permita cortar el proceso.
- Definir un tope por lote y una pausa entre lotes para no saturar el router.

## Actualización 2026-11-23

1. Hecho: “Reparar router” ya no devuelve 500 si el equipo no responde; informa el fallo en pantalla.
2. Hecho: respaldos.
   - La acción “Aplicar respaldo” abre la lista del router para **elegir** el respaldo; también permite reconstruir desde la base de datos.
   - Se puede **crear un respaldo en cualquier momento** desde la ficha del router y desde Respaldos (texto y binario).
   - Se implementó la carga de respaldos **binarios** (`.backup`) por SFTP + `/system backup load`, avisando del reinicio.
3. Hecho: modo simulado eliminado.
   - `MODOS_FIREWALL` queda solo en `real`; router y configuración migrados a real.
   - Fuera el selector de modo del router, el filtro de la lista y el selector de modo firewall en Configuración.
   - El seeder ya **no crea routers** ni VLAN/firewall/EOIP/balanceo/respaldo de ejemplo; los servicios quedan sin router y pendientes de aprovisionar.
   - Probado el seeder en una base limpia: 0 routers, 4 pools, 38 servicios, 40 clientes.
4. Hecho: **aprovisionamiento masivo** por router (botón en la ficha). Procesa lotes de 25, asigna los servicios sin router, crea PPPoE/IP/colas/address list y es idempotente. Muestra el conteo pendiente y permite reaprovisionar los ya aplicados.
5. Pendiente: probar el lote contra un router real (el CHR estaba apagado y no había pendientes en la base actual).
6. Pendiente: Cisco emulado (falta imagen), agenda de tareas y portal del cliente.
7. Pendiente menor: quedan ramas internas de simulación ya inalcanzables y el campo `simulated` en respaldos antiguos; se pueden podar en una limpieza posterior.
8. Hecho: **agenda de tareas**.
   - Modelo `WorkTask` con título, descripción, responsable, fecha/hora, prioridad, estado, ubicación y notas.
   - Administradores crean, asignan, editan, cancelan, reabren y eliminan.
   - Cada persona ve solo sus tareas, las empieza y las termina; se guardan hora de inicio y de cierre.
   - Permiso nuevo `agenda.gestion`; el seeder lo asigna al técnico.
   - Probado: creación, inicio, cierre, vista de empleado (solo sus tareas, sin botón de crear) y bloqueo de tareas ajenas.
9. Hecho: **portal del cliente**.
   - Acceso separado en `/portal` con código de cliente y clave; límite de intentos y sesión regenerada al entrar.
   - Ve deuda total, facturas pendientes, su plan y sus tickets; puede crear tickets de soporte.
   - Desde la ficha del cliente se habilita, restablece o deshabilita el acceso; la clave se muestra una sola vez.
   - Probado: habilitar, login, estado de cuenta, creación de ticket, sin sesión redirige al login.
10. Pendiente: probar agenda y portal con datos reales del cliente, Cisco emulado (imagen) y aprovisionamiento masivo contra un router encendido.
11. Hecho: la agenda también está disponible para soporte (`agenda.gestion` en el seeder y en la base actual), para ver tareas como cambio de IP pública o desbaneo.
12. Hecho: tipo de tarea en la agenda (instalación, soporte, cambio de IP pública, desbaneo de IP, mantenimiento, otro), visible en el listado.
13. Hecho: portal del cliente rediseñado: cabecera con saldo pendiente, tarjeta “Mi servicio”, ayuda para abrir ticket y tablas más simples.
14. Hecho: métricas de agenda en el rendimiento de técnicos: tareas asignadas, hechas, en curso, tiempo medio real (inicio→fin) y desglose por tipo (IP pública, desbaneo, instalación, etc.), en los indicadores, la ficha del trabajador y las tablas por área.
15. Hecho: aprovisionamiento masivo probado contra el CHR real por SSH: 2 de 2 servicios PPPoE creados (secret y cola) y verificados; luego se limpiaron y las suscripciones volvieron a su router.
16. Hecho: prueba masiva real: 27 servicios PPPoE en dos lotes (25/25 en 784 s y 2/2 en 63 s), con “quedan 2” correcto. Todo por SSH y luego limpiado.
17. Hecho: clientes cortados en el lote. El secret queda creado y deshabilitado, y la IP entra en MOROSOS (1 entrada). Una segunda pasada no duplica ni el secret ni la entrada.
18. Hecho: respaldos por router. La vista general agrupa por equipo con su nombre; se crean y descargan desde la ficha y desde la lista. Al aplicar un `.rsc` el router rechazó objetos duplicados (`already have interface with such name`) y el sistema reportó el error real; para restauración completa conviene un router limpio o el respaldo binario.
19. Hecho: respaldo del sistema con rclone.
   - Pestaña “Respaldos del sistema” en Configuración (solo administrador): remoto, carpeta, día, hora y activar/desactivar.
   - Exporta toda la base a JSON, la comprime en `.tar.gz` y la sube a `{remoto}:{carpeta}/{Mes}-{Año}/`.
   - Barra de porcentaje en vivo, botón manual y “Probar conexión”.
   - Programador cada minuto: domingo a la hora configurada, sin repetir el mismo día.
   - Probado: `gdrive:CRACKENTICK-RESPALDOS/Noviembre-2026/crackentick-2026-11-22-19-43-34.tar.gz`.
   - rclone 1.76 instalado en `%LOCALAPPDATA%\Programs\rclone` y `RCLONE_PATH` en `.env`.
   - **Aviso:** el remoto usa el client_id compartido de rclone, que se retira durante 2026. Crear un client_id propio para que el respaldo semanal siga funcionando.
20. Hecho: auditoría de permisos. Todas las secciones tienen `requierePermiso`; `/notificaciones` exige sesión; `/portal` es el único acceso público (login de cliente). Los respaldos del sistema exigen rol administrador.
21. Pendiente: Cisco emulado (imagen), client_id propio de rclone y prueba de restauración binaria.
23. Hecho: **consumo diario con retención de 90 días**.
   - Colección `TrafficDaily` (cliente-día, TTL 90 días) con descarga y subida.
   - Recolector cada 15 minutos: lee los contadores de las colas y guarda el delta; la primera lectura solo establece la base.
   - Página `/red/consumo` con rango, router, indicadores, gráfico por día y tabla por cliente.
   - Probado el parser y la página con filas de prueba; el recolector corrió sin errores. Pendiente: probar el delta con tráfico real por una cola.
24. Hecho: **hotspot con venta de vouchers**.
   - Modelos de lote y voucher; servidor y perfil por router en la ficha.
   - Lote: cantidad, perfil, duración, datos y precio; crea perfil y usuarios en el router.
   - Venta: registra ingreso financiero (categoría ventas) y marca vendido.
   - Revocación: deshabilita el usuario en el router.
   - Impresión de lote con códigos y claves.
   - Probado con 2 vouchers: 1 vendido (ingreso 2 USD), 1 revocado (usuario deshabilitado), impresión correcta; todo limpiado.
   - Permiso nuevo `hotspot.gestion`.
25. Decisión: no se implementa registro de IPs ni RADIUS por ahora. El visor de comandos se mantiene.
26. Hecho: **IPAM**.
   - Página `/red/ipam`: pools con total, usadas, libres, porcentaje y conflictos; página de detalle por pool.
   - Detecta IPs duplicadas (servicio/venta) y fuera de todos los pools.
   - Al crear o editar un servicio se rechaza una IP inválida, fuera del pool o ya asignada.
   - La lista de IPs del formulario ya no muestra las usadas y muestra "X IP(s) disponible(s) de Y".
   - Probado: 18 usadas en PPPoE Caracas, 0 aparecen en la lista, 1004 libres de 1022; intento de IP duplicada rechazado sin cambiar la IP.
27. Hecho: **planes de hotspot y vencimiento automático**.
   - Pestaña `/hotspot/planes`: precio, duración en minutos, bajada/subida Mbps y límite de datos; activar/desactivar/eliminar.
   - El router se habilita para hotspot con una casilla y se elige servidor y perfil.
   - Los lotes eligen un plan; el perfil del router lleva `rate-limit` y cada usuario `limit-uptime` y bytes.
   - Vencimiento: el reloj empieza en la primera conexión; al cumplirse el tiempo se elimina la sesión activa y el usuario del router y el voucher queda "Vencido".
   - Revocar también corta la sesión activa.
   - Probado: plan de 1 min con 2/1 Mbps creó el perfil y el usuario con `limit-uptime=1m`; al forzar el vencimiento se eliminó el usuario y el voucher quedó vencido.
28. Pendiente: probar el consumo diario con tráfico real por una cola.
29. Paquete para laptop v2 (CRACKENTICK-LAPTOP-2026-11-23.zip, 107 MB).
   - Dos bats: sembrar.bat (seed --reset --laptop) e iniciar.bat (MongoDB + CHR QEMU + aplicacion).
   - Incluye CHR RouterOS 7.20.2 y QEMU minimo verificado en chr/ y qemu/ (API 8728, WinBox 8291, SSH 2222).
   - seed.js acepta --laptop: crea un solo router (CHR 127.0.0.1:8728) y asigna pools, servicios, ventas y alertas.
   - Sin rclone ni dump de la base: la laptop se siembra (40 clientes, 38 servicios, 1 router, 4 pools con 38 usadas).
   - Verificado: QEMU minimo arranca y la API responde; iniciar.bat levanta CHR + app; seed --laptop en base temporal OK.
   - Pendiente: ejecutar docs/PRUEBAS-2026-11-23.md en la laptop.
30. Rework del 23/11:
   - PPPoE: el campo IP ya no se oculta ni se deshabilita al editar un servicio; vuelve la lista de IPs disponibles.
   - Auditoría: 161 páginas con admin y 160 con el seed de laptop, 0 respuestas 500; IDs inválidos devuelven 4xx. Se agregó `pruebas/auditar-paginas.js` y el manejador central registra método, ruta y usuario en los 500.
   - Permisos: matriz por nodo con Sin acceso / Solo lectura / Editar (`clave:read`), banner y ojo en el menú para solo lectura; los POST quedan bloqueados.
   - Reporte de instalaciones: alta manual (cliente, plan, zona, técnico, fecha) con índice único parcial en `saleId`.
   - Rendimiento: pestañas por trabajador y acceso directo desde la lista de empleados.
   - Agenda: cuadrícula por persona y hora (8A a 4), bloques por tipo con duración, alta al hacer clic en una celda, detalle de tarea y alta de personas desde la misma página.
   - Portal del cliente: tema claro/oscuro, resumen, detalle de factura y de ticket, enlaces desde el portal.
   - Verificado: sintaxis 166 JS y 97 EJS; portal 200 (factura, ticket y factura ajena redirigida); agenda y permisos probados.
31. Corregido: **login intermitente a la API MikroTik**.
   - Causa: ráfagas de conexiones cortas (2 por comando con lookup) sin límite; el CHR bajo QEMU registró `possible SYN flooding on tcp port 8728` y perdió logins.
   - Arreglo en `services/routeros.js`: máximo 2 conexiones por router con cola, 3 reintentos con espera para fallos transitorios (no para clave incorrecta), una sola conexión por comando y timeout 12 s.
   - Probado con CHR encendido: antes 2/5, 1/10 y 3/20 logins concurrentes; después 30/30 logins y 30/30 comandos, tres rondas de 25/25, sin nuevos SYN flood ni login failure.
   - Script: `pruebas/probar-api-concurrente.js`.
32. Correcciones del 23/11 y MAC:
   - Venta: corregido `servicio` indefinido al instalar; ahora instala, crea factura y revierte cliente/servicio/factura/stock si falla.
   - Seguridad: un gestor de usuarios ya no puede autoascenderse a admin; el formulario oculta el rol admin a no administradores.
   - XSS: seriales y MAC escapados en los JSON del formulario de venta y materiales.
   - Agenda: hora exacta (antes 00:00), tareas filtradas ya no aparecen como "fuera de horario", carriles para solapadas, gestores pueden ver/cancelar.
   - Permisos: ruta inicial generada desde todos los nodos; solo lectura oculta formularios POST (deja salir y filtrar); login con límite de intentos.
   - Instalaciones: índice parcial migrado al arrancar; edición vuelve al día del reporte; alta manual con MAC.
   - Portal: sin límite de 12 facturas/8 tickets.
   - Inventario: stock serializado con mutex; MAC por serial editable; al instalar se toma la MAC del serial si la venta no la trae.
   - MAC: `macAuthEnabled` en servicio, venta y reporte; DHCP crea lease, PPPoE agrega `caller-id`; validación y unicidad.
   - Probado: instalación de VEN-0002 en base temporal, MAC automática A0:B1:C2:11:22:33; PPPoE con `caller-id` en CHR; 162 páginas 0 errores; 20/20 API.
33. Servidores DHCP en Avanzado:
   - `Red → Avanzado → Servidores DHCP`: lista servidores, pools. redes e interfaces del router.
   - Crea en un paso la IP del gateway (opcional), el pool, la red DHCP y el servidor; repetir actualiza por nombre.
   - Valida CIDR, gateway y rango (gateway fuera del rango, sin red ni broadcast) y DNS.
   - Probado en el CHR: `ct-dhcp-test` con pool `.100-.150`, red y gateway creados; repetible sin duplicar.
34. Telegram: varios bots y categorías:
   - `notifications.telegram.bots[]` con nombre, token cifrado, chat ID y categorías `red`, `servicios`, `almacen`.
   - El formulario permite agregar y quitar bots; conserva el token si se deja vacío y valida formato, chat ID y categoría.
   - Enrutado: WAN/latencia → Red; cliente sin conexión → Servicios; stock bajo → Almacén.
   - La configuración antigua de un solo bot se sigue usando y se absorbe al guardar.
   - Probado: `pruebas/probar-telegram.js` (5 casos de enrutado, bot único, normalización y persistencia) y flujo HTTP con 2 bots.
35. SSH de RouterOS: corregido el upsert que fallaba con valores con `/`.
   - `find address=192.168.77.1/24` no encontraba la dirección porque RouterOS parte el valor; ahora se citan los valores especiales.
   - Varios comandos usan una sola consola SSH: la creación de DHCP bajó de 42 s a ~10,5 s y repetir ya actualiza.
   - Probado con el CHR en transporte SSH: crear dos veces deja 1 servidor, 1 pool, 1 red y 1 IP.
36. Auditoría (18 hallazgos) corregida:
   - Secretos: `.env.example` ya no trae clave real; clave AES rotada en la base y `scripts/rotar-clave.js` para repetirlo. Producción exige `SESSION_SECRET` y rechaza `admin123`; escucha en `127.0.0.1` por defecto (`HOST`).
   - Ventas e inventario: la instalación reclama la venta con `installStartedAt`; anulación y venta de vouchers usan transición atómica; ajustes y edición de stock pasan por la cola; facturas manuales consumen stock antes de crearse; contadores `VEN/CL/TCK/ART` usan `Counter` atómico.
   - Seguridad: `returnTo` solo acepta rutas internas; nombres de VLAN rechazan saltos/control (inyección IOS); alertas exigen permiso de edición para reconocer/resolver; límites de login acotados.
   - Operación: monitorización con una sola ronda a la vez; respaldo del sistema por cursor (sin cargar la base en memoria); mapas de consumo/WAN se purgan; portal muestra 20 y permite “ver todo”.
   - Pruebas: `npm test` (seguridad, Telegram, concurrencia, portal y Cisco simulado); simulador IOS en `pruebas/cisco-sim` (GNS3 no tiene imágenes Cisco licenciadas).
   - Telegram: bot `@CrackentickAlertasBot` con las tres categorías, chat de Juan y prueba real enviada.
37. Segunda auditoría (24/11):
   - Seriales: agregar, cambiar estado y editar MAC pasan por la cola de inventario; también la edición del artículo serializado.
   - MAC: índices únicos parciales en servicios y ventas en espera con autenticación por MAC.
   - Rotación de clave: `.env.rotacion` con clave vieja y nueva antes de guardar; `cryptoService` acepta `ENCRYPTION_KEY_OLD` para recuperar una rotación a medias.
   - Instalación: bloqueo de 30 min y reintento automático de PPPoE/IP si otro proceso toma el nombre.
   - Respaldo: el volcado por cursor ya no se cuelga si el disco falla.
   - RouterOS: cola máxima de 50 operaciones (configurable) para no acumular contra un router caído.
   - Rendimiento: configuración y conteo de alertas cacheados 10 s.
   - Alertas: botones por alerta según el permiso real; el portal pagina “ver todo” de 50 en 50.
   - `npm test` cubre seguridad, Telegram, concurrencia (incluida MAC única), facturas, portal y Cisco.
38. Monitorización configurable:
   - Pestaña **Configuración** en `Red → Monitoreo`: intervalo (2–300 s), espera antes de avisar (0–3600 s), ICMP de routers y timeout.
   - El planificador usa `setTimeout` con el intervalo guardado; los cambios aplican en la siguiente ronda.
   - Nuevas alertas `router_down`/`router_up`; el aviso de caída solo se crea tras la espera configurada y el de recuperación solo si hubo aviso.
   - ICMP con `ping` del sistema, sin dependencias nuevas; host validado para no inyectar opciones.
   - Probado: `pruebas/probar-monitoreo.js`, página de configuración, guardado y ping a 127.0.0.1; los routers inalcanzables muestran “Sin datos”/sin latencia.
39. Tercera ronda de auditoría (24/11):
   - WAN: cada interfaz se muestrea en su propia tarea, sin esperar a las demás; una WAN lenta ya no retrasa el intervalo ni el aviso de las otras.
   - MAC: al instalar una venta se revalida contra los servicios existentes y se pide editar la venta si la MAC ya está autenticada.
   - Bases viejas: `scripts/revisar-duplicados.js` informa MAC/seriales duplicados antes de confiar en los índices únicos (la base actual está limpia).
   - Inventario: además de la cola del proceso, un lease en Mongo (`models/Lock.js`) evita carreras entre instancias; máximo 15 s de espera y 503 si está ocupado.
   - Portal: `pf`/`pt` se recortan al total real de páginas; una URL manipulada ya no muestra una tabla vacía.
   - Badge de alertas: la caché de 10 s se invalida al crear, reconocer o resolver alertas desde Monitoreo, Notificaciones e Inventario.
   - Pruebas nuevas: `probar-agenda.js` y `probar-clientes.js` (alta, búsqueda, filtros, edición, servicio con IP/MAC, API de IPs y borrado protegido); `npm test` ejecuta 10 suites.
40. Cuarta ronda: permisos y tickets (24/11):
   - Portal: la prioridad "Crítica" enviaba `critical`, que no existe en el modelo (`urgent`); ahora se guarda bien. Un valor viejo cae a `medium` en vez de dar error 500.
   - Dashboard: las tarjetas usaban solo permisos de edición; un usuario de solo lectura no veía finanzas o stock aunque pudiera consultarlos. Ahora usa `puedeVer`.
   - Asistente: consultar clientes, tickets, red, averías e instalaciones acepta permiso de lectura; crear un ticket o solventar una avería sigue exigiendo edición.
   - Notificaciones: se reutilizan los helpers de `utils/permissions.js` en vez de duplicar la regla `:read`.
   - Permisos nuevos: `pruebas/probar-permisos.js` recorre 127 GET y 127 POST de todos los routers con un usuario de solo lectura, otro sin permisos y otro solo de Red. Comprueba que ningún POST pase, el aislamiento entre nodos y el filtrado de alertas.
   - Riesgo conocido: quien tenga `admin.usuarios` puede crear o editar usuarios con cualquier permiso y restablecer contraseñas; trátalo como un permiso de máxima confianza o hazlo exclusivo de administradores.
   - Pruebas nuevas: `probar-tickets.js` (alta, respuesta interna, prioridad, estados y alta desde el portal); `npm test` ejecuta 10 suites.
41. Agenda ampliada y duración flexible:
   - La cuadrícula pasó de 8:00–17:00 a 8:00–24:00 (16 columnas); las tareas de madrugada siguen en **Fuera de la cuadrícula**.
   - El formulario permite duración en **minutos**, en **horas** (0.25–12) o **de hora a hora** (desde/hasta).
   - En modo rango, la hora "desde" fija el inicio y la duración sale de la diferencia; 00:00 como fin cuenta como medianoche.
   - Validaciones: minutos 15–720, horas 0.25–12, rango con fin posterior, mínimo 15 min y máximo 12 h. Los errores vuelven al formulario con lo escrito, sin crear la tarea.
   - La agenda muestra la duración como “1 h 30 min”; el formulario alterna los campos con JS y el servidor valida siempre el modo elegido.
   - Probado: `probar-agenda.js`, formulario HTTP con los tres modos, rango inválido 422 y guardado real de 1.5 h y 22:00–23:30.
42. Tipos de tarea configurables:
   - Nueva pestaña **Agenda → Tipos de tarea** con listar, crear, editar, activar/desactivar y eliminar.
   - Cada tipo tiene nombre, color `#RRGGBB`, descripción, orden y estado. Los colores se aplican a los bloques y a la leyenda de la agenda.
   - Los seis tipos base se crean al arrancar: Instalación, Soporte, Cambio de IP pública, Desbaneo de IP, Mantenimiento y Otro.
   - La clave interna se genera del nombre y no cambia al editar, para no romper tareas existentes. Un tipo en uso no se elimina: se desactiva. Siempre queda al menos un tipo activo.
   - Las tareas guardan la clave del tipo; al desactivar uno, las tareas viejas siguen mostrando su nombre con la marca “(inactivo)” al editarlas.
   - Probado: `probar-tipos-tarea.js`, alta/edición/borrado por HTTP y color aplicado en la agenda.
43. Presets de permisos por cargo:
   - Pestaña **Usuarios → Presets de permisos** para crear, editar, activar/desactivar y borrar plantillas de permisos.
   - En el formulario de usuario hay un selector de preset y el botón **Aplicar**, que solo rellena los campos del formulario.
   - Editar o borrar un preset no escribe en la colección de usuarios: los permisos existentes quedan intactos. `probar-presets.js` lo verifica antes y después.
   - El texto de ejemplo del usuario cambió de `ana.rodriguez` a `carla.mendoza`.
44. Rendimiento por empleado:
   - Se agregó el tiempo medio por tipo de tarea (iniciada → terminada) en la ficha del trabajador y en la columna **Tareas**.
   - Se eliminó la sección **Activaciones y desconexiones / Instalaciones del período y estado actual del padrón** de la página de rendimiento.
   - Probado: `probar-rendimiento.js` con tareas de 0.5 h, 2 h y 2 h; promedio global 1.5 h y por tipo 1.25 h / 2 h.
45. Portal de clientes reescrito:
   - Layout propio (`layouts/portal.ejs`) con `public/css/portal.css`; ya no usa el CSS del panel interno.
   - Login dividido con animaciones Motion (motion.dev), mostrar/ocultar clave, errores en línea y enlace al acceso del personal.
   - Resumen con saldo, próximo vencimiento, servicio, tickets abiertos y últimas facturas/tickets.
   - Nueva lista de **facturas** con filtros Todas/Por pagar/Vencidas/Pagadas, paginación y detalle imprimible.
   - Nueva lista de **tickets** con filtros, paginación, alta con tipo/prioridad y conversación; el cliente puede responder y un ticket cerrado no acepta respuestas.
   - Todo el portal está limitado a `clientId`: facturas, tickets y respuestas se buscan siempre con el cliente de la sesión.
   - Motion se sirve local (`public/vendor/motion.min.js`), con respeto a `prefers-reduced-motion` y fallback sin JS.
   - Probado en navegador: login, resumen, filtros, factura, alta de ticket, respuesta, avisos y layout móvil; consola sin errores.
   - `probar-portal.js` cubre resumen, filtros, paginación, creación, respuesta y aislamiento entre clientes.
46. Rework visual y tres temas:
   - Tema oscuro predeterminado, claro arena y claro lavanda (el del portal); selector con muestra de color en la barra superior y persistencia en `localStorage`.
   - Capa `public/css/rework.css`: tarjetas, KPIs, barra lateral, cabecera, tablas, botones, campos, chips y avisos unificados en los tres temas.
   - Motion sustituye a anime.js: entrada de secciones, contadores, barras, dona y progreso; solo opacidad/transformaciones cortas y máximo 12 elementos.
   - Se desactiva con `prefers-reduced-motion` y con la pestaña oculta; no se animan filas de tablas.
   - Tema por usuario en `User.theme` y por cliente en `Client.portalTheme`; el portal tiene su propio selector de tres temas.
   - Fase 1 visual: contraste, foco, tablas como tarjetas en móvil y estados vacíos.
   - Fase 2: grupos del menú laterales plegables con estado recordado, migas y cabecera.
   - Fase 3: gráficos que siguen el tema, modo compacto persistido y filtros en URL.
   - Fase 4: foco visible, temas por usuario/cliente y portal de referencia.
   - Plan de mejoras visuales en `docs/PLAN-VISUAL-2026-11-24.md`; `npm test` ejecuta 14 suites.
47. Login del panel rediseñado:
   - Composición en dos columnas: presentación del producto a la izquierda y tarjeta de acceso a la derecha.
   - Tarjeta nueva con icono, borde superior degradado, foco, avisos y acceso separado al portal del cliente.
   - Fondo con rejilla, orbes y el canvas de líneas reactivo al puntero, más una luz que sigue al ratón con Motion.
   - Selector de tema con menú propio en el login (Oscuro, Claro arena, Claro lavanda) sin recargar.
   - Campos con más aire y contorno limpio en los tres temas; también en el login del portal.
   - Entrada escalonada de marca, titular, características, tarjeta y campos; respeta `prefers-reduced-motion` y pestaña oculta.
   - En móvil se prioriza el formulario: se ocultan párrafo y lista, y la tarjeta sube.
   - Probado: render, login real, selector de tema, sin errores de consola ni desbordes.
48. Modo único y textos de presentación:
   - Eliminados los textos de "Modo real" y el pie "· Prototipo académico".
   - Sidebar, pie, clientes, monitorización, configuración y visor de comandos muestran el estado sin aludir a modos.
   - Las caídas WAN ya no se simulan en routers reales; se retiró el código de simulación.
   - `mikrotikCli` descarta saltos de línea en valores para evitar inyección por SSH.
49. Correcciones de la revisión completa:
   - Cobro: tasa numérica con prefijo Bs, bloqueada por defecto y editable solo al pulsar Cambiar; los pagos en USD ya no exigen tasa BCV.
   - Facturas: anular una venta instalada queda bloqueado; si falla la devolución de stock la factura no se anula; ampliar el vencimiento devuelve la factura a pendiente.
   - IVA: el interruptor "Cobrar IVA en todo el sistema" ya estaba en Configuración > Facturación y se mantiene.
   - Stock: dos líneas del mismo artículo se validan juntas; el consumo ya no se recorta a cero en silencio.
   - Dinero: redondeo correcto del medio céntimo; "Cobrado" usa el total USD de la factura (también en pagos antiguos sin importe) y convierte bolívares a USD; editar un gasto conserva la tasa histórica.
   - Clientes: suspensión solo por facturas de servicio con gracia; los cortes manuales no se reactivan solos; mora corta todos los servicios.
   - Ventas: reintentar una instalación interrumpida no duplica stock, factura ni servicio.
   - Portal: un cliente retirado no entra; restablecer una clave existente exige finanzas o administrador.
   - Seguridad: sesiones se invalidan al cambiar contraseña; límite de login resiste ráfagas; sin GET /salir; permisos filtrados para usuarios no administradores.
   - Operación: respaldos con timeout, recolección de consumo sin solapes y zona horaria aplicada desde la configuración.







22. Hecho: DHCP completo. Se agregó `macAddress` al servicio (y a la venta), el formulario lo pide para DHCP y el aprovisionamiento crea la reserva en `/ip/dhcp-server/lease` por dirección y MAC, con upsert (sin duplicar). Probado el generador: DHCP produce cola + CLIENTES + lease; PPPoE no produce lease.







