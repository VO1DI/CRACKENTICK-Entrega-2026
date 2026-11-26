# RUNBOOK — CRACKENTICK

Guía de operación para levantar, verificar, respaldar, actualizar y recuperar el sistema.

> Este runbook asume Windows + PowerShell. En Linux/macOS cambian solo los comandos de servicio y rutas. No contiene contraseñas reales: usa las de tu `.env` y tu base.

---

## 1. Topología mínima

```
Navegador
   │ HTTP :3000
   ▼
Node.js / Express  ──►  MongoDB :27017
   │
   ├── API RouterOS :8728
   ├── SSH RouterOS :2222
   └── SSH Cisco :22 (opcional)
```

Servicios:

| Servicio | Puerto local | Notas |
|---|---|---|
| CRACKENTICK | 3000 | `HOST=127.0.0.1` por defecto |
| MongoDB | 27017 | Local o remoto |
| CHR API | 8728 | Laboratorio |
| CHR SSH | 2222 | Respaldos y modo SSH |
| CHR WinBox | 8291 | Administración del CHR |

---

## 2. Arranque rápido

```powershell
cd C:\ruta\CRACKENTICK

# 1. Verificar Node y dependencias
node -v            # debe ser 26.x
npm ci             # o npm install

# 2. Verificar entorno
Test-Path .env
Get-Content .env | Select-String 'MONGODB_URI|ENCRYPTION_KEY|SESSION_SECRET'

# 3. Arrancar
npm start
```

En otra terminal:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/health
```

Respuesta esperada:

```json
{"ok":true,"db":"up","uptimeSegundos":10,"version":"1.0.0"}
```

Si `ok` es `false` o `db` es `down`, revisar MongoDB y `MONGODB_URI`.

### Arranque en segundo plano (Windows)

```powershell
$log = "$env:TEMP\crackentick-app.log"
Start-Process -FilePath "node" `
  -ArgumentList "server.js" `
  -WorkingDirectory "C:\ruta\CRACKENTICK" `
  -RedirectStandardOutput $log `
  -RedirectStandardError "$log.err" `
  -WindowStyle Hidden
```

### Detener

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000 |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

## 3. CHR de laboratorio

El CHR es opcional; solo se necesita para probar MikroTik.

```powershell
# Arrancar con QEMU (ejemplo; ajusta las rutas)
& "C:\CHR-QEMU\qemu\qemu-system-x86_64.exe" `
  -M q35 -m 512 -accel tcg -smp 2 `
  -drive "file=C:\CHR-QEMU\chr-7.20.2.vhd,format=vpc,if=ide" `
  -nic "user,model=e1000,hostfwd=tcp:127.0.0.1:8728-:8728,hostfwd=tcp:127.0.0.1:2222-:22,hostfwd=tcp:127.0.0.1:8291-:8291" `
  -vnc 127.0.0.1:1
```

Esperar 30–60 segundos a que RouterOS arranque.

Comprobar:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8728,2222
```

En la app: **Red → Routers → CHR → Probar conexión**.

Para apagarlo: cierra la ventana de QEMU o termina el proceso `qemu-system-x86_64`.

---

## 4. Primer arranque y datos

```powershell
# Base demo completa
npm run seed -- --reset

# Base limpia (solo admin)
npm run vaciar
```

Credenciales demo: ver `README.md`. Cámbialas antes de publicar.

---

## 5. Verificación después de un cambio

```powershell
npm test
node pruebas/probar-permisos.js
node pruebas/probar-humo.js
node pruebas/auditar-paginas.js
npm audit --omit=dev
```

Resultado esperado:

- `npm test`: 18 suites OK.
- Permisos: sin accesos indebidos.
- Humo: 15 comprobaciones.
- Auditoría: 0 errores.
- `npm audit`: 0 vulnerabilidades.

También revisar:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/health
Get-Content "$env:TEMP\crackentick-app.log" -Tail 100
```

---

## 6. Respaldos

### 6.1 Base de datos

Con MongoDB Database Tools:

```powershell
$fecha = Get-Date -Format "yyyyMMdd-HHmm"
mongodump --uri="mongodb://127.0.0.1:27017/crackentick" --out="C:\respaldos\crackentick-$fecha"
```

Restaurar:

```powershell
mongorestore --uri="mongodb://127.0.0.1:27017" --drop "C:\respaldos\crackentick-YYYYMMDD-HHMM"
```

> `--drop` elimina la base actual antes de restaurar. Úsalo solo con confirmación.

### 6.2 Respaldo del sistema desde la app

**Configuración → Respaldos del sistema**. Requiere `rclone` configurado (`RCLONE_PATH`).

### 6.3 Respaldos de routers

**Red → Avanzado → Respaldos**.

- `.rsc`: exporta comandos; no reemplaza la configuración.
- Binario: estado completo, cifrado en la base; al restaurar reinicia el router.
- Lógico API: solo consulta, no restaurable automáticamente.

