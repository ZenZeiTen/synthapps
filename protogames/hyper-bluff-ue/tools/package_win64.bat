@echo off
rem Cook, stage, pak and archive a Win64 Development build into hyper-bluff-ue\dist\, then zip it
rem to dist\TeamName_HyperBluff.zip (rename "TeamName" to your jam team name).
rem Usage: hyper-bluff-ue\tools\package_win64.bat      (set UE_ROOT if UE 5.8 is elsewhere)
setlocal
if "%UE_ROOT%"=="" set "UE_ROOT=C:\Program Files\Epic Games\UE_5.8"
set "ROOT=%~dp0.."
set "PROJECT=%ROOT%\HyperBluff.uproject"
set "DIST=%ROOT%\dist"
call "%UE_ROOT%\Engine\Build\BatchFiles\RunUAT.bat" BuildCookRun "-project=%PROJECT%" -noP4 -platform=Win64 -clientconfig=Development -build -cook -stage -pak -archive "-archivedirectory=%DIST%" -utf8output -unattended
if errorlevel 1 (
  echo PACKAGE FAILED
  exit /b 1
)
if exist "%DIST%\TeamName_HyperBluff.zip" del "%DIST%\TeamName_HyperBluff.zip"
set "SRC=%DIST%\Windows"
if not exist "%SRC%" set "SRC=%DIST%\WindowsNoEditor"
if not exist "%SRC%" (
  echo No archived build found in %DIST%
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%SRC%\*' -DestinationPath '%DIST%\TeamName_HyperBluff.zip' -CompressionLevel Optimal"
if errorlevel 1 (
  echo ZIP FAILED
  exit /b 1
)
echo PACKAGED %DIST%\TeamName_HyperBluff.zip
