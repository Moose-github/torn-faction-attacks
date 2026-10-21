@echo off
cd /d "%~dp0"
set "RESEARCH_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%RESEARCH_PYTHON%" (
  "%RESEARCH_PYTHON%" analyse_dataset.py %*
) else (
  python analyse_dataset.py %*
)
pause
