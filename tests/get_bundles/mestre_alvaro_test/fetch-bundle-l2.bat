@echo off
setlocal enabledelayedexpansion

rem === fetch-bundle-l2.bat ===
rem Fetch simplified alarm bundle for Mestre Alvaro / Central L2
rem Reads config.txt from same folder — override any var before calling.

set "SCRIPT_DIR=%~dp0"
set "CONFIG=%SCRIPT_DIR%config.txt"
set "OUTPUT=%SCRIPT_DIR%simple_bundle_L2.json"

rem --- defaults (overridden by config.txt) ---
set "API_URL=https://gcdr-api.a.myio-bas.com"
set "API_KEY="
set "CUSTOMER_ID="
set "CENTRAL_ID="

rem --- load config.txt ---
if not exist "%CONFIG%" (
    echo [ERROR] config.txt not found: %CONFIG%
    exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in ("%CONFIG%") do (
    set "%%A=%%B"
)

rem --- validate required vars ---
if "%CUSTOMER_ID%"=="" ( echo [ERROR] CUSTOMER_ID not set in config.txt & exit /b 1 )
if "%CENTRAL_ID%"==""  ( echo [ERROR] CENTRAL_ID not set in config.txt  & exit /b 1 )
if "%API_KEY%"==""     ( echo [ERROR] API_KEY not set in config.txt      & exit /b 1 )

echo Fetching simplified bundle...
echo   URL:      %API_URL%
echo   Customer: %CUSTOMER_ID%
echo   Central:  %CENTRAL_ID%
echo   Output:   %OUTPUT%
echo.

curl -s "%API_URL%/api/v1/customers/%CUSTOMER_ID%/alarm-rules/bundle/simple" ^
  -H "X-API-Key: %API_KEY%" ^
  -H "X-Central-Id: %CENTRAL_ID%" ^
  -H "Accept: application/json" ^
  -o "%OUTPUT%"

if errorlevel 1 (
    echo [ERROR] curl failed
    exit /b 1
)

if not exist "%OUTPUT%" (
    echo [ERROR] Output file not created
    exit /b 1
)

echo.
echo [OK] Bundle saved to: %OUTPUT%
echo.

rem --- show summary via jq (if available) ---
where jq >nul 2>&1
if errorlevel 1 (
    echo [INFO] jq not found — showing raw output:
    type "%OUTPUT%"
) else (
    echo === meta ===
    jq ".data.meta" "%OUTPUT%"
    echo.
    echo === deviceIndex keys ===
    jq ".data.deviceIndex | keys" "%OUTPUT%"
    echo.
    echo === rules keys ===
    jq ".data.rules | keys" "%OUTPUT%"
)

endlocal
