@echo off
REM Start Next.js frontend, Python backend, and MediaPipe static demo servers

REM Start Next.js app
start "Next.js" cmd /k "cd /d %~dp0.. & npm run dev"

REM Start Python AI backend
start "Python AI" cmd /k "cd /d %~dp0..\python_ai & call ..\.venv\Scripts\activate.bat & python app.py"

REM Start static server for MediaPipe Tasks demo (serves python_ai/models)
start "Gemma Demo" cmd /k "cd /d %~dp0..\python_ai\models & call ..\.venv\Scripts\activate.bat & python -m http.server 8000"
