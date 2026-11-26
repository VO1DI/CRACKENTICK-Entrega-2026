@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title CHR QEMU
set "LOG=%~dp0CHR-log.txt"
echo [%date% %time%] inicio > "%LOG%"

set "VHD="
if exist "chr\chr-7.20.2.vhd" set "VHD=%CD%\chr\chr-7.20.2.vhd"
if not defined VHD if exist "%USERPROFILE%\CHR-QEMU\chr-7.20.2.vhd" set "VHD=%USERPROFILE%\CHR-QEMU\chr-7.20.2.vhd"
if not defined VHD (
  echo.
  echo [ERROR] No se encontro el disco del CHR.
  echo Descomprime el ZIP completo o coloca chr\chr-7.20.2.vhd junto a este archivo.
  echo Revisa: %LOG%
  pause
  exit /b 1
)
echo disco: %VHD%>> "%LOG%"

netstat -ano | findstr ":8728" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo [AVISO] El CHR ya esta corriendo en el puerto 8728.
  echo Cierra la ventana de QEMU antes de abrir otra.
  pause
  exit /b 0
)

tasklist /FI "IMAGENAME eq qemu-system-x86_64.exe" 2>nul | findstr /I "qemu-system-x86_64.exe" >nul
if not errorlevel 1 (
  echo.
  echo [AVISO] Ya hay un proceso qemu-system-x86_64.exe abierto.
  echo Puede estar usando el disco del CHR y bloquear el arranque.
  choice /C SN /M "Cerrar QEMU y continuar"
  if errorlevel 2 exit /b 0
  taskkill /IM qemu-system-x86_64.exe /F >nul 2>&1
  timeout /t 2 /nobreak >nul
)

set "QEMU="
if exist "qemu\qemu-system-x86_64.exe" set "QEMU=%CD%\qemu\qemu-system-x86_64.exe"
if not defined QEMU if exist "%USERPROFILE%\CHR-QEMU\qemu\qemu-system-x86_64.exe" set "QEMU=%USERPROFILE%\CHR-QEMU\qemu\qemu-system-x86_64.exe"
if not defined QEMU if exist "%LOCALAPPDATA%\CRACKENTICK-CHR\qemu\qemu-system-x86_64.exe" set "QEMU=%LOCALAPPDATA%\CRACKENTICK-CHR\qemu\qemu-system-x86_64.exe"

if not defined QEMU (
  if not exist "chr\qemu-setup.exe" (
    echo.
    echo [ERROR] No se encontro QEMU ni chr\qemu-setup.exe.
    echo Descomprime el ZIP completo.
    echo Revisa: %LOG%
    pause
    exit /b 1
  )
  echo Instalando QEMU - solo la primera vez...
  echo instalando QEMU...>> "%LOG%"
  start /wait "" "chr\qemu-setup.exe" /S /D=%CD%\qemu
  if exist "%CD%\qemu\qemu-system-x86_64.exe" set "QEMU=%CD%\qemu\qemu-system-x86_64.exe"
)

if not defined QEMU (
  echo.
  echo [ERROR] QEMU no quedo instalado.
  echo Ejecuta manualmente chr\qemu-setup.exe y vuelve a intentar.
  echo Revisa: %LOG%
  pause
  exit /b 1
)
echo qemu: %QEMU%>> "%LOG%"

echo ============================================================
echo   CHR RouterOS 7.20.2
echo   API:   127.0.0.1:8728   crackentick-api / CAMBIAR_CLAVE_CHR
echo   WinBox:127.0.0.1:8291  admin / CAMBIAR_CLAVE_ADMIN
echo   Consola VNC: 127.0.0.1:5901
echo   Cierra esta ventana para apagar la VM.
echo ============================================================
echo.

echo [%date% %time%] qemu start>> "%LOG%"
"%QEMU%" -M q35 -m 512 -accel tcg -smp 2 ^
  -drive "file=%VHD%,format=vpc,if=ide" ^
  -nic "user,model=e1000,hostfwd=tcp:127.0.0.1:8728-:8728,hostfwd=tcp:127.0.0.1:8291-:8291" ^
  -vnc 127.0.0.1:1 ^
  -monitor "tcp:127.0.0.1:5555,server=on,wait=off" ^
  -no-reboot >> "%LOG%" 2>&1

echo.
if errorlevel 1 (
  echo [ERROR] QEMU no pudo arrancar o el disco del CHR esta bloqueado.
  echo Cierra QEMU, expulsa el VHD si lo montaste en Windows, o reinicia.
  echo Revisa CHR-log.txt
) else (
  echo CHR detenido.
)
pause
