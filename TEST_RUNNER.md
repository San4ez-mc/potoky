# Запуск тестів ботів — FINEKO flows

**Версія:** 1.0 | **Дата:** травень 2026

---

## 1. Огляд

Платформа підтримує три способи запуску тестів:

1. **Full Regression** — дебаг локально або на проді всіх 14 ботів проєкту
2. **Per-Bot API** — тригер одного бота через REST endpoint
3. **MCP CLI** — прямий виклик MCP інструментів для детального дебагу

---

## 2. Запуск Full Regression (локально)

### Вимоги

- Node.js ≥ 18
- Доступ до `.env` файлу з `ANTHROPIC_API_KEY`, `MCP_SECRET`, `API_SECRET`
- Локальна або VPS база даних (Postgres + Redis)

### Команда

```bash
cd d:\програмування\система\ для\ воронок\platform

# Встановити env змінні
$env:TEST_BASE_URL='https://flows.fineko.space'  # або http://localhost:3000 для локального
$env:TEST_MCP_SECRET='mcp_flows_2026_secret'
$env:TEST_API_SECRET='api_s3cr3t_platform_2026_random_key'

# Запустити full regression
node scripts/run_full_regression.js
```

### Очікуваний вивід

```
REPORT_PATH=D:\...\platform\test-reports\regression-1778604505999.json
PASSED_BOTS=14
FAILED_BOTS=0
HAS_ERRORS=false
```

### Звіт

Результати зберігаються в JSON:

```json
{
  "projectSlug": "finance-course",
  "botsTotal": 14,
  "passed": 14,
  "failed": 0,
  "results": [
    {
      "ok": true,
      "report": {
        "bot": {
          "id": "db22c1f9-ae67-4b15-959d-cbd171be5038",
          "name": "Bot 1.2 Business Process",
          "slug": "bot-1-2-business-process"
        },
        "legend": {
          "source": "fallback",
          "title": "Smoke scenario for bot-1-2-business-process",
          "messages": ["Привіт!...", "Ми надаємо..."]
        },
        "sessionId": "375662a7-1e15-4973-99c1-03910bf9bcc2",
        "steps": [
          {
            "message": "Привіт! Я хочу пройти коротке тестування воронки.",
            "currentState": "interviewing",
            "hasBotResponse": true
          }
        ],
        "finalState": "interviewing",
        "historyCount": 4,
        "ended": true,
        "filesCreated": 0
      }
    }
  ]
}
```

---

## 3. Тригер Per-Bot (API endpoint)

### Один бот

```bash
$headers = @{
    'x-api-secret' = 'api_s3cr3t_platform_2026_random_key'
    'Content-Type' = 'application/json'
}

$botId = 'db22c1f9-ae67-4b15-959d-cbd171be5038'

$resp = Invoke-RestMethod `
    -Uri "https://flows.fineko.space/api/admin/bots/$botId/run-regression" `
    -Method Post `
    -Headers $headers `
    -Body '{}'

$resp | ConvertTo-Json -Depth 20
```

**Відповідь:**

```json
{
  "ok": true,
  "data": {
    "bot": { "id": "...", "name": "Bot 1.2 Business Process", "slug": "bot-1-2-business-process" },
    "legend": { "source": "fallback", "title": "...", "messages": [...] },
    "sessionId": "...",
    "startedState": "interviewing",
    "steps": [...],
    "finalState": "interviewing",
    "historyCount": 4,
    "ended": true,
    "filesCreated": 0
  }
}
```

### Весь проєкт (14 ботів)

