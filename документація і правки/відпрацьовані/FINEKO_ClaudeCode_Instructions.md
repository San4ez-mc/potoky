# FINEKO Finance Course — Фінальна інструкція для Claude Code

> **Ціль:** довести всі 15 воронок курсу до стану «готово для користувачів»  
> **Платформа:** `/var/www/flows.fineko.space/platform/`  
> **Monorepo:** `apps/api/`, `apps/admin/`, `apps/worker/`, `packages/db/`, `packages/claude/`  
> **БД:** PostgreSQL + Prisma. Черги: Bull + Redis.

---

## ЧАСТИНА 1 — КОНТЕКСТ: ЩО ЦЕ ЗА КУРС

### Курс «Фінансова система малого бізнесу»

Онлайн-курс для власників малого бізнесу (команди 7+ осіб). Проходить через Telegram-бота. AI-асистент курсу — **Майкл** (у sales-боті — **Ден**).

**Результат курсу:** три фінансові звіти (Cashflow, P&L, Баланс) вбудовані в бізнес-процес компанії і підтримуються командою без участі власника.

### Шлях студента через курс

```
БЛОК 1 — ФУНДАМЕНТ
  Bot 1.1 Onboarding      → Майкл знайомиться зі студентом, зберігає профіль
  Bot 1.2 Бізнес-процес   → Будує swimlane-схему всього бізнесу (PNG + docx)

БЛОК 2 — CASHFLOW
  Bot 2.1 Статті          → Визначає статті доходів/витрат (cogs/opex/owner/tax)
  Bot 2.2 Таблиця         → Будує Google Sheets таблицю Cashflow+P&L автоматично
  Bot 2.3 Платіжний кал.  → Заповнює перший місяць платіжного календаря

БЛОК 3 — P&L
  Bot 3.2 Таблиця P&L     → Додає лист P&L в існуючу таблицю
  Bot 3.3 Діагностика     → Аналізує таблиці, знаходить фінансові ризики

БЛОК 4 — УПРАВЛІННЯ
  Bot 4.1 Оновлення проц. → Оновлює бізнес-процес з точками збору даних
  Bot 4.2 Зарплати        → Налаштовує облік зарплат в таблиці
  Bot 4.3 Платежі         → Налаштовує облік регулярних платежів
  Bot 4.4 Зведена табл.   → Об'єднує всі звіти в один дашборд
  Bot 4.5 Інструкції      → Генерує інструкції для кожного члена команди

БЛОК 5 — БАЛАНС
  Bot 5.1 Статті балансу  → Визначає статті балансу під бізнес
  Bot 5.2 Таблиця балансу → Будує лист Баланс в існуючій таблиці
  Bot 5.3 Процес балансу  → Вбудовує ведення балансу в бізнес-процес
```

### Як дані передаються між ботами

Кожен бот зберігає результат через `saveFile`-ноду в таблицю `File` (Prisma) по `userId + fileType`. Наступний бот читає через `loadFile`-ноду. Це і є «пам'ять» курсу — Майкл «пам'ятає» все що студент зробив раніше.

```
user_onboarding_data  → зберігає 1.1,  читають всі наступні боти
business_process      → зберігає 1.2,  читають 2.1, 4.1, 4.5, 5.1
articles              → зберігає 2.1,  читають 2.2, 3.2, 4.2, 4.4, 4.5, 5.1
cashflow_table_url    → зберігає 2.2,  читають 2.3, 3.2, 3.3, 4.x, 5.2, 5.3
balance_articles      → зберігає 5.1,  читає  5.2
```

---

## ЧАСТИНА 2 — СТРУКТУРА КОЖНОГО БОТА

### Ідентифікатори ботів

