@echo off
setlocal DisableDelayedExpansion
if not defined DSH_WORKER_HARNESS_ROOT set "DSH_WORKER_HARNESS_ROOT=D:\dsh"
set "ELECTRON_RUN_AS_NODE=1"
"%DSH_WORKER_HARNESS_ROOT%\DeepSeek Harness.exe" "%~dp0..\deepseek-worker\server.mjs"
exit /b %errorlevel%
