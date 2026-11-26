# Plan de producción — CRACKENTICK

**Fecha:** 25 de noviembre de 2026  
**Alcance:** revisión completa del código, flujos, permisos, interfaz y operación con MikroTik, con plan de corrección para producción.  
**Método:** lectura del código (33 modelos, 36 módulos de rutas, 38 controladores, 41 servicios), pruebas existentes, auditoría de 162 páginas, fuzzing HTTP sobre una base aislada, documentación oficial de RouterOS y skills `mikrotik`, `ponytail` y `claude-council`.  
**Carga asumida:** un proceso Node.js, un equipo pequeño (1–5 operadores), hasta ~1.000 clientes y varios routers MikroTik. Si el despliegue va a ser multi-proceso o multi-sucursal, los riesgos de sesión, trabajos programados y bloqueos suben de nivel.

---

## 1. Veredicto ejecutivo

**CRACKENTICK no está listo para producción todavía.** La base es sólida: 14/14 suites pasan, la auditoría de 162 páginas no da errores, `npm audit` no reporta vulnerabilidades y los flujos felices están bien resueltos. Pero el sistema todavía tiene fallas que afectan dinero, red y confianza:

- **7 errores 500 reproducidos** con entradas inválidas o IDs inexistentes.
- **Configuraciones MikroTik que se guardan en la base antes de confirmar el router**, dejando registros y equipos en estados parciales.
- **Balanceo que solo crea rutas ECMP**, sin tablas de ruteo, mangle ni NAT; por eso no funciona como un balanceo real.
- **Venta que obliga a crear el servicio del cliente en el alta**, aunque quien vende sea un promotor.
- **Tres cifras distintas de “por cobrar”** y etiquetas financieras que hacen parecer que la deuda resta utilidad (no la resta en el código, pero la presentación confunde).
- **Hotspot que solo registra pagos en USD** y puede dejar lotes parciales si el router falla.
- **Respaldos que dependen solo de SSH** y convierten un fallo de conexión en un 500, sin explicar que el router está en API.

La ruta recomendada es un **sprint de 4 semanas**: primero errores y estados parciales, luego venta/permisos y finanzas, después balanceo/PCC, hotspot y respaldos, y al final sesión persistente, CSRF, observabilidad y prueba en CHR.

---

## 2. Semáforo por área

| Área | Estado | Bloqueador principal |
|---|---|---|
| Núcleo MVC, modelos, auditoría, cifrado | 🟢 Sólido | Nada crítico en el camino feliz |
| Pruebas y auditoría de páginas | 🟢 Sólido | Faltan pruebas de error, no de éxito |
| Permisos por nodo | 🟡 Parcial | `ventas.ventas` puede instalar y aprovisionar |
| Clientes y servicios | 🟡 Parcial | Alta de servicio desde cliente sin separar roles |
| Ventas e instalación | 🔴 Bloqueado | El promotor debe crear el servicio |
| Facturación y cobros | 🟡 Parcial | Tres definiciones de “por cobrar” |
| Contabilidad y utilidad | 🔴 Bloqueado | Etiquetas y alcance confunden deuda con utilidad |
| MikroTik básico (PPPoE, colas) | 🟢 Sólido | Probado contra CHR |
| MikroTik avanzado (VLAN, firewall, EOIP, DHCP) | 🔴 Bloqueado | Se guarda antes de aplicar y no hay rollback |
| Balanceo | 🔴 Bloqueado | Solo rutas ECMP; falta PCC/NAT/mangle |
| Respaldos de router | 🔴 Bloqueado | SSH obligatorio; error 500 sin diagnóstico |
| Hotspot | 🟡 Parcial | Pagos solo USD; lote parcial sin rollback |
| Agenda | 🟡 Parcial | No se reprodujo el 500, pero falta prueba de error |
| Interfaz y temas | 🟡 Parcial | Tarjetas/avatares distintos al portal |
| Producción (sesión, CSRF, jobs) | 🔴 Bloqueado | Sesión en memoria y sin tokens CSRF |

---

## 3. Hallazgos P0 (bloquean producción)

### P0-01. Las configuraciones MikroTik avanzadas no son atómicas

**Evidencia:** `controllers/vlanController.js` (crear/actualizar), `services/vlanService.js`, `controllers/firewallRuleController.js`, `controllers/eoipController.js`, `services/routerConfigService.js`, `services/dhcpServerService.js`.

**Qué pasa hoy:** en VLAN, firewall y EOIP el controlador **crea el registro en MongoDB**, después llama al router y, si el router falla, guarda el registro con `status: 'error'`. En DHCP no hay registro, pero los comandos se ejecutan en secuencia: si falla el tercero, el pool y la red ya quedaron creados. En VLAN, si la interfaz se crea y la dirección IP falla, la VLAN queda en el equipo y la base queda a medias.

**Caso concreto:** crear una VLAN con dirección `10.10.20.1/24` en un router donde la interfaz padre no existe. Se guarda la VLAN en MongoDB, el router rechaza el `add` y el registro queda visible como error. Al corregir y reintentar, el sistema puede duplicar la VLAN o dejar una dirección huérfana. Lo mismo aplica a una regla de firewall con `src-address` inválida o a un EOIP con nombre repetido.

**Riesgo:** estado parcial en el router, registros que la interfaz muestra como si existieran, duplicados al reintentar y auditoría que dice “guardado con error” sin haber revertido nada.

**Fix mínimo:**
1. Generar el `_id` del documento antes de aplicar (`new mongoose.Types.ObjectId()`), pero **no guardarlo** todavía.
2. Preflight de solo lectura: router activo, vendor compatible, modo real, interfaz existente, nombre no duplicado, dirección dentro de la red, etc.
3. Aplicar los comandos con una lista de compensación. Si el paso N falla, ejecutar en orden inverso los pasos 1..N-1 (borrar VLAN, borrar dirección, borrar regla).
4. Solo si `resultado.ok` es verdadero, guardar el documento. Si falla, devolver `422/502` con el detalle del router y no crear nada.
5. En edición, guardar un snapshot del estado anterior; si el nuevo falla, reaplicar el anterior.
6. En eliminación, aplicar primero en el router y solo borrar el documento si el router confirma.

