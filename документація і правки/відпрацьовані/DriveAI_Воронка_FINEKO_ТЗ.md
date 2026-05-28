# ТЗ Воронки: Bot Drive AI Assistant
## FINEKO Flows Platform

> Bot ID: `ecba13cc-fd08-40fb-89d0-ec2a3f1229ed`  
> Slug: `bot-drive-ai-assistant`  
> Project: `finance-course`  
> Статус: створено, isActive=false (активувати після налаштування)

---

## Що робить цей бот

Telegram-інтерфейс для Drive AI системи. Бот **не містить власної логіки пошуку чи AI** — він є тонким шаром між користувачем і Drive AI API. Вся логіка (embeddings, векторний пошук, класифікація, збереження) — на стороні Drive AI бекенду.

Бот підтримує три режими:
1. **Пошук** — будь-який текстовий запит → httpRequest до `/api/search` → форматована відповідь
2. **Додавання контенту** — текст, голосове повідомлення або файл → httpRequest до `/api/ingest` → підтвердження
3. **Нотифікації** — Drive AI API надсилає повідомлення через окремий endpoint (не воронка, а прямий виклик Telegram API з бекенду)

---

## Ключі бота (вже встановлені)

| Key | Значення | Примітка |
|---|---|---|
| `FUNNEL_CHANNELS` | `["telegram"]` | Канал запуску |
| `DRIVE_AI_API_URL` | `https://yourdomain.ua/api` | **Замінити на реальний URL** |
| `DRIVE_AI_WORKSPACE_TOKEN` | `ws_placeholder_replace_me` | **Замінити на реальний токен** (secret) |
| `TELEGRAM_BOT_TOKEN` | `placeholder_replace_me` | **Замінити на токен бота** (secret) |
| `TELEGRAM_BOT_USERNAME` | `drive_ai_bot` | Username бота |
| `CLAUDE_CONNECTOR_ID` | `30edf58a-...` | Якщо потрібна Claude нода для допомоги |

---

## Архітектура воронки

```
/start
  └── message: Привітання + меню
        └── claude: Роутер (визначає intent)
              ├── [intent=search]  → httpRequest: POST /api/search
              │                        └── condition: є результат?
              │                              ├── [так] message: Відповідь з посиланням
              │                              │         └── condition: кнопки оцінки
              │                              │               ├── [👍] httpRequest: POST /api/search/rate {rating:"up"}
              │                              │               └── [👎] httpRequest: POST /api/search/rate {rating:"down"}
              │                                               
              ├── [intent=add_text]  → httpRequest: POST /api/ingest (type=text)
              │                           └── condition: є пропозиція?
              │                                 └── message: "Зберегти в [папка/документ]?"
              │                                       └── condition: підтвердження
              │                                             ├── [✅ Так] httpRequest: POST /api/ingest/confirm
              │                                             │           └── message: "✅ Збережено!"
              │                                             └── [📁 Інша] claude: уточнення папки
              │
              ├── [intent=add_voice] → httpRequest: POST /api/ingest (type=voice, audio=fileId)
              │                           └── message: "🎤 Транскрибую..."
              │                                 └── (той самий флоу що add_text)
              │
              └── [intent=add_file]  → httpRequest: POST /api/ingest (type=file, fileId=...)
                                          └── (той самий флоу що add_text)
```

---

## Детальний опис нод

### Нода 1: `start`
```
type: start
trigger: /start
```

### Нода 2: `message` — Привітання
```
type: message
text:
👋 Привіт! Я Drive AI — твій помічник для роботи з Google Drive.

Що можу:
🔍 Знайти будь-який документ за змістом
📝 Зберегти нотатку, кейс або ідею
🎤 Транскрибувати голосове і зберегти
📎 Розмістити файл у потрібну папку

Просто напиши запит або надішли голосове — розберусь сам.
```

