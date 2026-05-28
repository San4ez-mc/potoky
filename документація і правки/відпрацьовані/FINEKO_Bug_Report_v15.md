# FINEKO Bug Report v15

> Документ для агента у VS Code.  
> Файли платформи: `/var/www/flows.fineko.space/platform/`  
> Monorepo структура: `apps/api/`, `apps/admin/`, `apps/worker/`, `packages/db/`, `packages/claude/`

---

## BUG-006 · `user_confirms` exitCondition — нода не переходить до saveFile

**Статус:** Відкритий  
**Пріоритет:** 🔴 Критичний — блокує боти 1.2, 2.1, 2.3, 3.3, 4.1, 4.5, 5.1, 5.3  
**Підтверджено на сесіях:** `75499024` (Bot 1.2), `03b20a7c` (Bot 2.1), `d06ba5af` (Bot 2.1), `0a4ca1a0` (Bot 1.2)

---

### Що відбувається покроково

1. Студент проходить діалог з Майклом — claude-нода з `mode: "dialog"`
2. Майкл показує підсумок і запитує «Все вірно?»
3. Студент пише «Так, все вірно!» / «підтверджую» / «ок»
4. Платформа детектує підтвердження — `exitCondition: user_confirms` спрацьовує
5. Платформа робить **фінальний** виклик до Claude API — генерує YAML або Markdown
6. Claude повертає фінальний документ (50-200 рядків тексту)
7. **БАГ:** після кроку 6 — `session.state` залишається `claude_main`, `waitingForUser = true`
8. Наступна нода (`saveFile`) **ніколи не виконується**
9. Результат: `filesCreated: 0`, студент не отримує артефакт, сесія зависає

---

### Чому Bot 1.1 працює, а інші — ні

Bot 1.1 використовує `exitCondition: "json_output"` — платформа перевіряє відповідь Claude на валідний JSON і **автоматично** переходить до наступної ноди.

Боти 1.2, 2.1 та інші використовують `exitCondition: "user_confirms"` — двоетапна логіка:
- **Етап 1:** детектувати підтвердження від студента ✅ (працює)
- **Етап 2:** зробити фінальний виклик Claude → зберегти результат → перейти до наступної ноди ❌ (не працює)

Платформа виконує Етап 1 і запускає Етап 2 (виклик Claude відбувається — `apiCallsCount` збільшується), але **після отримання відповіді не переходить далі**.

---

### Де шукати в коді

Платформа — монорепо Node.js + Express + Prisma + Bull.  
Обробка Telegram-повідомлень іде через webhook:

```
POST /webhook/telegram/:botId
  → platform/apps/api/src/routes/webhook.js
  → telegramHandler або finance-course handler
  → flow executor (обробка поточної ноди сесії)
```

**Шукати файл що:**
- Читає `Session.state` і `Session.context` з БД (Prisma model `Session`)
- Знаходить поточну ноду в `FlowDefinition.nodes` (JSON поле)
- Обробляє ноду типу `"claude"` з `data.mode === "dialog"`
- Перевіряє `data.exitCondition`
- Викликає Claude API через `@platform/claude`
- Має логіку визначення підтвердження (`user_confirms`)
- Після відповіді Claude — має переходити до наступної ноди через `FlowDefinition.edges`

Ймовірні шляхи:
```
platform/apps/api/src/services/flowExecutor.js     ← найімовірніше
platform/apps/api/src/services/sessionHandler.js
platform/apps/api/src/handlers/
platform/projects/finance-course/src/
platform/apps/worker/src/                          ← якщо обробка через Bull queue
```

---

### Що конкретно виправити

**Поточна (зламана) логіка:**