**Criterio de aceptación:** para cada alta/edición, una prueba con router simulado y otra con CHR debe demostrar: éxito → registro + objeto en router; fallo → ni registro ni objeto; reintento → sin duplicados. La UI nunca debe mostrar “guardado” si el router rechazó el cambio.

---

### P0-02. El balanceo no es un balanceo: solo crea rutas ECMP

**Evidencia:** `models/BalanceConfig.js` (`method: ['ecmp']`), `services/balanceService.js`, `controllers/balanceController.js`, vista `network/balance-index.ejs`.

**Qué hace hoy:** crea una ruta por WAN con `dst-address=0.0.0.0/0`, `gateway`, `check-gateway=ping`, `distance=1` y un comentario. No crea tablas de ruteo, reglas de mangle, marcas de conexión, marcas de ruteo, NAT por WAN ni excepciones de FastTrack.

**Por qué no funciona:** RouterOS puede usar ECMP para repartir conexiones entre rutas de igual costo, pero el tráfico de retorno, el NAT y las conexiones existentes necesitan una configuración coherente. Sin `routing-table`, `mangle` y `masquerade` por WAN, el tráfico puede salir por una interfaz y volver por otra, quedarse en una sola WAN o romperse al fallar un enlace. Además, el formulario ni siquiera pide la interfaz LAN ni la interfaz WAN; solo la gateway.

**Diseño correcto (PCC, documentación oficial de RouterOS):**
1. Crear una tabla por WAN: `/routing/table/add name=CT-ISP1 fib` (y `CT-ISP2`…).
2. Poner las redes conectadas en una address-list `CT-CONNECTED` y aceptarlas antes de clasificar:
   - `chain=prerouting action=accept dst-address-list=CT-CONNECTED`
   - `chain=output action=accept dst-address-list=CT-CONNECTED`
3. Marcar conexiones nuevas de la LAN con PCC:
   - `chain=prerouting action=mark-connection connection-mark=no-mark connection-state=new dst-address-type=!local in-interface=<LAN> per-connection-classifier=both-addresses:2/0 new-connection-mark=CT-ISP1`
   - la misma regla con `:2/1` para `CT-ISP2`.
4. Convertir la marca de conexión en marca de ruteo:
   - `chain=prerouting action=mark-routing connection-mark=CT-ISP1 in-interface=<LAN> new-routing-mark=CT-ISP1`
   - y equivalente en `output` para el tráfico del propio router.
5. Rutas: una por tabla (`gateway=... routing-table=CT-ISP1 check-gateway=ping`) y dos rutas principales con `distance=1` y `distance=2` para failover.
6. NAT: `chain=srcnat action=masquerade out-interface=<WAN1>` y otra para WAN2; agregar ambas interfaces a la lista `WAN`.
7. FastTrack: si existe la regla de FastTrack, condicionarla a `connection-mark=no-mark` o desactivarla para las conexiones marcadas; de lo contrario, las reglas de mangle no ven esos paquetes.
8. Limpieza por comentario/etiqueta `CT-BALANCE-<id>` en rutas, tablas, mangle y NAT.

**Advertencia:** la documentación de MikroTik indica que **PCC no funciona con HotSpot** porque el proxy del hotspot usa solo la tabla principal. Si el router tiene hotspot, hay que usar ECMP/failover o un equipo separado.

**Cambios de modelo/UI:** agregar `method: ['pcc','ecmp']`, `lanInterface`, `wan.interface`, `wan.weight`, `applyNat`, `fastTrackSafe`; pedir la interfaz LAN; mostrar vista previa de comandos; mostrar contadores y resultado por paso.

**Criterio de aceptación:** en CHR con dos WAN de prueba, el tráfico de varios clientes se reparte entre ambas, las reglas de mangle tienen contadores, el NAT funciona, al bajar una WAN el failover responde y al eliminar el balanceo no quedan tablas, rutas, mangle ni NAT con la etiqueta.

---

### P0-03. La venta obliga a crear el servicio y el cliente antes de tiempo

**Evidencia:** `views/sales/form.ejs` (plan, router y pool con `required`), `controllers/salesController.js` (`crear`), `services/salesService.js` (`crearVenta` exige router, pool, IP y plan).

**Qué pasa hoy:** el promotor de ventas debe elegir plan, router, pool, IP, PPPoE y MAC para guardar una venta. Si no los tiene, no puede registrar la venta. Peor aún, `crearVenta` valida y guarda esos datos antes de que el técnico intervenga.

**Por qué está mal:** el rol del promotor es captar al cliente, los equipos y el costo de instalación; la configuración del servicio la define el área técnica al instalar. Obligar al promotor a inventar una IP o un router genera datos falsos, servicios mal asignados y clientes creados antes de tiempo.

**Fix:**
1. Permitir `Sale.service` vacío o incompleto al crear: cliente, ítems, costo de instalación, técnico, promotor y fecha.
2. No crear cliente, suscripción ni factura en el alta; eso ocurre al instalar.
3. Agregar un estado visible “Servicio pendiente” y un formulario **Completar servicio** en la ficha de la venta para el técnico.
4. Separar permisos:
   - `ventas.ventas`: crear/cancelar venta, editar datos del cliente y materiales.
   - `ventas.instalar` (nuevo): completar plan/router/pool/IP/PPPoE e instalar.
   - `ventas.inventario`: consumir/ajustar stock.
   - `general.clientes`/`finanzas.facturas`: efectos de alta de cliente y factura, si se quiere separar aún más.