### Нода 3: `claude` — Роутер інтентів
```
type: claude
mode: single (не dialog — один запит/відповідь)
model: claude-sonnet-4-20250514
connectorId: {{env.CLAUDE_CONNECTOR_ID}}
outputVar: context.intent_result
exitCondition: json_output

systemPrompt:
Ти — роутер запитів для Drive AI системи. Визначаєш що хоче зробити користувач.

Вхідне повідомлення може бути:
- Текстовий запит (пошук або додавання)
- Голосове повідомлення (fileId буде в контексті)
- Файл (fileId буде в контексті)

Правила визначення інтенту:
- search: питання, запит типу "де", "знайди", "є у мене", "покажи" — пошук по Drive
- add_text: нова інформація, кейс, нотатка, ідея яку треба зберегти
- add_voice: якщо context.voice_file_id не порожній
- add_file: якщо context.document_file_id не порожній

Відповідай ТІЛЬКИ JSON:
{
  "intent": "search" | "add_text" | "add_voice" | "add_file",
  "query": "текст запиту або транскрипція для пошуку",
  "content": "контент для збереження (якщо add_*)"
}

messagesTemplate: |
  Повідомлення: {{lastMessage}}
  Голосовий файл: {{context.voice_file_id}}
  Документ: {{context.document_file_id}}
```

### Нода 4: `condition` — Розгалуження по інтенту
```
type: condition
conditions:
  - id: cond_search
    label: Пошук
    expression: context.intent_result.intent === "search"
  - id: cond_add_text
    label: Додати текст
    expression: context.intent_result.intent === "add_text"
  - id: cond_add_voice
    label: Голосове
    expression: context.intent_result.intent === "add_voice"
  - id: cond_add_file
    label: Файл
    expression: context.intent_result.intent === "add_file"
```

---

## Гілка ПОШУК

### Нода: `httpRequest` — Запит пошуку
```
type: httpRequest
method: POST
url: {{env.DRIVE_AI_API_URL}}/search
headers:
  Authorization: Bearer {{env.DRIVE_AI_WORKSPACE_TOKEN}}
  Content-Type: application/json
body:
  {
    "query": "{{context.intent_result.query}}",
    "top_k": 3
  }
outputVar: context.search_result
```

### Нода: `condition` — Є результат?
```
type: condition
conditions:
  - id: cond_found
    label: Знайдено
    expression: context.search_result.found === true
  - id: cond_not_found
    label: Не знайдено
    expression: context.search_result.found === false
```

### Нода: `message` — Відповідь знайдено
```
type: message
text:
📄 {{context.search_result.file_name}}
📁 {{context.search_result.folder_path}}

{{context.search_result.answer}}

🔗 [Відкрити документ]({{context.search_result.file_url}})

[👍 Корисно]  [👎 Не те]
```

### Нода: `message` — Не знайдено
```
type: message
text:
🤷 Нічого не знайшов за цим запитом.

Можливо, документ ще не проіндексований. Перевір розділ "Індексація" у Web UI або спробуй переформулювати запит.
```

### Нода: `httpRequest` — Зберегти оцінку 👍
```
type: httpRequest
method: POST
url: {{env.DRIVE_AI_API_URL}}/search/rate
headers:
  Authorization: Bearer {{env.DRIVE_AI_WORKSPACE_TOKEN}}
  Content-Type: application/json
body:
  {
    "query_log_id": "{{context.search_result.query_log_id}}",
    "rating": "up"
  }
```

### Нода: `httpRequest` — Зберегти оцінку 👎
```
type: httpRequest
method: POST
url: {{env.DRIVE_AI_API_URL}}/search/rate
headers:
  Authorization: Bearer {{env.DRIVE_AI_WORKSPACE_TOKEN}}
  Content-Type: application/json
body:
  {
    "query_log_id": "{{context.search_result.query_log_id}}",
    "rating": "down"
  }
```

---

## Гілка ДОДАВАННЯ ТЕКСТУ / ГОЛОСУ / ФАЙЛУ

### Нода: `message` — "Обробляю..."
```
type: message
text: ⏳ Обробляю...
```
*(показується поки httpRequest виконується)*

### Нода: `httpRequest` — Відправити на інгест
```
type: httpRequest
method: POST
url: {{env.DRIVE_AI_API_URL}}/ingest
headers:
  Authorization: Bearer {{env.DRIVE_AI_WORKSPACE_TOKEN}}
  Content-Type: application/json
body (для тексту):
  {
    "type": "text",
    "content": "{{context.intent_result.content}}"
  }

body (для голосу):
  {
    "type": "voice",
    "telegram_file_id": "{{context.voice_file_id}}"
  }

body (для файлу):
  {
    "type": "file",
    "telegram_file_id": "{{context.document_file_id}}"
  }

outputVar: context.ingest_result
```

> Drive AI бекенд сам транскрибує голос (Whisper) і парсить файл. Воронка тільки передає file_id.

