@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en el PATH.
  pause
  exit /b 1
)

echo.
echo Esto borra la base "crackentick" y carga los datos de ejemplo
echo con UN solo router: el CHR QEMU incluido en este paquete.
echo.
set "CONFIRMAR="
set /p "CONFIRMAR=Escribe SI para continuar: "
if /I not "%CONFIRMAR%"=="SI" (
  echo Operacion cancelada.
  pause
  exit /b 0
)

node seed.js --reset --laptop
pause