5. `salesService.instalar` debe validar el servicio completo antes de tocar stock o router y devolver un `422` claro si falta algo.
6. Validar en el alta solo lo que el promotor controla: nombre, contacto, ítems y costo.

**Criterio de aceptación:** un usuario con solo `ventas.ventas` crea una venta sin plan/router/IP; no se crea cliente ni suscripción; un usuario con `ventas.instalar` completa el servicio, instala y genera cliente/factura/servicio; un usuario sin `ventas.instalar` recibe 403 en `/ventas/:id/instalar`.

---

### P0-04. Finanzas: la deuda no resta utilidad, pero hay tres “por cobrar” y etiquetas engañosas

**Evidencia:** `controllers/dashboardController.js`, `services/economicsService.js`, `controllers/financeController.js`, `views/dashboard/index.ejs`, `views/finance/index.ejs`.

**Qué encontramos:** en el código **no existe una resta de deuda en la utilidad neta**. `utilidadNeta = utilidadBruta - gastosOperativos - nómina`. La confusión viene de tres cosas:

1. **“Ingresos netos”** en el dashboard significa “ingresos sin IVA”, no “ingresos menos deuda”. En base caja solo entra lo cobrado; por eso puede ser negativo aunque haya mucha facturación pendiente.
2. **“Deuda pendiente”** del dashboard suma **todas** las facturas `open` y `overdue` (incluidas las que aún no vencen y las de equipos), pero el enlace de detalle lleva a `?estado=overdue`. El número y el enlace no coinciden.
3. **“Por cobrar”** de contabilidad usa `deudasSerie`, que filtra por `dueDate` dentro del mes; no es el total pendiente. Por eso el dashboard muestra 2.367,40 y contabilidad 2.310,56 para el mismo negocio.

**Datos reales de la base actual (25/11/2026):**

| Vista | Ingresos | Gastos | Utilidad | Por cobrar |
|---|---:|---:|---:|---:|
| Caja | 130,00 | 715,00 | -655,00 | 2.310,56 (solo vencimientos del mes) |
| Devengo | 2.111,00 | 715,00 | 1.202,95 | 2.310,56 |
| Deuda total dashboard | — | — | — | 2.367,40 (39 facturas) |

No hay resta de deuda; hay **tres alcances distintos** y una etiqueta “Ingresos netos” que se lee como “después de deudas”.

**Riesgo adicional de doble costo:** `economicsService.costoFactura` resta el costo de equipos de las facturas de venta/instalación. Si la compra del equipo también se registra como gasto en `FinanceEntry`, el costo se cuenta dos veces; no hay vínculo entre la compra de inventario y la salida por venta. Hay que definir la política: costo perpetuo (solo al vender) o gasto al comprar (no volver a restar al vender).

**Fix:**
1. Definir y documentar dos bases: **Caja** (cobrado/pagado) y **Devengo** (facturado/gastado), con etiquetas explícitas:
   - “Ingresos cobrados (sin IVA)” / “Facturado (sin IVA)”.
   - “Utilidad de caja” / “Utilidad devengada”.
2. Separar “Por cobrar total” de “Vencido” y “Deuda de servicio” (solo `affectsService: true`). El dashboard debe mostrar el total y el vencido; el enlace debe filtrar exactamente lo que muestra.
3. Hacer que contabilidad muestre el mismo total pendiente o etiquetar claramente “por cobrar con vencimiento en el mes”.
4. Agregar una tarjeta de conciliación: facturado − cobrado = por cobrar; cobrado − gastos pagados = utilidad de caja. La deuda es un activo, no un gasto.
5. Definir la política de costo de equipos y aplicarla en un solo lugar. Si se usa costo perpetuo, no registrar la compra como gasto operativo; si se usa gasto al comprar, no restar `costoEquipos` otra vez.
6. Crear una prueba con un cliente, una factura pagada, una vencida y una venta de equipo que verifique los tres números y la utilidad.

**Criterio de aceptación:** una sola definición por KPI, misma cifra entre dashboard y contabilidad para el mismo alcance, y una prueba que falle si la deuda se resta de la utilidad o si el costo de equipo se cuenta dos veces.

---

### P0-05. Hotspot: pagos solo en USD y lotes parciales sin rollback

**Evidencia:** `controllers/hotspotController.js` (`vender`), `services/hotspotService.js` (`vender`, `crearLote`), `views/hotspot/index.ejs`, `models/HotspotVoucher.js`.

**Qué pasa hoy:**
- `vender` recibe solo `paymentMethod`; no recibe moneda, monto, tasa ni referencia.
- `hotspotService.vender` crea `FinanceEntry` con `currency: 'USD'`, `amount: price`, `amountUsd: price`. Si el cliente paga en bolívares, el ingreso queda mal.
- `recaudado` del listado suma `price`, no un equivalente en USD.
- `crearLote` intenta crear el perfil en el router, **ignora el resultado** y sigue creando el lote y los vouchers. Si el perfil falla, el lote queda con 0 vouchers útiles; si fallan algunos usuarios, el lote queda parcial sin limpieza.

**Fix:**
1. Agregar a la venta: `paymentCurrency` (`USD`/`VES`), `paymentAmount`, `exchangeRate`, `paymentReference` y `paymentMethod`.
2. Validar: USD no exige tasa; VES exige tasa > 0. Guardar `amountUsd` calculado.
3. Guardar esos campos también en `HotspotVoucher` y en `FinanceEntry` (`currency`, `amount`, `amountUsd`, `exchangeRate`, `reference`).
4. Cambiar `recaudado` para sumar `amountUsd` con respaldo en `price` para vouchers viejos.
5. En `crearLote`, comprobar el resultado del perfil; si falla, abortar antes de crear el lote. Si falla la creación de un voucher, registrar el error y decidir: cancelar todo el lote o dejar un lote parcial con estado `incomplete` y opción de reintentar.
6. Agregar UI con moneda, monto, tasa bloqueada/editable igual que en facturas, método y referencia.
7. Verificar con CHR: crear lote, vender en USD y Bs, comprobar ingreso, revocar y esperar la limpieza.

