@echo off
rem Compile the editor target (HyperBluffEditor Win64 Development) without opening the editor.
rem Usage: hyper-bluff-ue\tools\build_editor.bat      (set UE_ROOT if UE 5.8 is elsewhere)
setlocal
if "%UE_ROOT%"=="" set "UE_ROOT=C:\Program Files\Epic Games\UE_5.8"
set "PROJECT=%~dp0..\HyperBluff.uproject"
call "%UE_ROOT%\Engine\Build\BatchFiles\Build.bat" HyperBluffEditor Win64 Development "-project=%PROJECT%" -waitmutex -NoHotReload
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)
echo BUILD OK
