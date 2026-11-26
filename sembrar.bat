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
echo Esto borrara la base "crackentick" y cargara los datos de ejemplo.
set /p CONFIRMAR="Escribe SI para continuar: "
if /I not "%CONFIRMAR%"=="SI" (
  echo Operacion cancelada.
  pause
  exit /b 0
)

node seed.js --reset
pause
