# PLATFORM SKILLS.md
## Правила розробки для AI-виконавця
## Проект: Глобальна платформа AI-ботів | Олександр Мацук

---

## ГОЛОВНЕ ПРАВИЛО

Ти пишеш код для production-системи яка буде масштабуватись.
Кожне рішення приймається з урахуванням що через 6 місяців —
500+ студентів, 15+ ботів, 2+ проекти.

Якщо щось можна зробити швидко але брудно — не роби.
Якщо не впевнений у вимозі — питай перед тим як писати.

---

## 1. СТРУКТУРА ФАЙЛІВ

### Принцип: один файл — одна відповідальність

ПРАВИЛЬНО:
```
packages/claude/src/client.js        # ініціалізація Claude client
packages/claude/src/wrapper.js       # loggedApiCall для Claude
packages/claude/src/prompts.js       # утиліти для промптів
packages/claude/index.js             # публічний API пакету
```

НЕПРАВИЛЬНО:
```
packages/claude/claude.js            # все змішано в одному файлі
```

### Ліміт розміру файлу
- Максимум 200 рядків коду на файл
- Якщо більше — розбити на логічні модулі
- Виняток: Prisma schema (один файл, але добре структурований)

### Структура кожного бота (ізольований модуль)
```
projects/finance-course/bots/bot-2-1-articles/
├── index.js              # точка входу, роутинг повідомлень
├── handlers/
│   ├── start.js          # обробка /start і deep link
│   ├── dialog.js         # основний діалог (state machine)
│   └── completion.js     # завершення і збереження файлу
├── prompts/
│   ├── system.js         # system prompt
│   └── questions.js      # питання для діалогу
├── validators/
│   └── output.js         # валідація вихідного файлу
└── bot.config.js         # slug, назва, prerequisites
```

### Заборони в структурі
- НЕ імпортувати код одного бота в інший напряму
- НЕ писати SQL запити напряму — тільки через Prisma
- НЕ зберігати ключі API в коді — тільки process.env
- НЕ використовувати глобальні змінні між запитами

---

## 2. ІМЕНУВАННЯ

| Що | Стиль | Приклад |
|---|---|---|
| Файли і папки | kebab-case | `bot-2-1-articles`, `api-logger.js` |
| Змінні і функції | camelCase | `getLatestFile`, `sessionId` |
| Класи і React | PascalCase | `FileStorage`, `SessionDetail` |
| Константи | UPPER_SNAKE_CASE | `MAX_RETRIES`, `BOT_REQUIREMENTS` |

### Правила функцій
- Дієслово + іменник: `getSession`, `createFile`, `logApiCall`
- Тільки async/await — не .then().catch()
- Функція робить одну річ — якщо назва містить «і», розбити

### Правила змінних
- Описові: `telegramUserId` а не `tgId` або просто `id`
- Boolean: `isActive`, `hasCompleted`, `canAccess`
- Масиви: множина: `sessions`, `fileTypes`, `missingFiles`

---

## 3. ОБРОБКА ПОМИЛОК

### Принцип: помилка завжди логується і ніколи не ковтається

ПРАВИЛЬНО:
```javascript
async function getLatestFile(userId, fileType) {
  try {
    return await db.file.findFirst({
      where: { userId, fileType },
      orderBy: { version: 'desc' }
    });
  } catch (error) {
    logger.error('FileStorage.getLatest failed', { userId, fileType, error: error.message });
    throw new StorageError(`Failed to get file: ${error.message}`);
  }
}
```

НЕПРАВИЛЬНО:
```javascript
async function getLatestFile(userId, fileType) {
  return await db.file.findFirst({...}); // без try/catch — недопустимо
}
```

### Власні класи помилок
```javascript
// packages/errors/index.js
class PlatformError extends Error {
  constructor(message, code, context = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
  }
}

class StorageError extends PlatformError {}
class BotError extends PlatformError {}
class PrerequisiteError extends PlatformError {
  constructor(missingFiles) {
    super('Missing required files', 'MISSING_FILES', { missingFiles });
    this.missingFiles = missingFiles;
  }
}
```

