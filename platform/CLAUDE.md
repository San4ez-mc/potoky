# FINEKO Flows — Правила роботи над проектом

> Цей файл читається автоматично Claude Code на початку кожної сесії.
> Тут зібрані всі ключові конвенції та правила проекту.

---

## 1. Інфраструктура

### Сервер
- **IP:** `173.242.62.180`
- **Шлях до проекту:** `/var/www/flows.fineko.space/platform`
- **SSH:** `ssh root@173.242.62.180`

### PM2-сервіси
| id | назва | роль |
|----|-------|------|
| 0  | `platform-api` | API сервер (Express, порт 3000) |
| 1  | `platform-worker` | Worker (Bull queues, нагадування) |
| 2  | `platform-mcp` | MCP сервер |

Перезапуск після деплою: `pm2 restart platform-api platform-worker platform-mcp`

### Git
- **Репо:** `https://github.com/San4ez-mc/potoky.git`
- **Гілка:** `main`
- Платформа живе в піддиректорії `platform/` всередині монорепо
- Локальний git-root: `D:\програмування\система для воронок\platform`

---

## 2. Правило: всі зміни — через Git

**Завжди:**
1. Змінюємо код локально
2. `git add` → `git commit` → `git push origin main`
3. На сервері: `git pull origin main`
4. `pm2 restart` потрібних сервісів

**Ніколи не редагувати файли прямо на сервері** — при наступному pull вони перезатруться або виникнуть merge-конфлікти.

Якщо сервер «відстав» і є локальні правки на ньому:
```bash
git stash && git pull origin main
```

---

## 3. Правило: ключі — тільки у воронках

### Що зберігається у `funnelKey` (per-bot)
Абсолютно всі токени, API-ключі та конфіги для конкретної воронки:
- `TELEGRAM_CONNECTOR_ID` — UUID savedConnector з токеном бота
- `CLAUDE_CONNECTOR_ID` або `CLAUDE_API_KEY` — ключ Anthropic
- `AI_MODEL` — модель Claude (`claude-haiku-4-5` тощо)
- `AI_CONNECTOR_ID` — UUID savedConnector для AI
- `OPENAI_API_KEY` / `GEMINI_API_KEY` — резервні AI провайдери (fallback якщо Claude недоступний)
- `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_APP_SECRET` та ін. — ключі каналів
- `ADMIN_TELEGRAM_ID` — для notifyAdmin нод **★ системний ключ**

### Що НЕ треба зберігати в `.env` на сервері
- Будь-які per-bot токени/ключі
- OpenAI, Gemini API ключі
- Telegram токени ботів

### Системні ключі (глобальні savedConnectors, не в `.env`)
| тип | де зберігається | хто читає |
|-----|-----------------|-----------|
| `system_claude_api` | savedConnector | callClaude при тестуванні без сесії |
| `system_admin_telegram_id` | savedConnector | notifyAdmin нода |
| `telegram_bot` | savedConnector | channelSync, platformBotHandler через `TELEGRAM_CONNECTOR_ID` |

### Telegram-токен: ланцюг пріоритетів
```
funnelKey.TELEGRAM_CONNECTOR_ID → savedConnector.config.token   (пріоритет 1)
funnelKey.TELEGRAM_BOT_TOKEN                                     (пріоритет 2)
process.env.TELEGRAM_BOT_TOKEN  (ТІЛЬКИ для legacy)              (пріоритет 3)
```

---

## 4. Правило: нова нода → 3 місця одночасно

При додаванні нового типу ноди треба оновити **всі три** місця:

### 4.1 Бекенд — flow engine
Файл: `apps/api/src/services/testSession.js`
- Додати обробник у `executeFlowStep` (switch-like if/else chain)
- Додати тип у масив `NODE_TYPES` в `apps/mcp/src/tools-flows.js`

### 4.2 Фронтенд — ліва панель редактора
Файл: `apps/admin/src/components/funnel/NodeTypes.jsx` (або аналог)
- Додати нову ноду у список палітри зліва
- Додати defaultData (початкові дані для нової ноди)

### 4.3 MCP
Файл: `apps/mcp/src/tools-flows.js`
- Додати тип у `NODE_TYPES` (масив дозволених типів в `add_node`)
- Якщо є специфічні поля — додати опис у description `add_node` або `update_node`

---

## 5. Правило: після змін у воронках — тестування

Після будь-яких змін у flow engine або конкретній воронці:
1. Запустити тест-сесію через UI (кнопка «Тест» в редакторі воронки)
2. Або надіслати `/start` в Telegram якщо є реальний бот
3. Перевірити:
   - чи відправляються повідомлення
   - чи відображаються inline-keyboard кнопки
   - чи правильно відпрацьовує Claude-нода
   - чи немає `pm2 logs platform-api --lines 50` помилок

