# PLATFORM SKILLS.md — Частина 2
## Правила розробки (продовження)

---

## 7. TELEGRAM БОТ

### Структура обробника повідомлень
```javascript
// Завжди: знайти/створити юзера → знайти сесію → зберегти → обробити → відповісти

async function handleMessage(msg) {
  const { from, text } = msg;

  const user = await UserService.findOrCreate(from);
  const session = await SessionService.getActive(user.id, botId);
  await MessageService.save(session.id, 'user', text);

  const handler = STATE_HANDLERS[session.state];
  if (!handler) throw new BotError(`Unknown state: ${session.state}`);
  await handler(session, text);
}
```

### Перевірка prerequisites — завжди перед стартом
```javascript
async function startBot(userId, botSlug) {
  const { ok, missing } = await checkPrerequisites(userId, botSlug);
  if (!ok) {
    const missingNames = missing.map(f => FILE_DISPLAY_NAMES[f]).join(', ');
    await sendMessage(userId,
      `Для цього кроку потрібні файли які ще не створені: ${missingNames}.\n` +
      `Поверніться до попередніх уроків і запустіть відповідні боти.`
    );
    return;
  }
  await initSession(userId, botSlug);
}
```

### State machine — єдиний патерн для сценаріїв
```javascript
// handlers/dialog.js
const STATE_HANDLERS = {
  'awaiting_business_type':    handleBusinessType,
  'awaiting_income_articles':  handleIncomeArticles,
  'awaiting_expense_articles': handleExpenseArticles,
  'awaiting_confirmation':     handleConfirmation,
  'completed':                 handleAlreadyCompleted,
};
```

### Таймаут для Claude — завжди
```javascript
const response = await Promise.race([
  callClaude(messages),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Claude timeout after 30s')), 30000)
  )
]);
```

### Multipart для довгих повідомлень (> 4096 символів)
```javascript
// packages/telegram/src/sender.js
async function sendLongMessage(chatId, text) {
  const MAX = 4000;
  if (text.length <= MAX) {
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }
  const parts = splitByLength(text, MAX);
  for (const part of parts) {
    await bot.sendMessage(chatId, part, { parse_mode: 'Markdown' });
    await sleep(300); // щоб не флудити Telegram API
  }
}
```

---

## 8. ТЕСТУВАННЯ

### Після кожної зміни — обов'язковий smoke test (2 хвилини)

- [ ] Сервер стартує без помилок (`node index.js`)
- [ ] /start відповідає
- [ ] Happy path сценарію проходить до кінця
- [ ] Файл зберігається в БД і на диску
- [ ] Логи в api_calls є

### Перед деплоєм — edge cases

- [ ] Порожня відповідь від Claude → бот не падає
- [ ] Apps Script повертає помилку → fallback спрацьовує і студент отримує інструкцію
- [ ] Студент перезапускає бот посередині сценарію → повертається до поточного стану
- [ ] Відсутній prerequisite файл → правильне повідомлення з поясненням
- [ ] Telegram message > 4096 символів → multipart спрацьовує
- [ ] Одночасно два повідомлення від одного юзера → race condition не виникає

### Тестові fixtures
```
projects/finance-course/tests/fixtures/
├── cashflow_articles.fixture.md    # мінімальний валідний файл
├── pl_articles.fixture.md
├── business_process.fixture.md
└── balance_articles.fixture.md
```

### Тестові команди
```bash
# Запустити smoke test для конкретного бота
node projects/finance-course/tests/smoke/bot-2-1.test.js

# Перевірити що всі prerequisite перевірки працюють
node projects/finance-course/tests/prerequisites.test.js

# Перевірити FileStorage
node packages/storage/tests/fileStorage.test.js
```

---

## 9. ДЕПЛОЙ І ЗМІНИ

### Чеклист перед кожним деплоєм
1. [ ] Smoke test пройшов локально
2. [ ] Нові ENV змінні додані в production `.env`
3. [ ] Якщо є зміни Prisma schema — міграція підготована
4. [ ] Деплоїти в неробочий час (не в пік)
5. [ ] Snapshot БД зроблений

### Prisma міграції — тільки через migrate, не push
```bash
# РОЗРОБКА
npx prisma migrate dev --name add_error_resolved_index

# PRODUCTION — ніколи не prisma db push
npx prisma migrate deploy
```

### PM2 — graceful reload, не restart
```bash
pm2 reload platform-api     # НЕ pm2 restart — щоб не було downtime
pm2 reload platform-worker
pm2 status                  # перевірити що всі процеси running
```

### Rollback план
```bash
# Якщо щось зламалось після деплою:
git log --oneline -5        # знайти попередній коміт
git revert HEAD             # або
git checkout <prev-hash>
pm2 reload platform-api
```

### Нові ENV змінні — завжди в .env.example
```bash
# .env.example — завжди оновлювати при додаванні нових змінних
# Формат:
NEW_SERVICE_API_KEY=         # API ключ для нового сервісу (обовязковий)
NEW_SERVICE_TIMEOUT=5000     # таймаут в мс (за замовчуванням 5000)
```

---

## 10. БЕЗПЕКА

### Завжди
- Перевіряти `X-Telegram-Bot-Api-Secret-Token` при кожному webhook запиті
- Prepared statements через Prisma (ніяких рядкових конкатенацій)
- Rate limiting: не більше 10 повідомлень/хвилину від одного telegram_id
- HTTPS для webhook (Telegram вимагає)
- Session-based auth для адмін-панелі (bcrypt для паролів)