Se conservan las últimas **30 copias por router**.

---

## 7. Incidentes frecuentes

### La app no arranca

1. `node -v` debe ser 26.x.
2. `ENCRYPTION_KEY` debe existir en producción.
3. `SESSION_SECRET` no debe ser el valor de ejemplo en producción.
4. MongoDB debe estar escuchando en 27017.
5. Puerto 3000 ocupado:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000
```

### `db: down` en `/health`

```powershell
Get-Service MongoDB
Start-Service MongoDB
```

Revisar `MONGODB_URI` y credenciales.

### Login responde 403 o no inicia sesión

- El formulario necesita el token CSRF; recarga la página.
- Si cambió `SESSION_SECRET`, todas las sesiones anteriores quedan inválidas.
- Limpiar cookies de `localhost:3000`.

### La app responde 403 al guardar

- El usuario no tiene permiso de edición en ese nodo.
- Revisar **Usuarios → permisos**.
- En clientes, los permisos son: `clientes.datos`, `clientes.servicio`, `clientes.cortes`, `clientes.facturacion`.

### Router API/SSH no responde

```powershell
Test-NetConnection 127.0.0.1 -Port 8728
Test-NetConnection 127.0.0.1 -Port 2222
```

- Verificar `/ip/service api` y `/ip/service ssh` en RouterOS.
- Revisar usuario, contraseña y que el router esté en modo real.
- En **Red → Routers → Probar conexión** se guarda el resultado.

### Respaldo falla por SSH

- Habilitar SSH en el router o usar el respaldo lógico por API.
- Revisar `sshPort` del router.
- Verificar que el binario no supere 4 MB.

### Balanceo no reparte tráfico

- Está en **Experimental**.
- Requiere dos WAN reales con salida.
- PCC no es compatible con HotSpot.
- Revisar que LAN, WAN, gateway e interfaces existan.
- Probar con un cliente detrás de la LAN: mangle, rutas por tabla, NAT y failover.

### Vouchers o hotspot con error

- Verificar que el router tenga hotspot habilitado.
- Revisar que el perfil exista en RouterOS.
- Si el lote quedó `incomplete`, revisar `lastErrors` y eliminar usuarios huérfanos.

### Una venta no se instala

- Revisar el mensaje del router.
- Si el aprovisionamiento falla, la venta queda en espera y se revierten cliente/servicio/factura/stock.
- Corregir router, plan, pool o IP y reintentar.

---

## 8. Actualización y rollback

```powershell
# 1. Respaldo de base
mongodump --uri="mongodb://127.0.0.1:27017/crackentick" --out="C:\respaldos\pre-actualizacion"

# 2. Actualizar código
git pull
npm ci

# 3. Migraciones pendientes
Get-ChildItem migraciones -Filter *.js | Sort-Object Name | ForEach-Object { node $_.FullName }

# 4. Verificar
npm test
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/health
```

Rollback:

1. Detener la app.
2. Volver al commit anterior (`git checkout <commit>`).
3. Restaurar la base con `mongorestore`.
4. `npm ci` y arrancar.

---

## 9. Seguridad operativa

- Cambiar `admin123` y las claves demo.
- `SESSION_SECRET` y `ENCRYPTION_KEY` deben ser aleatorios y privados.
- No versionar `.env` ni `CREDENCIALES.txt`.
- Usar HTTPS en producción; la cookie `secure` exige HTTPS.
- Rotar credenciales de routers, Telegram y proveedores de IA.
- Al cambiar `ENCRYPTION_KEY`, volver a guardar las credenciales cifradas; de lo contrario no se descifran.
- Revisar **Auditoría** después de cambios de red o cobros.

---

## 10. Mantenimiento periódico

| Frecuencia | Tarea |
|---|---|
| Diario | Revisar `/health`, alertas y tickets críticos |
| Semanal | Revisar respaldos de base y routers; probar descarga |
| Mensual | Revisar usuarios/permisos, stock mínimo y deuda |
| Trimestral | Restaurar un respaldo en entorno de prueba |
| Cada cambio | `npm test`, humo, permisos y auditoría de páginas |

---

## 11. Contactos y responsables

- Responsable técnico: ______________________
- Responsable de base de datos: _____________
- Responsable de red: _______________________
- Horario de soporte: _______________________
- Proveedor de Internet / ISP: ______________

---

## 12. Limitaciones conocidas

- Balanceo PCC/ECMP en **Experimental**; falta prueba de reparto y failover con dos WAN reales.
- Cisco probado solo con simulador.
- Restauración `.rsc` puede quedar parcial.
- DHCP/tráfico/consumo usan API RouterOS; en router solo-SSH pueden quedar sin datos.
- Una instancia principal; los trabajos usan lock en MongoDB, pero el escalado horizontal requiere revisión.
