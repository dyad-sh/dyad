@echo off
:: token_sync_watcher.bat — Auto-start JoyCreate token sync watcher
:: Drop this file into shell:startup to run on Windows login.
::
:: Setup:
::   1. Press Win+R → type shell:startup → Enter
::   2. Copy this .bat file into that folder
::   3. Done — it auto-starts with Windows
::
:: Optional: set your bridge API key below (or leave blank for no auth)
set BRIDGE_API_KEY=
:: Optional: override machine ID (defaults to hostname)
:: set JOYCREATE_MACHINE_ID=my-nuc

:: Hide the window after launch
if not "%HIDDEN%"=="1" (
    set HIDDEN=1
    start "" /min cmd /c "%~f0"
    exit /b
)

title JoyCreate Token Sync

:: Use python from PATH; fall back to py launcher
where python >nul 2>&1 && (
    python "%~dp0token_sync_watcher.py"
) || (
    py -3 "%~dp0token_sync_watcher.py"
)
