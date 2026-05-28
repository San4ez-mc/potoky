# FINEKO Flows — Bug Report v1
> Дата: 13 травня 2026  
> Автор: Claude (діагностика через MCP + test sessions)  
> Проект: Finance Course (14 ботів)

---

## 🔴 БАГ #1 — КРИТИЧНИЙ: `MessageService.getHistory is not a function`

### Симптом
Після старту сесії бот отримує повідомлення від користувача, але **не передає його в Claude-ноду**. Claude не викликається взагалі (`apiCallsCount: 0` у всіх сесіях). Бот залишається в стані `interviewing` і не рухається далі.

### Де відтворюється
Всі боти з Claude-нодою де `messagesTemplate: "{{conversationHistory}}"`.  
Підтверджено на: **Bot 1.2 Business Process** (5 тестових сесій — жодна не дійшла до Claude-виклику).

### Помилка в логах
```
warning: "MessageService.getHistory is not a function"
```

### Місце в коді
Ймовірно: `apps/api/src/services/` — сервіс обробки повідомлень у воронці, функція яка будує `conversationHistory` перед передачею в Claude-ноду.

Можливі причини:
1. Метод `getHistory` перейменований або видалений з `MessageService` але посилання залишилось
2. `MessageService` імпортується не як клас а як об'єкт — і метод недоступний в цьому контексті
3. Змінилась сигнатура — метод тепер асинхронний або приймає інші параметри

### Очікувана поведінка
Коли користувач надсилає повідомлення в активній сесії → Claude-нода отримує `conversationHistory` (масив всіх попередніх повідомлень сесії) і викликає Anthropic API.

### Пріоритет
**🔴 Blocker** — без цього фіксу жоден бот курсу не працює.

---

## 🔴 БАГ #2 — КРИТИЧНИЙ: Нода `pl_articles saveFile` не підключена до flow (Bot 2.1)

### Симптом
Bot 2.1 Articles має дві `saveFile` ноди: одна зберігає `cashflow_articles`, друга — `pl_articles`. Але нода для `pl_articles` (`node_1778531261129`) **не підключена через edge** до основного flow. Тобто навіть якщо Claude-нода спрацює і поверне результат — `pl_articles` ніколи не збережеться.

### Деталі з `get_funnel`
```json
{
  "id": "node_1778531261129",
  "type": "saveFile",
  "data": {
    "fileType": "pl_articles",
    "contentVar": "context.articles_result"
  }
}
```
Edge `edge_save_pl_...` існує (`save_result → node_1778531261129`) і нода підключена через edge до `msg_done`. Але перевір чи edge реально зареєстрований в базі — у вихідному `get_funnel` edges для цієї ноди присутні, але `apiCallsCount: 0` не дозволяє перевірити виконання.

**Додаткова проблема:** обидві ноди — `cashflow_articles` і `pl_articles` — читають з **одного** `context.articles_result`. Якщо Claude повертає обидва файли в одному блоці (що правильно за system prompt), то обидва `saveFile` збережуть однаковий вміст. Потрібно або:
- Розділити output на `context.cashflowArticles` і `context.plArticles` через два окремих виходи Claude-ноди, або
- Платформа має підтримувати збереження підблоків з одного output (наприклад, через `contentPath: "cashflow_articles"`)

### Пріоритет
**🔴 Критично** — `pl_articles` є prerequisite для Bot 3.2. Якщо файл не зберігається — блок 3 не отримає вхідних даних.

---

## 🟡 БАГ #3 — ВАЖЛИВО: `APPS_SCRIPT_URL` не заповнений (Bot 2.2)

### Симптом
Bot 2.2 Cashflow Table має ключ `APPS_SCRIPT_URL` зі значенням `"REPLACE_AFTER_DEPLOY"`. Бот не зможе викликати Apps Script і побудувати таблицю.

