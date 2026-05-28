# PLATFORM TZ v1.0
## Глобальна платформа AI-ботів | Олександр Мацук

---

## 1. КОНЦЕПЦІЯ

Єдина платформа для управління AI-ботами різних проектів.
Кожен проект — окрема одиниця всередині платформи.
Перший проект: курс «Фінансова система малого бізнесу».
Другий проект (існуючий): Michael Bot (лід-кваліфікатор).

Платформа дає:
- Єдину адмін-панель для всіх проектів
- Логи всіх API-викликів (Claude, Telegram, Google Sheets, зовнішні)
- Переписки студентів/лідів у вигляді чату
- Файли які генерують боти (md, json)
- Аналітику по кожному боту і по платформі загалом
- Систему проектів з ролями та налаштуваннями

---

## 2. СТЕК

| Компонент | Технологія |
|---|---|
| Backend | Node.js (Express) |
| БД | PostgreSQL + Prisma ORM |
| Черга | Bull + Redis |
| Файли | Локальна ФС + PostgreSQL (metadata) |
| Frontend | React + Tailwind CSS |
| Хостинг | VPS (Ubuntu 22.04) |
| Process manager | PM2 |
| Reverse proxy | Nginx |
| AI | Anthropic Claude API |
| Telegram | node-telegram-bot-api |

Міграція Michael Bot: залишається на PHP до окремого рішення.
Логи від Michael Bot можна передавати через API-ендпоінт (окрема фаза).

---

## 3. АРХІТЕКТУРА ДИРЕКТОРІЙ

```
platform/
├── apps/
│   ├── api/              # Express API сервер
│   ├── admin/            # React адмін-панель
│   └── worker/           # Bull workers (фонові задачі)
├── packages/
│   ├── db/               # Prisma schema + migrations
│   ├── logger/           # Централізований логер
│   ├── claude/           # Claude API wrapper
│   ├── telegram/         # Telegram wrapper
│   └── storage/          # Файлове сховище
└── projects/
    └── finance-course/
        ├── bots/
        │   ├── bot-1-2-business-process/
        │   ├── bot-2-1-articles/
        │   ├── bot-2-2-cashflow-table/
        │   ├── bot-2-3-payment-calendar/
        │   ├── bot-3-2-pl-table/
        │   ├── bot-3-3-diagnostics/
        │   ├── bot-4-1-process-update/
        │   ├── bot-4-2-salaries/
        │   ├── bot-4-3-payments/
        │   ├── bot-4-4-combined-table/
        │   ├── bot-4-5-team-instructions/
        │   ├── bot-5-1-balance-articles/
        │   ├── bot-5-2-balance-table/
        │   └── bot-5-3-balance-process/
            └── michael/
        └── project.config.js
```

---

## 4. БАЗА ДАНИХ

### projects
```
id            UUID PK
name          VARCHAR(255)
slug          VARCHAR(100) UNIQUE   -- 'finance-course', 'michael-bot'
description   TEXT
is_active     BOOLEAN DEFAULT true
settings      JSONB
created_at    TIMESTAMP
```

### bots
```
id            UUID PK
project_id    UUID FK projects
name          VARCHAR(255)          -- 'Бот 2.1 — Статті Cashflow і P&L'
slug          VARCHAR(100)          -- 'bot-2-1-articles'
description   TEXT
trigger       VARCHAR(255)          -- deep link або команда
is_active     BOOLEAN DEFAULT true
settings      JSONB                 -- моделі, ліміти токенів, температура
created_at    TIMESTAMP
```

