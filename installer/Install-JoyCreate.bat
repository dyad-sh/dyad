@echo off
REM JoyCreate one-click installer launcher.
REM Just double-click this file. It will request admin only if needed
REM and run the PowerShell bootstrapper next to it.

setlocal
set "SCRIPT_DIR=%~dp0"

echo.
echo  Starting JoyCreate installer...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Install-JoyCreate.ps1" %*

if errorlevel 1 (
    echo.
    echo  Installer reported an error. Press any key to close.
    pause >nul
)

endlocal
