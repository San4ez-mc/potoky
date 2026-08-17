# browser-agent

Перевикористовуваний мікросервіс веб-автоматизації для екосистеми FINEKO.
Живе поряд із `platform/` (сусідня папка репо), деплой тим самим git.

## Навіщо
- **Дії** (розміщення замовлень у CRM постачальників): `/replay` (детерміновано, 0 токенів) + `/agent` (ШІ-фолбек, browser-use+Claude).
- **Читання** (метрики IG/Threads, парсинг): `/read` — код-first (curl-impersonate → markdown), ШІ не потрібен → економія токенів.

## Обмеження боксу (1 CPU, 3.8ГБ)
- Браузерні задачі **серіалізовані** (семафор = 1). Браузер **на вимогу**, закривається після задачі.
- Swap 2ГБ + swappiness=10 (запобіжник OOM).
- pm2 `--max-memory-restart 900M`.

## Ендпоінти (auth: заголовок `X-Agent-Secret`)
| метод | шлях | призначення |
|-------|------|-------------|
| GET | `/health` | пінг + чи зайнятий браузер |
| POST | `/replay` | `{scenario, data, screenshot}` → детермінований прогін кроків |
| POST | `/agent` | `{task, data, startUrl, dry_run, screenshot, max_steps}` → ШІ веде браузер, СТОП перед submit |
| POST | `/read` | `{url, mode, render_js}` → markdown/text/html/json |

## Схема сценарію (`/replay`)
`{ startUrl, steps: [{action, selector, value, url}] }`
Дії: `goto|fill|type|click|select|check|press|waitFor|waitMs|assertText`. Значення інтерполюються з `data` (`{{login}}`, `{{password}}`, `{{city}}`…).

## Деплой (на сервері, у `/var/www/flows.fineko.space/browser-agent`)
```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/playwright install chromium        # або PLAYWRIGHT_BROWSERS_PATH на наявні
cp .env.example .env && nano .env           # заповнити секрет + ANTHROPIC_API_KEY
pm2 start start.sh --name browser-agent --max-memory-restart 900M
```

## Інтеграція з воронкою (потік)
`replay(scenario) → успіх? → так: скрін→Telegram (dry-run звірка); ні: /agent (перезаписує сценарій) → скрін→Telegram`.
Креди постачальника (url/login/password) — у ключах воронки. Скріни — лише на час тесту (прапорець `dry_run`), далі вимикаються і додається крок фінального submit.