| Бот | ID | Тип |
|-----|----|-----|
| 1.1 Onboarding | `7675fc52-2057-44e2-b0dd-fffa15f99ee9` | dialog |
| 1.2 Business Process | `db22c1f9-ae67-4b15-959d-cbd171be5038` | dialog |
| 2.1 Articles | `f4bd6571-e386-4a36-a086-ff631c3d77e4` | dialog |
| 2.2 Cashflow Table | `ef42640d-1c18-4734-8b2b-ef444eadb960` | auto (httpRequest) |
| 2.3 Payment Calendar | `c1b1103d-12ae-423d-a155-74fa438ab82f` | dialog |
| 3.2 P&L Table | `6adc79da-72cb-41c3-9368-b892c0be551c` | auto (httpRequest) |
| 3.3 Diagnostics | `bd796da5-30ec-4b0a-bf80-f783fe4f8dbb` | dialog |
| 4.1 Process Update | `0062e7e3-27ff-41ec-a877-43a69f015a66` | dialog |
| 4.2 Salaries | `15b79289-a8c2-49f7-aa29-4e4fda7b23ab` | dialog |
| 4.3 Payments | `26c78700-4f95-4054-bb9b-1722977b6cd1` | dialog |
| 4.4 Combined Table | `a99faa7c-1e0f-46a9-8998-f6f6f2a81118` | auto (httpRequest) |
| 4.5 Team Instructions | `907b31e9-2032-4e94-831c-ed175db488e2` | dialog |
| 5.1 Balance Articles | `69da1d5f-1c9c-463d-a939-0f0f45834cec` | dialog |
| 5.2 Balance Table | `8bb47937-24e8-45e1-a18b-52918ab1e5d2` | auto (httpRequest) |
| 5.3 Balance Process | `e50af81c-1038-4b3e-9cee-9659a0a787b3` | dialog |

### Стандартна структура dialog-бота

```
loadFile(user_onboarding_data)     ← обов'язково всім крім 1.1
loadFile(...)                      ← інші файли за потребою
msg_intro                          ← вітання по імені, мета, час, що отримає
claude_main                        ← mode:dialog, exitCondition:user_confirms
saveFile                           ← зберігає результат
generateDocument                   ← конвертує в docx і відправляє
msg_done                           ← що зроблено + анонс наступного уроку
```

### Стандартна структура auto-бота (httpRequest)

```
loadFile(articles або balance_articles)
loadFile(user_onboarding_data)
msg_intro                          ← вітання + "будую таблицю, ~30 сек"
httpRequest(build_table)           ← POST до APPS_SCRIPT_URL
httpRequest(validate_table)        ← перевірка формул
[якщо помилки] httpRequest(repair_formulas) → httpRequest(validate_table)
condition(success?)
  ├── true  → saveFile(cashflow_table_url) → msg_done(посилання)
  └── false → msg_error
```

### Правила системного промпту

```
Ти — Майкл, AI-асистент курсу «Фінансова система бізнесу».

КОНТЕКСТ СТУДЕНТА:
- Ім'я: {{context.onboarding_result.name}}
- Бізнес: {{context.onboarding_result.company_description}}
- [інші поля залежно від уроку]

АЛГОРИТМ:
[покроковий алгоритм]

ПРАВИЛА:
- Одне питання за раз, ніколи два в одному повідомленні
- Звертайся по імені, на «ти», тепло
- Ти Майкл — не кажи що ти ШІ
- Після підтвердження — ТІЛЬКИ фінальний документ (YAML/Markdown), без пояснень

ФОРМАТ ВИХОДУ (після підтвердження):
[точний формат]
```

---

## ЧАСТИНА 3 — ЩО ТРЕБА ЗРОБИТИ (пріоритизовано)

### 🔴 ПРІОРИТЕТ 1 — APPS_SCRIPT_URL

**Без цього жодна таблиця не будується.**

Apps Script задеплоєний. URL знайти: Google Apps Script → Deploy → Manage deployments.  
Формат: `https://script.google.com/macros/s/AKfycb.../exec`

Оновити ключ `APPS_SCRIPT_URL` в 5 ботах:
- `ef42640d` (Bot 2.2)
- `c1b1103d` (Bot 2.3)
- `6adc79da` (Bot 3.2)
- `a99faa7c` (Bot 4.4)
- `8bb47937` (Bot 5.2)

**Або краще:** зробити глобальний ключ на рівні проекту щоб не дублювати.

---

### 🔴 ПРІОРИТЕТ 2 — loadFile `user_onboarding_data` в 10 ботах

**Без цього:** `{{context.onboarding_result.name}}` = порожній рядок → студент бачить «Привіт, !»

Нода для додавання:
```json
{
  "type": "loadFile",
  "data": {
    "label": "loadFile — онбординг",
    "fileType": "user_onboarding_data",
    "outputVar": "context.onboarding_result",
    "onMissing": "skip"
  }
}
```

Вставити першою в ланцюзі (перед іншими loadFile нодами, перед msg_intro).

