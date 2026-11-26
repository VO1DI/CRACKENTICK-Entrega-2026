# Guía para llevar CRACKENTICK a otra laptop y usarlo sin internet

Esta guía asume **Windows de 64 bits**. La aplicación funciona completamente offline:
Node.js, MongoDB y las dependencias quedan instaladas en la laptop.

> Importante: no basta con copiar solo `app.js` ni clonar un repositorio. Hay que copiar
> la carpeta completa **incluyendo `node_modules` y `.env`**, porque en la universidad no
> habrá internet para ejecutar `npm install`.

---

## 1. Qué necesitas descargar antes de salir (con internet)

Descarga estos instaladores y guárdalos en el USB o en la misma carpeta del proyecto:

1. **Node.js LTS para Windows (x64)**
   - https://nodejs.org/
   - Versión recomendada: Node 26 LTS (el proyecto pide Node 26).
   - Usa el instalador `.msi` y deja las opciones por defecto.

2. **MongoDB Community Server para Windows**
   - https://www.mongodb.com/try/download/community
   - Versión 7, 8 o 9 (x64). En este equipo funciona la 9.0.
   - En el instalador marca **Install MongoDB as a Service**.
   - MongoDB Compass es opcional (solo para ver la base visualmente).

3. **Opcional:** MongoDB como archivo ZIP (`mongodb-windows-x86_64-...zip`) si en la
   laptop de la universidad no te dejan instalar servicios de Windows.

---

## 2. Preparar el proyecto en esta laptop

1. Detén el servidor si está corriendo (`Ctrl + C` en la terminal).
2. Copia **toda** la carpeta del proyecto a un USB:

   ```text
   C:\Users\Jcrac\OneDrive\Documentos\CRACKENTICK
   ```

   Debe incluir, como mínimo:

   ```text
   CRACKENTICK\
   ├── app.js
   ├── server.js
   ├── seed.js
   ├── package.json
   ├── package-lock.json
   ├── .env                 <-- imprescindible
   ├── node_modules\        <-- imprescindible para instalar sin internet
   ├── config\  controllers\  models\  routes\  services\  views\  public\
   └── GUIA-INSTALACION-OFFLINE.md
   ```

3. Si el USB o el explorador de Windows no muestra `.env`, activa
   **Ver → Elementos ocultos** o comprueba con `dir /a` en PowerShell.
4. También puedes usar el ZIP `CRACKENTICK-offline.zip` que se genera junto a esta guía.

> No uses `git clone` ni copies solo el código fuente: `.env` y `node_modules` están
> excluidos por `.gitignore`.

---

## 3. Instalar en la laptop de la universidad

### 3.1 Node.js

1. Ejecuta el instalador de Node.js.
2. Abre **PowerShell** y comprueba:

   ```powershell
   node -v
   npm -v
   ```

   Debe mostrar Node 26 LTS.

   Si `npm` no se reconoce, usa `npm.cmd` o reinicia la laptop para que tome el `PATH`.

### 3.2 MongoDB

**Opción A: instalador MSI (recomendada)**

1. Ejecuta el `.msi` de MongoDB Community.
2. Elige **Complete**.
3. Deja marcado **Install MongoDB as a Service** y **Run the service as Network Service**.
4. Termina la instalación. El servicio queda en inicio automático.
5. Comprueba en PowerShell:

   ```powershell
   Get-Service MongoDB
   ```

   Debe decir `Running`.

**Opción B: MongoDB portátil (sin instalar servicio)**

1. Descomprime el ZIP de MongoDB en `C:\CRACKENTICK\mongodb`.
2. Crea la carpeta de datos:

   ```powershell
   mkdir C:\CRACKENTICK\data\db
   ```

3. Inicia MongoDB en una terminal aparte:

   ```powershell
   C:\CRACKENTICK\mongodb\bin\mongod.exe --dbpath C:\CRACKENTICK\data\db
   ```

4. Deja esa terminal abierta mientras uses la aplicación.

---

## 4. Copiar y configurar el proyecto

1. Copia la carpeta `CRACKENTICK` a una ruta **sin acentos, sin espacios y fuera de OneDrive**:

   ```text
   C:\CRACKENTICK
   ```

   Evita `C:\Users\...\OneDrive\...`: OneDrive puede sincronizar, bloquear archivos o
   dejar el proyecto sin conexión.

2. Comprueba que existe `C:\CRACKENTICK\.env`. Si no existe:

   ```powershell
   Copy-Item .env.example .env
   ```

   Contenido esperado:

   ```ini
   PORT=3000
   NODE_ENV=development
   MONGODB_URI=mongodb://127.0.0.1:27017/crackentick
   SESSION_SECRET=CAMBIAR_SESSION_SECRET
   ```

   Si copias una base de datos ya existente, conserva el mismo `SESSION_SECRET`
   (o define `ENCRYPTION_KEY`), porque las contraseñas de routers están cifradas.