### Fallback для зовнішніх сервісів
- Claude API недоступний → зберегти повідомлення, повідомити студента, залогувати
- Apps Script недоступний → fallback: інструкція для ручного створення таблиці
- Telegram API недоступний → повторити через Bull queue з exponential backoff

---

## 4. ЛОГУВАННЯ

### Завжди логувати
- Старт і завершення кожної сесії
- Кожен API-виклик (через loggedApiCall — автоматично)
- Кожну зміну стану сценарію
- Кожне збереження файлу
- Кожну помилку з повним контекстом

### Рівні логів
- `error` — помилки що впливають на роботу студента
- `warn` — підозрілі ситуації (порожня відповідь AI, дублікат сесії)
- `info` — ключові події (сесія стартувала, файл збережено, блок завершено)
- `debug` — деталі для дебагу (тільки NODE_ENV=development)

### Формат: завжди структурований JSON
```javascript
logger.info('Bot session completed', {
  sessionId,
  userId,
  botSlug: 'bot-2-1-articles',
  duration_ms: Date.now() - startTime,
  filesGenerated: ['cashflow_articles', 'pl_articles']
});
```

### НЕ логувати
- API ключі і токени (ніколи)
- Повні тексти повідомлень (тільки перші 200 символів якщо потрібно)
- Персональні дані без необхідності

---

## 5. РОБОТА З БАЗОЮ ДАНИХ

### Prisma — єдиний спосіб роботи з БД
```javascript
// ПРАВИЛЬНО
const session = await db.session.create({
  data: { userId, botId, state: 'started', context: {} }
});

// НЕПРАВИЛЬНО — raw SQL тільки якщо Prisma не може
await db.$queryRaw`INSERT INTO sessions ...`;
```

### Транзакції для пов'язаних операцій
```javascript
// Файл і прогрес мають зберегтись разом або не зберегтись взагалі
const [file, progress] = await db.$transaction([
  db.file.create({ data: fileData }),
  db.userProgress.update({
    where: { id: progressId },
    data: { status: 'completed', artifactFileId: fileId }
  })
]);
```

### Індекси — обов'язково для всіх FK і полів фільтрації
```prisma
model File {
  @@index([userId, fileType])   // пошук файлів по юзеру
  @@index([userId, version])    // getLatest
}
model Message {
  @@index([sessionId])          // вся переписка сесії
}
model ApiCall {
  @@index([sessionId])          // всі виклики сесії
  @@index([createdAt])          // фільтр по даті в адмінці
}
```

### Пагінація обов'язкова для lists
```javascript
const sessions = await db.session.findMany({
  where: { botId },
  orderBy: { startedAt: 'desc' },
  take: 50,
  skip: page * 50,
  include: { user: true, bot: true }
});
```

---

## 6. API ДИЗАЙН (Express)

### REST конвенції
```
GET  /api/projects                          # список проектів
GET  /api/projects/:id/bots                 # боти проекту
GET  /api/bots/:id/sessions                 # сесії бота (з пагінацією)
GET  /api/sessions/:id                      # деталь сесії
GET  /api/sessions/:id/messages             # повідомлення сесії
GET  /api/sessions/:id/api-calls            # API виклики сесії
GET  /api/users/:id/progress                # прогрес студента
GET  /api/users/:id/files                   # файли студента
```

### Відповідь завжди з обгорткою
```javascript
// успіх
res.json({ ok: true, data: sessions, meta: { total, page, limit } });

// помилка
res.status(400).json({
  ok: false,
  error: { code: 'MISSING_FILES', message: 'Required files not found', context: {} }
});
```

### Middleware для кожного роуту
```javascript
router.get('/sessions/:id',
  authMiddleware,           // перевірка admin сесії
  validateParams(schema),   // валідація параметрів
  asyncHandler(getSession)  // обробник з автоматичним catch
);
```