| Бот | Bot ID | Вставити першою нодою |
|-----|---------|-----------------------|
| 3.2 | `6adc79da` | так |
| 3.3 | `bd796da5` | так |
| 4.1 | `0062e7e3` | так |
| 4.2 | `15b79289` | так |
| 4.3 | `26c78700` | так |
| 4.4 | `a99faa7c` | так |
| 4.5 | `907b31e9` | так |
| 5.1 | `69da1d5f` | так |
| 5.2 | `8bb47937` | так |
| 5.3 | `e50af81c` | так |

---

### 🔴 ПРІОРИТЕТ 3 — generateDocument в 7 ботах

**Без цього:** студент не отримує docx-файл після уроку.

Нода вставляється між `save_result` і `msg_done`:
```
Видалити ребро: save_result → msg_done
Додати: save_result → generateDocument → msg_done
```

| Бот | Bot ID | template | sourceVar |
|-----|--------|----------|-----------|
| 3.3 | `bd796da5` | `financial_diagnostics` | `context.mechanics_md` |
| 4.1 | `0062e7e3` | `business_process_v2` | `context.process_v2_md` |
| 4.2 | `15b79289` | `salary_processes` | `context.salary_md` |
| 4.3 | `26c78700` | `payment_processes` | `context.payments_md` |
| 4.5 | `907b31e9` | `team_instructions` | `context.instructions_md` |
| 5.1 | `69da1d5f` | `balance_articles` | `context.balance_articles_md` |
| 5.3 | `e50af81c` | `balance_process_guide` | `context.balance_process_md` |

---

### 🟡 ПРІОРИТЕТ 4 — Bot 4.3: додати loadFile `business_process`

В промпті Bot 4.3 є `{{context.businessProcess}}` але нода відсутня.

```json
{
  "type": "loadFile",
  "data": {
    "fileType": "business_process",
    "outputVar": "context.businessProcess",
    "onMissing": "skip"
  }
}
```

Вставити після `loadfile_cashflow_articles`, перед `loadfile_onboarding`.

---

### 🟡 ПРІОРИТЕТ 5 — Bot 5.2: виправити `combinedSheetsId`

В промпті Bot 5.2 є `{{context.combinedSheetsId}}` але змінна не заповнюється.

Додати js-ноду між loadFile і msg_intro:
```javascript
const url = context.sheetsUrl || context.combinedUrl;
if (url) {
  const match = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  context.sheetsId = match ? match[1] : null;
  context.combinedSheetsId = context.sheetsId;
}
```

---

### 🟡 ПРІОРИТЕТ 6 — Bot 4.4: уніфікувати fileType

Bot 4.4 зберігає як `combined_table_url`, Bot 5.2 читає `cashflow_table_url`.  
Змінити в saveFile Bot 4.4: `combined_table_url` → `cashflow_table_url`

---

## ЧАСТИНА 4 — АРХІТЕКТУРА GOOGLE SHEETS

### Apps Script — що вміє

Файл: `боти/Google Sheets AI agent/apps-script/FinancialReportsBuilder.gs`

Приймає `HTTP POST`, маршрутизує по `payload.action`:

| action | що робить |
|--------|-----------|
| `build_table` | Створює Spreadsheet: листи, named ranges, формули, захист, dropdown-и, тестові рядки, інструкцію |
| `validate_table` | Перевіряє: `#REF!`, `#NAME?`, `#VALUE!`, `#DIV/0!`, `#ERROR!`, named ranges, sheet protection |
| `update_table` | Зміни: `add_article`, `remove_article`, `rename_article`, `repair_formulas`, `add_sheet`, `remove_sheet` |
| `ping` | Перевірка доступності |

### Обов'язковий flow після build_table

```javascript
// 1. Будуємо таблицю
const buildResult = await httpRequest(APPS_SCRIPT_URL, {
  action: 'build_table', report_type: '...', ...
});

// 2. Валідуємо
const validateResult = await httpRequest(APPS_SCRIPT_URL, {
  action: 'validate_table',
  spreadsheetId: buildResult.spreadsheetId
});

// 3. Якщо є помилки — ремонтуємо
if (validateResult.hasErrors) {
  await httpRequest(APPS_SCRIPT_URL, {
    action: 'update_table',
    change_type: 'repair_formulas',
    spreadsheetId: buildResult.spreadsheetId
  });
  // повторна валідація
}

// 4. Зберігаємо результат
context.sheetsUrl = buildResult.spreadsheetUrl;
context.sheetsId = buildResult.spreadsheetId;
```

