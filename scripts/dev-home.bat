@echo off
setlocal
cd /d "%~dp0.."
where powershell.exe >nul 2>&1 || (echo [ERROR] Windows PowerShell was not found.&pause&exit /b 1)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-home-ui.ps1"
endlocal