```javascript
// В обробнику claude-ноди з mode: "dialog" і exitCondition: "user_confirms"

async function handleClaudeDialogNode(node, session, userMessage) {
  if (node.data.exitCondition === 'user_confirms') {
    const isConfirmation = detectConfirmation(userMessage);
    // detectConfirmation шукає "так", "ок", "підтверджую", "все вірно" тощо
    
    if (isConfirmation) {
      // Робимо фінальний виклик Claude щоб він згенерував документ
      const finalResponse = await callClaude({
        systemPrompt: node.data.systemPrompt,
        history: session.conversationHistory,
        outputInstruction: 'Згенеруй фінальний документ'
      });
      
      // ❌ БАГ: після отримання finalResponse — нічого не відбувається
      // session.context[outputVar] не оновлюється
      // session.state не змінюється  
      // session.waitingForUser не скидається в false
      // Наступна нода не викликається
      // Функція завершується — і платформа знову чекає наступного повідомлення від студента
    }
  }
}
```

**Виправлена логіка:**

```javascript
async function handleClaudeDialogNode(node, session, userMessage) {
  if (node.data.exitCondition === 'user_confirms') {
    const isConfirmation = detectConfirmation(userMessage);
    
    if (isConfirmation) {
      // Робимо фінальний виклик Claude
      const finalResponse = await callClaude({
        systemPrompt: node.data.systemPrompt,
        history: session.conversationHistory,
        outputInstruction: 'Згенеруй фінальний документ'
      });
      
      // ✅ ВИПРАВЛЕННЯ 1: зберегти результат в context
      const outputVar = node.data.outputVar; // напр. "context.articles_result"
      const varName = outputVar.replace('context.', '');
      session.context[varName] = finalResponse;
      
      // ✅ ВИПРАВЛЕННЯ 2: скинути waitingForUser
      session.waitingForUser = false;
      
      // ✅ ВИПРАВЛЕННЯ 3: знайти наступну ноду по edges і виконати її
      const flowDef = await getFlowDefinition(session.botId); // FlowDefinition з БД
      const nextNodeId = flowDef.edges.find(e => e.source === node.id)?.target;
      
      if (nextNodeId) {
        // Оновити session.state і виконати наступну ноду
        session.state = nextNodeId;
        await prisma.session.update({
          where: { id: session.id },
          data: { 
            state: nextNodeId,
            context: session.context,
            waitingForUser: false
          }
        });
        
        await executeNode(nextNodeId, session, flowDef);
      }
      
      return; // виходимо — не чекаємо наступного повідомлення
    }
  }
  
  // Якщо не підтвердження — звичайний діалог, продовжуємо чекати
  session.waitingForUser = true;
  const response = await callClaude({ ... });
  await sendToTelegram(session.userId, response);
}
```

---

### Структура FlowDefinition для розуміння

З БД (Prisma model `FlowDefinition`, поле `nodes` і `edges` — JSON):

```javascript
// Нода claude_main:
{
  "id": "claude_main",
  "type": "claude",
  "data": {
    "mode": "dialog",
    "exitCondition": "user_confirms",
    "outputVar": "context.articles_result",  // ← сюди писати результат
    "connectorId": "30edf58a-...",
    "systemPrompt": "Ти — Майкл..."
  }
}

// Edge claude_main → save_result:
{
  "id": "e3",
  "source": "claude_main",   // ← поточна нода
  "target": "save_result"    // ← наступна нода
}

// Нода save_result:
{
  "id": "save_result",
  "type": "saveFile",
  "data": {
    "fileType": "articles",
    "contentVar": "context.articles_result"  // ← читає те що ми записали
  }
}
```

Логіка переходу:
```javascript
function getNextNodeId(currentNodeId, edges) {
  return edges.find(e => e.source === currentNodeId)?.target ?? null;
}
```

---

### Критично: не зламати Bot 1.1

Bot 1.1 (`7675fc52`) використовує `exitCondition: "json_output"` і **працює коректно**.  
Зміни стосуються **виключно** обробки `exitCondition: "user_confirms"`.

---

### Як перевірити що виправлено