**Criterio de aceptación:** venta USD y VES guardan montos correctos, el KPI suma USD, un fallo de perfil no crea lote, y un fallo de usuario no deja vouchers sin trazabilidad.

---

### P0-06. Respaldos: SSH obligatorio, error 500 y sin diagnóstico

**Evidencia:** `services/backupService.js`, `controllers/backupController.js`, `services/mikrotikSsh.js`, modelos `RouterBackup`/`NetworkBackup`.

**Qué pasa hoy:** el respaldo `.rsc` y el binario usan SSH (`export hide-sensitive`, `/system backup save` + SFTP). El controlador solo captura `error.status`; un fallo de SSH llega como error genérico y el middleware responde **500**. Los routers en transporte API con SSH no habilitado fallan sin explicar que el problema es el canal.

**Fix:**
1. Envolver los errores de SSH/API en un `502` con mensaje accionable: “El router no acepta SSH en el puerto 22/2222; habilita `/ip/service ssh` o usa respaldo lógico por API”.
2. Agregar un **respaldo lógico por API** como respaldo de lectura: identidad, interfaces, direcciones, rutas, firewall, mangle, NAT, PPP secrets (sin contraseñas), colas, pools, DHCP y VLAN, guardado como `NetworkBackup` con `kind: 'api-logical'`. No es restaurable automáticamente; debe decirlo en la UI.
3. Si `/export` por API funciona en la versión de RouterOS, usarlo como `.rsc` API; probarlo en CHR antes de prometerlo.
4. Guardar el `RouterBackup` solo cuando haya contenido; si falla, no crear un archivo vacío. Registrar el intento fallido en auditoría con el error.
5. Añadir prueba de conexión de respaldo (SSH/SFTP) y mostrar el resultado en la ficha del router.
6. Probar restauración `.rsc` y binaria en CHR; verificar que el archivo descargado coincide con el guardado.

**Criterio de aceptación:** un router API sin SSH devuelve un mensaje claro y no un 500; un router con SSH guarda `.rsc` y binario; un router con API y sin SSH puede guardar al menos un respaldo lógico; el listado y la descarga funcionan.

---

### P0-07. Errores 500 reproducidos

Fuzzing sobre una base aislada, autenticado como admin, con IDs inexistentes y cuerpos inválidos. Todos los casos siguientes devolvieron **500**; el resto de rutas devolvió 4xx o redirección.

| # | Endpoint | Disparador | Causa exacta | Fix |
|---|---|---|---|---|
| 1 | `POST /clientes/:id/servicio` | Cliente inexistente | El `catch` renderiza `subscriptions/form` con `cliente = null`; la vista usa `cliente.fullName` | Devolver 404 antes de renderizar o pasar un cliente seguro |
| 2 | `PUT /red/reportes/instalaciones/:id` | Reporte inexistente | El `catch` renderiza `reports/installation-form` con `reporte = null`; la vista usa `reporte.clientId` | Devolver 404; no renderizar con null |
| 3 | `POST /ventas/:id/servicio/editar` | Venta inexistente | El `catch` renderiza `sales/service-edit` con `venta = null`; la vista usa `venta.code` | Devolver 404 antes del render |
| 4 | `POST /ventas/:id/materiales/editar` | Venta inexistente | Igual que el anterior, `materials-edit.ejs` | Devolver 404 |
| 5 | `POST /soporte/tickets` | Cuerpo vacío | `tickets/form.ejs` usa `usuarios` y el `catch` no lo pasa | Pasar `usuarios`, `clientes` y `subscriptions` en el catch |
| 6 | `POST /admin/empleados` | `startDate` inválida | `datos.startDate.toISOString()` sobre `Invalid Date` | Validar fecha antes de renderizar; helper de fecha segura |
| 7 | `PUT /admin/empleados/:id` | `startDate` inválida | Igual, en el render de edición | Igual |
| 8 | `POST /admin/gastos` | `date` inválida | `datos.date.toISOString()` sobre `Invalid Date` | Igual |
| 9 | `PUT /admin/gastos/:id` | `date` inválida | Igual | Igual |

**Patrón común:** los `catch` de validación asumen que la entidad existe y que la fecha es válida. La solución es doble: (a) devolver 404 cuando `findById` no encuentra; (b) usar `fechaParaInput(valor, defecto)` que devuelva una cadena segura en lugar de llamar `toISOString()` sobre una fecha inválida.

**Agenda:** no se reprodujo ningún 500 en 11 casos malformados (fecha inválida, duración inválida, rango invertido, asignado inexistente, título largo, categoría/prioridad inválidas). Si el 500 apareció en una acción concreta, hace falta la URL y la hora del log. Mientras tanto, agregar `if (!duracion.scheduledAt)` antes de asignar y `if (!tarea)` en los `catch`, y una prueba de regresión.

**Criterio de aceptación:** un script de fuzzing de todas las rutas POST/PUT/DELETE con IDs falsos y cuerpos vacíos/inválidos devuelve **0 respuestas 500**; cada caso queda como prueba automatizada.

---

### P0-08. Permisos: `ventas.ventas` puede instalar, aprovisionar y facturar

**Evidencia:** `app.js:273` monta `/ventas` con `requierePermiso('ventas.ventas')`; `routes/sales.js` incluye `POST /:id/instalar`, `POST /:id/servicio/editar` y `POST /:id/materiales/editar`; `salesService.instalar` crea cliente, suscripción, factura, consume inventario y aprovisiona el router.

**Riesgo:** un promotor con `ventas.ventas` puede hacer todo el ciclo de instalación, incluida la creación de un cliente y un servicio, el consumo de stock y comandos al router, sin tener `general.clientes`, `red.routers` ni `finanzas.facturas`. También puede editar materiales y afectar el stock.

