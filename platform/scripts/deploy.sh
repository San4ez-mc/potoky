#!/bin/bash
# Деплой Flows на сервері (етап 0 плану «правки → нуль», 13.10.2026).
#   bash scripts/deploy.sh                       — лише у вечірнє вікно 21:00–08:00 за Києвом
#   bash scripts/deploy.sh --critical "причина"  — удень, лише критичне (гроші, мовчання бота, скарга клієнта)
# Чому: денні деплої перезапускали процес посеред розмов (12.10 — загублена відповідь клієнту, хвиля правок після
# поспішних змін). Тепер: вікно, лог усіх деплоїв, плавна зупинка API (30 с на завершення ходів), перевірка /health.
# Етап 1 додасть сюди прогін нового коду на вчорашніх ходах і блок деплою при новому спрацюванні детектора.
set -e
cd /var/www/flows.fineko.space/platform
LOG=/var/log/flows-deploy.log
H=$(TZ=Europe/Kyiv date +%H); H=$((10#$H))
MODE="${1:-}"; REASON="${2:-}"
if [ "$MODE" = "--critical" ]; then
  if [ -z "$REASON" ]; then echo "⛔ Для денного деплою вкажіть причину: --critical \"що саме горить\""; exit 1; fi
elif [ "$H" -ge 8 ] && [ "$H" -lt 21 ]; then
  echo "⛔ Зараз $(TZ=Europe/Kyiv date +%H:%M) за Києвом — деплой лише з 21:00 до 08:00. Критичне: --critical \"причина\""; exit 1
fi
OLD=$(git rev-parse --short HEAD)
git pull -q origin main
NEW=$(git rev-parse --short HEAD)
if [ "$OLD" = "$NEW" ]; then echo "Нових змін нема ($NEW)"; exit 0; fi
CHANGED=$(git diff --name-only --relative "$OLD" "$NEW") # шляхи від platform/ (apps/..., scripts/...)
echo "$(date -Is) $OLD → $NEW ${MODE:+[critical: $REASON]}" >> "$LOG"
echo "$CHANGED" | sed 's/^/    /' >> "$LOG"
# Нові SQL-міграції — не автоматично: показуємо, щоб застосувати свідомо (cd apps/api && node ../../scripts/apply-sql.js ../../scripts/<файл>.sql)
NEWSQL=$(echo "$CHANGED" | grep -E '^scripts/.*\.sql$' || true)
[ -n "$NEWSQL" ] && echo "⚠ Нові SQL-скрипти (застосуйте вручну, якщо ще ні): $NEWSQL"
# API — з плавною зупинкою (index.js чекає завершення ходів до 25 с)
pm2 restart platform-api --kill-timeout 30000 >/dev/null
echo "$CHANGED" | grep -qE '^apps/worker/|^packages/' && pm2 restart platform-worker >/dev/null && echo "worker перезапущено"
echo "$CHANGED" | grep -qE '^apps/mcp/|^packages/' && pm2 restart platform-mcp >/dev/null && echo "mcp перезапущено"
# Перевірка, що API піднявся
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:3000/health >/dev/null; then echo "✅ Задеплоєно $OLD → $NEW, API відповідає"; exit 0; fi
  sleep 1
done
echo "❌ API не відповідає на /health після деплою $NEW — дивіться pm2 logs platform-api"; echo "$(date -Is) HEALTH FAIL $NEW" >> "$LOG"; exit 2
