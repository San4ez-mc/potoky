# Bug Report + ТЗ Bot 1.1 — Фінансова система малого бізнесу
_Дата: 13.05.2026 | Тестування через MCP FINEKO flows debug_

---

## 🐛 СИСТЕМНІ БАГИ (для агента у VS Code)

### BUG-001 — КРИТИЧНИЙ: Test mode надсилає відповіді в реальний Telegram замість MCP

**Статус:** ✅ Виправлено (13.05.2026)  
**Виявлено на:** Bot 1.2 Business Process (підтверджено по логах — той самий баг на всіх попередніх тест-сесіях)  
**Пріоритет:** P0 — без цього фікса тестування неможливе

**Симптом:**
- `start_test_session` — створює сесію, повертає перше повідомлення бота ✅
- `send_test_message` — повідомлення юзера записується в DB ✅
- Бот обробляє повідомлення і генерує відповідь (Claude відпрацьовує) ✅
- При спробі відправити відповідь — крашить з `ETELEGRAM: 400 Bad Request: chat not found` ❌
- MCP повертає стару відповідь (перше intro-повідомлення) замість нової ❌
- `currentNode: null` — бот застряє, стан не просувається ❌

**Де ламається:**
```
testSession.js:226 → sendTestMessage
  → telegramHandler.js → bot index.js:112 → handleMessage
    → bot генерує відповідь через Claude ✅
    → намагається відправити через sender.js:50 → sendMessage ❌
      → TelegramError: chat not found (бо тест-юзер не має реального Telegram chat_id)
```

**Стек:**
```
TelegramError: ETELEGRAM: 400 Bad Request: chat not found
  at sendMessage (.../packages/telegram/src/sender.js:50:15)
  at async Bot12Handler.handleMessage (.../bot-1-2-business-process/index.js:112:13)
  at async routeToActiveSession (.../telegramHandler.js:198:9)
  at async sendTestMessage (.../services/testSession.js:226:9)
```

**Очікувана поведінка:**
`send_test_message` має повертати відповідь бота через MCP відповідь, а НЕ через Telegram API. В тест-режимі `sender.js` або `telegramHandler.js` мають бути перехоплені — відповідь бота повертається прямо в `sendTestMessage` як return value, а не іде в Telegram.

**Що треба зробити:**
В `testSession.js → sendTestMessage` потрібно мокнути або обійти `sendMessage` з `sender.js`. Варіанти:
1. Передавати в handler `isTestMode: true` → хендлер повертає відповідь замість відправки
2. Мокнути `sender.sendMessage` перед викликом `handleMessage` → перехопити що саме відправляється → повернути через MCP
3. Зберігати відповідь в `session.context._testBotResponse` → `sendTestMessage` читає її після `handleMessage`

**Рекомендований підхід (варіант 3 — мінімальний ризик):**
```javascript
// В telegramHandler.js / bot index.js — перед sendMessage:
if (session.context._isTestMode) {
  session.context._testBotResponse = messageText;
  await prisma.session.update({ where: { id: session.id }, data: { context: session.context } });
  return; // не відправляємо в Telegram
}

// В testSession.js → sendTestMessage:
await handleTelegramUpdate(update); // запускаємо бота
// Читаємо відповідь з context після обробки
const updated = await prisma.session.findUnique({ where: { id: sessionId } });
const botResponse = updated.context._testBotResponse ?? null;
// Очищаємо щоб не дублювалось
await prisma.session.update({ ... context: { ...updated.context, _testBotResponse: undefined } });
return { botResponse, currentState: updated.state, ... };
```

---

### BUG-002 — ВАЖЛИВИЙ: Warning "chat not found" в `start_test_session`

**Статус:** ✅ Виправлено разом з BUG-001 (13.05.2026)  
**Симптом:** При старті тест-сесії в полі `warning` повертається `"ETELEGRAM: 400 Bad Request: chat not found"` — але перше повідомлення бота таки повертається (тобто стартова відповідь виходить, просто також намагається піти в Telegram)  
**Де ламається:** `testSession.js:151 → startTestSession → startBot → sender.js:50`  
**Фікс:** Той самий мок `isTestMode` з BUG-001 вирішить і це

---

### BUG-003 — СЕРЕДНІЙ: `currentNode: null` у відповіді `get_test_session_state`

**Статус:** ✅ Виправлено (fallback + збереження `currentNode`)  
**Симптом:** `currentNode` завжди `null`, навіть коли сесія активна і бот "знаходиться" у певній ноді  
**Очікувана поведінка:** `currentNode` має показувати ID ноди де зараз знаходиться бот (наприклад `"claude_main"` або `"msg_intro"`)  
**Де фіксити:** В логіці збереження стану після переходу між нодами — зберігати `currentNodeId` в сесії  

---

### BUG-004 — ВАЖЛИВИЙ: `create_funnel` є в маніфесті але не підвантажується і не виконується

**Статус:** ✅ Виправлено (реалізація і реєстрація `create_funnel` є в MCP tools)  
**Пріоритет:** P1

