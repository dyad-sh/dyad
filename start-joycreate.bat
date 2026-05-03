@echo off
title JoyCreate
cd /d "%~dp0"

:: Add common node installation paths so npm is always found
set "PATH=%APPDATA%\npm;%PATH%"
set "PATH=%LOCALAPPDATA%\nvm\v22.21.0;%PATH%"
set "PATH=%ProgramFiles%\nodejs;%PATH%"

:: Verify npm is reachable before proceeding
where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm not found. Install Node.js from https://nodejs.org
  pause
  exit /b 1
)

echo Starting JoyCreate...
npm start

:: Keep window open if npm exits with an error so the user can see the message
if errorlevel 1 (
  echo.
  echo JoyCreate exited with an error. See output above.
  pause
)
