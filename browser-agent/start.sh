#!/usr/bin/env bash
# Запуск сервісу (використовується pm2). Читає .env, піднімає uvicorn (1 воркер — 1 ядро).
set -a
[ -f .env ] && . ./.env
set +a
exec "$(dirname "$0")/venv/bin/uvicorn" main:app --host 127.0.0.1 --port "${PORT:-8091}" --workers 1
