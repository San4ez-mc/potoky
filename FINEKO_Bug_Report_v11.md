# FINEKO Bug Report v11

> Документ для агента у VS Code. Кожен баг описано з контекстом і очікуваною поведінкою.

---

## BUG-001 · `get_connector` не повертає збережені екземпляри

**Статус:** ✅ Виправлено  
**Реалізовано:** tools-flows.js - добавлено масив `instances` з id і label без secrets

---

## BUG-002 · Закрито

---

## BUG-003 · Закрито — виправлено через `mode: "dialog"` і `exitCondition`

**Статус:** ✅ Закрито  
Параметри проставлено в ноді через MCP, діалог працює коректно.

---

## BUG-004 · Закрито — виправлено разом з BUG-003

**Статус:** ✅ Закрито

---

## BUG-005 · Дублювання повідомлення в кінці діалогу (Telegram)

**Статус:** ✅ Виправлено  
**Реалізовано:** testSession.js - функція `stripJsonAndTrailingText()` гарантує що текст ПІСЛЯ JSON не буде відправлено користувачу. Тільки текст ДО JSON (або нічого) буде видимий.

Варіант B — **на рівні промпту** (вже зроблено): прибрати з промпту markdown-бачки \`\`\`json і писати JSON без обгортки — це зменшує ймовірність що модель додасть текст після. Але не гарантує 100%.

**Рекомендація:** реалізувати Варіант A на рівні runtime — це надійніше ніж боротися з промптом.

---

## FEATURE-001 · Фронтенд — UI для `mode` і `exitCondition` в Claude Node

**Статус:** ✅ Реалізовано  
**Реалізовано:** 
- NodeEditor.jsx: ClaudeNodeEditor з Select для mode та exitCondition (з support ключових слів)
- NodeTypes.jsx: ClaudeNode компонент показує 💬 діалог / 1× одиночний режим + бейдж exitCondition (📋 JSON, 📝 Markdown, ✅ Підтвердження, 🔑 Ключове слово)
- NODE_PALETTE: claude node тип з default параметрами
- Також додано UI для saveFile, loadFile та generateDocument нод

---

## FEATURE-002 · Нова нода `generateDocument` — генерація і відправка docx

**Статус:** ✅ Базова реалізація готова  
**Пріоритет:** Високий  
**Реалізовано:** testSession.js - нода типу `generateDocument` з підтримкою:
- Шаблонів документів: `student_profile`, `business_process` та інші
- Параметрів: `sourceVar`, `template`, `filename`, `sendToUser`
- Збереження як file artifact з можливістю відправки користувачу

**Текущо підтримується:**
- Генерування текстового документу на основі даних з контексту
- Збереження файлу в базі даних
- Параметр `sendToUser` для відправки посилання на документ

**Потрібно доробити:**
- Конвертація в реальний .docx формат через `docx` npm-пакет (на даний момент - текстовий формат)
- Інтеграція з Telegram для відправки файлу користувачу  
Розглянути `js`-ноду з вбудованою генерацією через `docx` npm пакет і Telegram Bot API для відправки файлу. Але краще нативна нода.

---

---

## BUG-006 · `exitCondition: "user_confirms"` не переводить воронку до наступної ноди

**Статус:** ✅ Виправлено  
**Реалізовано:** testSession.js - двоетапна логіка для user_confirms:
- Етап 1: користувач пише підтвердження → `runtime.userConfirmationReceived = true`
- Етап 2: claude-нода викликається в режимі фіналізації без очікування нового повідомлення від користувача
- Етап 3: переходимо до наступної ноди автоматично

---

## BUG-007 · Тест-сесія не передає контекст між ботами

**Статус:** ✅ Виправлено  
**Реалізовано:** 
- API sessions.js: прийма `contextOverride` в POST /api/sessions/test/start
- Service testSession.js: нормалізує і мержить контекст з `contextOverride`
- MCP tools-debug.js: схема `start_test_session` приймає опціональний `contextOverride`

---

## BUG-008 · Bot 2.1 — два saveFile зберігають однаковий контент

**Статус:** ⚠️ Рекомендація  
**Рішення:** Цей баг є конфігураційною помилкою воронки. Рекомендація: 
- Використовувати один `saveFile` з `fileType: "articles"` і зберегти YAML цілком
- Або створити окремі `outputVar` в claude-ноді для `context.cashflow_result` та `context.pl_result`
**Контекст:** Після підтвердження схеми студентом бот має відправити PNG візуалізацію swimlane-схеми через Telegram.

**Архітектура після claude-ноди (після exitCondition: user_confirms):**

```
claude_main (dialog, user_confirms)
  → js_encode   — кодує Mermaid-текст з context.swimlane_mermaid в base64 URL
  → http_render — GET https://mermaid.ink/img/{base64} → отримує PNG
  → saveFile    — зберігає Mermaid-текст (context.swimlane_md) в систему
  → sendPhoto   — відправляє PNG студенту в Telegram
  → msg_done    — фінальне повідомлення
