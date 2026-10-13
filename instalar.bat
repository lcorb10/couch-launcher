@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Instalador de Couch Launcher
set "EXE=%~dp0node_modules\electron\dist\electron.exe"
echo ============================================
echo    Instalando Couch Launcher...
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] No se encontro Node.js.
  echo     Instalalo desde https://nodejs.org  ^(version 18 o superior^)
  echo     CIERRA esta ventana, instala Node y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

echo [1/3] Instalando dependencias...
call npm install
if errorlevel 1 (
  echo.
  echo [X] Error instalando dependencias. Revisa tu internet y reintenta.
  pause
  exit /b 1
)

echo.
echo [2/3] Descargando Electron con Widevine ^(puede tardar, ~200 MB^)...
if not exist "%EXE%" (
  if exist "%~dp0node_modules\electron\install.js" (
    node "%~dp0node_modules\electron\install.js"
  )
)
if not exist "%EXE%" (
  echo.
  echo [X] No se pudo descargar el binario de Electron.
  echo     Revisa tu conexion a internet y vuelve a ejecutar este archivo.
  echo     ^(Tambien puedes correr:  node node_modules\electron\install.js^)
  pause
  exit /b 1
)

echo.
echo [3/3] Creando acceso directo en el escritorio...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Couch Launcher.lnk'); $lnk.TargetPath = '%EXE%'; $lnk.Arguments = '.'; $lnk.WorkingDirectory = '%~dp0'; $lnk.IconLocation = '%EXE%,0'; $lnk.Save()"

echo.
echo ============================================
echo    Listo! Se creo "Couch Launcher" en tu escritorio.
echo    Haz doble click ahi para abrir la app.
echo ============================================
echo.
pause
