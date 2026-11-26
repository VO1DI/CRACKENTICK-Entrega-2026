# Investigación: plataformas de gestión para ISP y brechas de CRACKENTICK

Fecha: 2026-11-22 (segunda versión, con fuentes consultadas en línea)
Estado: documento de trabajo. No implementa nada por sí solo.

## 1. Método

Se consultaron los sitios públicos de las plataformas el 2026-11-22 y se extrajo
su lista de módulos. No se probaron las demos ni se leyó documentación interna.

Fuentes:

- Splynx — <https://splynx.com/features/>, <https://splynx.com/network-management>,
  <https://splynx.com/tr069-acs>, <https://splynx.com/scheduling-field-services>
- Wispro — <https://wispro.co/>, <https://www.wispro.co/administrar-olt-fibra-optica>
- Sonar — <https://sonar.software/>
- Powercode — <http://www.powercode.com/>
- UISP (Ubiquiti) — <https://uisp.com/> (el sitio exige JavaScript; no se pudo leer)
- MikroWisp — `mikrowisp.com` devuelve una página de espera y `mikrowisp.cl` no
  resuelve. **No se pudo verificar su lista de funciones hoy.**

## 2. Qué ofrece cada plataforma

### Splynx

Facturación (recurrente y prepago), CRM, gestión de clientes, ticketing,
agenda y servicios de campo, inventario, API abierta, WhatsApp, ACS TR-069,
hotspot Wi-Fi, ciberseguridad, facturación a revendedores y VoIP.

Su módulo de red es el más completo del grupo:

- **RADIUS propio**: autenticación, estadísticas, bloqueo y limitación de velocidad.
- **IPAM IPv4/IPv6** integrado con ACS y RADIUS.
- **Monitorización y respaldos**: SNMP, ping, SSH, control de cambios de configuración.
- **ACS TR-069**: aprovisionamiento automático de CPE, actualizaciones masivas de
  firmware, reinicio y cambio de Wi-Fi remoto, diagnóstico (ping, traceroute,
  analizador Wi-Fi). Se licencia aparte: ~100 USD/mes por cada 1000 CPE.
- **Agenda**: tablero en tiempo real, flujos de trabajo, bitácoras, calendario
  sincronizado con Google, órdenes creadas desde tickets y edición en el mapa.

### Wispro

Enfoque LatAm, muy fuerte en fibra y en facturación electrónica local.

- **OLT/ONU**: autorización y aprovisionamiento de ONT, perfiles de ancho de banda
  por cliente o plan, potencia óptica en vivo, alertas de potencia, VLAN y puertos,
  control de CATV, relación ONT-cliente y **cajas NAP geolocalizadas con control
  de puertos** (disponible/ocupado, historial de quién se conectó y cuándo).
- **Facturación electrónica** para Argentina (ARCA), Colombia (DIAN), Ecuador (SRI),
  México (SAT) y Perú (SUNAT).
- **Apps**: una para el técnico (órdenes, geolocalización, contacto con el cliente)
  y otra para el cliente (pago de facturas, notificaciones, cambio de clave Wi-Fi,
  promesas de pago).
- **ACS TR-069** para gestión remota de equipos del cliente.
- Automatización de atención por WhatsApp y redes sociales.

### Sonar

OSS/BSS unificado para ISPs de fibra, WISP y cable.

- Cuentas, facturación con impuestos multi-jurisdicción, comunicaciones masivas.
- Tickets con SLA y escalamiento.
- **Agenda con despacho, optimización de rutas y GPS en tiempo real.**
- **Red e IPAM**: inventario de IPs, monitorización multivendor y detección de cortes.
- Inventario, órdenes de compra, herramientas de ubicación (área de servicio),
  tareas internas, reportes con Looker, IA, pagos integrados y API GraphQL.

### Powercode

- **Command** (BSS/OSS): facturación, cuentas, aprovisionamiento, tickets, agenda,
  inventario, reportes, voz y portal del cliente. **IPv4 e IPv6 con DHCPv6-PD.**
- **Link**: motor de DHCPv4/DHCPv6 con delegación de prefijos, gestión de leases,
  polling SNMP, sondeo ICMP y consola única; migración desde sus equipos antiguos.
- **Atlas**: planta externa (GIS, diseño y obra de fibra).

### Patrones comunes

1. Todo gira alrededor de la **ficha del cliente** (servicio, red, finanzas, soporte).
2. **RADIUS + IPAM + SNMP** son el núcleo de red; no solo la API del router.
3. El **portal/app del cliente** y la **app del técnico** son producto, no extra.
4. **TR-069/ACS** para los equipos del cliente (CPE), separado de la OLT.
5. **Facturación electrónica** según el país.
6. **Geolocalización** de clientes, NAP y técnicos.
7. **Multi-tenant / revendedores** en los planes altos.

