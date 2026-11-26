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
node pruebas\verificar-entorno.js
pause