```

**Потрібні зміни в системі:**

**1. js-нода для кодування Mermaid → URL:**
```javascript
// Вхід: context.swimlane_mermaid (рядок з Mermaid-кодом)
// Вихід: context.mermaid_img_url, context.mermaid_live_url

const mermaidCode = context.swimlane_mermaid;
const encoded = Buffer.from(mermaidCode).toString('base64url');
context.mermaid_img_url = `https://mermaid.ink/img/${encoded}`;
context.mermaid_live_url = `https://mermaid.live/edit#base64:${encoded}`;
```

**2. httpRequest-нода з підтримкою бінарної відповіді (PNG):**
- Поточна httpRequest нода повертає JSON. Потрібна підтримка `responseType: "binary"` або `"image"`
- Результат зберігати в `context.diagram_png` як base64 або buffer
- URL береться з `{{context.mermaid_img_url}}`

**3. sendPhoto-нода або параметр у message-ноді:**
- Відправляє фото в Telegram з `context.diagram_png`
- Опційний caption (підпис під фото)

**Поведінка редагування (важливо):**
- Редагування схеми відбувається ТІЛЬКИ через діалог з Майклом — студент пише правки, Claude оновлює Mermaid, показує нову схему
- PNG генерується тільки після фінального підтвердження
- Посилання на Mermaid Live Editor (`context.mermaid_live_url`) можна дати в msg_done як довідкове — з поясненням що зміни звідти НЕ повертаються в систему курсу
- В системі завжди зберігається Mermaid-текст — наступні боти читають його

**Системний промпт claude-ноди — додати:**
Після підтвердження Claude має виводити Mermaid-код в окремій змінній:
```
Після підтвердження генеруй ТІЛЬКИ блок:
---MERMAID---
flowchart TD
  ...
---END---
```
js-нода парсить блок між тегами і кладе в `context.swimlane_mermaid`.

---

## FEATURE-004 · Поле `description` і `goal` для ботів і нод

**Статус:** ✅ Виправлено  
**Пріоритет:** Середній — що вона робить, яка мета, що отримує студент на виході. Те ж саме для нод — є тільки `label`.

**Що потрібно додати:**

**1. До об'єкта бота (`list_funnels` і `get_funnel`):**
```json
{
  "id": "...",
  "name": "Bot 1.2 Business Process",
  "slug": "bot-1-2-business-process",
  "project": "...",
  "description": "Будує детальну swimlane-схему бізнес-процесу компанії студента. Охоплює 5 блоків: маркетинг, продажі, фінанси, виконання, завершення.",
  "goal": "Студент отримує документ business_process.md зі схемою — фундамент для побудови Cashflow, P&L і Балансу.",
  "outputFiles": ["business_process"]
}
```

**2. До ноди (опціонально):**
```json
{
  "id": "claude_main",
  "data": {
    "label": "Майкл — будує swimlane",
    "description": "Веде діалог зі студентом, збирає деталі по 5 блоках процесу, генерує Mermaid-схему, приймає правки, після підтвердження віддає фінальний Markdown-документ"
  }
}
```

**Де використовується:**  
- AI-агент через MCP розуміє що робить кожен бот без читання всіх нод  
- Адмін-панель може показувати опис при перегляді списку ботів  
- Дебаг і документація курсу

**Поточний воркараунд:**  
Описи ботів курсу зберігаються окремо в скілі `funnel-writing-fineko/SKILL.md` — секція «Контекст курсу».

---

## FEATURE-005 · Bot 1.2 — docx з текстовим описом бізнес-процесу

**Статус:** ✅ Виправлено  
**Пріоритет:** Високий  
**Пов'язано з:** FEATURE-003 (PNG схема)

**Опис:**  
На виході Bot 1.2 студент має отримати два артефакти:
1. **PNG** — візуальна swimlane-схема через mermaid.ink (FEATURE-003)
2. **docx** — документ з повним текстовим описом бізнес-процесу (ця фіча)

**Структура docx `business_process.docx`:**
```
[Логотип курсу]

