# FINEKO Flows Platform — Структура проекту

> Актуально на: травень 2026
> Production URL: https://flows.fineko.space
> Git repo: https://github.com/San4ez-mc/potoky.git

---

## 1. Загальний огляд

Платформа складається з монорепо `platform` і додаткових директорій з legacy/суміжними модулями.

Ключові можливості:
- Візуальний редактор воронок (React Flow)
- Запуск бот-логіки через API та Telegram webhook
- MCP HTTP endpoints для керування/дебагу
- Системні ключі та ключі конекторів
- Черги повідомлень через Bull + Redis

---

## 2. Коренева структура

```text
/
├── platform/                         # основний monorepo
│   ├── apps/
│   │   ├── api/
│   │   ├── admin/
│   │   ├── worker/
│   │   └── mcp/
│   ├── packages/
│   │   ├── db/
│   │   ├── claude/
│   │   ├── telegram/
│   │   ├── storage/
│   │   ├── logger/
│   │   └── errors/
│   ├── projects/
│   │   └── finance-course/
│   ├── scripts/
│   ├── ecosystem.config.js
│   └── package.json
├── michael-bot/                      # legacy PHP модуль
└── боти/                             # окремі зовнішні підпроекти
```

---

## 3. Apps

### 3.1 API (`platform/apps/api`)

Точка входу: `src/index.js`

Що є важливого зараз:
- `express-session` з Redis store (`src/lib/sessionStore`)
- `authMiddleware` + підтримка `x-api-secret`/`API_SECRET`
- окремі HTTP MCP маршрути: `/api/mcp`, `/api/mcp-edit`, `/api/mcp-debug`
- webhook endpoint для WayForPay: `POST /webhook/wayforpay`

Підключені роутери:
- `/api/projects`
- `/api/bots`
- `/api/sessions`
- `/api/users`
- `/api/funnels`
- `/api/connectors`
- `/api/saved-connectors`
- `/api/system-keys`
- `/api/admin`
- `/webhook`

### 3.2 Admin (`platform/apps/admin`)

SPA на React + Vite.

Основні сторінки/роути:
- `/login`
- `/funnels` (рендериться сторінка `Bots.jsx`)
- `/funnel/:botId`
- `/projects`
- `/dashboard`
- `/connectors`
- `/sessions`, `/sessions/:id`
- `/users`, `/users/:id`
- `/settings`

Примітка: окрема сторінка MCP settings відсутня; `/mcp` редіректить на `/settings`.

### 3.3 Worker (`platform/apps/worker`)

Черги:
- `telegram-messages`
- `notifications`

Використовує `@platform/telegram` для фактичної відправки повідомлень.

### 3.4 MCP stdio app (`platform/apps/mcp`)

Має stdio сервер (`src/index.js`) для локальних/desktop інтеграцій.
HTTP MCP для production реалізований через API роутери (`apps/api/src/routes/mcp*.js`).

---

## 4. Packages

### `@platform/db`
- Prisma schema: `platform/packages/db/schema.prisma`
- Основні моделі: `Project`, `Bot`, `User`, `Session`, `Message`, `ApiCall`, `File`, `UserProgress`, `FlowDefinition`, `FunnelKey`, `ConnectorDef`, `SavedConnector`, `GlobalKey`, `AppError`, `UserData`
- У `Bot` є поля `goal`, `outputFiles`

### `@platform/claude`
- Обгортки для викликів Claude моделей

### `@platform/telegram`
- Відправка повідомлень/нотифікацій у Telegram

### `@platform/storage`
- Робота з файловими артефактами користувачів

### `@platform/logger`
- Структуровані логи для API/worker

### `@platform/errors`
- Єдині класи помилок (`AuthError`, `NotFoundError`, тощо)

---

## 5. Projects

`platform/projects/finance-course`

Поточний стан:
- `src/telegramHandler.js` — головний обробник Telegram подій
- `services/` — бізнес-сервіси проекту
- `bots/` — сценарії/конфіги окремих ботів

---

## 6. API (коротка карта)

