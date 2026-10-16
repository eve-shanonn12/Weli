@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js n'est pas installe. Installez Node.js 20 ou plus, puis relancez ce fichier.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installation des dependances Node.js...
  call npm ci
  if errorlevel 1 (
    echo L'installation a echoue.
    pause
    exit /b 1
  )
)

echo Compilation de Weli-Link Market...
call npm run build
if errorlevel 1 (
  echo La compilation a echoue.
  pause
  exit /b 1
)

echo.
echo Weli-Link Market est pret : http://127.0.0.1:3333
echo Laissez cette fenetre ouverte tant que le site doit fonctionner.
call npm start
