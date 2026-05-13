# FINEKO Flows — Bug Report v2
> Дата: 13 травня 2026  
> Попередній звіт: v1 (правки внесені агентом)  
> Метод: тест-сесії через MCP Debug + перевірка воронок

---

## Статус після v1

| Баг з v1 | Статус |
|----------|--------|
| #1 `MessageService.getHistory` | 🔴 НЕ ПОФІКСОВАНИЙ |
| #2 `pl_articles` saveFile / однаковий output | не перевірити поки #1 не пофіксований |
| #3 `APPS_SCRIPT_URL = REPLACE_AFTER_DEPLOY` | 🟡 не перевірено |
| #4 Відсутні ключі у 8 ботів | 🟡 не перевірено |
| #5 Конфлікт system prompt vs воронка Bot 1.2 | 🟡 не перевірено |
| #6 Відсутній `create_funnel` в MCP + IP-whitelist | 🔴 НЕ ПОФІКСОВАНИЙ — Bot 1.1 в `list_funnels` відсутній |

---

## 🔴 БАГ #1 — ЗАЛИШАЄТЬСЯ: `MessageService.getHistory is not a function`

### Підтверджено повторним тестом
```
Сесія: e3629209-75f2-43a5-84c1-c09fe5773b65
Bot: 1.2 Business Process
Повідомлення надіслано: "Ми — маркетингове агентство..."
botResponse: повертає перше intro-повідомлення знову
warning: "MessageService.getHistory is not a function"
apiCallsCount: 0 ← Claude не викликається
```

### Де шукати
Файл: `apps/api/src/services/` — швидше за все `telegramHandler.js` або окремий `sessionService.js` / `claudeNodeRunner.js`.

Патерн виклику який треба знайти:
```javascript
// десь в обробці Claude-ноди:
const history = MessageService.getHistory(sessionId);
// або:
const history = await MessageService.getHistory(sessionId);
```

`getHistory` або не існує як статичний метод, або клас імпортується некоректно, або метод перейменований.

**Правильний виклик** (судячи по моделі даних):
```javascript
const messages = await db.message.findMany({
  where: { sessionId },
  orderBy: { createdAt: 'asc' }
});
// або через @platform/db helper якщо він є
```

### Пріоритет
**🔴 Blocker** — жоден бот курсу не дійде до Claude поки це не пофіксовано.

---

## 🔴 БАГ #6 — ЗАЛИШАЄТЬСЯ: Відсутній `create_funnel` в MCP

### Підтверджено
`list_funnels` повертає 14 воронок — Bot 1.1 відсутній. Новий метод `create_funnel` не з'явився в інструментах MCP після деплою v1.

### Нагадування що потрібно
Два незалежних фікси (деталі в Bug Report v1):
1. `create_funnel` tool в `tools-flows.js` — `db.bot.create` + `db.flowDefinition.create`
2. Зняти IP-фільтр для `/api/mcp*` в Nginx або додати відкритий доступ по Bearer-only

---

## 🔴 БАГ #7 — НОВИЙ: `get_node_stats` падає з Prisma помилкою

### Симптом
```
FINEKO flows:get_node_stats(botId, nodeId: "claude_main", period: "24h")
→ Prisma error: Unknown argument `createdAt`
```

### Повний stack
```
Invalid `prisma.session.count()` invocation:
{
  where: {
    botId: "db22c1f9-...",
    createdAt: {        ← ЦЕ ПОЛЕ НЕ ІСНУЄ В МОДЕЛІ Session
      gte: new Date(...)
    }
  }
}
Unknown argument `createdAt`. 
Available: id, userId, state, context, startedAt, lastActive, 
           completedAt, isActive, user, bot, messages, apiCalls, files, errors
```

### Причина
У моделі `Session` немає поля `createdAt` — є `startedAt`. Код `get_node_stats` фільтрує по `createdAt` замість `startedAt`.

### Фікс
У `tools-flows.js`, функція `get_node_stats`, знайти:
```javascript
createdAt: { gte: periodStart }
```
Замінити на:
```javascript
startedAt: { gte: periodStart }
```

### Пріоритет
**🔴 Критично** — `get_node_stats` потрібен для моніторингу нод. Фікс тривіальний: одне слово.

---

## 🟡 БАГ #8 — НОВИЙ: `get_errors` повертає порожній масив при реальних помилках

### Симптом
Під час тест-сесій Bot 1.2 стабільно з'являється `warning: "MessageService.getHistory is not a function"`. При цьому:
```javascript
get_errors(botId: "db22c1f9-...", resolved: false) → []
get_errors(resolved: false) → []  // глобально — теж порожньо
```

### Причина
Одне з двох:
1. `warning` в тест-сесії не пишеться в таблицю `AppError` — логується тільки в stdout/stderr сервера
2. Або `get_errors` читає з `AppError` де `sessionId` прив'язаний до реального Telegram userId, а тест-сесії мають інший userId тип — і фільтр не спрацьовує

### Фікс
В обробнику Claude-ноди: коли `MessageService.getHistory` падає з помилкою — catch блок має писати в `db.appError.create(...)`, не тільки логувати через `logger.warn`. Тоді `get_errors` буде корисним інструментом для діагностики.

### Пріоритет
**🟡 Важливо** — без цього `get_errors` не дає реальної картини що відбувається.

---

## 📋 Загальний статус після v2

| # | Баг | Пріоритет | Статус |
|---|-----|-----------|--------|
| 1 | `MessageService.getHistory is not a function` | 🔴 Blocker | Відкритий (повторно підтверджений) |
| 6 | Відсутній `create_funnel` в MCP + IP-whitelist | 🔴 Blocker | Відкритий (повторно підтверджений) |
| 7 | `get_node_stats` — `createdAt` → має бути `startedAt` | 🔴 Критично | Новий |
| 8 | `get_errors` не пише реальні помилки в AppError | 🟡 Важливо | Новий |
| 2 | `pl_articles` saveFile / однаковий output | 🔴 Критично | Заблокований #1 |
| 3 | `APPS_SCRIPT_URL = REPLACE_AFTER_DEPLOY` Bot 2.2 | 🟡 Важливо | Не перевірено |
| 4 | Відсутні ключі у 8 ботів | 🟡 Важливо | Не перевірено |
| 5 | Конфлікт system prompt vs воронка Bot 1.2 | 🟡 Важливо | Не перевірено |

---

## Черговість фіксів для наступного раунду

1. **#1** — `MessageService.getHistory` → знайти і замінити на прямий `db.message.findMany`
2. **#7** — `get_node_stats` → `createdAt` → `startedAt` (1 хвилина)
3. **#6** — `create_funnel` в MCP + Nginx allowlist
4. **#8** — `get_errors` → додати `db.appError.create` в catch Claude-ноди

Після фіксу #1 і #6 → повертаємось: створюємо Bot 1.1, тестуємо повний цикл 1.2 → зберігається `business_process.md`.