---

## 6. Мікросервіси (на тому ж сервері)

Всі мікросервіси живуть у **сусідніх папках** від `platform/`:

```
/var/www/flows.fineko.space/
├── platform/                  ← основна платформа
├── michael-bot/               ← PHP Telegram бот (домашні завдання)
├── apps-script/               ← Google Apps Script утиліти
├── docs/                      ← документація
├── бот з контент планом/      ← контент-бот (окремий)
├── боти/                      ← різні standalone боти
│   ├── Google Sheets AI agent/
│   └── бізнес процес агента/
```

PM2 на сервері управляє також:
- `image-processor` — обробка зображень (Fal.ai, FLUX)
- `video-processor` — відео (Kling, B-roll)
- `remotion-renderer` — Remotion рендер
- `slide-builder` — слайди
- `notebooklm-service` — Python сервіс (порт окремий)
- `hyperframes-service` — HeyGen аватари

---

## 7. Структура платформи

```
platform/
├── apps/
│   ├── api/            ← Express API (порт 3000)
│   │   └── src/
│   │       ├── routes/
│   │       │   ├── webhook.js          ← Telegram webhook handler
│   │       │   ├── funnels.js          ← CRUD воронок + ключів
│   │       │   ├── mcp-flows.js        ← MCP read-only
│   │       │   └── mcp-flows-edit.js   ← MCP write
│   │       ├── services/
│   │       │   ├── platformBotHandler.js  ← production Telegram handler
│   │       │   ├── testSession.js         ← flow engine (executeFlowStep)
│   │       │   └── channelSync.js         ← реєстрація webhook у Telegram
│   │       └── middleware/
│   ├── admin/          ← React SPA (Vite, Tailwind)
│   ├── worker/         ← Bull queues + cron-нагадування
│   └── mcp/            ← MCP tools definitions
├── packages/
│   ├── claude/         ← callClaude (Anthropic SDK + fallback)
│   ├── db/             ← Prisma client
│   ├── telegram/       ← sendMessage helpers
│   ├── logger/         ← Winston logger
│   └── errors/         ← ClaudeError, NotFoundError тощо
```

---

## 8. Telegram webhook: як працює routing

```
POST /webhook/telegram/:botId    ← platform funnels (platformBotHandler)
POST /webhook/bot/:slug          ← content funnels (slug-based)
POST /webhook/instagram/:botId   ← Instagram channel
```

`platformBotHandler` при `/start slug__l2` — визначає target bot через `resolveTargetBot`.

---

## 9. MCP ендпойнти

| URL | тип | призначення |
|-----|-----|-------------|
| `POST /api/mcp` | read-only | list_funnels, get_funnel, list_projects, get_node_stats, list_connectors, get_api_logs |
| `POST /api/mcp-edit` | write | new_bot, add_node, update_node, delete_node, create/update/delete project, ключі, конектори |
| `POST /api/mcp-debug` | debug | логи, стани сесій |

Auth: `Authorization: Bearer <MCP_SECRET>` або `?token=<user.mcpToken>`

---

## 10. Воронка курсу та Майкл-бот

- **Бот-курс «Фінансова система»** (`bot-course-finance`, id: `2bdaeaf5-...`)
  - Sends YouTube buttons + Michael bot link for each lesson
  - Wait nodes вже налаштовані на event mode (`mode: "event"`, `eventKey: "homework_done_lesson_X_Y"`)
  - Коли user натискає кнопку "✅ Домашнє завдання виконано" — `hw_done:` callback fires event

- **Michael bot** (`@michael_fineko_bot`) — **НЕ є платформною воронкою**
  - Існує як PHP-додаток у `/var/www/flows.fineko.space/michael-bot/`
  - Connector: `9c3a7f38-557b-469d-95a8-61ed4d926355` («Майкл - Бот з домашніми завданнями»)
  - Якщо захочемо перенести в платформу — потрібно створити бот + прив'язати connector

---

## 11. Claude fallback (OpenAI / Gemini)

При помилках `529 / 503 / timeout / overload` від Claude:
1. Шукає `OPENAI_API_KEY` у funnelKey → пробує OpenAI `gpt-4o-mini`
2. Якщо немає або теж упав — шукає `GEMINI_API_KEY` → пробує Gemini `gemini-1.5-flash`
3. Якщо всі впали — кидає помилку з повідомленням