```bash
$headers = @{
    'x-api-secret' = 'api_s3cr3t_platform_2026_random_key'
    'Content-Type' = 'application/json'
}

$resp = Invoke-RestMethod `
    -Uri "https://flows.fineko.space/api/admin/projects/finance-course/run-regressions" `
    -Method Post `
    -Headers $headers `
    -Body '{}'

Write-Output "BOTS_TOTAL=$($resp.data.botsTotal)"
Write-Output "PASSED=$($resp.data.passed)"
Write-Output "FAILED=$($resp.data.failed)"

# Список фейлів (якщо є)
$failed = $resp.data.results | Where-Object { -not $_.ok }
foreach ($f in $failed) {
    Write-Output "FAIL: $($f.bot.slug) | $($f.error)"
}
```

---

## 4. MCP: Ручне тестування сесії

### Стартуємо сесію для конкретного бота

```bash
$h = @{
    Authorization='Bearer mcp_flows_2026_secret'
    'Content-Type'='application/json'
}

# start_test_session
$b1 = @{
    jsonrpc='2.0'
    id=1
    method='tools/call'
    params=@{
        name='start_test_session'
        arguments=@{ botSlug='bot-1-2-business-process' }
    }
} | ConvertTo-Json -Depth 10

$r1 = Invoke-RestMethod `
    -Uri 'https://flows.fineko.space/mcp' `
    -Method Post -Headers $h -Body $b1

$sessionId = ($r1.result.content[0].text | ConvertFrom-Json).sessionId
Write-Output "SESSION_ID=$sessionId"
```

### Надсилаємо повідомлення

```bash
# send_test_message
$b2 = @{
    jsonrpc='2.0'
    id=2
    method='tools/call'
    params=@{
        name='send_test_message'
        arguments=@{
            sessionId=$sessionId
            message='we provide accounting services for b2b'
        }
    }
} | ConvertTo-Json -Depth 10

$r2 = Invoke-RestMethod `
    -Uri 'https://flows.fineko.space/mcp' `
    -Method Post -Headers $h -Body $b2

$o2 = $r2.result.content[0].text | ConvertFrom-Json
Write-Output "BOT_RESPONSE_PRESENT=$([bool]$o2.botResponse)"
Write-Output "CURRENT_STATE=$($o2.currentState)"
```

### Отримуємо стан сесії

```bash
# get_test_session_state
$b3 = @{
    jsonrpc='2.0'
    id=3
    method='tools/call'
    params=@{
        name='get_test_session_state'
        arguments=@{ sessionId=$sessionId }
    }
} | ConvertTo-Json -Depth 10

$r3 = Invoke-RestMethod `
    -Uri 'https://flows.fineko.space/mcp' `
    -Method Post -Headers $h -Body $b3

$o3 = $r3.result.content[0].text | ConvertFrom-Json
Write-Output "STATE_CURRENT=$($o3.currentState)"
Write-Output "HISTORY_COUNT=$($o3.history.Count)"
```

### Отримуємо логи сесії

```bash
# get_session_logs (останні 5 помилок)
$b6 = @{
    jsonrpc='2.0'
    id=6
    method='tools/call'
    params=@{
        name='get_session_logs'
        arguments=@{ limit=5 }
    }
} | ConvertTo-Json -Depth 10

$r6 = Invoke-RestMethod `
    -Uri 'https://flows.fineko.space/mcp' `
    -Method Post -Headers $h -Body $b6

$o6 = $r6.result.content[0].text | ConvertFrom-Json
Write-Output "LOG_COUNT=$($o6.Count)"
```

### Завершуємо сесію

```bash
# end_test_session
$b7 = @{
    jsonrpc='2.0'
    id=7
    method='tools/call'
    params=@{
        name='end_test_session'
        arguments=@{ sessionId=$sessionId }
    }
} | ConvertTo-Json -Depth 10

$r7 = Invoke-RestMethod `
    -Uri 'https://flows.fineko.space/mcp' `
    -Method Post -Headers $h -Body $b7

$o7 = $r7.result.content[0].text | ConvertFrom-Json
Write-Output "ENDED=$(-not $o7.summary.isActive)"
```

---

## 5. Фільтрація результатів

### Отримуємо тільки фейли