### Нода: `message` — Пропозиція збереження
```
type: message
text:
📂 Розпізнав: {{context.ingest_result.classified_as}}

Зберегти сюди?
📁 {{context.ingest_result.suggested_folder}}
📄 {{context.ingest_result.suggested_document}}

[✅ Так, зберегти]  [📁 Інша папка]  [✏️ Редагувати текст]
```

### Нода: `condition` — Що обрав користувач?
```
type: condition
conditions:
  - id: cond_confirm
    label: Підтвердив
    expression: lastMessage === "✅ Так, зберегти"
  - id: cond_other_folder
    label: Інша папка
    expression: lastMessage === "📁 Інша папка"
  - id: cond_edit
    label: Редагувати
    expression: lastMessage === "✏️ Редагувати текст"
```

### Нода: `httpRequest` — Підтвердити збереження
```
type: httpRequest
method: POST
url: {{env.DRIVE_AI_API_URL}}/ingest/confirm
headers:
  Authorization: Bearer {{env.DRIVE_AI_WORKSPACE_TOKEN}}
  Content-Type: application/json
body:
  {
    "ingest_id": "{{context.ingest_result.ingest_id}}",
    "confirmed": true
  }
outputVar: context.save_result
```

### Нода: `message` — Збережено ✅
```
type: message
text:
✅ Збережено!

📄 {{context.save_result.file_name}}
📁 {{context.save_result.folder_path}}

🔗 [Відкрити документ]({{context.save_result.file_url}})
```

### Нода: `message` — Обрати іншу папку
```
type: message
text:
📁 Напиши назву папки або шлях куди зберегти:
(наприклад: Кейси/Email-маркетинг)
```
*(далі → повторний httpRequest /ingest/confirm з custom_folder)*

---

## API контракт між воронкою і Drive AI

Drive AI бекенд повинен реалізувати ці endpoints для воронки:

### POST /api/search
**Request:**
```json
{
  "query": "де мої кейси по email?",
  "top_k": 3
}
```
**Response:**
```json
{
  "found": true,
  "query_log_id": "uuid",
  "file_name": "Кейси по консалтингу Q3",
  "file_url": "https://docs.google.com/...",
  "folder_path": "Кейси / Email-маркетинг",
  "answer": "Знайдено 3 кейси по email-маркетингу...",
  "snippet": "Конверсія підвищена з 1.2% до 3.4%..."
}
```

### POST /api/search/rate
```json
{ "query_log_id": "uuid", "rating": "up" | "down" }
```

### POST /api/ingest
**Request (текст):**
```json
{ "type": "text", "content": "Зробили кейс з Rozetka..." }
```
**Request (голос/файл):**
```json
{ "type": "voice", "telegram_file_id": "AgACAgIAAxk..." }
```
**Response:**
```json
{
  "ingest_id": "uuid",
  "classified_as": "Кейс | Rozetka | Email-маркетинг",
  "suggested_folder": "Кейси / Email-маркетинг",
  "suggested_document": "Кейси по консалтингу",
  "transcription": "Зробили кейс з Rozetka..."
}
```

### POST /api/ingest/confirm
```json
{
  "ingest_id": "uuid",
  "confirmed": true,
  "custom_folder": null
}
```
**Response:**
```json
{
  "file_name": "Кейси по консалтингу",
  "file_url": "https://docs.google.com/...",
  "folder_path": "Кейси / Email-маркетинг"
}
```

---

## Нотифікації з Drive AI (поза воронкою)

Drive AI бекенд надсилає нотифікації напряму через Telegram Bot API (не через воронку):

```
POST https://api.telegram.org/bot{TOKEN}/sendMessage
{
  "chat_id": "{workspace.telegram_chat_id}",
  "text": "✅ Індексація завершена. 347 файлів, 2840 чанків",
  "parse_mode": "Markdown"
}
```

Це простіше ніж тригерити воронку для нотифікацій.

---

## Що потрібно зробити після передачі ТЗ

1. Створити Telegram бота через BotFather → отримати токен
2. Замінити `TELEGRAM_BOT_TOKEN` і `DRIVE_AI_WORKSPACE_TOKEN` в ключах бота
3. Замінити `DRIVE_AI_API_URL` на реальний URL після деплою Drive AI
4. Додати ноди у візуальний редактор FINEKO Flows згідно цього ТЗ
5. Налаштувати webhook: `POST /webhook/telegram/{botId}`
6. Встановити `isActive: true`
