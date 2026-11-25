@echo off
rem Double-click to open your job dashboard.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed yet. Open this folder in Codex or Claude and say "set me up".
  pause
  exit /b 1
)
node app\cli.mjs start
if errorlevel 1 pause
