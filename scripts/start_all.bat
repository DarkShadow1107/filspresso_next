@echo off
REM Start Next.js frontend, Python AI backend, Express API, and MariaDB container

REM Start Docker MariaDB container (if not running)
echo Starting MariaDB container...
docker compose -f "%~dp0..\docker-compose.yml" up -d mariadb
timeout /t 5 /nobreak > nul

REM Start Express.js API server
start "Express API" cmd /k "cd /d %~dp0..\express-api & npm install & npm run dev"

REM Start Next.js app
start "Next.js" cmd /k "cd /d %~dp0.. & npm run dev"

REM Start Python AI backend (TinyLlama v2)
start "Python AI" cmd /k "cd /d %~dp0..\python_ai & call ..\.venv\Scripts\activate.bat & python app.py"

echo.
echo All services starting:
echo   - MariaDB:     localhost:3306
echo   - Express API: localhost:4000
echo   - Next.js:     localhost:3000
echo   - Python AI:   localhost:5000
echo.