```
1. start_test_session для Bot 2.1 (f4bd6571-e386-4a36-a086-ff631c3d77e4)
2. Відповісти на ~5-6 питань про статті
3. Написати "Так, все вірно!"
4. end_test_session → перевірити:
   - currentState == "msg_done"  (не "claude_main")
   - filesCreated == 1           (не 0)
   - nodesVisited містить: claude_main, save_result, generateDocument, msg_done
5. Також перевірити Bot 1.1 (7675fc52) — має продовжувати працювати
```

---

---

## BUG-012 · BigInt serialization error — `JSON.stringify` падає на `telegram_id`

**Статус:** Відкритий  
**Пріоритет:** 🔴 Критичний — блокує Bot 2.2 і всі ноди що передають дані з `user.telegramId`  
**Помилка:** `TypeError: Do not know how to serialize a BigInt`  
**Виявлено на:** Bot 2.2 (`ef42640d`), тест-сесія `92bd284a`, при виклику claude_main

---

### Чому виникає — технічне пояснення

В Prisma schema (`platform/packages/db/schema.prisma`):
```prisma
model User {
  telegramId  BigInt   @unique   // Telegram ID — 64-bit число
  ...
}
```

Telegram ID деяких акаунтів > 2^53 (напр. `793812360` — це малий ID, але нові акаунти мають ID типу `7123456789` що перевищує `Number.MAX_SAFE_INTEGER`). Prisma зберігає це як JavaScript `BigInt` (литерал `793812360n`).

**Проблема:** стандартний `JSON.stringify()` не підтримує `BigInt`:
```javascript
const user = await prisma.user.findUnique({ where: { telegramId: 793812360n } });
// user.telegramId = 793812360n  (BigInt, не Number)

JSON.stringify({ id: user.telegramId })
// ❌ TypeError: Do not know how to serialize a BigInt
```

Це падає в момент коли платформа будує payload для:
- Виклику Claude API (передає `session.context` або `user.telegramId` в системний промпт)
- Або httpRequest до Apps Script (передає `telegram_id` в body)
- Або збереження `session.context` в БД через Prisma

---

### Де шукати в коді

**1. При ініціалізації сесії або читанні юзера:**
```
platform/apps/api/src/routes/webhook.js
platform/apps/api/src/services/
platform/projects/finance-course/src/
```
Ймовірно є:
```javascript
const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
// потім user кладеться в session або context
session.context.userId = user.telegramId;  // ← BigInt в context
```

**2. При виклику Claude через `@platform/claude`:**
```
platform/packages/claude/src/index.js
```
Ймовірно є:
```javascript
const payload = {
  model: '...',
  messages: buildMessages(session, systemPrompt), // ← може містити BigInt з context
  max_tokens: 4096
};
const body = JSON.stringify(payload); // ← ПАДАЄ якщо payload містить BigInt
```

**3. При збереженні context в БД:**
```javascript
await prisma.session.update({
  where: { id: session.id },
  data: { context: session.context } // ← Prisma JSON поле, може теж падати на BigInt
});
```

---

### Рішення — Варіант А (рекомендований): конвертація при читанні з БД

Один раз в одному місці — при читанні `User` з БД конвертувати `telegramId` в рядок:

```javascript
// В сервісі/хендлері де читається User після webhook від Telegram:

const user = await prisma.user.findUnique({ 
  where: { telegramId: BigInt(incomingTelegramId) } 
});

if (user && typeof user.telegramId === 'bigint') {
  user.telegramId = user.telegramId.toString(); // 793812360n → "793812360"
}
```

Або через Prisma `$use` middleware (якщо у проекті є prisma client initialization):
```javascript
// platform/packages/db/src/index.js

prisma.$use(async (params, next) => {
  const result = await next(params);
  // Конвертувати BigInt → String для User model
  if (params.model === 'User') {
    const convert = (obj) => {
      if (!obj) return obj;
      if (Array.isArray(obj)) return obj.map(convert);
      if (typeof obj === 'object') {
        return Object.fromEntries(
          Object.entries(obj).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
        );
      }
      return obj;
    };
    return convert(result);
  }
  return result;
});
```

---