### Payload для кожного бота

**Bot 2.2 — `cashflow_and_pl`:**
```json
{
  "action": "build_table",
  "report_type": "cashflow_and_pl",
  "business_name": "{{context.onboarding_result.company_description}}",
  "telegram_username": "{{user.username}}",
  "telegram_id": "{{user.telegramId}}",
  "pl_mode": "total",
  "inflows": "{{context.cashflowArticles.cashflow_articles.income}}",
  "outflows": "{{context.cashflowArticles.cashflow_articles.expenses}}"
}
```

Що будується: `📊 Cashflow`, `📊 P&L`, `⬇️ Надходження`, `⬆️ Витрати`, `📋 Довідники`, `⚙️ Налаштування`, `🔗 References`, `📖 Інструкція`.  
Колонки у Витратах: `Дата оплати`, `Дата визнання`, `cost_type`.  
Cashflow → по `дата_оплати`. P&L → по `дата_визнання` + `cost_type`.

**Bot 3.2 — додати лист P&L:**
```json
{
  "action": "update_table",
  "change_type": "add_pl_sheet",
  "spreadsheetId": "{{context.sheetsId}}",
  "pl_mode": "total",
  "articles": "{{context.plArticles}}"
}
```

**Bot 4.2 — додати лист зарплат:**
```json
{
  "action": "update_table",
  "change_type": "add_salary_sheet",
  "spreadsheetId": "{{context.sheetsId}}",
  "salaryData": "{{context.salaryProcesses}}"
}
```

**Bot 4.3 — додати персональні листи:**
```json
{
  "action": "update_table",
  "change_type": "add_payment_sheets",
  "spreadsheetId": "{{context.sheetsId}}",
  "paymentData": "{{context.paymentProcesses}}"
}
```

**Bot 5.2 — додати лист Баланс:**
```json
{
  "action": "build_table",
  "report_type": "balance",
  "spreadsheetId": "{{context.combinedSheetsId}}",
  "articles": "{{context.balanceArticles}}"
}
```

Що будується: `📊 Баланс`, `📋 Довідники`, `⚙️ Налаштування`, `🔗 References`, `📖 Інструкція`.

### Google Drive структура

```
Root folder: GOOGLE_DRIVE_PARENT_FOLDER_ID (або "Фінансова система — Курс")
  └── client_tg_<username>/          ← папка студента
        └── Cashflow_P&L_<name>.xlsx  ← один файл, боти додають до нього листи
```

---

## ЧАСТИНА 5 — ГЛОБАЛЬНІ ПРАВИЛА

### fileType — точні значення

| fileType | формат | хто пише | хто читає |
|----------|--------|----------|-----------|
| `user_onboarding_data` | JSON | Bot 1.1 | всі 1.2+ |
| `business_process` | Markdown + Mermaid | Bot 1.2, 4.1 | 2.1, 4.1, 4.5, 5.1 |
| `articles` | YAML (cashflow + pl разом) | Bot 2.1 | 2.2, 3.2, 4.2, 4.4, 4.5, 5.1 |
| `cashflow_table_url` | JSON: `{spreadsheetUrl, spreadsheetId}` | Bot 2.2, 4.4 | 2.3, 3.2, 3.3, 4.x, 5.2, 5.3 |
| `payment_calendar` | JSON | Bot 2.3 | — |
| `diagnostics_report` | Markdown | Bot 3.3 | — |
| `team_instructions` | Markdown | Bot 4.5 | — |
| `balance_articles` | YAML | Bot 5.1 | 5.2 |
| `balance_process_guide` | Markdown | Bot 5.3 | — |

### Таблиця loadFile залежностей

| Бот | onboarding | business_process | articles | cashflow_table_url | balance_articles |
|-----|-----------|-----------------|----------|--------------------|-----------------|
| 1.1 | ❌ | ❌ | ❌ | ❌ | ❌ |
| 1.2 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 2.1 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 2.2 | ✅ | ❌ | ✅ | ❌ | ❌ |
| 2.3 | ✅ | ❌ | ❌ | ✅ | ❌ |
| 3.2 | ✅ | ❌ | ✅ | ✅ | ❌ |
| 3.3 | ✅ | ❌ | ✅ | ✅ | ❌ |
| 4.1 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 4.2 | ✅ | ❌ | ✅ | ✅ | ❌ |
| 4.3 | ✅ | ✅ | ❌ | ✅ | ❌ |
| 4.4 | ✅ | ❌ | ✅ | ✅ | ❌ |
| 4.5 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 5.1 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 5.2 | ✅ | ❌ | ❌ | ✅ | ✅ |
| 5.3 | ✅ | ❌ | ❌ | ✅ | ❌ |