## 3. Comparación con CRACKENTICK

| Módulo | CRACKENTICK | Splynx | Wispro | Sonar | Powercode |
|---|---|---|---|---|---|
| Clientes, planes, suscripciones | Sí | Sí | Sí | Sí | Sí |
| Facturación y cobros | Sí | Sí | Sí | Sí | Sí |
| Corte por mora | Sí | Sí | Sí | Sí | Sí |
| PPPoE / colas / address list | Sí | Sí | Sí | Sí | Sí |
| VLAN / firewall / EOIP / balanceo | Sí | Parcial | Parcial | Parcial | Parcial |
| Respaldos de router y diff | Sí (sin diff) | Sí | Sí | Parcial | Parcial |
| Transporte SSH de emergencia | Sí | Sí | Sí | Sí | Sí |
| IPAM IPv4/IPv6 | No | Sí | No | Sí | Sí |
| RADIUS | No | Sí | Sí | Parcial | No |
| SNMP / detección de cortes | No | Sí | Parcial | Sí | Sí |
| TR-069 / ACS (CPE) | No | Sí | Sí | No | No |
| Hotspot | No | Sí | No | No | No |
| OLT / ONU + NAP | No | No | Sí | No | Parcial (Atlas) |
| Agenda / app técnico con GPS | No | Sí | Sí | Sí | Sí |
| Portal / app del cliente | No | Sí | Sí | Sí | Sí |
| Facturación electrónica local | No | Multi | 5 países | Multi | Multi |
| Inventario serializado | Sí | Sí | Sí | Sí | Sí |
| Tickets con SLA | Parcial | Sí | Sí | Sí | Sí |
| Multi-revendedor | No | Sí | Sí | Sí | Sí |
| IPv6 / DHCPv6-PD | No | Sí | Parcial | Parcial | Sí |

## 4. Ideas concretas que valen para CRACKENTICK

Ordenadas por relación valor/esfuerzo:

1. **IPAM** (Sonar, Splynx): mapa de pools, uso por zona y detección de IP
   duplicada o fuera de rango. Hoy hay pools, pero no una vista de ocupación.
2. **Detección de cortes** (Sonar, Powercode Link): sondeo ICMP/SNMP por router y
   por cliente, con historial y alerta. Se apoya en lo que ya hay de monitorización.
3. **TR-069/ACS** (Splynx, Wispro): en vez de escribir un ACS propio, evaluar
   **GenieACS** (open source) y conectar CRACKENTICK por su API NBI. Da cambio de
   Wi-Fi, reinicio, firmware y diagnóstico sin visitar al cliente.
4. **Agenda y app de técnico** (los cuatro): órdenes con estado, fotos, firma,
   geolocalización y checklist. Encaja con los reportes de instalación actuales.
5. **Portal/app del cliente** (los cuatro): estado de cuenta, pago, tickets,
   consumo y cambio de clave Wi-Fi. Es la brecha más grande hoy.
6. **RADIUS** (Splynx, Wispro): FreeRADIUS para AAA y contabilidad; habilita
   hotspot multi-router y consumo real por sesión.
7. **NAP y OLT** (Wispro): si hay fibra, el control de cajas NAP con puertos y
   geolocalización aporta más que la OLT al principio.
8. **Diff de respaldos** (Splynx): comparar dos respaldos y avisar de cambios.
   Sobre lo que ya hay, es barato y muy útil en soporte.
9. **IPv6/DHCPv6-PD** (Powercode): planificar el direccionamiento desde el modelo
   de datos antes de que haga falta.
10. **Facturación electrónica**: no aplica a Venezuela tal cual; habría que ver
    SENIAT. No copiar el modelo de los otros países.

## 5. Lo pedido: factibilidad

### 5.1 Registro de IPs (cumplimiento)

Guardar qué IP usó cada cliente y cuándo:

- Colección `ConnectionLog { clientId, subscriptionId, username, ip, mac,
  routerId, startedAt, endedAt, source }`.
- Fuentes: `/ppp/active/print` periódico, `/ip/dhcp-server/lease/print` y syslog
  de conexión/desconexión del router.
- Retención con TTL (p. ej. 90 días) e índice por cliente y fecha.
- Los **destinos visitados** requieren NetFlow/IPFIX o logs de conexiones; es otro
  nivel de volumen y de privacidad. Solo con requisito legal explícito.

Esfuerzo: 3–5 días. Riesgo: privacidad y base legal.

### 5.2 Consumo diario por cliente