```bash
$headers = @{ 'x-api-secret' = 'api_s3cr3t_platform_2026_random_key' }
$resp = Invoke-RestMethod `
    -Uri "https://flows.fineko.space/api/admin/projects/finance-course/run-regressions" `
    -Method Post -Headers $headers -Body '{}'

$failed = $resp.data.results | Where-Object { -not $_.ok }
$failed | ForEach-Object {
    Write-Output "BOT: $($_.bot.slug) | ERROR: $($_.error)"
}
```

### Отримуємо боти зі специфічним станом

```bash
$resp.data.results | Where-Object { $_.ok } | ForEach-Object {
    if ($_.report.finalState -eq 'completed') {
        Write-Output "COMPLETED: $($_.report.bot.slug)"
    }
}
```

---

## 6. Перевірка в UI

Кнопка **"Тест"** у списку ботів (`/admin/bots`):

1. Перейти на сторінку адміна: `https://flows.fineko.space/admin/bots`
2. У таблиці ботів, стовпець "Дії" — натиснути **"Тест"**
3. Статус оновлюється live:
   - ⏳ "Running..." — сесія в процесі
   - ✅ "Passed" — успішно завершено
   - ❌ "Failed" — помилка, див. деталі

---

## 7. Відомі обмеження

| Обмеження | Наслідок |
|-----------|----------|
| `ANTHROPIC_API_KEY` не встановлений | Регресія використовує fallback сценарії (завдяки это усе ж проходить) |
| Бота немає в DB | Помилка "Bot not found" |
| Тестова сесія залежить від prerequisite файлів | Якщо файли не створені попереднім ботом, залежна сесія падає |
| Telegram API помилки | Діагностика буде в логах: "ETELEGRAM: ..." |

---

## 8. Troubleshooting

### Помилка: "Test session was not created"

**Причини:**
- Бот не завантажився (помилка в require модулю)
- Prerequisite файли не створені
- Telegram handler повернув помилку

**Розв'язання:**
```bash
# Включити діагностику через MCP
# Помилки будуть у відповіді з деталями кожної спроби start_test_session
```

### Помилка: "ETELEGRAM: 400 Bad Request: chat not found"

**Причина:** Synthetic Telegram ID не валідний або user не створений в DB

**Розв'язання:** Перевірити логи сервера:
```bash
ssh root@173.242.62.180 "cd /var/www/flows.fineko.space && pm2 logs platform-api --lines 50"
```

### Помилка: "Identifier 'buildMessages' has already been declared"

**Причина:** Дублювання імпорту/функцій у bot handler

**Розв'язання:** Видалити дублікат функції або імпорту в `bots/*/index.js`

---

## 9. CI/CD Integration

### Автоматизований запуск (приклад для GitHub Actions)

```yaml
name: Test Bots
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: |
          cd platform
          npm ci
      - run: |
          export TEST_BASE_URL='https://flows.fineko.space'
          export TEST_API_SECRET='${{ secrets.API_SECRET }}'
          export TEST_MCP_SECRET='${{ secrets.MCP_SECRET }}'
          node scripts/run_full_regression.js
      - name: Report results
        if: always()
        run: |
          cat test-reports/regression-*.json | jq '.passed, .failed'
```

---

## 10. Отримання допомоги

Список доступних MCP методів:

```bash
$h = @{
    Authorization='Bearer mcp_flows_2026_secret'
    'Content-Type'='application/json'
}

$b = @{
    jsonrpc='2.0'
    id=1
    method='tools/list'
} | ConvertTo-Json

$r = Invoke-RestMethod `
    -Uri 'https://flows.fineko.space/mcp' `
    -Method Post -Headers $h -Body $b

$r.result.tools | ForEach-Object { Write-Output "- $($_.name): $($_.description)" }
```

---

**Контакт:** див. `доступи.md`  
**Остання оновлення:** травень 2026