Ключі ТІЛЬКИ per-funnel, глобальний `.env` не використовується.

---

## 12. Inline keyboard buttons у воронці

Message-нода підтримує `data.buttons` — масив масивів:
```json
{
  "buttons": [
    [{"text": "YouTube урок 1.1", "url": "https://youtu.be/..."}],
    [{"text": "📞 Хочу демо", "callback_data": "cta:demo"}]
  ]
}
```

`callback_data` префікси:
- `hw_done:<eventKey>` — відмітка виконання ДЗ
- `cta:<choice>` — вибір у воронці (demo/test/questions)
- `cm_approve`, `cm_regen`, `cm_fix` — quality check в content-manager

---

## 13. Деплой — чеклист

```bash
# 1. Локально
git add <files>
git commit -m "feat/fix: опис"
git push origin main

# 2. Сервер
ssh root@173.242.62.180
cd /var/www/flows.fineko.space/platform
git pull origin main
pm2 restart platform-api platform-worker  # + platform-mcp якщо MCP змінився

# 3. Перевірка
pm2 logs platform-api --lines 20
```

---

## 14. Стан фільтрів у UI

Список воронок (`/bots`) зберігає стан фільтрів у `sessionStorage` (`botsListFilters`):
- projectFilter, searchQuery, nameSort
- Відновлюється автоматично при поверненні зі сторінки редагування

---

## 15. Уроки з помилок

> Правило: після кожної помилки, яку допустив Claude і яку виправили (я або він) —
> сюди додається урок. Мета: не повторювати одне і те ж двічі.

### 15.1 `context` — тільки root-рівень, не `flowCtx`

**Помилка:** `lessonSlug` і `eventKey` зберігались у `session.context.flowRuntime.flowCtx.lessonSlug`  
**Правило:** Flow engine читає `ctx = session.context` (root). Усе, що треба зберегти між кроками або між сесіями — пишеться прямо в `session.context[key]`, а не у вкладені об'єкти `flowRuntime`.

### 15.2 `getNewAssistantMessages` — timestamp, не UUID

**Помилка:** Для фільтрації нових повідомлень використовувалось порівняння UUID (`id > sinceId`). UUIDs не є послідовними — старі повідомлення потрапляли в доставку.  
**Правило:** Завжди захоплювати `sinceTime = new Date()` **до** виклику `executeFlowStep`, передавати як `Date` об'єкт, фільтрувати через `createdAt: { gt: sinceTime }`.

### 15.3 Ключі для fallback — тільки у funnelKey, не в `.env`

**Помилка:** `resolveFallbackKeys` спочатку читав `OPENAI_API_KEY` і `GEMINI_API_KEY` з `process.env` як fallback.  
**Правило:** Будь-які API-ключі зовнішніх сервісів (OpenAI, Gemini, тощо) — ТІЛЬКИ в `funnelKey` конкретного бота. `.env` — тільки для системних налаштувань платформи (PORT, DATABASE_URL, MCP_SECRET).

### 15.4 Git: шляхи відносні від кореня репо, не від `platform/`

**Помилка:** При `git add` вказувався шлях `platform/apps/...` — але git root вже всередині `platform/`, тому правильний шлях `apps/...`.  
**Правило:** Завжди перевіряти `git status` перед `git add`. Шляхи у git — відносні від директорії де знаходиться `.git`.

### 15.5 Конфлікт на сервері — ніколи не редагувати файли напряму

**Помилка:** Сервер мав локальні зміни, що не були закомічені. При `git pull` виникав конфлікт.  
**Правило:** Дивись Розділ 2 — всі зміни тільки через git. Якщо сервер «відстав»: `git stash && git pull origin main`. Якщо merge conflict: `git merge --abort; git reset --hard origin/main; git pull`.

### 15.6 SSH + heredoc + кирилиця — апострофи ламають bash -c

**Помилка:** Передача JavaScript коду з апострофами (в українських текстах) через `ssh root@... bash -c '...'` ламала синтаксис.  
**Правило:** Якщо треба виконати скрипт на сервері з нестандартними символами — писати файл локально, `scp`-ити на сервер, запускати там, видаляти після.

### 15.7 Токени в Claude-нодах — 429 rate-limit

**Помилка:** `{{context.contentPlan}}` з повним JSON плану (30 постів × 2K симв.) + `{{context.nlm_overview}}` = 45K токенів. Ліміт 30K/хв → 429 на всіх провайдерах.  
**Правило:** `compressContextForPrompt()` у `testSession.js` автоматично стискає контекст перед кожним Claude-викликом. **Не треба** обрізати вручну в промптах — це вирішено на рівні flow engine.  
Бюджет на системний промпт: ≤ 3 000 токенів (~12K символів). Повний контекст (БЗ + план) додає ще ~3–4K після compression.

