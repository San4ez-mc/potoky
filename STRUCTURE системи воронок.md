# FINEKO Flows Platform — Структура проекту

> Актуально на: травень 2026  
> Production URL: https://flows.fineko.space  
> Git repo: https://github.com/San4ez-mc/potoky.git

---

## Зміст

1. [Загальний огляд](#1-загальний-огляд)
2. [Технологічний стек](#2-технологічний-стек)
3. [Файлова структура](#3-файлова-структура)
4. [Apps — Застосунки](#4-apps--застосунки)
5. [Packages — Пакети](#5-packages--пакети)
6. [MCP Сервери](#6-mcp-сервери)
7. [База даних — схема](#7-база-даних--схема)
8. [API Routes](#8-api-routes)
9. [Автентифікація](#9-автентифікація)
10. [Деплой та інфраструктура](#10-деплой-та-інфраструктура)
11. [Потоки даних](#11-потоки-даних)

---

## 1. Загальний огляд

AI Bots Platform — монорепо для управління чат-ботами з:
- Візуальним редактором воронок (аналог n8n)
- Інтеграцією з Telegram та Instagram
- AI-бекендом на Claude (Anthropic)
- Адмін-панеллю для моніторингу
- MCP (Model Context Protocol) для роботи з Claude.ai

---

## 2. Технологічний стек

| Шар | Технологія |
|-----|-----------|
| Runtime | Node.js 18+ |
| API | Express.js |
| ORM | Prisma |
| БД | PostgreSQL 14+ |
| Черга | Bull + Redis |
| AI | Anthropic Claude API |
| Frontend | React 18 + Vite + Tailwind CSS |
| Flow Editor | React Flow |
| State (admin) | Zustand |
| Process Manager | PM2 |
| Reverse Proxy | Nginx |
| Монорепо | Yarn Workspaces |

---

## 3. Файлова структура

```
/
├── platform/                        ← Основна платформа
│   ├── package.json                 ← Yarn Workspaces root
│   ├── ecosystem.config.js          ← PM2 конфіг (3 процеси)
│   ├── deploy.sh                    ← Деплой скрипт
│   ├── README.md                    ← Документація розгортання
│   │
│   ├── apps/
│   │   ├── api/                     ← Express API сервер (port 3000)
│   │   ├── admin/                   ← React адмін-панель
│   │   ├── worker/                  ← Bull jobs worker
│   │   └── mcp/                     ← MCP stdio сервер
│   │
│   ├── packages/
│   │   ├── db/                      ← Prisma клієнт + schema
│   │   ├── claude/                  ← Anthropic API обгортка
│   │   ├── telegram/                ← Telegram Bot API
│   │   ├── storage/                 ← Файлова система + DB
│   │   ├── logger/                  ← Winston логер
│   │   └── errors/                  ← Кастомні класи помилок
│   │
│   ├── projects/
│   │   └── finance-course/          ← Фінансовий курс (боти)
│   │
│   └── scripts/
│       ├── seed_funnels.js
│       ├── seed_finance_course.js
│       ├── seed_global_keys.js
│       ├── apply_flow_updates.js
│       ├── resync_all_channels.js
│       └── run_full_regression.js
│
├── michael-bot/                     ← Legacy PHP бот (окремий)
│   ├── config.php
│   ├── db.php
│   ├── models/
│   └── migrations/
│
├── боти/                            ← Окремі боти (Google Sheets, бізнес-процес)
│   ├── Google Sheets AI agent/
│   └── бізнес процес агента/
│
├── доступи.md                       ← Креди сервера та сервісів
├── fix_nginx.sh                     ← Nginx конфіг
└── STRUCTURE.md                     ← Цей файл
```

---

## 4. Apps — Застосунки

### 4.1 API (`platform/apps/api/`)

Основний Express сервер. Запускається через PM2 як `platform-api`.

**Точка входу:** `src/index.js`

**Middleware:**
```
src/middleware/
├── auth.js           ← Session + Bearer token автентифікація
├── asyncHandler.js   ← Обгортка для async route handlers
├── errorHandler.js   ← Глобальна обробка помилок
└── validateParams.js ← Zod валідація body/params/query
```

**Routes (`src/routes/`):**

| Файл | Prefix | Захист |
|------|--------|--------|
| `projects.js` | `/api/projects` | authMiddleware |
| `bots.js` | `/api/bots` | authMiddleware |
| `sessions.js` | `/api/sessions` | authMiddleware |
| `users.js` | `/api/users` | authMiddleware |
| `funnels.js` | `/api/funnels` | authMiddleware |
| `connectors.js` | `/api/connectors` | authMiddleware |
| `admin.js` | `/api/admin` | bcrypt login (власна) |
| `webhook.js` | `/webhook` | open (Telegram/Meta) |
| `mcp-flows.js` | `/api/mcp` | Bearer/token |
| `mcp-debug.js` | `/api/mcp-debug` | Bearer/token |
| `mcp.js` | `/mcp` | Bearer/token (legacy) |

**Services (`src/services/`):**
- `testSession.js` — Симульована Telegram сесія для тестування
- `regressionRunner.js` — Запуск регресійних тестів ботів
- `channelSync.js` — Синхронізація воронок з Telegram каналами

---

### 4.2 Admin (`platform/apps/admin/`)

React SPA, збирається у `public/admin/`. Serve через Nginx.

**Сторінки:**

| Route | Файл | Опис |
|-------|------|------|
| `/login` | `Login.jsx` | Авторизація |
| `/funnel/:botId` | `FunnelEditor.jsx` | Візуальний редактор (React Flow, full-screen) |
| `/funnels` | `Bots.jsx` | Список воронок/ботів |
| `/projects` | `Projects.jsx` | Управління проектами |
| `/dashboard` | `Dashboard.jsx` | Аналітика платформи |
| `/connectors` | `Connectors.jsx` | Бібліотека конекторів |
| `/sessions` | `Sessions.jsx` | Список сесій (global або per-bot) |
| `/sessions/:id` | `SessionDetail.jsx` | Деталі сесії (messages, API calls) |
| `/users` | `Users.jsx` | Список користувачів |
| `/users/:id` | `UserDetail.jsx` | Профіль користувача |
| `/api-logs` | `ApiLogs.jsx` | Логи API викликів |
| `/errors` | `Errors.jsx` | Трекінг помилок |
| `/logs` | `Logs.jsx` | Системні логи |
| `/mcp` | `MCPSettings.jsx` | MCP налаштування (два endpoint'и) |
| `/settings` | `Settings.jsx` | Налаштування адмінки |

**Layout:**
- `components/layout/Sidebar.jsx` — Бокове меню навігації
- `components/layout/Layout.jsx` — Основна обгортка з header
- `stores/authStore.js` — Zustand auth стор

---

### 4.3 Worker (`platform/apps/worker/`)

Bull jobs processor. PM2: `platform-worker`.

**Черги:**
- `telegram-messages` — Відправка Telegram повідомлень через `@platform/telegram`
- `notifications` — Сповіщення власника

**Конфіг:** Redis на `REDIS_URL` env var.

---

### 4.4 MCP (`platform/apps/mcp/`)

Stdio транспорт MCP для Claude Desktop.

**Точка входу:** `src/index.js`
- Читає JSON-RPC з stdin
- Обробляє: `initialize`, `tools/list`, `tools/call`

**Файли інструментів:**
- `src/tools.js` — Комбінований (25 tools, для legacy `/mcp`)
- `src/tools-flows.js` — 15 tools для управління воронками
- `src/tools-debug.js` — 10 tools для дебагу сесій

---

## 5. Packages — Пакети

### `@platform/db`
Prisma клієнт. Singleton з query logging у dev режимі.
```js
const { db } = require('@platform/db');
await db.session.findMany({ where: { isActive: true } });
```

### `@platform/claude`
Anthropic SDK обгортка.
```js
const { callClaude, buildMessages, extractTag } = require('@platform/claude');
```

### `@platform/telegram`
Telegram Bot API.
```js
const { sendMessage, sendInlineKeyboard, notifyOwner } = require('@platform/telegram');
```

### `@platform/storage`
Файлова система + DB зберігання артефактів.
```js
await FileStorage.save({ userId, botId, fileType: 'cashflow_articles', content });
await FileStorage.getLatest(userId, 'cashflow_articles');
```
Шлях: `FILES_BASE_PATH / projectSlug / userId / fileType_vN.md`

### `@platform/logger`
Winston логер з sanitization секретів.
```js
const logger = require('@platform/logger');
logger.info('Сесія створена', { sessionId, userId });
logger.error('Помилка Claude', { error: err.message });
```

### `@platform/errors`
Кастомні класи помилок:
```js
PlatformError → StorageError, BotError, PrerequisiteError,
                ClaudeError, TelegramError, AuthError,
                ValidationError, NotFoundError
```

---

## 6. MCP Сервери

Два HTTP MCP сервери для Claude.ai (причина розподілу: Claude.ai має ліміт ~12 tools на сервер via tool_search).

### Flows MCP — управління воронками
**URL:** `https://flows.fineko.space/api/mcp?token=<token>`

| Tool | Опис |
|------|------|
| `list_funnels` | Список всіх ботів та статус воронок |
| `get_funnel` | Повна воронка (nodes, edges, keys) |
| `update_node` | Оновити дані ноди |
| `add_node` | Додати ноду на canvas |
| `delete_node` | Видалити ноду |
| `create_edge` | З'єднати ноди |
| `update_funnel_key` | Створити/оновити змінну середовища |
| `delete_funnel_key` | Видалити змінну |
| `list_connectors` | Список конекторів |
| `get_connector` | Деталі конектора |
| `create_connector` | Створити конектор |
| `update_connector` | Оновити конектор |
| `delete_connector` | Видалити конектор |
| `get_node_stats` | Статистика ноди (помилки, сесії) |
| `get_api_logs` | Логи API викликів |

### Debug MCP — дебаг сесій
**URL:** `https://flows.fineko.space/api/mcp-debug?token=<token>`

| Tool | Опис |
|------|------|
| `get_session_logs` | Список сесій з историею повідомлень |
| `get_session` | Деталі сесії |
| `get_session_messages` | Всі повідомлення сесії |
| `get_session_api_calls` | API виклики в сесії |
| `get_session_context` | Контекст (файли з попередніх сесій) |
| `get_errors` | Лог помилок зі стектрейсами |
| `start_test_session` | Запустити симульовану Telegram сесію |
| `send_test_message` | Відправити повідомлення в тест-сесію |
| `get_test_session_state` | Стан тест-сесії |
| `end_test_session` | Завершити тест-сесію |

**Автентифікація обох:** Bearer token або `?token=<mcpToken>`

**Legacy URL (25 tools):** `https://flows.fineko.space/mcp?token=<token>`

---

## 7. База даних — схема

PostgreSQL. Prisma schema: `platform/packages/db/schema.prisma`

### Моделі

```
Project
├── id (UUID)
├── name, slug (unique), description
├── isActive, settings (JSON)
└── → Bot[], GlobalKey[]

Bot
├── id (UUID)
├── projectId → Project
├── name, slug (unique per project), description
├── trigger, isActive, settings (JSON)
└── → Session[], File[], UserProgress[], AppError[]
    FlowDefinition (1:1), FunnelKey[]

User
├── id (UUID)
├── telegramId (BigInt, unique)
├── username, firstName, lastName, languageCode
├── projectId → Project
├── mcpToken (unique, 64-char hex)
├── metadata (JSON)
└── → Session[], File[], UserProgress[], AppError[]

Session
├── id (UUID)
├── userId → User, botId → Bot
├── state (VARCHAR 100) ← поточний стан у воронці
├── context (JSON) ← змінні сесії
├── startedAt, lastActive, completedAt, isActive
└── → Message[], ApiCall[], File[], AppError[]

Message
├── id (UUID), sessionId → Session
├── role ('user' | 'assistant' | 'system')
├── content (Text), metadata (JSON)
└── createdAt

ApiCall
├── id (UUID), sessionId → Session (nullable)
├── service ('claude' | 'telegram' | 'google_sheets' | 'apps_script')
├── method, requestData (JSON), responseData (JSON)
├── statusCode, durationMs, error (Text)
└── createdAt

File
├── id (UUID)
├── userId → User, botId → Bot, sessionId → Session
├── fileType (enum: cashflow_articles, pl_articles, business_process, ...)
├── fileName, filePath, content (Text)
├── version (auto-increment per userId+fileType)
└── createdAt, updatedAt

UserProgress
├── id (UUID)
├── userId → User, projectId → Project, botId → Bot
├── blockNumber, lessonNumber (e.g. '2.1', '4.2')
├── status ('locked' | 'available' | 'in_progress' | 'completed')
├── completedAt, artifactFileId → File
└── Unique: (userId, projectId, lessonNumber)

FlowDefinition (1:1 з Bot)
├── id (UUID), botId → Bot (unique)
├── nodes (JSON), edges (JSON), viewport (JSON)
└── updatedAt

FunnelKey
├── id (UUID), botId → Bot
├── key (VARCHAR 100), value (Text)
├── label, isSecret
└── Unique: (botId, key)

GlobalKey
├── id (UUID), projectId → Project
├── key (VARCHAR 100), value (Text)
├── label, description, isSecret
└── Unique: (projectId, key)

ConnectorDef
├── id (UUID)
├── name, type (unique), description
├── icon, color, schema (JSON)
├── isBuiltin, isActive
└── createdAt

AppError
├── id (UUID)
├── sessionId → Session (nullable)
├── botId → Bot (nullable)
├── userId → User (nullable)
├── errorType, message (Text), stack (Text)
├── context (JSON), resolved (boolean)
└── createdAt
```

---

## 8. API Routes

### `GET /health` (public)
Перевірка стану сервера. Повертає `{ ok: true, status: 'healthy' }`.

### `POST /api/admin/login`
Авторизація адміна. Body: `{ password }`. Bcrypt перевірка.

### `/api/projects`
- `GET /` — Список активних проектів
- `GET /:id` — Деталі проекту
- `GET /:id/bots` — Боти з метриками (сесії, помилки, юзери)
- `GET /:id/stats` — 7d активні юзери, 24h помилки
- `GET/PUT/DELETE /:id/global-keys/:key` — CRUD глобальних ключів
- `GET /:id/global-keys/:key/reveal` — Показати секретний ключ

### `/api/bots`
- `GET /:id` — Дані бота
- `GET /:id/sessions` — Сесії бота (пагінація, дані юзера)

### `/api/sessions`
- `POST /test/start` — Створити тест-сесію
- `POST /test/:id/send` — Відправити повідомлення
- `GET /test/:id/state` — Стан тест-сесії
- `POST /test/:id/end` — Завершити тест-сесію
- `GET /:id` — Деталі сесії
- `GET /:id/messages` — Всі повідомлення
- `GET /:id/api-calls` — Лог API викликів
- `GET /:sessionId/context` — Контекст з файлів юзера

### `/api/users`
- `GET /` — Список (пагінація)
- `GET /:id` — Деталі юзера
- `GET /:id/progress` — Прогрес по урокам
- `GET /:id/files` — Файли-артефакти
- `GET /:id/sessions` — Сесії юзера
- `POST /:id/mcp-token` — Згенерувати MCP токен
- `GET /:id/mcp-token` — Отримати MCP токен

### `/api/funnels`
- `GET /:botId` — Воронка (nodes + edges + keys)
- `PUT /:botId` — Зберегти воронку
- `GET /:botId/export` — Експорт JSON
- `POST /:botId/import` — Імпорт JSON
- `GET/PUT/DELETE /:botId/keys/:key` — CRUD ключів воронки
- `POST /:botId/sync-channels` — Синхронізація каналів

### `/api/admin`
- `GET /analytics` — Загальна статистика платформи
- `GET /errors` — Лог помилок
- `PATCH /errors/:id/resolve` — Позначити помилку вирішеною
- `GET /sessions` — Всі сесії (з даними юзера: firstName, lastName, username, telegramId)
- `GET /api-logs` — Лог API викликів
- `POST /bots/:id/run-regression` — Регресійні тести бота

### `/webhook`
- `POST /telegram` — Головний Telegram webhook
- `POST /telegram/:botId` — Бот-специфічний Telegram webhook
- `GET /instagram/:botId` — Meta challenge verification
- `POST /instagram/:botId` — Instagram events

---

## 9. Автентифікація

### Адмін-панель (session-based)
1. `POST /api/admin/login` з паролем
2. Bcrypt перевірка проти `ADMIN_PASSWORD_HASH` env
3. `req.session.isAdmin = true` (24h cookie)

### API запити (Bearer token)
- `Authorization: Bearer <API_SECRET>` — для автоматизованих систем
- Або `x-api-secret: <API_SECRET>` header

### MCP токени (per-user)
- 64-char hex у полі `User.mcpToken`
- Передається через `?token=<mcpToken>` або `Authorization: Bearer <token>`
- Генерується через `POST /api/users/:id/mcp-token`

---

## 10. Деплой та інфраструктура

### Сервер
- **VPS:** 173.242.62.180
- **OS:** Ubuntu/Debian
- **Domain:** flows.fineko.space
- **Nginx:** reverse proxy → localhost:3000

### PM2 процеси
| Name | Script | Max Memory |
|------|--------|-----------|
| `platform-api` | `apps/api/src/index.js` | 500MB |
| `platform-worker` | `apps/worker/src/index.js` | 300MB |
| `platform-mcp` | `apps/mcp/src/index.js` | 200MB |

### Environment Variables (`.env` у `platform/`)
```env
DATABASE_URL=postgresql://platform:***@localhost:5432/platform
REDIS_URL=redis://localhost:6379
PORT=3000
NODE_ENV=production
SESSION_SECRET=...
API_SECRET=...
ADMIN_PASSWORD_HASH=$2b$12$...
ANTHROPIC_API_KEY=...
CLAUDE_MODEL=claude-haiku-4-5
FILES_BASE_PATH=/var/www/flows.fineko.space/files
LOG_LEVEL=info
MCP_SECRET=...
```

### Деплой команди
```bash
# Локально:
git add -A && git commit -m "..." && git push origin main

# На сервері:
ssh root@173.242.62.180 "
  cd /var/www/flows.fineko.space &&
  git pull origin main &&
  cd platform &&
  yarn workspace @platform/admin build &&   # якщо змінений frontend
  pm2 restart platform-api &&
  pm2 status
"
```

### Структура файлів на сервері
```
/var/www/flows.fineko.space/
├── platform/           ← git repo
├── files/              ← FILES_BASE_PATH (артефакти юзерів)
└── public/
    └── admin/          ← Зібраний React build
```

---

## 11. Потоки даних

### Telegram → Бот
```
Telegram User
    ↓ повідомлення
POST /webhook/telegram[:botId]
    ↓
webhook.js → telegramHandler.js (finance-course)
    ↓
Claude API (@platform/claude) → генерує відповідь
    ↓
Bull Queue (telegram-messages)
    ↓
Worker → @platform/telegram → Telegram API
    ↓
Користувач отримує відповідь
```

### Адмін → Редагування воронки
```
Admin UI (React)
    ↓ PUT /api/funnels/:botId
API → funnels.js route
    ↓
Prisma → FlowDefinition.update (nodes + edges JSON)
    ↓
Збережено в PostgreSQL
```

### Claude.ai → MCP
```
Claude.ai (браузер)
    ↓ POST /api/mcp?token=<token>  (або /api/mcp-debug)
mcp-flows.js (або mcp-debug.js) route
    ↓ auth check (global secret або User.mcpToken)
tools-flows.js (або tools-debug.js)
    ↓
Prisma + бізнес-логіка
    ↓
JSON відповідь → Claude.ai
```

### Юзер → Прогрес по курсу
```
Bot session
    ↓ юзер виконує завдання
telegramHandler.js → services
    ↓
FileStorage.save() → файл на диск + File у DB
    ↓
UserProgress.update() → статус 'completed'
    ↓
Наступний урок розблоковується
```

---

## Корисні посилання

| Ресурс | URL |
|--------|-----|
| Адмін-панель | https://flows.fineko.space/admin |
| MCP Flows | https://flows.fineko.space/api/mcp |
| MCP Debug | https://flows.fineko.space/api/mcp-debug |
| Health check | https://flows.fineko.space/health |
| Prisma Studio | `yarn workspace @platform/db studio` |
| PM2 статус | `pm2 status` (на сервері) |


---

## 9. онектори — архітектура та концепція

### ва рівні: шаблон і екземпляр

Система конекторів побудована на двох незалежних сутностях.

#### ConnectorDef — системний шаблон типу конектора

Таблиця connector_defs. азвичай isBuiltin: true. писує:
- **type** — унікальний slug (наприклад, claude_sonnet, 	elegram_bot)
- **name** — людська назва (Claude Sonnet, Telegram Bot)
- **icon** — емодзі для UI
- **description** — пояснення, коли використовувати
- **schema.fields** — масив полів, які потрібно заповнити:
  - key — ключ у config JSON
  - label — відображувана назва
  - secret: true — поле рендериться як password
  - multiline: true — textarea (наприклад, JSON ключа)
  - placeholder — підказка
- **schema.docs_url** — посилання на офіційну документацію API

ConnectorDef **не містить реальних ключів**. е лише інструкція "які поля треба заповнити і як відправляти запити".

#### SavedConnector — збережений екземпляр із ключами

Таблиця saved_connectors. істить:
- **name** — ваша назва (Sonnet основний, Fineko main bot)
- **type** — посилання на ConnectorDef.type
- **config** — JSON з реальними значеннями ключів, які ввів користувач
- **description** — необов'язкова нотатка

#### риклад розподілу

`
ConnectorDef: claude_sonnet
  └── SavedConnector: "Sonnet основний"   { api_key: "sk-ant-..." }
  └── SavedConnector: "Sonnet додатковий" { api_key: "sk-ant-..." }

ConnectorDef: telegram_bot
  └── SavedConnector: "Fineko main bot"   { token: "7123456789:AAH..." }
  └── SavedConnector: "Test bot"          { token: "9876543210:AAB..." }
`

дин ConnectorDef може мати **необмежену кількість** SavedConnector із різними ключами.

### Сторінка онектори (admin UI)

Сторінка /connectors має три секції:
1. **оступні типи конекторів** — картки ConnectorDef із бази, кожна з кнопкою "+ берегти конектор цього типу"
2. **бережені конектори** — список SavedConnector, згрупований за типом, з редагуванням і видаленням
3. **лобальні ключі проекту** — змінні середовища для ботів (окремий механізм)

### аповнення шаблонів

ля заповнення connector_defs використовується seed-скрипт:
`ash
yarn seed:connector-defs
# або напряму:
node scripts/seed_connector_defs.js
`

оточні шаблони: claude_haiku, claude_sonnet, claude_opus, openai_gpt4, 	elegram_bot, google_sheets, pps_script, webhook_generic.

### икористання у воронці (NodeEditor)

оли редагується нода типу connector у NodeEditor, є два режими:
- **бережений** — вибір зі списку SavedConnector (автоматично заповнює config)
- **учний** — пряме введення параметрів

Список у NodeEditor фільтрується за типом ноди (наприклад, для Claude-ноди показуються лише claude_* конектори).
