@echo off
REM Build TermExtrax.exe (Windows). Requires: Python 3.10+, Node.js 18+.
REM Result: backend\dist\TermExtrax.exe — double-click to run the app.
setlocal
cd /d "%~dp0"

echo === 1/4 Building frontend ===
cd frontend
call npm install || goto :error
call npm run build || goto :error
cd ..

echo === 2/4 Installing backend dependencies ===
cd backend
pip install -r requirements.txt pyinstaller || goto :error

echo === 3/4 Bundling frontend into backend\static ===
if exist static rmdir /s /q static
xcopy /e /i /q ..\frontend\dist static || goto :error

echo === 4/4 Building executable ===
pyinstaller --noconfirm TermExtrax.spec || goto :error

echo.
echo Done: backend\dist\TermExtrax.exe
exit /b 0

:error
echo Build failed.
exit /b 1