### Ніколи
- Не логувати API ключі і токени
- Не передавати секрети через URL параметри або query string
- Не довіряти даним від клієнта без валідації через zod або joi
- Не зберігати паролі у відкритому вигляді
- Не комітити `.env` файли в репозиторій

### Файлова система
```
/data/files/          # дані студентів — недоступні через HTTP
/app/                 # код — недоступний через HTTP
/app/public/          # тільки статика адмінки
```

---

## 11. ЗАБОРОНЕНІ ПРАКТИКИ

| Що заборонено | Чому | Що робити замість |
|---|---|---|
| `console.log` в production | Не структуровано, не в БД | `logger.info/error/debug` |
| Порожній `catch(e) {}` | Помилка зникає безслідно | Логувати і throw |
| `.then().catch()` | Важко читати і дебажити | `async/await` з try/catch |
| Hardcoded рядки статусів | Важко змінювати | Константи в `constants.js` |
| Мутація вхідних параметрів | Непередбачувана поведінка | Повертати новий об'єкт |
| Синхронні fs операції | Блокують event loop | `fs.promises` або `fs/promises` |
| Прямий доступ до БД з бота | Порушує розподіл відповідальності | Через сервісний шар |
| `any` без валідації вхідних | Помилки в рантаймі | Валідація через zod |

---

## 12. КОРИСНІ ШАБЛОНИ

### Сервісний шар між ботом і БД
```javascript
// projects/finance-course/services/FileService.js
class FileService {
  static async save(userId, botId, sessionId, fileType, content) {
    const latest = await this.getLatest(userId, fileType);
    const version = (latest?.version || 0) + 1;
    const filePath = path.join(
      process.env.FILES_BASE_PATH,
      userId, `${fileType}_v${version}.md`
    );

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf-8');

    return db.file.create({
      data: { userId, botId, sessionId, fileType,
        file_name: `${fileType}_v${version}.md`,
        file_path: filePath, content, version }
    });
  }

  static async getLatest(userId, fileType) {
    return db.file.findFirst({
      where: { userId, fileType },
      orderBy: { version: 'desc' }
    });
  }
}
```

### asyncHandler — уникнути повторення try/catch в роутах
```javascript
// apps/api/middleware/asyncHandler.js
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Використання:
router.get('/sessions/:id', auth, asyncHandler(async (req, res) => {
  const session = await SessionService.getById(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND' } });
  res.json({ ok: true, data: session });
}));
```

### Constants файл для кожного проекту
```javascript
// projects/finance-course/constants.js
const FILE_TYPES = {
  CASHFLOW_ARTICLES: 'cashflow_articles',
  PL_ARTICLES: 'pl_articles',
  BUSINESS_PROCESS: 'business_process',
  BALANCE_ARTICLES: 'balance_articles',
  FINANCIAL_MECHANICS: 'financial_mechanics',
  SALARY_PROCESSES: 'salary_processes',
  PAYMENT_PROCESSES: 'payment_processes',
  TEAM_INSTRUCTIONS: 'team_instructions',
  BALANCE_PROCESSES: 'balance_processes',
};

const FILE_DISPLAY_NAMES = {
  cashflow_articles: 'Статті Cashflow',
  pl_articles: 'Статті P&L',
  business_process: 'Бізнес-процес компанії',
  balance_articles: 'Статті балансу',
};

const BLOCK_STATUSES = {
  LOCKED: 'locked',
  AVAILABLE: 'available',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
};
```

### Перевірка розблокування блоку
```javascript
// projects/finance-course/services/ProgressService.js
const BLOCK_UNLOCK_CONDITIONS = {
  2: (files) => files.has('business_process'),
  3: (files) => files.has('cashflow_articles') && files.has('pl_articles'),
  4: (files) => files.has('cashflow_articles') && files.has('pl_articles'),
  5: (files, urls) => urls.has('combined_table'),
};

static async checkBlockAccess(userId, blockNumber) {
  const userFiles = await FileService.getAllTypes(userId);
  const userUrls = await UrlService.getAll(userId);
  const condition = BLOCK_UNLOCK_CONDITIONS[blockNumber];
  if (!condition) return true; // блок 1 — завжди відкритий
  return condition(new Set(userFiles), new Set(userUrls));
}
```

---

## 13. КОМУНІКАЦІЯ З ОЛЕКСАНДРОМ

### Питати ДО того як писати
- Архітектурне рішення що впливає на кілька модулів
- Зміна в БД схемі (нова таблиця, нові поля)
- Будь-яка неоднозначність в ТЗ бота
- Breaking change що може зламати існуючих студентів

### Формат звіту після виконання
```
Зроблено:
- [конкретно що реалізовано]

Файли змінено:
- packages/storage/src/FileService.js (новий)
- projects/finance-course/bots/bot-5-1/handlers/dialog.js (оновлено)

Що перевірити:
- Запустити /start lesson_5_1 і пройти до кінця
- Перевірити що balance_articles.md з'явився в /files

Питання:
- [якщо є]
```

### Breaking changes — попереджати заздалегідь
```
⚠️ BREAKING CHANGE
Що: змінилась структура cashflow_articles.md (додане поле responsible)
Кого зачіпає: всі студенти що вже пройшли бот 2.1
Що потрібно: міграційний скрипт до деплою
Пропоную: написати scripts/migrate-cashflow-articles.js
```