### users
```
id              UUID PK
telegram_id     BIGINT UNIQUE
username        VARCHAR(255)
first_name      VARCHAR(255)
last_name       VARCHAR(255)
language_code   VARCHAR(10)
project_id      UUID FK projects
metadata        JSONB
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### sessions
```
id            UUID PK
user_id       UUID FK users
bot_id        UUID FK bots
state         VARCHAR(100)          -- поточний стан сценарію
context       JSONB                 -- весь контекст сесії
started_at    TIMESTAMP
last_active   TIMESTAMP
completed_at  TIMESTAMP NULL
is_active     BOOLEAN DEFAULT true
```

### messages
```
id            UUID PK
session_id    UUID FK sessions
role          VARCHAR(20)           -- 'user' | 'assistant' | 'system'
content       TEXT
metadata      JSONB                 -- telegram_message_id, edit_count тощо
created_at    TIMESTAMP
```

### api_calls
```
id              UUID PK
session_id      UUID FK sessions
service         VARCHAR(50)         -- 'claude' | 'telegram' | 'google_sheets' | 'apps_script'
method          VARCHAR(100)
request_data    JSONB               -- без секретів
response_data   JSONB               -- перші 10KB
status_code     INT
duration_ms     INT
error           TEXT NULL
created_at      TIMESTAMP
```

### files
```
id            UUID PK
user_id       UUID FK users
bot_id        UUID FK bots
session_id    UUID FK sessions
file_type     VARCHAR(50)
-- cashflow_articles | pl_articles | business_process
-- balance_articles | financial_mechanics | salary_processes
-- payment_processes | team_instructions | balance_processes
file_name     VARCHAR(255)
file_path     VARCHAR(500)          -- шлях на диску
content       TEXT                  -- повний вміст (для передачі між ботами)
version       INT DEFAULT 1
created_at    TIMESTAMP
updated_at    TIMESTAMP
```

### user_progress
```
id              UUID PK
user_id         UUID FK users
project_id      UUID FK projects
block_number    INT
lesson_number   VARCHAR(10)         -- '2.1', '4.2' тощо
bot_id          UUID FK bots NULL
status          VARCHAR(50)         -- 'locked' | 'available' | 'in_progress' | 'completed'
completed_at    TIMESTAMP NULL
artifact_file_id UUID FK files NULL
```

### errors
```
id            UUID PK
session_id    UUID FK sessions NULL
bot_id        UUID FK bots NULL
user_id       UUID FK users NULL
error_type    VARCHAR(100)
message       TEXT
stack         TEXT
context       JSONB
resolved      BOOLEAN DEFAULT false
created_at    TIMESTAMP
```

---

## 5. СИСТЕМА ФАЙЛІВ

Файли зберігаються в двох місцях одночасно:
- **Диск:** `/data/files/{project_slug}/{user_id}/{file_type}_v{version}.md`
- **PostgreSQL (files):** повний вміст + metadata (для пошуку і передачі між ботами)

Передача між ботами:
```javascript
// packages/storage/FileStorage.js
const file = await FileStorage.getLatest(userId, 'balance_articles');
if (!file) {
  // повідомити студента і запропонувати повернутись до попереднього бота
}
```

Версіонування:
- Кожен новий запуск генеруючого бота — нова версія
- Попередні версії зберігаються (не видаляються)
- Боти-будівники завжди беруть latest версію

---

## 6. АДМІН-ПАНЕЛЬ

### Навігація
```
Платформа
├── Проекти
│   └── [Фінансовий курс]
│       ├── Огляд
│       ├── Боти → [Бот X] → Сесії → деталь сесії
│       ├── Студенти → деталь студента
│       ├── Файли
│       └── Помилки
├── Глобальна аналітика
├── API Logs (стрім + фільтри)
└── Налаштування платформи
```

### Огляд проекту
- Кількість студентів (всього / активних за 7 днів)
- Прогрес по блоках: bar chart (скільки завершили кожен блок)
- Топ-5 точок де студенти застрягають
- Помилки за останні 24 години
- Загальна вартість API (токени × ціна моделі)

### Список сесій бота
Таблиця: студент, старт, тривалість, статус, к-ть повідомлень, к-ть API-викликів

### Деталь сесії — вкладка «Чат»
- Переписка бульбашками (бот справа, студент зліва)
- Час кожного повідомлення
- Стан сценарію в момент повідомлення
- Кнопка «Написати від імені бота» (ручне втручання)

### Деталь сесії — вкладка «API Calls»
- Таймлайн всіх викликів: сервіс, метод, duration_ms, статус
- Розгортається по кліку: request + response JSON
- Помилки підсвічуються червоним

### Сторінка студента
- Прогрес по блоках (з датами і статусами)
- Всі сесії по всіх ботах
- Всі файли з переглядом вмісту
- Помилки пов'язані з цим студентом

### Глобальні API Logs
- Стрім останніх викликів (всі проекти, всі боти)
- Фільтри: проект, бот, сервіс, статус, дата
- Пошук по вмісту request/response
- Графік: виклики за годину/день

### Сторінка помилок
- Всі помилки по всіх проектах
- Фільтри: проект, бот, тип, вирішено/не вирішено
- Кнопка «Позначити як вирішено»
- Клік → stack trace + контекст сесії

---

## 7. БОТИ КУРСУ

### 7.1 Існуючі (інтегрувати, не переписувати)

**БОТ 1.2 — Бізнес-процес (swimlane)**
Статус: написаний
Артефакт: business_process.md + PNG схема
Дія: підключити до платформи (логи, файли, сесії)

**БОТ 2.1 — Статті Cashflow і P&L**
Статус: написаний
Артефакт: cashflow_articles.md + pl_articles.md
Дія: підключити до платформи

**БОТ 2.2 — Таблиця Cashflow (Apps Script)**
Статус: написаний (без балансу)
Вхід: cashflow_articles.md
Артефакт: посилання на Google Sheets
Дія: підключити до платформи; тип 'balance' додати в фазі 3

---

### 7.2 Написати нові

---

**БОТ 2.3 — Платіжний календар**
Вхід: cashflow_articles.md + діалог
Сценарій:
  1. Завантажує cashflow_articles.md
  2. Питає горизонт планування (1 або 3 місяці)
  3. По кожній статті: є відомі платежі (суми, дати)?
  4. Будує календар через Apps Script: рядки=статті, стовпці=тижні
  5. Формули підсвічують дні з від'ємним залишком
Артефакт: лист «Платіжний календар» в Google Sheets
Fallback: інструкція якщо Apps Script недоступний

---

**БОТ 3.2 — Таблиця P&L**
Вхід: pl_articles.md + діалог (режим: total | by_project)
Сценарій:
  1. Завантажує pl_articles.md
  2. Питає режим: загальний або по проектах
  3. Якщо by_project — збирає список проектів/напрямків
  4. Будує лист P&L в тому самому файлі що Cashflow (через Apps Script)
  5. Рівні: Валовий прибуток → EBITDA → Чистий прибуток
  6. Cashflow читає дата_оплати, P&L читає дата_визнання + cost_type
Артефакт: лист «P&L» в Google Sheets

---

**БОТ 3.3 — Діагностика фінансової механіки**
Вхід: cashflow_articles.md + pl_articles.md + business_process.md + діалог
Сценарій:
  1. Аналізує всі три файли
  2. Задає 5–8 питань: маржа, відстрочки клієнтів, сезонність, фікс. витрати
  3. Генерує structured звіт
Артефакт: financial_mechanics.md
Структура звіту:
  - Виявлені ризики (касові розриви, низька маржа, концентрація клієнтів)
  - Рекомендації
  - Питання на які варто знати відповідь

---

**БОТ 4.1 — Оновлення бізнес-процесу**
Вхід: business_process.md + cashflow_articles.md + pl_articles.md
Сценарій:
  1. Показує поточну схему бізнес-процесу
  2. Для кожної фін. статті: де в процесі вона виникає?
  3. Додає точки збору даних (хто, коли, що фіксує)
  4. Генерує оновлену схему
Артефакт: business_process_v2.md + оновлена PNG

---

**БОТ 4.2 — Зарплати і виплати**
ТЗ: є в проекті (ТЗ_Бот_4_2_Зарплати.md)
Вхід: діалог + cashflow_articles.md
Артефакт: salary_processes.md

---

**БОТ 4.3 — Регулярні платежі**
Вхід: діалог + cashflow_articles.md
Сценарій: збирає всі регулярні платежі — оренда, підписки, кредити, ліцензії
Артефакт: payment_processes.md

---

**БОТ 4.4 — Combined Cashflow + P&L**
Вхід: посилання на таблиці Cashflow і P&L + salary_processes.md + payment_processes.md
Сценарій:
  1. Перевіряє чи є обидві таблиці
  2. Об'єднує в один файл або лінкує через IMPORTRANGE + References sheet
  3. Додає листи для зарплат і регулярних платежів
  4. Перевіряє формули між листами
Артефакт: оновлене посилання на Google Sheets (єдиний файл)

---

**БОТ 4.5 — Персональні інструкції команді**
Вхід: business_process_v2.md + cashflow_articles.md + pl_articles.md + salary_processes.md + payment_processes.md
Сценарій:
  1. Аналізує всі файли, визначає ролі
  2. Для кожної ролі: що вносити, коли, звідки брати, куди вносити
  3. Збирає в один документ
Артефакт: team_instructions.md

---

**БОТ 5.1 — Статті балансу**
ТЗ: є в проекті (ТЗ_Бот_5_1_Статті_балансу.md)
Вхід: cashflow_articles.md + pl_articles.md + business_process.md + діалог
Блоки опитування: оборотні активи → необоротні → поточні зобов'язання → довгострокові → капітал
Артефакт: balance_articles.md

---

**БОТ 5.2 — Таблиця балансу**
Вхід: balance_articles.md + посилання на існуючий Google Sheets (Cashflow+P&L)
Сценарій:
  1. Завантажує balance_articles.md
  2. Додає лист «Баланс» до існуючого файлу через Apps Script
  3. Три розділи: Активи / Зобов'язання / Власний капітал
  4. Формула перевірки: Активи = Зобов'язання + Капітал (підсвічує якщо не сходиться)
  5. Власний капітал розраховується автоматично
Примітка: це розширення існуючого Apps Script бота 2.2 — додати тип 'balance'
Артефакт: оновлене посилання (тепер три листи: Cashflow + P&L + Баланс)

---

**БОТ 5.3 — Баланс у бізнес-процесі**
Вхід: balance_articles.md + business_process_v2.md
Сценарій:
  1. По кожній статті балансу: хто відповідальний, звідки дані, як часто оновлює
  2. Уточнює про інвентаризацію: хто, як часто
  3. Генерує інструкції для команди
Артефакт: balance_processes.md (додається до team_instructions.md)

---

## 8. ЛОГІКА РОЗБЛОКУВАННЯ БЛОКІВ

```
Блок 1 → завжди відкритий
Блок 2 → після: business_process.md існує
Блок 3 → після: cashflow_articles.md + pl_articles.md + таблиця Cashflow побудована
Блок 4 → після: таблиця P&L побудована
Блок 5 → після: combined_table_url (єдиний файл Cashflow+P&L)
```

Всередині блоку — вільний порядок для відео.
Якщо потрібного файлу немає — бот повідомляє і пропонує повернутись.

Перевірка при старті бота:
```javascript
// projects/finance-course/config/prerequisites.js
const BOT_REQUIREMENTS = {
  'bot-2-1-articles':        { files: [] },
  'bot-2-2-cashflow-table':  { files: ['cashflow_articles'] },
  'bot-2-3-payment-calendar':{ files: ['cashflow_articles'] },
  'bot-3-2-pl-table':        { files: ['pl_articles'] },
  'bot-3-3-diagnostics':     { files: ['cashflow_articles', 'pl_articles', 'business_process'] },
  'bot-4-1-process-update':  { files: ['business_process', 'cashflow_articles', 'pl_articles'] },
  'bot-4-2-salaries':        { files: ['cashflow_articles'] },
  'bot-4-3-payments':        { files: ['cashflow_articles'] },
  'bot-4-4-combined-table':  { files: ['cashflow_articles', 'pl_articles'] },
  'bot-4-5-team-instructions':{ files: ['business_process_v2', 'salary_processes', 'payment_processes'] },
  'bot-5-1-balance-articles':{ files: ['cashflow_articles', 'pl_articles'] },
  'bot-5-2-balance-table':   { files: ['balance_articles'] },
  'bot-5-3-balance-process': { files: ['balance_articles', 'business_process_v2'] },
};

