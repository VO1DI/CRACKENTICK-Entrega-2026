@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title CRACKENTICK

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en el PATH.
  pause
  exit /b 1
)

if not exist ".env" (
  echo [ERROR] Falta el archivo .env.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [ERROR] Falta la carpeta node_modules.
  pause
  exit /b 1
)

rem --- MongoDB ---
netstat -ano | findstr ":27017" | findstr "LISTENING" >nul
if errorlevel 1 (
  sc query MongoDB >nul 2>&1
  if not errorlevel 1 (
    echo Iniciando MongoDB...
    net start MongoDB >nul 2>&1
  ) else (
    echo [AVISO] MongoDB no esta corriendo. Inicia el servicio MongoDB antes de usar la app.
  )
)

rem --- CHR QEMU ---
netstat -ano | findstr ":8728" | findstr "LISTENING" >nul
if errorlevel 1 (
  if exist "qemu\qemu-system-x86_64.exe" if exist "chr\chr-7.20.2.vhd" (
    echo Iniciando CHR RouterOS 7.20.2...
    start "CHR QEMU" /min cmd /c ""%CD%\qemu\qemu-system-x86_64.exe" -M q35 -m 512 -accel tcg -smp 2 -drive "file=%CD%\chr\chr-7.20.2.vhd,format=vpc,if=ide" -nic "user,model=e1000,hostfwd=tcp:127.0.0.1:8728-:8728,hostfwd=tcp:127.0.0.1:8291-:8291,hostfwd=tcp:127.0.0.1:2222-:22" -vnc 127.0.0.1:1 -monitor "tcp:127.0.0.1:5555,server=on,wait=off" -no-reboot >> "%CD%\CHR-log.txt" 2>&1"
    echo El CHR tarda entre 30 y 90 segundos en aceptar la API.
  )
) else (
  echo CHR ya esta corriendo en 127.0.0.1:8728.
)

echo.
echo ============================================================
echo   CRACKENTICK
echo   Web:    http://localhost:3000   admin / admin123
echo   CHR:    API 127.0.0.1:8728      WinBox 127.0.0.1:8291
echo   Usuario CHR: crackentick-api / CAMBIAR_CLAVE_CHR
echo   Cierra la ventana minimizada "CHR QEMU" para apagar la VM.
echo ============================================================
echo.
echo Pulsa Ctrl+C para detener la aplicacion.
echo.

node server.js
pause