**Симптом:**
`create_funnel` видно в UI налаштувань FINEKO flows (всього 16 tools). Але при виклику через MCP — `Tool 'FINEKO flows:create_funnel' not found`. Перепідключення сервера не допомагає.

**Корінна причина — ліміт підвантаження інструментів:**

`tool_search` підвантажує інструменти порційно (до ~18 за запит) на основі семантичної схожості запиту. Спостереження з тестування:
- Запит `"create funnel"` → підтягує `list_funnels`, `get_funnel`, `update_funnel_key`, `create_edge` — але НЕ `create_funnel`
- Запит `"create funnel new bot project slug"` (ширший) → підтягує 18 інструментів включно з `add_node`, `create_edge`, `update_node` — але `create_funnel` знову відсутній
- Прямий виклик `FINEKO flows:create_funnel` без попереднього `tool_search` → `Tool not found`

Це означає що `create_funnel` або:
1. **Зареєстрований в маніфесті** (тому видно в UI) але **не має реалізації** в `tools-flows.js` (тому `tool_search` не може його завантажити і виклик падає), або
2. **Реалізований**, але має баг в схемі/описі через який семантичний пошук його не знаходить жодним запитом

**Як перевірити:**
В `tools-flows.js` — знайти чи є обробник з назвою `create_funnel`. Якщо є опис в маніфесті але немає `case 'create_funnel':` в switch — це варіант 1.

**Що треба зробити (якщо варіант 1 — не реалізований):**
```javascript
// tools-flows.js — додати обробник
case 'create_funnel': {
  const { name, slug, description, projectId } = input;
  const bot = await prisma.bot.create({
    data: { name, slug, description, projectId, isActive: true }
  });
  await prisma.flowDefinition.create({
    data: { botId: bot.id, nodes: [], edges: [], viewport: {} }
  });
  return { id: bot.id, name: bot.name, slug: bot.slug };
}

// mcp-flows.js маніфест — переконатись що є:
{
  name: "create_funnel",
  description: "Create a new bot/funnel in a project",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      name: { type: "string" },
      slug: { type: "string", description: "Unique slug, e.g. bot-1-1-intro" },
      description: { type: "string" }
    },
    required: ["projectId", "name", "slug"]
  }
}
```

**Обхідний шлях (до фікса):** Створити бота вручну через адмін-панель https://flows.fineko.space/admin, отримати UUID — і наповнювати нодами через `add_node` + `create_edge` (ці інструменти працюють нормально).

---

## 🆕 ТЗ: Bot 1.1 — Знайомство та кастдев

**Урок:** 1.1 — Вступ: знайомство і карта старту  
**Slug:** `bot-1-1-intro`  
**Артефакт:** `intro_profile.md` — профіль студента + його головний біль  
**Мета:** Познайомитись з людиною, зробити мінімальний кастдев, показати формат артефакту, пояснити що дані зберігаються і наступні боти будуть їх використовувати

---

### Логіка бота (flow)

```
START /start lesson_1_1
  ↓
[MSG] Привітання → питання про ім'я (або підтвердження імені з Telegram)
  ↓
[CLAUDE claude-haiku-4-5] Веде знайомство — 3 кастдев-питання (роль, бізнес, головний біль)
  ↓
[SAVE FILE] intro_profile.md
  ↓
[MSG] Завершення — показує приклад файлу, пояснює систему артефактів
```

---

### Детальна специфікація нод

#### Нода 1 — Start
```json
{
  "id": "start_1",
  "type": "start",
  "data": {
    "label": "Start /start lesson_1_1",
    "trigger": "/start lesson_1_1"
  }
}
```

#### Нода 2 — Привітання з ім'ям
```
Тип: message
ID: msg_greeting
```

Текст повідомлення:
```
👋 Привіт{{#if user.firstName}}, {{user.firstName}}{{/if}}!

Я — бот курсу «Фінансова система малого бізнесу».

{{#if user.firstName}}Телеграм каже що тебе звати {{user.firstName}} — так і звертатись, чи краще інакше?{{else}}Як тебе звати? Напиши ім'я — так і буду до тебе звертатись.{{/if}}
```

_Примітка для агента: якщо система не підтримує Handlebars у message-нодах — Claude-нода стартує першою і сама визначає ім'я через `context.user`_

#### Нода 3 — Claude веде кастдев (ОСНОВНА)
```
Тип: claude
ID: claude_castdev
Model: claude-haiku-4-5
outputVar: context.intro_profile_md
```