Урок 1.2 — Бізнес-процес компанії
Дата: [дата]

Компанія: [назва/опис]
Тип бізнесу: [тип]

РОЛІ
- [роль 1]
- [роль 2]
...

КЛЮЧОВІ КРОКИ ПРОЦЕСУ
1. [крок]
2. [крок]
...

БЛОКИ ПРОЦЕСУ

Маркетинг і залучення
[текстовий опис блоку]

Продажі і предпродажна підготовка
[текстовий опис блоку]

Фінанси
[текстовий опис блоку]

Технічне виконання
[текстовий опис блоку]

Завершення і постпродажне обслуговування
[текстовий опис блоку]

---
Документ згенеровано системою курсу.
Схема процесу збережена окремим файлом.
```

**Місце в воронці:**
```
claude_main (user_confirms)
  → js_encode (Mermaid → base64)
  → http_render (PNG)
  → saveFile (Mermaid-текст в систему)
  → generateDocument (docx з текстовим описом)  ← ця фіча
  → sendPhoto (PNG студенту)
  → sendDocument (docx студенту)  ← потрібна нода або параметр
  → msg_done
```

**Джерело даних для docx:**  
`context.swimlane_md` — фінальний Markdown-документ який Claude генерує після підтвердження. Він вже містить всі розділи (ролі, кроки, схема) — docx будується на його основі.

---

## FEATURE-006 · WayForPay конектор — реалізація `create_invoice` action

**Статус:** ✅ Виправлено  
**Пріоритет:** Високий  
**Контекст:** Конектор `wayforpay` (id: `fe1f9e6e-5cfe-4a7d-aa30-5113dd80fd7a`) створено в системі. Потрібна реалізація на бекенді.

**Що потрібно реалізувати:**

WayForPay API для створення інвойсу: `POST https://api.wayforpay.com/api`

**Параметри запиту:**
```json
{
  "transactionType": "CREATE_INVOICE",
  "merchantAccount": "{{merchant_account}}",
  "merchantDomainName": "{{merchant_domain}}",
  "orderReference": "{{orderReference}}",
  "orderDate": "{{timestamp_unix}}",
  "amount": "{{amount}}",
  "currency": "UAH",
  "productName": ["{{description}}"],
  "productPrice": ["{{amount}}"],
  "productCount": [1],
  "merchantSignature": "{{hmac_md5_signature}}"
}
```

**Підпис (merchantSignature):**  
HMAC_MD5 від рядка: `merchantAccount;merchantDomainName;orderReference;orderDate;amount;currency;productName;productCount;productPrice`  
Ключ підпису: `merchant_secret`

**Очікувана відповідь:**
```json
{
  "invoiceUrl": "https://secure.wayforpay.com/pay?invoice=...",
  "reason": "Ok",
  "reasonCode": 1100
}
```
`invoiceUrl` зберігається в `outputVar` ноди.

**Webhook для підтвердження оплати:**  
WayForPay надсилає POST на `callback_url` після успішної оплати. Потрібен endpoint в системі + логіка видачі доступу до курсу після підтвердження.

---

## FEATURE-007 · Bot Sales SPIN — налаштування після реалізації WayForPay

**Статус:** Відкритий  
**Пріоритет:** Середній  
**Bot ID:** `e7dd3dd2-3a5b-438a-bdd3-beda815f7681`

**Що зробити після реалізації FEATURE-006:**
1. Заповнити ключ `COURSE_PRICE` реальною ціною (наприклад `2990 грн`)
2. Заповнити ключ `COURSE_PRICE_INT` числом (наприклад `2990`)
3. Додати ключі WayForPay інстансу: `merchant_account`, `merchant_secret`, `merchant_domain`
4. Налаштувати Telegram Bot Token для Sales бота (окремий бот або той самий)
5. Протестити повний цикл: SPIN діалог → офер → оплата → доступ
6. Реалізувати логіку видачі доступу після оплати (webhook → увімкнути бота для користувача)

---

## FEATURE-008 · Збір даних з Telegram-профілю на старті воронки