### Рішення — Варіант Б: safeStringify хелпер

Якщо варіант А не підходить — додати хелпер і замінити всі `JSON.stringify` що можуть зустріти BigInt:

```javascript
// platform/apps/api/src/utils/safeStringify.js  (новий файл)

function safeStringify(obj, indent) {
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'bigint') return value.toString();
    return value;
  }, indent);
}

module.exports = { safeStringify };
```

Замінити в критичних місцях:
```javascript
// Замість:
const body = JSON.stringify(payload);
// На:
const body = safeStringify(payload);
```

---

### Як перевірити що виправлено

```
1. start_test_session для Bot 2.2 (ef42640d-1c18-4734-8b2b-ef444eadb960)
2. Написати "Так, запускай!"
3. Перевірити що немає помилки "Do not know how to serialize a BigInt"
4. apiCallsCount > 0 (виклик пройшов)
5. Перевірити AppError таблицю — не має бути нового запису з BigInt помилкою
```

---

---

## ТЗ: loadFile `user_onboarding_data` — додати в 10 ботів

**Пріоритет:** 🟡 Важливо  

Файл `user_onboarding_data` зберігається Bot 1.1 через `saveFile` в таблицю `File` (Prisma).  
`loadFile`-нода читає останній файл з `File` по `userId + fileType` і кладе в `session.context[outputVar]`.  
Без цієї ноди `{{context.onboarding_result.name}}` = порожній рядок → «Привіт, !»

**Нова нода для кожного бота:**
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

**Де вставити — таблиця:**

| Бот | ID | Вставити після | Перед |
|-----|----|----------------|-------|
| 3.2 | `6adc79da` | `loadfile_pl_articles` | `msg_intro` |
| 3.3 | `bd796da5` | `loadfile_pl_articles` | `msg_intro` |
| 4.1 | `0062e7e3` | `loadfile_pl_articles` | `msg_intro` |
| 4.2 | `15b79289` | `loadfile_business_process` | `msg_intro` |
| 4.3 | `26c78700` | `loadfile_cashflow_articles` | `msg_intro` |
| 4.4 | `a99faa7c` | `loadfile_cashflow_table_url` | `msg_intro` |
| 4.5 | `907b31e9` | `loadfile_pl_articles` | `msg_intro` |
| 5.1 | `69da1d5f` | `loadfile_business_process` | `msg_intro` |
| 5.2 | `8bb47937` | `loadfile_combined_table_url` | `msg_intro` |
| 5.3 | `e50af81c` | `loadfile_business_process_v2` | `msg_intro` |

**Ребра для кожного бота:**
```
Видалити: <остання_loadFile_нода> → msg_intro
Додати:   <остання_loadFile_нода> → нова_loadFile_onboarding
Додати:   нова_loadFile_onboarding → msg_intro
```

---

## ТЗ: generateDocument — додати в 7 ботів

**Пріоритет:** 🟡 Важливо  

Нода `generateDocument` конвертує Markdown з `context` в docx і відправляє студенту.  
Вставляється між `save_result` і `msg_done`.

| Бот | ID | template | sourceVar |
|-----|----|----------|-----------|
| 3.3 | `bd796da5` | `financial_diagnostics` | `context.mechanics_md` |
| 4.1 | `0062e7e3` | `business_process_v2` | `context.process_v2_md` |
| 4.2 | `15b79289` | `salary_processes` | `context.salary_md` |
| 4.3 | `26c78700` | `payment_processes` | `context.payments_md` |
| 4.5 | `907b31e9` | `team_instructions` | `context.instructions_md` |
| 5.1 | `69da1d5f` | `balance_articles` | `context.balance_articles_md` |
| 5.3 | `e50af81c` | `balance_process_guide` | `context.balance_process_md` |

**Ребра для кожного бота:**
```
Видалити: save_result → msg_done
Додати:   save_result → нова_generateDocument
Додати:   нова_generateDocument → msg_done
```

---

## ТЗ: APPS_SCRIPT_URL — заповнити реальним URL