- Tarea horaria que lea los contadores de las colas (`bytes`) y guarde un snapshot
  en `TrafficDaily { clientId, date, rxBytes, txBytes, peakRx, peakTx }`.
- Agregación diaria y gráfico por rango; exportación CSV.
- Con RADIUS, la fuente sería `radacct` (más exacta).

Esfuerzo: 4–6 días. Riesgo: leer por lotes; nunca una conexión por cliente.

### 5.3 Hotspot

- Servidores y perfiles de hotspot en RouterOS, portal cautivo propio.
- Vouchers con tiempo/tráfico, impresión y QR; venta desde caja.
- Sin RADIUS, los usuarios viven en el router (no escala a varios equipos).

Esfuerzo: 2–3 semanas para una versión vendible.

### 5.4 RADIUS

- FreeRADIUS + MySQL/PostgreSQL (`radcheck`, `radreply`, `radacct`, `radusergroup`).
- La app da de alta usuarios y lee sesiones/consumo; RouterOS apunta a RADIUS
  para PPPoE y/o hotspot.
- Habilita: hotspot multi-router, accounting real y limitación centralizada.

Esfuerzo: 3–4 semanas. Riesgo: infraestructura nueva (servidor, respaldo, HA).

### 5.5 OLT / GPON

Wispro confirma el patrón: autorizar ONT, perfiles de velocidad, potencia óptica,
VLAN/puertos, CATV y NAP geolocalizadas. Cada marca tiene su interfaz:

- Huawei MA5600/MA5800: SNMP + CLI.
- ZTE C320/C300: SNMP + CLI.
- VSOL: CLI/Telnet y, según modelo, API.

Empezar por **una marca y un modelo** en laboratorio: 4–6 semanas por familia.
Sin equipo real no se puede garantizar compatibilidad.

### 5.6 Portal del cliente

- Autenticación aparte (cédula/código + clave o enlace mágico).
- Estado de cuenta, facturas, pago, tickets, consumo y datos del plan.
- Base para una app móvil después (PWA primero).

Esfuerzo: 2–3 semanas el MVP.

### 5.7 Multimodo PPPoE / DHCP / IP estática

| Modo | Qué hace hoy | Falta |
|---|---|---|
| PPPoE | Perfil + secret + cola con velocidad; el corte deshabilita el secret | Nada crítico |
| IP estática | IP en `CLIENTES` + cola por IP | Verificar que la IP esté libre antes de asignar |
| DHCP | Se trata como IP fija | **No guarda MAC ni crea lease** en `/ip/dhcp-server/lease` |

Arreglo pequeño: `serviceConfig.macAddress` + upsert de lease DHCP. Powercode
demuestra que el camino natural es DHCPv4/v6 con delegación de prefijos.

## 6. Brechas priorizadas

**P1 — operación diaria**
1. Portal del cliente (MVP).
2. Consumo diario histórico.
3. DHCP con lease y MAC.
4. IPAM con ocupación por pool/zona.
5. Registro de IP por cliente.

**P2 — ingresos y soporte**
6. Hotspot con vouchers.
7. RADIUS + accounting.
8. Agenda/app de técnico.
9. TR-069 (GenieACS) para CPE.
10. Diff de respaldos.

**P3 — escalado**
11. OLT (una marca).
12. NAP geolocalizadas.
13. Multi-revendedor.

## 7. Arquitectura sugerida

- **Recolector de red** separado: lee routers por lotes (IPs, leases, colas,
  sesiones) y escribe snapshots. No debe competir con las peticiones del usuario.
- **Patrón driver** por familia de equipo (`mikrotik`, `cisco`, `olt-*`,
  `acs-*`) con interfaz común (`probar`, `aplicar`, `leer`), como el driver de
  firewall que ya existe.
- **Colecciones nuevas**: `TrafficDaily`, `ConnectionLog`, `HotspotVoucher`,
  `RadiusSession`, `OltOnu`, `NapBox`.
- **Retención**: TTL por colección y purga programada.

## 8. Riesgos y decisiones pendientes

- Legalidad y retención de IPs/destinos.
- ¿RADIUS propio o servicio externo?
- ¿Qué marca de OLT hay en la red real?
- Portal: ¿cédula, código de cliente o correo como usuario?
- Hotspot: ¿venta en caja o autocobro?
- TR-069: ¿GenieACS o desarrollo propio?

## 9. Roadmap sugerido (12 semanas)

1. Semanas 1–2: DHCP con lease + IPAM básico.
2. Semanas 3–5: consumo diario + registro de IP.
3. Semanas 6–8: portal del cliente MVP.
4. Semanas 9–10: hotspot con vouchers.
5. Semanas 11–12: RADIUS o piloto de TR-069 con GenieACS.
