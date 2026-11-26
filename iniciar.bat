@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js no esta instalado o no esta en el PATH.
  echo Instala Node.js LTS y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [AVISO] Se creo .env a partir de .env.example.
  ) else (
    echo [ERROR] No existe .env ni .env.example.
    pause
    exit /b 1
  )
)

if not exist "node_modules" (
  echo.
  echo [ERROR] Falta la carpeta node_modules.
  echo Copiala desde el equipo original o ejecuta: npm install
  echo.
  pause
  exit /b 1
)

sc query MongoDB >nul 2>&1
if errorlevel 1 (
  echo [AVISO] No se detecto el servicio MongoDB.
  echo Inicia MongoDB manualmente antes de usar la aplicacion.
) else (
  sc query MongoDB | findstr /I "RUNNING" >nul
  if errorlevel 1 (
    echo Iniciando el servicio MongoDB...
    net start MongoDB >nul 2>&1
  )
)

echo.
echo ==========================================
echo   CRACKENTICK
echo   http://localhost:3000
echo   Usuario: admin / admin123
echo ==========================================
echo.
echo Pulsa Ctrl+C para detener el servidor.
echo.

node server.js
pause