async function checkPrerequisites(userId, botSlug) {
  const requirements = BOT_REQUIREMENTS[botSlug] || { files: [] };
  const missing = [];
  for (const fileType of requirements.files) {
    const file = await FileStorage.getLatest(userId, fileType);
    if (!file) missing.push(fileType);
  }
  return { ok: missing.length === 0, missing };
}
```

---

## 9. TELEGRAM-БОТ КУРСУ

Один Telegram-бот для всіх сценаріїв курсу.

Команди і deep links:
```
/start                  → головне меню з прогресом
/start lesson_1_2       → бот 1.2
/start lesson_2_1       → бот 2.1
/start lesson_2_2       → бот 2.2
/start lesson_2_3       → бот 2.3
/start lesson_3_2       → бот 3.2
/start lesson_3_3       → бот 3.3
/start lesson_4_1       → бот 4.1
/start lesson_4_2       → бот 4.2
/start lesson_4_3       → бот 4.3
/start lesson_4_4       → бот 4.4
/start lesson_4_5       → бот 4.5
/start lesson_5_1       → бот 5.1
/start lesson_5_2       → бот 5.2
/start lesson_5_3       → бот 5.3
/progress               → прогрес по блоках
/files                  → всі згенеровані файли
/help                   → допомога
```

Головне меню:
- Прогрес по 5 блоках з емодзі статусів (🔒 / ✅ / 🔄)
- Кнопки переходу до відкритих блоків
- Для заблокованих: що потрібно щоб відкрити

---

## 10. ЦЕНТРАЛІЗОВАНИЙ ЛОГЕР

```javascript
// packages/logger/apiLogger.js

