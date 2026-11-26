# CRACKENTICK

Sistema web de gestión para un ISP (proveedor de internet): clientes, servicios, ventas, instalaciones, inventario, facturación, cobros, red MikroTik/Cisco, tickets, agenda, hotspot, reportes, auditoría y portal del cliente.

Construido con **Node.js + Express + MongoDB + EJS**, sin frameworks de CSS. La interfaz tiene tres temas (oscuro, claro arena y claro lavanda), animaciones con Motion y soporte para escritorio y móvil.

> **Entrega académica:** este repositorio es una copia limpia del proyecto, sin `.env`, credenciales, `node_modules`, discos de RouterOS ni archivos temporales. Para ejecutarlo, sigue la sección de instalación y crea tu propio `.env`.

---

## Estado verificado

| Comprobación | Resultado |
|---|---|
| Suites automatizadas (`npm test`) | **18/18** |
| Matriz de permisos | 136 GET y 129 POST revisados |
| Humo de páginas principales | 15/15 |
| Auditoría de navegación | 160 páginas, 0 errores |
| Fuzzing de entradas inválidas | 0 respuestas 500 en los casos probados |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| Sintaxis de todos los archivos JS | 0 errores |

La revisión funcional se hizo contra un **CHR RouterOS 7.20.2 en QEMU** (API 8728 y SSH 2222) y un simulador Cisco. Las funciones no probadas de punta a punta están agrupadas en la zona **Experimental**.

---

## Tecnologías

- **Node.js 26 LTS** (`.nvmrc` incluido)
- **Express 4**
- **MongoDB + Mongoose 8**
- **EJS + express-ejs-layouts**
- **express-session** con almacén en MongoDB
- **connect-flash**, **method-override**, **morgan**
- **node-routeros** para la API MikroTik
- **ssh2** para MikroTik SSH y Cisco
- **Motion** y **Chart.js** servidos localmente
- CSS y JavaScript propios

---

## Funcionalidades

- **Dashboard** con KPIs, alertas, tickets, stock, deuda y gráficos de 6 meses.
- **Clientes** con ficha por pestañas: datos, servicio, monitoreo, facturación, tickets e historial.
- **Permisos granulares de cliente**: datos/portal, servicio técnico, cortes/PPPoE y facturación.
- **Planes y servicios**: PPPoE, IP estática y DHCP; colas simples o address list.
- **Ventas e instalaciones**: el promotor puede crear la venta sin servicio; el técnico la completa e instala. Si el router rechaza el aprovisionamiento, la venta no se marca instalada y se revierten cliente, servicio, factura y stock.
- **Inventario** por cantidad y serializado, con movimientos, stock mínimo y alertas.
- **Facturación y cobros** en USD/Bs, tasa BCV, mora, anulación y pagos.
- **Contabilidad** en base Caja o Devengo, con utilidad, costo de equipos, compras de inventario y por cobrar.
- **Red**: routers MikroTik/Cisco, pools, IPAM, VLANs, DHCP, firewall, EOIP, balanceo PCC/ECMP y respaldos.
- **Hotspot**: planes, lotes de vouchers, venta en USD/Bs y limpieza de vencidos.
- **Soporte**: tickets con conversación pública/interna.
- **Agenda**: tareas por técnico, duración, prioridad, categoría y estados.
- **Reportes** de instalaciones y averías por zona.
- **Auditoría** append-only con comandos y resultados.
- **Portal del cliente**: facturas, tickets, tema y estado del servicio.
- **Asistente IA** opcional, con herramientas filtradas por permisos y confirmación de cambios.
- **Zona Experimental** para funciones avanzadas no probadas de punta a punta.

---

## Requisitos

- Node.js **26 LTS** (recomendado; `package.json` exige `>=26 <27`)
- MongoDB local o remoto
- Opcional: QEMU + CHR RouterOS para probar funciones de red
- Windows, Linux o macOS

---

## Instalación rápida

```powershell
# 1. Dependencias
npm install

# 2. Crear el archivo de entorno
Copy-Item .env.example .env
# Edita .env y define SESSION_SECRET y ENCRYPTION_KEY

# 3. Cargar datos de demostración
npm run seed -- --reset

# 4. Arrancar
npm start
```

Abre `http://localhost:3000`.

### Variables de entorno

| Variable | Uso |
|---|---|
| `PORT` | Puerto HTTP (3000 por defecto). |
| `HOST` | Interfaz de escucha (`127.0.0.1` por defecto). |
| `NODE_ENV` | `development` o `production`. |
| `MONGODB_URI` | Cadena de conexión a MongoDB. |
| `SESSION_SECRET` | Firma de la cookie de sesión. |
| `ENCRYPTION_KEY` | Clave de 32 bytes en hexadecimal para cifrar credenciales y respaldos. |
| `CHR_API_PASSWORD` | Opcional, clave del usuario API del CHR de laboratorio. |
| `RCLONE_PATH` | Opcional, ruta al ejecutable de rclone para respaldos del sistema. |

Genera una clave de cifrado con:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

En desarrollo, si `ENCRYPTION_KEY` falta, el sistema arranca con una clave de desarrollo y muestra un aviso. En producción es obligatoria.

### Datos demo

`npm run seed -- --reset` crea 5 usuarios de demostración:

| Usuario | Clave | Rol |
|---|---|---|
| `admin` | `admin123` | Administrador |
| `tecnico` | `tecnico123` | Técnico |
| `ventas` | `ventas123` | Ventas |
| `finanzas` | `finanzas123` | Finanzas |
| `soporte` | `soporte123` | Soporte |