### Auth/admin
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/analytics`
- `GET /api/admin/sessions`
- `GET /api/admin/errors`
- `PATCH /api/admin/errors/:id/resolve`
- `GET /api/admin/api-logs`
- `POST /api/admin/bots/:id/run-regression`
- `POST /api/admin/projects/:slug/run-regressions`
- `GET /api/admin/mcp-config`

### Projects/Bots
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/projects/:id/bots`
- `POST /api/projects/:id/bots`
- `GET /api/projects/:id/stats`

### Keys
- `GET /api/projects/:id/global-keys`
- `PUT /api/projects/:id/global-keys/:key`
- `DELETE /api/projects/:id/global-keys/:key`
- `GET /api/projects/:id/global-keys/:key/reveal`
- `GET /api/system-keys`
- `PUT /api/system-keys/:key`
- `GET /api/system-keys/:key/reveal`

### Funnels
- `GET /api/funnels/:botId`
- `PUT /api/funnels/:botId`
- `GET /api/funnels/:botId/export`
- `POST /api/funnels/:botId/import`
- `GET /api/funnels/:botId/keys`
- `PUT /api/funnels/:botId/keys`
- `DELETE /api/funnels/:botId/keys/:key`
- `GET /api/funnels/:botId/keys/:key/reveal`
- `POST /api/funnels/:botId/sync-channels`
- `POST /api/funnels/:botId/edges`
- `PUT /api/funnels/:botId/edges`
- `DELETE /api/funnels/:botId/edges/:edgeId`
- `GET /api/funnels/:botId/nodes/:nodeId/stats`
- `POST /api/funnels/:botId/check-prerequisites`

### Sessions/Users
- `POST /api/sessions/test/start`
- `POST /api/sessions/test/:id/send`
- `GET /api/sessions/test/:id/state`
- `POST /api/sessions/test/:id/end`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/messages`
- `GET /api/sessions/:id/api-calls`
- `GET /api/sessions/:id/errors`
- `POST /api/sessions/:id/send`
- `DELETE /api/sessions/:id`
- `POST /api/sessions/bulk-delete`
- `GET /api/sessions/:sessionId/context`
- `GET /api/users`
- `GET /api/users/:id`
- `GET /api/users/:id/progress`
- `GET /api/users/:id/files`
- `GET /api/users/:id/sessions`
- `POST /api/users/:id/mcp-token`
- `GET /api/users/:id/mcp-token`

### Connectors
- `GET /api/connectors`
- `GET /api/connectors/:id`
- `GET /api/saved-connectors`
- `GET /api/saved-connectors/:id`
- `POST /api/saved-connectors`
- `PUT /api/saved-connectors/:id`
- `DELETE /api/saved-connectors/:id`

### MCP HTTP
- `GET/POST /api/mcp`
- `GET/POST /api/mcp-edit`
- `GET/POST /api/mcp-debug`
- `GET/POST /mcp` (legacy)

### Webhook
- `POST /webhook/telegram`
- `POST /webhook/telegram/:botId`
- `GET /webhook/instagram/:botId`
- `POST /webhook/instagram/:botId`
- `POST /webhook/wayforpay`

---

## 7. Деплой та runtime

### PM2 конфіг (`platform/ecosystem.config.js`)
- `platform-api`
- `platform-worker`
- `platform-mcp`

### Часті команди

```bash
# dependencies
yarn install --production=false

# admin build
yarn build:admin

# db
yarn db:migrate:deploy

# process
pm2 restart all
pm2 status
```

### Важлива примітка по БД

Після змін Prisma schema обов'язково застосовувати міграції до перевірки UI/API.
Критичний приклад: відсутність колонок `bots.goal`/`bots.outputFiles` ламала `GET /api/projects/:id/bots` і воронки зникали в UI.

---

## 8. Потоки даних (коротко)

### Admin -> Funnels

```text
Admin UI
  -> /api/projects/:id/bots (список воронок)
  -> /api/funnels/:botId (деталі flow)
  -> Prisma (Bot + FlowDefinition + FunnelKey)
```

### Telegram -> Session runtime

```text
Telegram webhook
  -> finance-course telegramHandler
  -> session/state logic
  -> queue/send via worker + @platform/telegram
```

### Claude.ai -> MCP

```text
Claude.ai
  -> /api/mcp | /api/mcp-edit | /api/mcp-debug
  -> tools-flows/tools-debug
  -> Prisma/API operations
```
