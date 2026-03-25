@echo off
setlocal

REM --- Start Docker containers in detached mode -------------------------
docker compose -f "%~dp0..\docker-compose.yml" up -d

REM --- Start Next.js dev server -----------------------------------------
cd /d "%~dp0.."
npm run dev