**Cambia estas claves antes de exponer el sistema.**

Otros comandos:

```powershell
npm run seed -- --reset   # borra y reconstruye la demo
npm run vaciar            # deja la base vacía con solo admin
npm run dev               # nodemon
npm test                  # suites automatizadas
```

---

## Permisos

Los permisos tienen dos niveles: **ver** y **editar**. El rol `admin` siempre tiene acceso total.

| Nodo | Alcance |
|---|---|
| `general.dashboard` | Dashboard |
| `general.clientes` | Listar y abrir clientes |
| `clientes.datos` | Editar datos, portal y eliminar cliente sin historial |
| `clientes.servicio` | Crear/editar servicio, plan, router, pool, IP y PPPoE |
| `clientes.cortes` | Cortar/restaurar por MOROSOS y activar/desactivar PPPoE |
| `clientes.facturacion` | Ver la pestaña Facturación del cliente |
| `ventas.ventas` | Crear/cancelar ventas |
| `ventas.instalar` | Completar e instalar ventas |
| `ventas.inventario` | Inventario |
| `red.*` | Routers, pools, planes, monitoreo, VLANs, DHCP, firewall, EOIP, balanceo y respaldos |
| `soporte.tickets` | Tickets |
| `soporte.asistente` | Asistente IA |
| `agenda.gestion` | Agenda |
| `hotspot.gestion` | Hotspot |
| `finanzas.*` | Facturación, facturas y contabilidad |
| `admin.*` | Usuarios, empleados, gastos, configuración y auditoría |

Las pestañas de la ficha del cliente se muestran solo si el usuario tiene el permiso correspondiente. Las rutas también validan el permiso; no basta con ocultar el botón.

---

## MikroTik y Cisco

### MikroTik

Probado contra CHR RouterOS 7.20.2:

- VLAN: crear, actualizar y eliminar.
- Firewall: crear y eliminar reglas.
- EOIP: crear y eliminar túneles.
- DHCP: crear pool/red/servidor y listar.
- PPPoE, cola simple, address list y perfiles.
- Balanceo PCC/ECMP: tablas, mangle, rutas y NAT; limpieza por etiqueta.
- Respaldos `.rsc`, binario y lógico por API.
- Hotspot: lote, venta USD/Bs, revocación y limpieza.

### Cisco

Implementación **experimental** para pruebas de conexión SSH, respaldo, VLAN y balanceo ECMP. El aprovisionamiento de servicios, firewall y EOIP no se ejecuta en Cisco.

### Zona Experimental

En **Red → Avanzado → Experimental** están las funciones que no se probaron de punta a punta:

- Firewall (se probó crear/eliminar, no el bloqueo real).
- EOIP (no se probó tráfico entre sedes).
- Balanceo PCC/ECMP (no se probó reparto ni failover con dos WAN reales).
- DHCP (no se probó entrega de leases a clientes).
- Reparación completa.
- Restauración `.rsc` (puede quedar parcial).
- Funciones Cisco.

Cada página experimental muestra un aviso y una insignia “Sin probar”.

---

## Pruebas

```powershell
npm test
```

Cubre: seguridad, temas, Telegram, concurrencia, facturas, economía, balanceo, ventas fallidas, hotspot, portal, agenda, tipos de tarea, presets, rendimiento, clientes, tickets, monitoreo y Cisco.

Comprobaciones adicionales:

```powershell
node pruebas/probar-permisos.js
node pruebas/probar-humo.js
node pruebas/auditar-paginas.js
```

---

## Estructura

```
config/         conexión a MongoDB y constantes
controllers/    controladores MVC
middlewares/    autenticación, permisos, errores
models/         esquemas Mongoose
routes/         rutas Express
services/       lógica de negocio y RouterOS/Cisco
utils/          fechas, dinero, IP, errores, sesiones
views/          plantillas EJS, layouts y parciales
public/         CSS, JS, fuentes locales y vendor
pruebas/        suites y scripts de auditoría
migraciones/    scripts de migración de datos/permisos
docs/           documentación técnica y de producción
scripts/        utilidades operativas
```

---

## Documentación

- [`RUNBOOK.md`](RUNBOOK.md): operación, arranque, respaldos, incidentes y despliegue.
- [`docs/CAMBIOS-2026-11-26.md`](docs/CAMBIOS-2026-11-26.md): cambios y verificaciones recientes.
- [`docs/PLAN-PRODUCCION-2026-11-25.md`](docs/PLAN-PRODUCCION-2026-11-25.md): plan de producción y riesgos.
- [`docs/DOCUMENTO-DESARROLLO-v1.6.md`](docs/DOCUMENTO-DESARROLLO-v1.6.md): especificación funcional y técnica.

---

## Limitaciones conocidas

- El balanceo PCC está implementado y aplica/limpia objetos, pero **no se probó reparto ni failover con dos WAN reales**.
- Cisco no se probó con hardware real.
- La restauración `.rsc` no reemplaza la configuración: importa comandos y puede detenerse en un objeto duplicado.
- DHCP, tráfico y consumo usan la API RouterOS; en un router solo-SSH pueden quedar sin datos.
- El sistema está pensado para una instancia principal. Los trabajos programados usan un lock en MongoDB, pero un despliegue multi-instancia requiere planificarlo.
- La rotación de `ENCRYPTION_KEY` exige volver a guardar las credenciales cifradas.

---

## Licencia

MIT.