**Fix:** dividir el nodo como se indica en P0-03: `ventas.ventas`, `ventas.instalar`, `ventas.inventario` (ya existe) y, si se quiere, `general.servicios` para el alta de servicio desde la ficha del cliente. Revisar cada ruta POST contra su nodo, no solo contra “tiene algún permiso”.

**Criterio de aceptación:** matriz de 30 nodos con rutas y métodos; un usuario con cada nodo solo puede ejecutar las acciones de ese nodo; un usuario de solo lectura no puede ningún POST; ninguna acción cruza a otro nodo sin permiso explícito.

---

### P0-09. Listo para producción: sesión, CSRF y trabajos

Estos no son bugs de una pantalla, pero bloquean una puesta en producción real:

- `express-session` con **MemoryStore**: las sesiones se pierden al reiniciar y no se comparten entre procesos (`app.js:116-129`). Migrar a Mongo/Redis.
- **Sin tokens CSRF**: solo hay validación de `Origin` y `SameSite=Lax`. Agregar token por sesión en formularios y validarlo en todos los POST/PUT/DELETE.
- **Trabajos programados en un solo proceso**: monitorización, consumo, nómina, respaldos y limpieza de vouchers. Si se levantan dos instancias, se duplican. Documentar un solo proceso o agregar bloqueo en Mongo.
- **Secretos en el paquete**: `.env` y `CREDENCIALES.txt` viajan en el ZIP. Para producción, rotar `SESSION_SECRET`, `ENCRYPTION_KEY`, claves de router/Telegram/IA y no distribuir esos archivos.
- **Sin endpoint de salud, request-id ni logs estructurados**: agregar `/health`, logs JSON y correlación de errores.
- **Sin transacciones multi-documento**: la idempotencia y los bloqueos actuales son buenos, pero hay que documentar y probar la recuperación de cada flujo (venta, factura, stock, respaldo).
- **Node 26 en desarrollo**: fijar una versión LTS (20/22) y probar la instalación en la laptop.

---

## 4. Hallazgos P1 (corregir antes del piloto)

| ID | Hallazgo | Evidencia | Fix |
|---|---|---|---|
| P1-01 | “Deuda pendiente” incluye facturas no vencidas y de equipos; el enlace filtra solo vencidas | `dashboardController`, `views/dashboard/index.ejs` | Separar total/vencido/servicio; enlace coherente |
| P1-02 | “Por cobrar” de contabilidad es solo del mes, no el total | `economicsService.deudasSerie` | Mostrar total o etiquetar “del mes” |
| P1-03 | Doble costo posible de equipos | `economicsService.costoFactura` | Política única de inventario |
| P1-04 | El alta de servicio desde cliente puede tocar router sin permiso de red | `clientController.crearServicio` | Nodo `general.servicios` o `red.routers` |
| P1-05 | `/api/tasa/actualizar` lo puede llamar cualquier autenticado | `app.js:217` | Restringir a finanzas/admin |
| P1-06 | Respaldos binarios en MongoDB con límite de 4 MB | `RouterBackup` | GridFS o almacenamiento externo; checksum |
| P1-07 | Sin retención/limpieza de respaldos y auditoría | `RouterBackup`, `AuditLog` | Política de retención y archivo |
| P1-08 | Hotspot no vincula la venta a un cliente | `HotspotVoucher.clientId` opcional | Selector de cliente y estado de cuenta |
| P1-09 | Lote de hotspot parcial sin estado | `hotspotService.crearLote` | Estado `incomplete` y reintento |
| P1-10 | Agenda no tiene prueba de errores | `pruebas/probar-agenda.js` | Casos de fecha/duración/ID |
| P1-11 | Formularios avanzados no muestran vista previa ni confirmación | VLAN/firewall/EOIP | Vista previa de comandos + confirmación |
| P1-12 | Cisco avanzado (firewall/EOIP) devuelve error después de guardar | `routerConfigService` | Validar vendor antes de guardar |
| P1-13 | Errores de router se muestran como “guardado con error” | controladores | 422/502 sin guardar |
| P1-14 | No hay prueba de restauración de respaldo | `backupService` | Prueba CHR + descarga + import |
| P1-15 | El pie y los textos ya no dicen “modo real”, pero quedan referencias técnicas en docs | `docs/DOCUMENTO-DESARROLLO.md` | Actualizar documentación |
| P1-16 | `styles.css` de 6.442 líneas y `app.js` monolítico | `public/css`, `public/js` | Consolidar y dividir |

---

## 5. Cómo se maneja la información: estado técnico

**Arquitectura:** navegador → Express (rutas, sesión, permisos, origen) → controladores → servicios → MongoDB / RouterOS / APIs externas. EJS renderiza en servidor; el navegador no accede a Mongo ni al router.

**Datos:** 33 colecciones; referencias `ObjectId` para cliente-servicio-plan-router-factura; documentos embebidos para líneas de factura, seriales, movimientos y snapshots. Índices únicos para factura, servicio/período, consumo/día, MAC en venta y quincena; TTL de 90 días para consumo.

**Concurrencia:** contadores atómicos (`Counter`), reclamo de venta (`findOneAndUpdate`), reclamo de voucher, `Lock` de inventario (lease 30 s, espera 15 s), cola de 2 conexiones por router. No hay transacciones multi-documento; se compensa con idempotencia y bloqueos.

**Seguridad:** scrypt para contraseñas, AES-256-GCM para credenciales, cookies httpOnly/SameSite, 30 nodos de permiso, límite de intentos, validación de origen, auditoría append-only con secretos enmascarados.

**Lo que falta para producción:** sesión persistente, CSRF, transacciones/compensación sistemática en MikroTik, observabilidad y pruebas de error.

---

## 6. Plan de corrección por fases

### Fase 0 — Errores y red de seguridad (2–3 días)