async function loggedApiCall(sessionId, service, method, fn) {
  const start = Date.now();
  let requestSnapshot = null;

  try {
    const result = await fn();
    await db.apiCall.create({ data: {
      sessionId,
      service,
      method,
      statusCode: 200,
      duration_ms: Date.now() - start,
      response_data: truncateJson(result, 10000)
    }});
    return result;
  } catch (error) {
    await db.apiCall.create({ data: {
      sessionId,
      service,
      method,
      statusCode: error.status || 500,
      duration_ms: Date.now() - start,
      error: error.message
    }});
    await db.error.create({ data: {
      sessionId,
      error_type: error.constructor.name,
      message: error.message,
      stack: error.stack,
      context: { service, method }
    }});
    throw error;
  }
}

module.exports = { loggedApiCall };
```

Використання в боті:
```javascript
const { loggedApiCall } = require('@platform/logger');

const response = await loggedApiCall(
  sessionId, 'claude', 'messages.create',
  () => anthropic.messages.create({ model, messages, max_tokens })
);
```

---

## 11. ФАЗИ РОЗРОБКИ

**Фаза 1 — Фундамент (тиждень 1–2)**
- [ ] Monorepo структура (nx або turborepo)
- [ ] PostgreSQL схема + Prisma міграції
- [ ] packages/db — Prisma client
- [ ] packages/logger — централізований логер + apiLogger
- [ ] packages/claude — Claude API wrapper
- [ ] packages/telegram — Telegram wrapper
- [ ] packages/storage — FileStorage (диск + DB)
- [ ] Базовий Express API (health check, webhook endpoint)
- [ ] PM2 config + Nginx config

**Фаза 2 — Інтеграція існуючих ботів (тиждень 2–3)**
- [ ] Підключити бота 1.2 до платформи
- [ ] Підключити бота 2.1 до платформи
- [ ] Підключити бота 2.2 до платформи
- [ ] Спільний Telegram-бот з роутингом по deep links
- [ ] Система прогресу і розблокування блоків
- [ ] FileStorage — передача файлів між ботами

**Фаза 3 — Нові боти курсу (тиждень 3–5)**
- [ ] Бот 2.3 — платіжний календар
- [ ] Бот 3.2 — таблиця P&L
- [ ] Бот 3.3 — діагностика
- [ ] Бот 4.1 — оновлення бізнес-процесу
- [ ] Бот 4.2 — зарплати
- [ ] Бот 4.3 — регулярні платежі
- [ ] Бот 4.4 — combined таблиця
- [ ] Бот 4.5 — інструкції команді
- [ ] Бот 5.1 — статті балансу
- [ ] Бот 5.2 — таблиця балансу (розширення Apps Script)
- [ ] Бот 5.3 — баланс у процесі

**Фаза 4 — Адмін-панель (тиждень 4–6)**
- [ ] React структура + Tailwind
- [ ] Список проектів і ботів
- [ ] Список сесій бота
- [ ] Деталь сесії: чат + API calls таймлайн
- [ ] Сторінка студента + прогрес + файли
- [ ] Глобальні API Logs з фільтрами
- [ ] Сторінка помилок
- [ ] Аналітика проекту (воронка блоків, вартість API)

**Фаза 5 — Michael Bot (після курсу)**
- [ ] Оцінити обсяг міграції PHP → Node.js
- [ ] Або: API-ендпоінт для передачі логів з PHP в платформу

---

## 12. ЗМІННІ СЕРЕДОВИЩА

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/platform

# Redis
REDIS_URL=redis://localhost:6379

# Anthropic
ANTHROPIC_API_KEY=

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=

# Google / Apps Script
APPS_SCRIPT_WEB_APP_URL=

# Admin panel
ADMIN_SESSION_SECRET=
ADMIN_USERNAME=
ADMIN_PASSWORD_HASH=

# Storage
FILES_BASE_PATH=/data/files

# Environment
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
```
