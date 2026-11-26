@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title CRACKENTICK

:MENU
cls
echo ============================================================
echo   CRACKENTICK - Lanzador
echo ============================================================
echo   1 - Correr el programa
echo   2 - Correr y sembrar la base (borra los datos y carga demo)
echo   3 - Correr en limpio (vacia la base, deja solo el admin)
echo   0 - Salir
echo.
set "OPCION="
set /p "OPCION=Elige una opcion: "
if "%OPCION%"=="1" goto CORRER
if "%OPCION%"=="2" goto SEMBRAR
if "%OPCION%"=="3" goto LIMPIAR
if "%OPCION%"=="0" exit /b 0
goto MENU

:SEMBRAR
echo.
echo Esto BORRA la base "crackentick" y carga los datos de ejemplo.
set "CONFIRMAR="
set /p "CONFIRMAR=Escribe SI para continuar: "
if /I not "%CONFIRMAR%"=="SI" goto MENU
call :PREPARAR
if errorlevel 1 goto MENU
node seed.js --reset
if errorlevel 1 (
  echo.
  echo [ERROR] El seed fallo. Revisa el mensaje anterior.
  pause
  goto MENU
)
goto CORRER

:LIMPIAR
echo.
echo Esto VACIA la base "crackentick". Solo quedara el usuario admin.
set "CONFIRMAR="
set /p "CONFIRMAR=Escribe SI para continuar: "
if /I not "%CONFIRMAR%"=="SI" goto MENU
call :PREPARAR
if errorlevel 1 goto MENU
node vaciar.js --si
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo vaciar la base.
  pause
  goto MENU
)
goto CORRER

:CORRER
call :PREPARAR
if errorlevel 1 goto MENU
echo.
echo ============================================================
echo   CRACKENTICK en http://localhost:3000
echo   Usuario: admin / admin123
echo   Pulsa Ctrl+C para detener el servidor.
echo ============================================================
echo.
node server.js
pause
exit /b 0

:PREPARAR
where node >nul 2>&1
if errorlevel 1 goto PREP_ERROR_NODE
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [AVISO] Se creo .env a partir de .env.example.
  ) else (
    echo [ERROR] Falta el archivo .env.
    pause
    exit /b 1
  )
)
if not exist "node_modules" goto PREP_ERROR_MODULES

sc query MongoDB >nul 2>&1
if errorlevel 1 goto PREP_MONGO_PORTABLE
sc query MongoDB | findstr /I "RUNNING" >nul
if errorlevel 1 (
  echo Iniciando el servicio MongoDB...
  net start MongoDB >nul 2>&1
)
netstat -ano | findstr ":27017" | findstr "LISTENING" >nul
if errorlevel 1 goto PREP_MONGO_PORTABLE
exit /b 0

:PREP_MONGO_PORTABLE
if not exist "mongodb\mongod.exe" goto PREP_ERROR_MONGO
if not exist "mongodb\data" mkdir "mongodb\data"
echo Iniciando MongoDB portable...
start "MongoDB CRACKENTICK" /min "mongodb\mongod.exe" --dbpath "%CD%\mongodb\data" --port 27017 --bind_ip 127.0.0.1 --logpath "%CD%\mongodb\mongod.log" --logappend
timeout /t 4 /nobreak >nul
netstat -ano | findstr ":27017" | findstr "LISTENING" >nul
if errorlevel 1 goto PREP_ERROR_MONGO_START
exit /b 0

:PREP_ERROR_NODE
echo.
echo [ERROR] Node.js no esta instalado o no esta en el PATH.
echo Instala "instaladores\node-v22-x64.msi" y reinicia la laptop.
pause
exit /b 1

:PREP_ERROR_MODULES
echo.
echo [ERROR] Falta la carpeta node_modules.
echo Copia la carpeta completa del proyecto o ejecuta: npm install
pause
exit /b 1

:PREP_ERROR_MONGO
echo.
echo [ERROR] MongoDB no esta corriendo y falta mongodb\mongod.exe.
echo Copia la carpeta mongodb del ZIP o instala MongoDB como servicio.
pause
exit /b 1

:PREP_ERROR_MONGO_START
echo.
echo [ERROR] MongoDB portable no arranco. Revisa mongodb\mongod.log
pause
exit /b 1
