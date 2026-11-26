@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en el PATH.
  echo Instala Node.js LTS y vuelve a ejecutar.
  pause
  exit /b 1
)
echo.
echo Esta accion BORRA la base "crackentick" de esta laptop y la reemplaza
echo por la copia del 22/11/2026 que viene en pruebas\datos-base.json.
echo.
set "CONFIRMAR="
set /p "CONFIRMAR=Escribe SI para continuar: "
if /I not "%CONFIRMAR%"=="SI" (
  echo Cancelado.
  pause
  exit /b 0
)
echo Asegurate de que el servidor CRACKENTICK este detenido.
node pruebas\importar-base.js --si
pause