**System Prompt:**
```
Ти — бот курсу «Фінансова система малого бізнесу» Олександра Мацука.
Твоє завдання — познайомитись зі студентом і зібрати 4 речі через природній діалог.

ДАНІ ПРО ЮЗЕРА З ТЕЛЕГРАМА:
firstName: {{context.user.firstName}}
lastName: {{context.user.lastName}}
username: {{context.user.username}}

КРОК 1 — Ім'я:
- Якщо firstName є — запитай: «Телеграм каже що тебе звати [firstName] — так і звертатись, чи краще інакше?»
- Якщо firstName немає — запитай: «Як тебе звати? Просто ім'я.»
- Запам'ятай підтверджене ім'я → збережи в змінну NAME

КРОК 2 — Роль:
Після отримання імені запитай ОДНЕ питання:
«[NAME], яку роль ти виконуєш у своїй компанії? Власник, директор, фінансовий директор — або щось інше?»

КРОК 3 — Що робить компанія:
Після відповіді про роль — запитай:
«Коротко — чим займається твоя компанія? 1-2 речення.»

КРОК 4 — Головний біль:
Після опису компанії — запитай:
«І останнє: яка головна проблема або незручність у фінансах твого бізнесу зараз? Що найбільше дратує або лякає?»

ПРАВИЛА ДІАЛОГУ:
- Одне питання за раз — ніколи не задавай два питання в одному повідомленні
- Реагуй на відповіді природньо (1 речення) перед наступним питанням
- Якщо відповідь нечітка — уточни ОДНИМ реченням, потім рухайся далі
- Після отримання відповіді на 4-й крок — НЕ задавай більше питань, одразу генеруй файл

ПІСЛЯ ЗБОРУ ВСІХ 4 ВІДПОВІДЕЙ — згенеруй файл intro_profile.md у такому форматі:

---
# Профіль студента

**Ім'я:** [NAME]
**Роль:** [ROLE]
**Компанія:** [COMPANY_DESCRIPTION]
**Головний фінансовий біль:** [PAIN]

**Дата:** [DD.MM.YYYY]
---

Веди діалог виключно українською мовою.
Тон — дружній, конкретний, без зайвих слів.
Не представляйся повторно після першого повідомлення.
```

**messagesTemplate:** `{{conversationHistory}}`

#### Нода 4 — Збереження файлу
```json
{
  "id": "save_intro",
  "type": "saveFile",
  "data": {
    "label": "Зберегти intro_profile.md",
    "fileType": "intro_profile",
    "contentVar": "context.intro_profile_md"
  }
}
```

#### Нода 5 — Завершення
```
Тип: message
ID: msg_done
```

Текст:
```
✅ Готово, {{context.studentName}}! Записав.

Ось як виглядає твій перший файл-артефакт курсу:

📄 intro_profile.md
━━━━━━━━━━━━━━━━━━━━━━━━━
Ім'я: [ім'я]
Роль: [роль]
Компанія: [опис]
Головний біль: [біль]
━━━━━━━━━━━━━━━━━━━━━━━━━

В такому форматі ти будеш отримувати результат після кожного уроку. Всі файли зберігаються — і кожен наступний бот знатиме що ти вже зробив.

Далі — відео уроку 1.1 і потім урок 1.2: будуємо бізнес-процес твоєї компанії.
```

---

### Edges (порядок нод)
```
start_1 → claude_castdev → save_intro → msg_done
```

_Примітка: msg_greeting прибрано як окрему ноду — Claude сам починає з питання про ім'я. Це простіший і більш гнучкий flow._

---

### Keys
```
FUNNEL_CHANNELS: ["telegram"]
TELEGRAM_BOT_TOKEN: [токен основного бота курсу або окремого]
TELEGRAM_BOT_USERNAME: [username]
```

---

### Що зберігається в БД
| fileType | Зміст |
|---|---|
| `intro_profile` | Markdown-профіль студента з ім'ям, роллю, описом компанії, болем |

Цей файл в майбутньому може використовуватись:
- Для персоналізації повідомлень в інших ботах (`context.introProfile`)
- Для аналітики — які болі найчастіші серед студентів
- Для ухвалення рішень про нові уроки

---

## 📋 СТАТУС ТЕСТУВАННЯ

| Бот | Статус | Примітка |
|---|---|---|
| Bot 1.1 (новий) | ⏳ Не існує — треба створити | ТЗ вище |
| Bot 1.2 Business Process | ❌ Не протестовано | Блокується BUG-001 |
| Bot 2.1 Articles | ⏳ Не тестувалось | |
| Bot 2.2 Cashflow Table | ⏳ Не тестувалось | |
| Bot 2.3 Payment Calendar | ⏳ Не тестувалось | |
| Bot 3.2 P&L Table | ⏳ Не тестувалось | |
| Bot 3.3 Diagnostics | ⏳ Не тестувалось | |
| Bot 4.1 Process Update | ⏳ Не тестувалось | |
| Bot 4.2 Salaries | ⏳ Не тестувалось | |
| Bot 4.3 Payments | ⏳ Не тестувалось | |
| Bot 4.4 Combined Table | ⏳ Не тестувалось | |
| Bot 4.5 Team Instructions | ⏳ Не тестувалось | |
| Bot 5.1 Balance Articles | ⏳ Не тестувалось | |
| Bot 5.2 Balance Table | ⏳ Не тестувалось | |
| Bot 5.3 Balance Process | ⏳ Не тестувалось | |

**Блокер для всіх:** Немає критичних блокерів з цього списку. Можна продовжувати MCP debug тестування.

---

_Документ оновлюється по мірі тестування._