**Objetivo:** que ninguna entrada inválida produzca 500 y que los fallos de router no creen registros falsos.

| Tarea | Archivos | Criterio |
|---|---|---|
| Corregir los 9 casos de 500 de la tabla P0-07 | `clientController`, `salesController`, `installationReportController`, `ticketController`, `employeeController`, `expenseController` | Fuzz 0 respuestas 500 |
| Helper `fechaParaInput(valor, defecto)` y usarlo en formularios | `utils/dates.js`, controladores | Fecha inválida → 422, nunca `toISOString` sobre inválida |
| `usuario`/`clientes`/`subscriptions` siempre presentes en `tickets/form` | `ticketController`, vista | POST vacío → 422 |
| `if (!entidad) return 404` en todos los `catch` que renderizan | controladores | IDs falsos → 404 |
| Respaldos: errores SSH/API → 502 con mensaje accionable | `backupController`, `backupService` | Router sin SSH → mensaje, no 500 |
| Script `pruebas/probar-500.js` con fuzz de rutas | `pruebas/` | Se ejecuta en CI/local |

### Fase 1 — MikroTik atómico y venta/permisos (1 semana)

| Tarea | Archivos | Criterio |
|---|---|---|
| Preflight + compensación en VLAN | `vlanController`, `vlanService` | Fallo no deja VLAN ni dirección |
| Preflight + compensación en firewall y EOIP | `firewallRuleController`, `eoipController`, `routerConfigService` | Fallo no crea registro |
| Compensación en DHCP | `dhcpServerService` | Fallo no deja pool/red/servidor parciales |
| Venta sin servicio obligatorio | `salesService`, `salesController`, `views/sales/form.ejs` | Promotor crea venta sin plan/router/IP |
| Formulario “Completar servicio” | `views/sales/service-edit.ejs` | Técnico completa e instala |
| Permisos `ventas.instalar`/`general.servicios` | `config/constants`, `app.js`, `routes`, vistas | Matriz por nodo |
| Pruebas con router simulado y CHR | `pruebas/` | Alta/edición/borrado y fallo |

### Fase 2 — Dinero, hotspot y respaldos (1 semana)

| Tarea | Archivos | Criterio |
|---|---|---|
| Definir Caja/Devengo y etiquetas | `economicsService`, dashboard, finanzas | Una cifra por KPI |
| Separar por cobrar total/vencido/servicio | controladores y vistas | Dashboard y contabilidad coinciden |
| Política de costo de equipos | `economicsService` | Sin doble costo |
| Hotspot USD/Bs y referencia | `hotspotService`, controlador, vista, modelo | Venta USD y VES correcta |
| Rollback de lote hotspot | `hotspotService` | Perfil fallido no crea lote |
| Respaldo lógico API / fallback | `backupService` | Router API sin SSH guarda respaldo lógico |
| Prueba de restauración | CHR | `.rsc` y binario |

### Fase 3 — Balanceo PCC, UI y producción (1–2 semanas)

| Tarea | Archivos | Criterio |
|---|---|---|
| Modelo/UI de balanceo PCC | `BalanceConfig`, vista, controlador | LAN/WAN/método/preview |
| Mangle + routing tables + NAT + FastTrack | `balanceService` | Tráfico repartido y failover |
| Limpieza/rollback por etiqueta | `balanceService` | Sin objetos huérfanos |
| Sesión persistente + CSRF + health | `app.js`, middleware, dependencias | Producción |
| Unificar tarjetas/avatares/animaciones | CSS/vistas/partials | Paridad con portal |
| Consolidar CSS/JS y eliminar redundancias | `public/` | Menos líneas, sin regresiones |
| Pruebas de carga y CHR | `pruebas/` | 1.000 clientes, 2 WAN |

### Fase 4 — UAT y salida (2–3 días)

- Migración de datos con respaldo previo y script de conciliación.
- Prueba en la laptop con el ZIP final y CHR.
- Checklist de go-live: secretos rotados, sesión persistente, HTTPS, backups verificados, monitoreo, rollback.
- Capacitación corta: promotor, técnico, cajero, administrador.

---

## 7. Pruebas que deben existir antes de producción

1. **Fuzz de errores:** todas las rutas POST/PUT/DELETE con IDs falsos, cuerpos vacíos, fechas inválidas y campos gigantes → 0 respuestas 500.
2. **MikroTik:** por cada configuración avanzada, éxito, fallo en el primer comando, fallo en el último, reintento y eliminación; en CHR.
3. **Balanceo:** dos WAN, contadores de mangle, NAT, failover, limpieza; verificar que PCC no se ofrece con hotspot.
4. **Ventas:** promotor crea venta sin servicio; técnico completa; permisos; reintento de instalación; stock.
5. **Finanzas:** factura pagada, vencida y venta de equipo; conciliación caja/devengo; deuda no resta utilidad; costo no duplicado.
6. **Hotspot:** lote, venta USD, venta VES, revocación, expiración, fallo de perfil y fallo de usuario.
7. **Respaldos:** `.rsc` por SSH, binario, API sin SSH, restauración y descarga.
8. **Permisos:** matriz de 30 nodos; cada nodo solo sus rutas; sin escalada por `admin.usuarios`.
9. **Carga:** 1.000 clientes, 5 routers, monitorización y facturación simultánea.
10. **Recuperación:** reinicio de Node con sesión persistente; respaldo/restauración de MongoDB.

---

## 8. Permisos por nodo (matriz de revisión)

