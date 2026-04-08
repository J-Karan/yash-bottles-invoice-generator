@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if "%PORT%"=="" set "PORT=5000"
if "%HOST%"=="" set "HOST=0.0.0.0"
if "%ADMIN_PASSWORD%"=="" set "ADMIN_PASSWORD=admin123"

echo [1/3] Checking dependencies...
if not exist "node_modules" (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

echo [2/3] Building frontend...
call npm run build
if errorlevel 1 (
  if exist "dist\\index.html" (
    echo Build failed. Using existing dist output.
  ) else (
    goto :fail
  )
)

set "LAN_IP="
for /f "delims=" %%I in ('powershell -NoProfile -Command "$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue ^| Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' -and $_.InterfaceAlias -notlike '*Loopback*' -and $_.InterfaceAlias -notlike '*vEthernet*' -and $_.InterfaceAlias -notlike '*WSL*' -and $_.InterfaceAlias -notlike '*Bluetooth*' -and $_.InterfaceAlias -notlike '*Virtual*' }; if ($ips) { $ips[0].IPAddress }"') do set "LAN_IP=%%I"
if "%LAN_IP%"=="" (
  for /f "tokens=2 delims=:" %%I in ('ipconfig ^| findstr /i "IPv4"') do (
    set "CANDIDATE=%%I"
    set "CANDIDATE=!CANDIDATE: =!"
    if not "!CANDIDATE!"=="127.0.0.1" if not "!CANDIDATE:~0,7!"=="169.254" (
      set "LAN_IP=!CANDIDATE!"
      goto :ip_done
    )
  )
)
:ip_done

echo [3/3] Starting server...
echo Local URL: http://localhost:%PORT%
if not "%LAN_IP%"=="" (
  echo Wi-Fi URL: http://%LAN_IP%:%PORT%
) else (
  echo Wi-Fi URL: Unable to auto-detect. Run "ipconfig" and use your IPv4 address.
)
echo Keep this window open while testing.
echo.

call npm start
goto :eof

:fail
echo.
echo Failed to start server. Review errors above.
exit /b 1