### 15.8 start_1 з кількома вихідними ребрами — тільки перше виконується

**Помилка:** `start_1 → msg_intro` і `start_1 → NotebookLM` як паралельні ребра. `pickNextNodeId` бере тільки `outgoing[0]` → NotebookLM ніколи не запускається.  
**Правило:** Кожна нода має ОДИН вихідний ланцюжок (або явно branched через condition). Паралельного fan-out немає. Якщо треба кілька кроків перед welcome — з'єднувати послідовно: `start → NLM → loadFile → welcome`.

### 15.9 content-scheduler у "returning user" routing — /start веде не туди

**Помилка:** Content Scheduler автоматично створює сесії по крону. `resolveTargetBot` знаходив їх як "останню сесію юзера" → returning users отримували бот-планувальник замість контент-менеджера.  
**Правило:** Автоматизовані боти-планувальники додавати в `AUTOMATED_SLUGS` масив у `platformBotHandler.js`. Вже є: `['content-scheduler']`.

### 15.10 Чекпоінти в контент-воронках — fileType для проміжних даних

**Архітектура:** Великі генерації (план на місяць) розбиваються на кроки з `saveFile` на кожному:
- `avatars_plan` — аватари, болі, мотивації (від KB)
- `content_structure` — рубрики, баланс, теми по датах (після підтвердження)
- `content_plan` — повні тексти постів (після батч-генерації)

`loadFile` підтримує будь-який рядок як `fileType` — нові типи не вимагають змін у коді. Якщо сесія падає — наступний `/start` відновлює з останнього збереженого чекпоінта.

---

## 16. Правило: конектори — тільки збережені екземпляри

### Що є в системі (Збережені конектори)

| Тип | ID екземпляру | Назва |
|-----|--------------|-------|
| Claude Sonnet | `2ec53ba5-144e-463b-9758-c217c4a69b0e` | Claude Sonnet для воронок |
| Claude Haiku | `4a8000aa-837f-4a73-bf5c-224949ebaf9a` | Claude Haiku для воронок |
| Claude Opus | `6a438f34-40b4-4b86-9aac-84a8f060a806` | Claude Opus для воронок |
| Telegram Bot (Den) | `1cd281cb-1bcc-4210-8f64-1dfca80c0af9` | Den. Бот для продаж |
| Telegram Bot (фін.курс) | `f5b2d95b-bd44-4f96-adce-c4d7d01750dc` | Бот для фінансового курсу |
| Telegram Bot (Майкл) | `9c3a7f38-557b-469d-95a8-61ed4d926355` | Майкл - Бот з домашніми завданнями |
| WayForPay | `350490a6-63f0-4fb5-8fc8-20d05a37558b` | Wayforpay для курсу по фінансах |
| Google Apps Script | `694fce00-6aef-4831-bae0-0325cec1f871` | Скрипт для створення гугл таблиць |
| ElevenLabs | `a27d7049-1973-4fdf-b8d5-660c0c7044b1` | ElevenLabs |
| Google Gemini | `e94f5f54-b19b-4d9c-b8aa-e88bcc4194d1` | Gemini для воронок |
| OpenAI GPT-4 | `54a9dabc-88e3-47a5-a4b5-a7c551428053` | GPT для воронок |

### Правило

**Не створювати per-funnel funnelKeys типу `AI_CONNECTOR_ID`, `CLAUDE_CONNECTOR_ID` для глобальних конекторів.**

- Замість `connectorId: "{{env.AI_CONNECTOR_ID}}"` → вставляти UUID прямо: `connectorId: "2ec53ba5-..."`
- Перед додаванням нового конектора — завжди перевіряти `list_connectors` і пропонувати вибрати з існуючих екземплярів
- Якщо потрібного конектора немає в списку — запитати користувача, чи треба створити новий збережений конектор у UI (`/connectors`)
- `TELEGRAM_CONNECTOR_ID` — **виняток**: залишається в funnelKey, бо кожен бот має різний токен

### Урок з помилки (2026-05-28)

`AI_CONNECTOR_ID = 30edf58a` — це **ID типу конектора** (definition), а не збереженого екземпляру. Правильний **instance ID** = `2ec53ba5`. Через цю помилку Claude нода не могла знайти конектор і падала. Завжди використовувати instance UUID з `list_connectors → instances[].id`.

---

*Оновлено: 2026-05-28. Якщо є нові правила — додавай сюди.*