| Nodo | Rutas principales | Observación |
|---|---|---|
| `general.dashboard` | `/` | Solo lectura; tarjetas filtradas |
| `general.clientes` | `/clientes`, `/suscripciones` | Puede crear servicio desde la ficha; evaluar separar |
| `reportes.gestion` | `/reportes` | Solo lectura |
| `red.routers` | `/red/routers`, `/routers` | Credenciales y reparación: alto impacto |
| `red.pools` | `/red/pools`, `/red/ipam`, `/pools` | Aplicar pool toca router |
| `red.planes` | `/red/planes`, `/planes` | Sincroniza colas |
| `red.monitoreo` | `/red/monitoreo`, `/red/consumo`, `/monitoreo` | Crear interfaces y configuración |
| `red.zonas` | `/red/zonas` | Bajo riesgo |
| `red.averias` | `/red/reportes/averias` | Reportes técnicos |
| `red.instalaciones` | `/red/reportes/instalaciones` | Reportes técnicos |
| `red.vlans` | `/red/vlans` | Debe ser atómico (P0-01) |
| `red.dhcp` | `/red/dhcp` | Debe ser atómico (P0-01) |
| `red.firewall` | `/red/firewall` | Debe ser atómico; puede cortar gestión |
| `red.eoip` | `/red/eoip` | Debe ser atómico |
| `red.balanceo` | `/red/balanceo` | PCC/NAT pendiente |
| `red.respaldos` | `/red/respaldos` | Descarga configuración sensible |
| `ventas.ventas` | `/ventas` | Hoy incluye instalar; separar |
| `ventas.inventario` | `/ventas/inventario`, `/inventario` | Stock, seriales y MAC |
| `soporte.tickets` | `/soporte/tickets`, `/tickets` | Tickets |
| `soporte.asistente` | `/asistente` | Consulta con permisos; propone con confirmación |
| `agenda.gestion` | `/agenda` | Tareas de cualquier usuario |
| `hotspot.gestion` | `/hotspot` | Vende e ingresa dinero; revisar moneda |
| `finanzas.facturacion` | `/finanzas/facturacion`, `/facturacion` | Emite y ejecuta mora (corta) |
| `finanzas.facturas` | `/finanzas/facturas`, `/facturas` | Cobra y anula |
| `finanzas.gestion` | `/finanzas` | Contabilidad |
| `admin.usuarios` | `/admin/usuarios` | Presets y permisos |
| `admin.empleados` | `/admin/empleados` | Nómina y pagos |
| `admin.gastos` | `/admin/gastos` | Gastos e ingresos |
| `admin.configuracion` | `/admin/configuracion` | Firewall, IA, respaldos |
| `admin.auditoria` | `/admin/auditoria` | Solo lectura; sin POST |

**Rutas sin nodo:** `/notificaciones` (filtra por tipo visible), `/api/preferencias/tema` (solo tema propio), `/api/tasa/actualizar` (hoy cualquier autenticado; restringir).

---

## 9. Interfaz: paridad con el portal y reducción de redundancia

### Lo que ya está bien
- Motion está local y las animaciones respetan `prefers-reduced-motion`.
- El portal tiene tarjetas con degradado, borde suave, hover y avatares circulares; el panel tiene una base sólida.
- Los temas claro/oscuro/lavanda ya están en ambos lados.

### Cambios recomendados
1. **Tokens compartidos:** `--radius-card: 18px`, `--shadow-card`, `--surface-grad`, `--brand-grad`, `--avatar-size`. Mapear `--radius` del panel a 18 px.
2. **Tarjetas:** llevar `.tarjeta`/`.panel` al estilo `.p-card`: fondo con degradado sutil, borde 1 px, radio 18, hover de 2 px, sombra suave, `data-motion="fade"`.
3. **Avatares y logos:** crear `views/partials/avatar.ejs` circular, con imagen opcional (`avatarUrl`/`logoUrl`) o iniciales con color determinista por ID. Usarlo en sidebar, topbar, clientes, tickets, agenda y portal. Si no hay archivo, iniciales con degradado como el portal.
4. **Marca:** un solo parcial de marca (logo + texto) para panel y portal; el logo del portal no debe ser distinto al del panel.
5. **Animaciones:** revelar tarjetas con `Motion` en grupos de máximo 12, opacidad/transform, hover de tarjeta y contadores; nada de animar tablas completas.
6. **Textos:** guía corta de copy: “Panel”, “Portal del cliente”, “Clientes”, “Servicios”, “Por cobrar”, “Vencido”, “Utilidad de caja/devengada”. Evitar “Ingresos netos” para referirse a “sin IVA”.
7. **Consolidar CSS:** `styles.css` (6.442 líneas) + `rework.css` + `fases.css` + `login.css` → `tokens.css`, `base.css`, `components.css`, `pages.css`. Usar `:is([data-tema='claro'],[data-tema='claro-suave'])` para eliminar pares repetidos y borrar clases muertas.
8. **Dividir JS:** `public/js/app.js` (81 KB) en `forms.js`, `charts.js`, `agenda.js`, `theme.js`, `assistant.js`, `monitor.js`; cargar con `defer` solo lo necesario.
9. **Redundancia:** retirar rutas alias antiguas después de un periodo de redirección; unificar formularios de red repetidos; eliminar el modo simulado que ya no se usa (o aislarlo como modo de pruebas) y sus ramas `mode === 'real'` si se decide un solo modo.

---

## 10. Parecer del Consejo (Claude Council)

