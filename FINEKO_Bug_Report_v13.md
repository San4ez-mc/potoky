# FINEKO Bug Report v13

> Документ для агента у VS Code. Баги і фічі виявлені після впровадження змін з v12.

---

## BUG-012 · Bot 2.2 — `BigInt serialization error` при виклику claude_main

**Статус:** Відкритий  
**Пріоритет:** Критичний  
**Виявлено при:** Тест-сесія `92bd284a`, повідомлення «Так, починаємо!»

**Симптоми:**  
`"Do not know how to serialize a BigInt"` — помилка в Node.js при спробі виконати claude-ноду або побудувати payload для Apps Script.

**Причина:**  
BigInt не серіалізується через стандартний `JSON.stringify`. Telegram ID — 64-bit число, передається як BigInt. При побудові payload для Claude або Apps Script — `JSON.stringify` падає.

**Фікс:**
```javascript
// Замінити JSON.stringify на:
JSON.stringify(payload, (key, value) =>
  typeof value === 'bigint' ? value.toString() : value
)
```
Або конвертувати `telegram_id` в рядок при збереженні в контекст сесії.

---

## BUG-013 · Bot 2.2 — loadFile `user_onboarding_data` не виконується

**Статус:** Відкритий  
**Пріоритет:** Середній  
**Виявлено при:** Тест-сесія `92bd284a`

**Симптоми:**  
`nodesVisited` містить `loadfile_cashflow_articles` але не містить `node_1778770729995` (loadFile onboarding). Нода є в воронці і підключена, але пропускається.

**Очікувана поведінка:**  
Обидві loadFile ноди мають виконуватись послідовно на старті.

**Гіпотеза:**  
Можливо ребро між двома loadFile нодами відсутнє або `onMissing: skip` призводить до обходу всього подальшого ланцюга.

---

## FEATURE-014 · Bot 2.2 — замінити claude-ноду на httpRequest напряму до Apps Script

**Статус:** Відкритий  
**Пріоритет:** Високий  
**Контекст:** В Bot 2.2 Claude не потрібен для діалогу — бот має взяти статті з контексту і одразу викликати Apps Script без участі студента.

**Поточна архітектура (неправильна):**
```
msg_intro → claude_main (mode: single) → saveFile → msg_done
```
Claude тут зайвий — він лише формує payload і робить HTTP виклик, що може робити `httpRequest`-нода напряму.

**Правильна архітектура:**
```
loadFile(articles) → loadFile(onboarding)
→ msg_building («⏳ Будую таблицю, зачекай хвилинку...»)
→ httpRequest (POST до {{env.APPS_SCRIPT_URL}})
→ condition: response.success === true
  ├── true  → saveFile(sheetsUrl) → msg_done (посилання)
  └── false → msg_error («Щось пішло не так — спробуй ще раз через /retry»)
```

**Payload для httpRequest:**
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

**Нова нода `msg_building` (додати перед httpRequest):**
```
⏳ Будую таблицю під твій бізнес — це займе 20-30 секунд. Вже скоро!
```

**Переваги:**
- Немає зайвого виклику Claude (дешевше, швидше)
- Немає ризику 401 або BigInt помилок від AI шару
- Чіткіша логіка: статті → таблиця → посилання
- condition-нода дає graceful error handling

---

## FEATURE-015 · Перенести логіку Google Sheets AI Agent у воронки курсу

**Статус:** Відкритий  
**Пріоритет:** Високий  
**Джерело:** `боти/Google Sheets AI agent/` — готовий бот з прокачаною логікою побудови таблиць, який вже тестувався в продакшні.

**Контекст:**  
В старому боті всі сценарії (Cashflow, P&L, Combined, Balance) жили в одному боті з одним діалогом. В нашому курсі ці сценарії розбиті по окремих воронках (2.2, 3.2, 5.2 тощо), але логіка побудови таблиць — та сама. Треба не переписувати, а переносити.

---

### Що є в старому боті і треба перенести

**1. `apps-script/FinancialReportsBuilder.gs` — ядро системи, не чіпати**

Apps Script вже задеплоєний і працює. Він приймає HTTP POST і маршрутизує по `payload.action`:

| action | що робить |
|--------|-----------|
| `build_table` | Створює Spreadsheet, папку клієнта, листи, named ranges, формули, захист, тестові рядки, інструкцію, dropdown-и |
| `validate_table` | Перевіряє #REF!, #NAME?, #VALUE!, named ranges, sheet protection, наявність формул |
| `update_table` | `add_article`, `remove_article`, `rename_article`, `add_sheet`, `remove_sheet`, `repair_formulas` |
| `list_tables` | Пошук таблиць юзера в Google Drive за папкою |
| `ping` | Перевірка доступності + ініціалізація debug log spreadsheet |