### Зведена таблиця артефактів

| Бот | Студент отримує | В системі зберігається |
|-----|----------------|------------------------|
| 1.1 | 📝 docx профіль | `user_onboarding_data` |
| 1.2 | 🖼️ PNG схема + 📝 docx | `business_process` |
| 2.1 | 📝 docx статті | `articles` |
| 2.2 | 🔗 Google Sheets посилання | `cashflow_table_url` |
| 2.3 | 📅 Платіжний календар + 📝 docx | `cashflow_table_url` (оновлений) |
| 3.2 | 🔗 Оновлена таблиця (P&L лист) | `cashflow_table_url` |
| 3.3 | 📝 docx діагностика | `diagnostics_report` |
| 4.1 | 🖼️ PNG + 📝 docx | `business_process` (оновлений) |
| 4.2 | 🔗 Оновлена таблиця | `cashflow_table_url` |
| 4.3 | 🔗 Оновлена таблиця | `cashflow_table_url` |
| 4.4 | 🔗 Оновлена таблиця (дашборд) | `cashflow_table_url` |
| 4.5 | 📝 docx інструкції | `team_instructions` |
| 5.1 | 📝 docx статті балансу | `balance_articles` |
| 5.2 | 🔗 Оновлена таблиця (Баланс) | `cashflow_table_url` |
| 5.3 | 📝 docx процес балансу | `balance_process_guide` |

---

## ЧАСТИНА 6 — ЩО ВЖЕ ЗРОБЛЕНО (не чіпати)

### Платформа:
- ✅ BUG-006 виправлено — `user_confirms` тепер переходить до saveFile
- ✅ BUG-012 виправлено — BigInt серіалізація
- ✅ `exitCondition: "json_output"` — працює
- ✅ `mode: "dialog"` — базова логіка діалогу працює
- ✅ `loadFile` / `saveFile` / `generateDocument` ноди — є в системі
- ✅ Claude API інтеграція — Haiku (`4a8000aa`) і Sonnet (`2ec53ba5`) налаштовані
- ✅ `fetchTelegramProfile` нода — додана в Bot 1.1

### Воронки (зроблено через MCP):
- ✅ Всі 15 ботів: `mode/exitCondition` проставлено
- ✅ Всі 15 ботів: `CLAUDE_CONNECTOR_ID` додано
- ✅ Всі 15 ботів: `fileType: "articles"` (замість cashflow_articles/pl_articles)
- ✅ Всі 15 ботів: `msg_intro/msg_done` — ім'я, стандарт, анонс
- ✅ Застарілі моделі → `claude-haiku-4-5` і `claude-sonnet-4-20250514`
- ✅ Bot 1.1: `fetchTelegramProfile` + `generateDocument` + правильні ребра
- ✅ Bot 1.2: `loadFile onboarding`, `jsEncode`, `httpRequest(binary)`, `sendPhoto`, `generateDocument`
- ✅ Bot 2.1: дублікат `saveFile` видалено, `loadFile×2`, `generateDocument`
- ✅ Bot 2.2: `loadFile articles+onboarding`, `CLAUDE_CONNECTOR_ID`, правильна модель
- ✅ Bot 2.3: `loadFile×3`, `generateDocument`, `mode/exitCondition`
- ✅ Боти 3.2–5.3: `mode/exitCondition`, `CLAUDE_CONNECTOR_ID`, `msg_intro/done`

---

## ЧАСТИНА 7 — ЯК ТЕСТУВАТИ

### Тест повного ланцюга

Після всіх змін — пройти повний шлях студента через debug-сесії:

**Крок 1: Bot 1.1**
```
start_test_session(7675fc52)
→ відповісти на 1-2 питання про бізнес
→ написати "Так, все вірно!"
→ end_test_session → перевірити: currentState="completed", filesCreated=1
```