```
═══════════════════════════════════════════════════════════════════
                         THE COUNCIL
     "¿Podemos pasar CRACKENTICK a producción ya?"
═══════════════════════════════════════════════════════════════════

⚔ THE ADVERSARY
No. Hay siete 500 reproducidos, configuraciones de router que se guardan antes de
confirmar y un balanceo que solo escribe rutas. Eso no es producción: es una demo
con base de datos. El Engineer tiene razón en que la compensación es la única
forma segura de tocar MikroTik; el Scientist tiene razón en que la agenda no se
rompió en el fuzzing, pero eso solo significa que el fuzzer no encontró el camino.
No confundan "no lo vi" con "no existe".

──────────────────────────────────────────────────────────────────

📈 THE STRATEGIST
La ventana existe: un panel para ISP pequeño con clientes, cobros y red es
valioso. Pero lanzar con tres cifras distintas de "por cobrar" destruye la
confianza más rápido que una función faltante. La ruta corta no es reescribir:
son cuatro semanas. La fase 0 quita los 500; la fase 1 protege la caja. El
Adversary exagera con "demo", pero acierta en que sin cobros confiables no hay
negocio que sostener.

──────────────────────────────────────────────────────────────────

🔬 THE SCIENTIST
Los datos: 14/14 suites pasan, 162 páginas sin error, `npm audit` limpio. Pero
una pasada de fuzzing encontró 7 respuestas 500. Eso mide el camino feliz, no el
camino de error. La agenda no falló en 11 casos malformados; si el usuario vio un
500, necesitamos la URL y la hora del log. Mi probabilidad de "listo" sube cuando
cada entrada inválida devuelve 4xx y cuando el CHR reproduce cada rollback.

──────────────────────────────────────────────────────────────────

🎨 THE VISIONARY
No lancen todo el sistema: lancen un piloto de solo lectura con un router, un
cajero y una cartera. Así obtienen datos reales mientras construyen las
transacciones atómicas y el PCC. La restricción no es "terminar todo", es
"probar un ciclo seguro". Pero el Adversary tiene razón en algo: un estado
parcial en el router es peor que no tener la función.

──────────────────────────────────────────────────────────────────

⚙ THE ENGINEER
El fallo es concreto: la VLAN se crea, la dirección falla, el registro queda en
MongoDB y el reintento duplica. El balanceo no crea ni una tabla de ruteo ni una
regla de mangle; no puede funcionar como PCC. El respaldo usa SSH aunque el
router esté en API y convierte el error en 500. Se arregla con preflight,
compensación, `502` explícito y pruebas en CHR; no con más mensajes de error.

──────────────────────────────────────────────────────────────────

🧘 THE PHILOSOPHER
¿Qué significa "producción"? Si es una demo para una materia, ya está. Si es un
negocio que depende de cobrar y cortar, el estándar es otro: ningún estado
parcial silencioso y ninguna cifra de dinero ambigua. Decidan eso antes de fijar
la fecha. La Humanist preguntará quién absorbe el costo de un corte equivocado.

──────────────────────────────────────────────────────────────────

❤ THE HUMANIST
Al promotor le están pidiendo configurar PPPoE, pools y routers: eso no es un
problema de capacitación, es un problema de diseño de rol. Al equipo de finanzas
le van a dejar de creer después del primer mes con tres "por cobrar". Y quien
explica un corte equivocado al cliente no está en esta sala. Corrijan los roles y
los números antes de salir.

═══════════════════════════════════════════════════════════════════
                         THE VERDICT
═══════════════════════════════════════════════════════════════════

POSITION: No pases a producción todavía. Ejecuta un sprint de cuatro semanas:
primero elimina los 500 y los estados parciales de MikroTik, luego separa venta
de instalación y corrige la contabilidad; después habilita PCC/NAT, pagos
hotspot y respaldos.

CONFIDENCE: 82% — los defectos son reproducibles y están localizados; bajaría si
el objetivo real es solo una demo controlada, y subiría con el fuzz en 0 y el
rollback probado en CHR.

──────────────────────────────────────────────────────────────────

CRITICAL RISKS  (exactly 3)

  1. Partial Router State: una VLAN o regla queda a medias y el reintento duplica
     o rompe el servicio.
  2. Financial Distrust: tres cifras de por cobrar y una utilidad que parece
     descontar deuda hacen que nadie confíe en el dashboard.
  3. Permission Blind Spot: `ventas.ventas` instala, factura y aprovisiona; un
     rol comercial puede tocar red y dinero sin permiso explícito.

──────────────────────────────────────────────────────────────────

NEXT STEPS  (exactly 5)

  1. Corregir los 9 casos de 500 y añadir el fuzz de rutas a la suite.
  2. Implementar preflight, compensación y 502 en VLAN, firewall, EOIP y DHCP.
  3. Separar venta de instalación y crear los nodos `ventas.instalar` y
     `general.servicios`.
  4. Unificar Caja/Devengo, separar por cobrar total/vencido/servicio y probar
     que la deuda no resta utilidad ni el costo se duplica.
  5. Implementar PCC/NAT, pagos hotspot USD/Bs y respaldo API; probar todo en CHR
     antes del piloto.

──────────────────────────────────────────────────────────────────

MINORITY REPORT: 🎨 THE VISIONARY
"Puedes lanzar un piloto de solo lectura con un router y una caja, pero no
llames a eso producción. La restricción real no es la fecha: es no dejar estados
parciales ni números ambiguos."
═══════════════════════════════════════════════════════════════════
```

---

## 11. Decisiones que necesito del negocio

1. ¿La utilidad oficial es **caja** o **devengo**? ¿Cuál se muestra como “utilidad neta”?
2. ¿El costo de equipos se reconoce al comprar o al vender? (para evitar doble costo).
3. ¿El promotor puede ver el estado de la venta y los materiales, o solo crearla?
4. ¿El balanceo se usará con hotspot? Si sí, PCC no aplica; habría que usar ECMP/failover o separar el hotspot.
5. ¿Los respaldos deben funcionar en routers solo-API o se exigirá SSH?
6. ¿Se agregan nodos de permiso `ventas.instalar` y `general.servicios`, o se reutilizan nodos existentes?
7. ¿La puesta en producción será un solo proceso o varias instancias? (define sesión y locks).

---

**Conclusión del plan:** CRACKENTICK tiene una base funcional y una arquitectura defendible. Lo que falta no es “más pantallas”: es cerrar los caminos de error, separar roles, hacer que el router y el dinero sean transaccionales, y probar el sistema con datos y routers reales. Con las fases 0–2 completas se puede hacer un piloto controlado; con la fase 3 y el UAT se puede hablar de producción.