**Цей файл не змінювати** — він вже прокачаний і перевірений. Всі воронки курсу просто кличуть його через HTTP POST.

---

**2. `src/google/appsScriptClient.js` — HTTP клієнт до Apps Script**

Містить:
- retry логіку (3 спроби при помилці)
- timeout handling (`APPS_SCRIPT_TIMEOUT_MS`)
- обробку відповіді і витягування `spreadsheetUrl`
- fallback на `reportBuilder.js` якщо Apps Script недоступний

**Як використати в воронках:**  
Логіку з цього файлу перенести в `httpRequest`-ноду системи воронок. Або винести в окремий мікросервіс-проксі між воронками і Apps Script — тоді retry і fallback будуть централізовані.

---

**3. `src/telegram/webhookHandler.js` — state machine і editing mode**

Editing mode (`/use`, `/retry`, `/tables`, `add_article` тощо) — цінна логіка якої немає в наших воронках.

**Що треба перенести для курсу:**

| Команда | Що робить | Де потрібно |
|---------|-----------|-------------|
| `/retry` | Повторює побудову з тим самим payload | Bot 2.2, 3.2, 5.2 |
| `/tables` | Список таблиць юзера з Google Drive | Окремий бот або команда |
| `validate_table` | Перевірка після побудови | Bot 2.2, 3.2, 5.2 |
| `repair_formulas` | Авторемонт формул | Bot 2.2, 3.2, 5.2 |
| `add_article` / `remove_article` | Правки статей в живій таблиці | Bot 4.x |

---

### Що будує Apps Script по report_type

**`cashflow_and_pl`** (використовувати для Bot 2.2):
- Листи: `📊 Cashflow`, `📊 P&L`, `⬇️ Надходження`, `⬆️ Витрати`, `📋 Довідники`, `⚙️ Налаштування`, `🔗 References`, `📖 Інструкція`
- Додаткові колонки: `Дата оплати`, `Дата визнання`, `cost_type`, опційно `Проєкт`
- P&L рахується через SUMIFS по `дата_визнання` і `cost_type`
- Cashflow рахується по `дата_оплати`

**`pl`** (використовувати для Bot 3.2 якщо таблиця вже є — додати лист):
- Листи: `📊 P&L`, `💰 Доходи`, `💸 Прямі витрати`, `💸 Операційні витрати`, `📋 Довідники`
- Формули: доходи − прямі витрати = валовий прибуток − операційні = чистий прибуток

**`balance`** (використовувати для Bot 5.2):
- Листи: `📊 Баланс`, `📋 Довідники`, `⚙️ Налаштування`, `🔗 References`, `📖 Інструкція`
- Зараз спрощена версія — потребує доопрацювання в рамках курсу

---

### Де зберігаються таблиці на Google Drive

```
Root folder: GOOGLE_DRIVE_PARENT_FOLDER_ID або "Фінансова система — Курс"
  └── client_tg_<username>/      ← папка кожного студента
        ├── Cashflow_ПІБ.xlsx
        ├── P&L_ПІБ.xlsx
        └── Balance_ПІБ.xlsx
```

Всі таблиці одного студента в одній папці — важливо для `list_tables` і `/use`.

---

### Як інтегрувати в систему воронок курсу

**Крок 1 — `APPS_SCRIPT_URL` як глобальний env:**  
Один URL для всіх ботів курсу. Додати в глобальні ключі проекту (не per-bot).

**Крок 2 — Стандартний payload для httpRequest-ноди:**
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

**Крок 3 — Після build_table завжди validate + repair:**
```
httpRequest(build_table)
  → httpRequest(validate_table, spreadsheetId з відповіді)
    → якщо є помилки → httpRequest(update_table, repair_formulas)
    → повторно validate
  → condition: все ок?
    ├── true  → saveFile → msg_done
    └── false → msg_error + зберегти посилання на файл
```

**Крок 4 — Зберегти `spreadsheetId` і `spreadsheetUrl` в контекст:**
```
context.sheetsUrl = response.spreadsheetUrl
context.sheetsId  = response.spreadsheetId
```
`sheetsId` потрібен для validate і update_table викликів. `sheetsUrl` — для msg_done і saveFile.

**Крок 5 — Налаштувати fallback:**  
Якщо Apps Script недоступний (timeout або 500) — повідомити студента що файл не створено і дати кнопку «Спробувати ще раз».

---

### Env змінні що треба додати в проект

| Змінна | Опис |
|--------|------|
| `APPS_SCRIPT_URL` | URL задеплоєного Apps Script web app |
| `APPS_SCRIPT_TIMEOUT_MS` | Таймаут для HTTP запиту (рекомендовано 30000) |
| `GOOGLE_DRIVE_PARENT_FOLDER_ID` | ID root папки в Google Drive |
| `GOOGLE_REPORTS_SHARE_MODE` | `anyone_with_link` або `specific_users` |