**Крок 2: Bot 1.2**
```
start_test_session(db22c1f9)
→ описати бізнес-процес (маркетинг, продажі, фінанси, виконання, завершення)
→ написати "Так, все вірно!"
→ end_test_session → перевірити: currentState="completed", filesCreated=1, nodesVisited містить jsEncode і sendPhoto
```

**Крок 3: Bot 2.1**
```
start_test_session(f4bd6571)
→ описати статті доходів і витрат
→ написати "Так, все вірно!"
→ end_test_session → перевірити: currentState="completed", filesCreated=1
```

**Крок 4: Bot 2.2 (критичний тест)**
```
start_test_session(ef42640d)
→ написати "Запускай!"
→ end_test_session → перевірити:
  - currentState="completed"
  - filesCreated=1
  - context.sheetsUrl містить посилання на Google Sheets
  - відкрити посилання → таблиця має 8 листів: Cashflow, P&L, Надходження, Витрати, Довідники, Налаштування, References, Інструкція
```

### Чеклист перед запуском для користувачів

- [ ] BUG-006 виправлено (user_confirms переходить до saveFile) — перевірено на Bot 2.1
- [ ] BUG-012 виправлено (BigInt) — перевірено на Bot 2.2
- [ ] APPS_SCRIPT_URL заповнений реальним URL
- [ ] Bot 2.2 повертає посилання на Google Sheets з 8 листами
- [ ] loadFile onboarding додано в всі 10 ботів (ім'я відображається коректно)
- [ ] generateDocument додано в 7 ботів (docx відправляється студенту)
- [ ] Bot 1.1 → Bot 2.2 проходить без помилок (контекст передається між ботами)

---

## ЧАСТИНА 8 — РОБОЧИЙ ПЛАН ВПРОВАДЖЕННЯ (СТАРТ)

Це покроковий план, за яким можна впроваджувати зміни без ризику зламати прод:

### Етап A — Підготовка і безпека

1. Зняти backup поточних flowDefinition для 15 ботів (експорт nodes/edges в JSON).
2. Підтвердити актуальний APPS_SCRIPT_URL і доступність endpoint через `ping`.
3. Прогнати dry-run логіки оновлення на dev/stage (без запису в прод).

Критерій готовності етапу:
- є backup;
- APPS Script повертає успішний `ping`;
- список ботів для оновлення збігається зі специфікацією.

### Етап B — Масові зміни flow

1. Оновити flow через `platform/scripts/apply_flow_updates.js`:
  - onboarding `loadFile` у 10 ботах;
  - `generateDocument` у 7 ботах;
  - Bot 4.3 `business_process` load;
  - Bot 5.2 `combinedSheetsId` parser;
  - Bot 4.4 `fileType` у `cashflow_table_url`.
2. Записати APPS_SCRIPT_URL через `platform/scripts/seed_apps_script_funnel_keys.js --url=<REAL_URL>`.

Критерій готовності етапу:
- скрипт не має `SKIP` по критичних нодах;
- всі 5 цільових ботів мають ключ APPS_SCRIPT_URL;
- у Bot 4.4 `saveFile.fileType = cashflow_table_url`.

### Етап C — Смоук-тест ланцюга

1. Пройти 1.1 → 1.2 → 2.1 → 2.2 через debug-сесії.
2. Перевірити передачу файлів між ботами (`user_onboarding_data`, `business_process`, `articles`, `cashflow_table_url`).
3. Перевірити, що 2.2 повертає робочий Google Sheets URL з 8 листами.

Критерій готовності етапу:
- всі сесії завершуються `completed`;
- `filesCreated` відповідає очікуванню;
- таблиця відкривається і проходить валідацію.

### Етап D — Регресія і реліз

1. Запустити `npm run test:regression:project finance-course`.
2. Зафіксувати результати тесту і логи змін.
3. Тільки після цього відкривати доступ для користувачів.

Критерій готовності етапу:
- регресія зелена;
- немає блокуючих помилок по bot 2.2/3.2/4.4/5.2.

### Статус старту робіт

- [x] План впровадження зафіксований в інструкції.
- [ ] Підсилити `apply_flow_updates.js` для стійкого пошуку нод у Bot 5.2.
- [ ] Уточнити логіку вставки onboarding `loadFile` як першої ноди в ланцюгу.
- [ ] Виконати смоук-прохід 1.1 → 2.2 і зафіксувати результат.