3. Abre PowerShell en la carpeta:

   ```powershell
   cd C:\CRACKENTICK
   ```

4. **No ejecutes `npm install`**: las dependencias ya vienen en `node_modules`.
   Solo si `node_modules` no se copió, necesitarás internet para:

   ```powershell
   npm install
   ```

---

## 5. Crear los datos de ejemplo

La primera vez, carga la base demo:

```powershell
npm run seed -- --reset
```

o, si `npm` no está en el `PATH`:

```powershell
node seed.js --reset
```

Debe mostrar los conteos: 2 routers, 4 pools, 5 planes, 5 usuarios, 12 movimientos
financieros, 12 clientes, 11 servicios, 3 ventas, 36 facturas, etc.

> `--reset` borra la base `crackentick` y la vuelve a crear. Úsalo solo para iniciar
> desde cero o para recuperar la demo.

---

## 6. Iniciar la aplicación

Desde `C:\CRACKENTICK`:

```powershell
npm start
```

o:

```powershell
node server.js
```

También puedes hacer doble clic en `iniciar.bat`.

Debe aparecer:

```text
✅ MongoDB conectado en 127.0.0.1/crackentick
🚀 CRACKENTICK en http://localhost:3000
```

Abre el navegador en:

**http://localhost:3000/login**

### Credenciales

| Usuario | Contraseña | Acceso |
|---|---|---|
| `admin` | `admin123` | Todos los nodos (se muestra como Juan Echenique) |
| `tecnico` | `tecnico123` | Clientes, routers, monitoreo, ventas y tickets |
| `ventas` | `ventas123` | Clientes, ventas, inventario y facturas |
| `finanzas` | `finanzas123` | Facturación, facturas, finanzas y gastos |
| `soporte` | `soporte123` | Clientes, monitoreo y tickets |

---

## 7. Uso diario en la universidad

1. Enciende la laptop. El servicio **MongoDB** debe estar en ejecución
   (`Get-Service MongoDB`). Si no lo está:

   ```powershell
   Start-Service MongoDB
   ```

   Si Windows pide permisos de administrador, abre PowerShell como administrador.

2. Abre `C:\CRACKENTICK` y ejecuta `iniciar.bat` o `npm start`.
3. Entra a http://localhost:3000.
4. Para detener el servidor, pulsa `Ctrl + C` en la terminal.

No hace falta internet. La aplicación no llama a servicios externos para funcionar;
las fuentes de Google pueden no cargarse y el navegador usará las fuentes del sistema.

---

## 8. Si algo falla

| Síntoma | Causa probable | Solución |
|---|---|---|
| `node` o `npm` no se reconoce | Node.js no instalado o `PATH` sin actualizar | Instala Node.js LTS y reinicia la laptop |
| `ECONNREFUSED 127.0.0.1:27017` | MongoDB no está corriendo | `Start-Service MongoDB` o inicia `mongod` portátil |
| `No se pudo iniciar la aplicación` | URI o base incorrecta | Revisa `MONGODB_URI` en `.env` |
| El puerto 3000 está ocupado | Otro proceso lo usa | Cambia `PORT=3001` en `.env` y abre `http://localhost:3001` |
| `Cannot find module 'express'` | No se copió `node_modules` | Copia `node_modules` o ejecuta `npm install` con internet |
| `EADDRINUSE` | Ya hay un servidor CRACKENTICK abierto | Cierra la otra terminal o cambia el puerto |
| La base quedó inconsistente | Se modificó con pruebas | `npm run seed -- --reset` |
| Las contraseñas de routers no descifran | Cambió `SESSION_SECRET` o `ENCRYPTION_KEY` | Usa el mismo `.env` con el que se guardaron o vuelve a sembrar |
| Las fuentes se ven distintas | Sin internet no carga Google Fonts | Es normal; la aplicación funciona igual |

---

## 9. Copia de seguridad rápida (opcional)

Si quieres conservar los datos que cargues en la universidad, copia la carpeta de datos
de MongoDB o genera un respaldo con las herramientas de MongoDB:

```powershell
mongodump --db crackentick --out C:\respaldo-crackentick
```

Para restaurar en otra instalación:

```powershell
mongorestore --db crackentick C:\respaldo-crackentick\crackentick
```

Si no tienes `mongodump`, la alternativa es volver a sembrar la demo con
`node seed.js --reset`.

---

## 10. Checklist final

- [ ] Node.js LTS instalado (`node -v` funciona).
- [ ] MongoDB instalado y corriendo (`Get-Service MongoDB` = `Running`).
- [ ] Carpeta copiada en `C:\CRACKENTICK` con `node_modules` y `.env`.
- [ ] `npm run seed -- --reset` ejecutado una vez.
- [ ] `npm start` muestra `CRACKENTICK en http://localhost:3000`.
- [ ] Login con `admin` / `admin123` funciona.
- [ ] Se probó desconectando el Wi-Fi.