**Статус:** Відкритий  
**Пріоритет:** Середній  
**Виявлено при:** Перегляд профілю тест-юзера

**Опис:**  
На старті будь-якої воронки (зокрема Bot 1.1 Onboarding) система вже отримує Telegram-дані юзера (id, username, ім'я). Але фото профілю і bio (опис акаунту) не збираються. Потрібно:

**1. Нода `fetchTelegramProfile` (або js-нода) на початку Bot 1.1:**  
Непомітна для користувача — між `start` і `msg_intro`. Робить запит до Telegram Bot API:
- `getChat(telegram_id)` → повертає `bio` (опис профілю)
- `getUserProfilePhotos(telegram_id, limit=1)` → повертає file_id першого фото
- `getFile(file_id)` → повертає `file_path` для завантаження фото

Результати зберігаються в:
- `context.tg_bio` — текст опису профілю (може бути порожнім)
- `context.tg_photo_url` — URL фото профілю (може бути порожнім)

**Місце в воронці Bot 1.1:**
```
start_onboarding
  → node_fetch_tg_profile  ← нова нода (непомітна, без повідомлень)
  → node_msg_intro (вітання)
  → claude_main (діалог)
  → saveFile
  → msg_done
```

**2. Оновити `saveFile` — додати нові поля до `user_onboarding_data`:**  
```json
{
  "name": "...",
**Статус:** ✅ Виправлено  
  "company_description": "...",
  "main_problem": "...",
  "tg_bio": "{{context.tg_bio}}",
  "tg_photo_url": "{{context.tg_photo_url}}",
  "tg_username": "{{user.username}}",
  "tg_id": "{{user.telegramId}}"
}
```

**3. Оновити картку юзера в адмін-панелі:**  
Додати поля до профілю користувача:
- **Фото профілю** — аватар з Telegram (або заглушка якщо немає)
- **Bio** — текст опису з Telegram
- **Username** — @username (вже є, але показати явно)
- **Telegram ID** — (вже є)

**Примітки:**  
- Якщо фото немає — не ламати воронку, просто `tg_photo_url: null`
- Якщо bio порожній — аналогічно `tg_bio: null`
- Майкл може використовувати `tg_bio` в системному промпті як додатковий контекст про студента

---

## FEATURE-009 · Sales бот — повноцінна nurturing-воронка з нагадуваннями

**Статус:** Відкритий  
**Пріоритет:** Високий  
**Bot ID:** `e7dd3dd2-3a5b-438a-bdd3-beda815f7681`

**Поточна проблема:**  
Воронка лінійна: SPIN → офер → оплата. Немає розгалуження по зацікавленості, немає нагадувань, немає презентації, немає nurturing для тих хто ще «думає».

**Архітектура повноцінної воронки:**

```
start → fetch_tg_profile (тихо)
→ msg_intro
→ claude_spin (SPIN діалог, exitCondition: json_output)
  ↓
condition: spin_result.ready_to_buy?
  ├── FALSE → msg_not_interested («Зрозумів! Якщо колись захочеш повернутись — я тут 👋»)
  │           → saveFile (зберегти контакт для ремаркетингу)
  │           → END
  └── TRUE ↓
      msg_teaser (розпалити інтерес — 2-3 речення про результат БЕЗ ціни)
      → sendDocument (PDF презентація курсу)  ← файл додається пізніше
      → wait 24h
      → msg_remind_1 («Привіт! Встиг переглянути презентацію?» + кнопки «Так» / «Ще ні»)
        ├── «Ще ні» → wait 48h → msg_remind_2 (м'якше нагадування)
        │   └── не відповів → msg_remind_3 (фінальне, через 72h) → END
        └── «Так» ↓
            claude_objections (обробка заперечень, mode: dialog, exitCondition: user_confirms)
            → msg_offer (детальний офер з ціною)
            → connector WayForPay create_invoice
            → msg_payment_link
            → wait_payment (чекаємо webhook від WayForPay)
              ├── оплачено → msg_payment_success → notify_admin → END
              └── не оплачено 24h → msg_payment_remind → END
```

**Нові типи нод що потрібні:**
- `wait` — затримка на вказаний час перед наступною нодою (24h, 48h, 72h)
- `condition` — розгалуження по значенню змінної (`context.spin_result.ready_to_buy`)
- `sendDocument` — відправка PDF файлу студенту в Telegram
- `wait_payment` — чекає webhook від платіжної системи з timeout

---

## FEATURE-010 · WayForPay конектор — додати поле `merchant_name` і webhook

**Статус:** ✅ Виправлено  
**Пріоритет:** Високий  
**Connector ID:** `fe1f9e6e-5cfe-4a7d-aa30-5113dd80fd7a`

**Опис:**  
WayForPay потребує три обов'язкових поля для підпису і відображення магазину. Зараз в конекторі є `merchant_account`, `merchant_secret`, `merchant_domain`. Потрібно додати `merchant_name`.

**Оновити схему конектора:**
```json
{
  "fields": [
    { "key": "merchant_account", "label": "Merchant Account (логін)", "secret": false },
    { "key": "merchant_secret",  "label": "Secret Key (секретний ключ)", "secret": true },
    { "key": "merchant_domain",  "label": "Домен магазину (yourdomain.com)", "secret": false },
    { "key": "merchant_name",    "label": "Назва магазину (відображається покупцю)", "secret": false }
  ]
}
```

**Webhook для підтвердження оплати:**  
WayForPay надсилає POST на `serviceUrl` після кожної транзакції. Потрібно:
1. Endpoint `POST /webhooks/wayforpay` в системі
2. Верифікація підпису (`merchantSignature` в тілі запиту)
3. Якщо `transactionStatus: "Approved"` → тригерити ноду `payment_success` у воронці
4. Відповідь WayForPay очікує: `{"orderReference": "...", "status": "accept", "time": ..., "signature": "..."}`

---

## FEATURE-011 · Сповіщення адміну в Telegram після оплати

**Статус:** Відкритий  
**Пріоритет:** Високий

**Опис:**  
Після успішної оплати система має:
1. Надіслати студенту повідомлення про підтвердження
2. Надіслати сповіщення адміну в Telegram

**Нова нода `notifyAdmin`:**
```json
{
  "type": "notifyAdmin",
  "data": {
    "label": "Сповістити адміна",
    "telegramId": "{{env.ADMIN_TELEGRAM_ID}}",
    "message": "💰 Нова оплата!\n\nІм'я: {{context.spin_result.name}}\nБізнес: {{context.spin_result.business}}\nБіль: {{context.spin_result.main_pain}}\nСума: {{env.COURSE_PRICE}}\nЧас: {{timestamp}}"
  }
}
```

**Ключ для Sales бота:**  
Додати ключ `ADMIN_TELEGRAM_ID` — Telegram ID адміна для сповіщень.

**Повідомлення студенту після оплати:**
```
✅ Оплату отримано! Дякую, що обрав курс.

Ми вже бачимо твій платіж і зв'яжемось найближчим часом — надамо доступ до бота з Майклом.

Якщо щось термінове — пиши сюди, я на зв'язку 👋
```

---

## FEATURE-012 · Нода `wait` — затримка між повідомленнями

**Статус:** Відкритий  
**Пріоритет:** Високий  
**Потрібна для:** Sales воронка (нагадування), будь-які delayed follow-up

**Опис:**  
Нова нода типу `wait` що зупиняє виконання воронки на вказаний час і потім продовжує.

**Конфігурація:**
```json
{
  "type": "wait",
  "data": {
    "label": "Чекати 24 години",
    "duration": 24,
    "unit": "hours"
  }
}
```

**Одиниці:** `minutes`, `hours`, `days`  
**Важливо:** стан воронки має персистуватись між рестартами (не в пам'яті процесу, а в БД)

---

## FEATURE-013 · Нода `condition` — розгалуження по значенню змінної

**Статус:** Відкритий  
**Пріоритет:** Високий  
**Потрібна для:** Sales воронка (зацікавлений/не зацікавлений), будь-яка логіка розгалуження

**Опис:**  
Нода з двома виходами (`true` / `false`) на основі умови.

**Конфігурація:**
```json
{
  "type": "condition",
  "data": {
    "label": "Перевірити зацікавленість",
    "condition": "context.spin_result.ready_to_buy === true"
  }
}
```

**Виходи:**  
- `true` → наступна нода якщо умова виконана  
- `false` → альтернативна нода якщо умова не виконана  

**Підтримувані оператори:** `===`, `!==`, `>`, `<`, `>=`, `<=`, `includes`