**Пріоритет:** 🔴 Критичний для ботів що будують таблиці

Apps Script вже задеплоєний. URL отримати: Google Apps Script → Deploy → Manage deployments.

Оновити `APPS_SCRIPT_URL` для 5 ботів:

| Бот | ID |
|-----|----|
| 2.2 | `ef42640d` |
| 2.3 | `c1b1103d` |
| 3.2 | `6adc79da` |
| 4.4 | `a99faa7c` |
| 5.2 | `8bb47937` |

Або краще: створити `GlobalKey` на рівні проекту (Prisma model `GlobalKey`, поле `projectId`) щоб один ключ для всіх ботів.

---

## ТЗ: Bot 4.3 — додати loadFile `business_process`

В промпті є `{{context.businessProcess}}` але нода відсутня.

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
Вставити між `loadfile_cashflow_articles` і `loadfile_onboarding` (який буде доданий вище).

---

## ТЗ: Bot 5.2 — виправити `combinedSheetsId`

В промпті є `{{context.combinedSheetsId}}` але ця змінна не заповнюється.  

Додати js-ноду між `loadfile_combined_table_url` і `msg_intro`:
```javascript
// Парсить spreadsheetId з URL
const url = context.sheetsUrl || context.combinedUrl;
if (url) {
  const match = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  context.sheetsId = match ? match[1] : null;
}
```

---

## ТЗ: Bot 4.4 — уніфікувати fileType в saveFile

Зараз saveFile зберігає як `combined_table_url`.  
Bot 5.2 очікує `cashflow_table_url`.  
Змінити `fileType` в saveFile Bot 4.4 з `combined_table_url` на `cashflow_table_url` — щоб весь ланцюг читав з одного місця.

---

## Що вже зроблено через MCP (не повторювати)

| Бот | Що зроблено |
|-----|-------------|
| 1.1 | fetchTelegramProfile, generateDocument, ребра виправлені |
| 1.2 | loadFile onboarding, jsEncode, httpRequest(binary), sendPhoto, generateDocument, exitCondition→user_confirms |
| 2.1 | дублікат saveFile видалено, fileType→articles, loadFile×2, generateDocument |
| 2.2 | loadFile articles+onboarding, CLAUDE_CONNECTOR_ID, модель→haiku-4-5, msg_intro/done |
| 2.3 | loadFile×3, mode/exitCondition, CLAUDE_CONNECTOR_ID, generateDocument, msg_intro/done |
| 3.2 | fileType→articles, mode/exitCondition, CLAUDE_CONNECTOR_ID, msg_intro/done |
| 3.3 | fileType→articles×2, mode: dialog/user_confirms, CLAUDE_CONNECTOR_ID, msg_intro/done |
| 4.1 | fileType→articles×2, mode/exitCondition, CLAUDE_CONNECTOR_ID, msg_intro/done |
| 4.2 | mode/exitCondition (вже було), CLAUDE_CONNECTOR_ID (вже було), msg_intro/done оновлено |
| 4.3 | fileType→articles, mode/exitCondition, CLAUDE_CONNECTOR_ID, модель→sonnet, msg_intro/done |
| 4.4 | mode: single/json_output, CLAUDE_CONNECTOR_ID, модель→haiku-4-5, msg_intro/done |
| 4.5 | fileType→articles×2, mode/exitCondition, CLAUDE_CONNECTOR_ID, msg_intro/done |
| 5.1 | fileType→articles×2, mode/exitCondition, CLAUDE_CONNECTOR_ID, msg_intro/done |
| 5.2 | mode: single/json_output, CLAUDE_CONNECTOR_ID, модель→haiku-4-5, msg_intro/done |
| 5.3 | mode/exitCondition, CLAUDE_CONNECTOR_ID, модель→sonnet, msg_intro/done (фінальне) |
| Sales (Ден) | SPIN промпт, WayForPay конектор, wait/sendDocument ноди, notifyAdmin, ключі |
