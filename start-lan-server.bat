@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if "%PORT%"=="" set "PORT=5000"
if "%HOST%"=="" set "HOST=0.0.0.0"
if "%ADMIN_PASSWORD%"=="" set "ADMIN_PASSWORD=admin123"
if "%KEEP_AWAKE%"=="" set "KEEP_AWAKE=1"
set "KEEP_AWAKE_PID_FILE=%TEMP%\lan-server-keep-awake.pid"
set "KEEP_AWAKE_SCRIPT=%TEMP%\lan-server-keep-awake.ps1"
set "KEEP_AWAKE_HELPER_PID="

call :stop_keep_awake >nul 2>&1

call :prepare_port
if errorlevel 1 goto :fail

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
echo Press Ctrl+C to stop the server.
echo.

if /I not "%KEEP_AWAKE%"=="0" (
  call :start_keep_awake
  if defined KEEP_AWAKE_HELPER_PID (
    echo Sleep prevention enabled while the server is running.
  ) else (
    echo Warning: Could not enable sleep prevention helper.
    echo If Windows enters sleep mode, LAN access will stop.
  )
  echo.
)

call npm start
set "EXITCODE=%ERRORLEVEL%"
call :stop_keep_awake
echo.
if "%EXITCODE%"=="0" (
  echo Server process ended.
) else (
  echo Server failed or stopped unexpectedly with exit code %EXITCODE%.
  echo Tip: if the error is EADDRINUSE, close the old server or change PORT.
)
echo Press any key to close this window.
pause >nul
exit /b %EXITCODE%

:fail
call :stop_keep_awake >nul 2>&1
echo.
echo Failed to start server. Review errors above.
echo Press any key to close this window.
pause >nul
exit /b 1

:start_keep_awake
set "KEEP_AWAKE_HELPER_PID="
if exist "%KEEP_AWAKE_PID_FILE%" del /f /q "%KEEP_AWAKE_PID_FILE%" >nul 2>&1

> "%KEEP_AWAKE_SCRIPT%" echo $pid ^| Set-Content -LiteralPath '%KEEP_AWAKE_PID_FILE%' -Encoding ASCII
>> "%KEEP_AWAKE_SCRIPT%" echo Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeMethods { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags); }';
>> "%KEEP_AWAKE_SCRIPT%" echo $flags = 0x80000041
>> "%KEEP_AWAKE_SCRIPT%" echo try ^{
>> "%KEEP_AWAKE_SCRIPT%" echo   while ^($true^) ^{
>> "%KEEP_AWAKE_SCRIPT%" echo     [void][NativeMethods]::SetThreadExecutionState^($flags^)
>> "%KEEP_AWAKE_SCRIPT%" echo     Start-Sleep -Seconds 30
>> "%KEEP_AWAKE_SCRIPT%" echo   ^}
>> "%KEEP_AWAKE_SCRIPT%" echo ^} finally ^{
>> "%KEEP_AWAKE_SCRIPT%" echo   [void][NativeMethods]::SetThreadExecutionState^(0x80000000^)
>> "%KEEP_AWAKE_SCRIPT%" echo ^}

start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%KEEP_AWAKE_SCRIPT%" >nul 2>&1

for /l %%N in (1,1,10) do (
  if exist "%KEEP_AWAKE_PID_FILE%" (
    set /p "KEEP_AWAKE_HELPER_PID="<"%KEEP_AWAKE_PID_FILE%"
    goto :start_keep_awake_done
  )
  timeout /t 1 >nul
)

:start_keep_awake_done
exit /b 0

:stop_keep_awake
if not defined KEEP_AWAKE_HELPER_PID (
  if exist "%KEEP_AWAKE_PID_FILE%" set /p "KEEP_AWAKE_HELPER_PID="<"%KEEP_AWAKE_PID_FILE%"
)

if defined KEEP_AWAKE_HELPER_PID (
  taskkill /PID !KEEP_AWAKE_HELPER_PID! /T /F >nul 2>&1
  set "KEEP_AWAKE_HELPER_PID="
)

if exist "%KEEP_AWAKE_PID_FILE%" del /f /q "%KEEP_AWAKE_PID_FILE%" >nul 2>&1
if exist "%KEEP_AWAKE_SCRIPT%" del /f /q "%KEEP_AWAKE_SCRIPT%" >nul 2>&1
exit /b 0

:prepare_port
set "APP_RUNNING="
for /f "delims=" %%I in ('powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri ('http://localhost:' + $env:PORT + '/api/health') -TimeoutSec 2; if($r.ok -eq $true -and $r.storage -eq 'sqlite'){ 'YES' } } catch {}"') do set "APP_RUNNING=%%I"

set "PORT_PIDS= "
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo "!PORT_PIDS!" | findstr /C:" %%P " >nul || set "PORT_PIDS=!PORT_PIDS!%%P "
)

if not "!PORT_PIDS!"==" " (
  if /I "!APP_RUNNING!"=="YES" (
    echo Existing invoice server detected on port %PORT%. Restarting...
  ) else (
    echo Port %PORT% is in use by PID^(s^): !PORT_PIDS!
    echo Attempting to free port %PORT%...
  )

  for %%P in (!PORT_PIDS!) do (
    taskkill /PID %%P /F >nul 2>&1
  )

  timeout /t 1 >nul
)

set "PORT_BUSY="
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set "PORT_BUSY=%%P"
  goto :port_busy_found
)
:port_busy_found

if defined PORT_BUSY (
  if /I "!APP_RUNNING!"=="YES" (
    echo Invoice server is already running on port %PORT%. Reusing existing instance.
    exit /b 0
  )

  echo Could not free port %PORT%. It is still used by PID !PORT_BUSY!.
  echo Trying a fallback port...
  call :find_free_port
  if errorlevel 1 (
    echo Could not find a free fallback port.
    exit /b 1
  )
  echo Using fallback port !PORT!.
)

exit /b 0

:find_free_port
set /a "SCAN_PORT=%PORT%+1"
set /a "MAX_PORT=%PORT%+30"

:find_free_loop
set "SCAN_BUSY="
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":!SCAN_PORT! .*LISTENING"') do set "SCAN_BUSY=1"
if not defined SCAN_BUSY (
  set "PORT=!SCAN_PORT!"
  exit /b 0
)

set /a "SCAN_PORT+=1"
if !SCAN_PORT! LEQ !MAX_PORT! goto :find_free_loop
exit /b 1
