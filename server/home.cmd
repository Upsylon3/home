@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0home.ps1" %1
if errorlevel 1 (
  echo HOME could not complete this action. See the message above.
  pause
  exit /b 1
)
if "%~1"=="" pause