### Дія
Після деплою Apps Script Web App → оновити через:
```
update_funnel_key(botId: "ef42640d-...", key: "APPS_SCRIPT_URL", value: "<реальний URL>")
```

Те саме зробити для всіх ботів що викликають Apps Script:
- Bot 2.3 Payment Calendar (`c1b1103d-...`)
- Bot 3.2 P&L Table (`6adc79da-...`)
- Bot 4.4 Combined Table (`a99faa7c-...`)
- Bot 5.2 Balance Table (`8bb47937-...`)

### Пріоритет
**🟡 Важливо** — блокує побудову таблиць, але не блокує тестування діалогової частини ботів.

---

## 🟡 БАГ #4 — ВАЖЛИВО: Відсутні `APPS_SCRIPT_URL` ключі у 8 ботів

### Симптом
Боти з `keysCount: 0` які за логікою курсу мають викликати зовнішні API або мати налаштування середовища:

| Bot | ID | Проблема |
|-----|-----|---------|
| Bot 4.1 Process Update | `0062e7e3-...` | Немає жодного ключа |
| Bot 4.2 Salaries | `15b79289-...` | Немає жодного ключа |
| Bot 3.3 Diagnostics | `bd796da5-...` | Немає жодного ключа |
| Bot 5.1 Balance Articles | `69da1d5f-...` | Немає жодного ключа |
| Bot 5.3 Balance Process | `e50af81c-...` | Немає жодного ключа |
| Bot 4.3 Payments | `26c78700-...` | Немає жодного ключа |
| Bot 4.5 Team Instructions | `907b31e9-...` | Немає жодного ключа |
| Bot 2.1 Articles | `f4bd6571-...` | Немає жодного ключа |

Після деплою Apps Script додати `APPS_SCRIPT_URL` принаймні до ботів 4.4, 3.2, 2.3.

---

## 🟡 БАГ #5 — ВАЖЛИВО: Конфлікт логіки між system prompt і структурою воронки (Bot 1.2)

### Симптом
Системний промпт Claude в ноді `claude_main` описує власну багатоетапну логіку з `currentBlock`, `processModel`, `completedBlocks`, `validationAttempts`. При цьому воронка в FINEKO flows — лінійна (одна Claude-нода без умовних переходів).

Тобто є два конкуруючі "мозки":
- **Структура воронки** каже: `msg_intro → claude_main → save_result → msg_done` (лінійно)
- **System prompt Claude** каже: є блоки, є валідація, є підтвердження

Реальний контекст (`contextSnapshot`) показує поля `currentBlock: 0`, `processModel: {}`, `completedBlocks: []` — вони є в базі, але **ніколи не оновлюються** бо Claude-нода не може писати в `context` крім `outputVar`.

### Що потрібно
Або спростити system prompt (прибрати логіку блоків, залишити тільки лінійний діалог + генерацію фінального документа), або платформа має підтримувати умовні переходи з виходу Claude-ноди в залежності від стану.

**Рекомендація:** спростити system prompt — це швидше і надійніше. Нова версія system prompt вже підготовлена окремо.

---

## 📋 Загальний статус

| # | Баг | Пріоритет | Статус |
|---|-----|-----------|--------|
| 1 | `MessageService.getHistory is not a function` | 🔴 Blocker | Відкритий |
| 2 | `pl_articles` saveFile нода не підключена / однаковий output | 🔴 Критично | Відкритий |
| 3 | `APPS_SCRIPT_URL = REPLACE_AFTER_DEPLOY` у Bot 2.2 | 🟡 Важливо | Відкритий |
| 4 | Відсутні ключі у 8 ботів | 🟡 Важливо | Відкритий |
| 5 | Конфлікт логіки system prompt vs воронка в Bot 1.2 | 🟡 Важливо | Відкритий |

---

*Наступний крок після фіксу Бага #1: повторне тестування Bot 1.2 → перевірка повного циклу від повідомлення до збереження `business_process.md`.*
