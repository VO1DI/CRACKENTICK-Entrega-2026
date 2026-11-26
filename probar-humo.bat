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
echo Deja la aplicacion corriendo en otra ventana (iniciar.bat) antes de esta prueba.
echo.
node pruebas\probar-humo.js
pause
