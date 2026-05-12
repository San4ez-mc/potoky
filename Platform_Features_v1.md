# Platform Features v1
## FINEKO Flows — нові фічі та архітектурні рішення

---

## 1. СХОВИЩЕ ФАЙЛІВ МІЖ БОТАМИ (User Storage Layer)

**Проблема:** Файли (`cashflow_articles`, `business_process` тощо) зберігаються після кожного бота, але наступний бот не має механізму їх отримати — кожна сесія починає "з нуля".

**Архітектурне рішення — три рівні сховища:**

```
┌─────────────────────────────────────────┐
│           USER STORAGE LAYER            │
│                                         │
│  [Slot Store]      [File Store]         │
│  Короткі дані      Документи/MD         │
│  firstName         cashflow_articles    │
│  phone             business_process     │
│  block_done: 2     pl_articles          │
│                                         │
│  [Session Store]                        │
│  Тимчасові змінні поточної сесії        │
│  context.* очищується після сесії       │
└─────────────────────────────────────────┘
         ↑ читає при старті кожного бота
         ↓ пише saveFile / updateSlot
```

**Slot Store** — іменовані поля профілю підписника:
```json
{
  "userId": "123456",
  "slots": {
    "firstName": "Олексій",
    "companyType": "послуги",
    "block_1_done": true,
    "block_2_done": false,
    "sheetsUrl": "https://docs.google.com/..."
  }
}
```

**File Store** — повні документи по fileType:
```json
{
  "userId": "123456",
  "files": {
    "cashflow_articles": "# Статті Cashflow\n...",
    "business_process": "# Бізнес-процес\n...",
    "pl_articles": "# Статті P&L\n..."
  }
}
```

**Як відображається в UI редактора:**

На канвасі — окремий блок "Сховище" між воронками:

```
[Бот 2.1] ──saveFile──► [💾 USER STORAGE] ◄──loadFile──[Бот 2.2]
                         cashflow_articles
                         pl_articles
```

На схемі видно які файли туди пишуться і звідки читаються. Дає повну картину потоку даних між ботами.

**Нові типи нод для роботи зі Storage:**

| Нода | Дія |
|------|-----|
| `saveFile` | вже є — зберегти MD-документ |
| `loadFile` | завантажити файл в context |
| `updateSlot` | записати коротке значення в слот |
| `readSlot` | прочитати слот в context |
| `checkSlot` | перевірити чи є значення (для умов) |

**API методи:**
```
get_user_storage(userId)           → всі слоти + файли
get_user_file(userId, fileType)    → конкретний файл
set_user_slot(userId, key, value)  → записати слот
get_user_slot(userId, key)         → прочитати слот
list_user_files(userId)            → список файлів з датами
```

---

## 2. СЛОТИ — щоб бот не питав двічі

**Проблема:** Якщо підписник вже відповів на питання в боті 2.1, бот 3.2 не знає про це і може запитати те саме знову.

**Рішення — Slot System:**

Слот — іменована комірка яка зберігається в профілі підписника і живе між сесіями.

**Як працює:**

1. Claude-нода або JS-нода витягує значення з відповіді підписника і пише в слот
2. При наступній сесії — слот автоматично доступний в context
3. В system prompt Claude завжди додається список заповнених слотів — Claude не питає про них знову

**Визначення слотів для воронки (в налаштуваннях бота):**
```json
{
  "slots": [
    { "name": "company_type",  "description": "Тип бізнесу" },
    { "name": "company_name",  "description": "Назва компанії" },
    { "name": "team_size",     "description": "Розмір команди" },
    { "name": "sheets_url",    "description": "Посилання на Google Sheets" },
    { "name": "pl_mode",       "description": "Режим P&L (total/by_project)" }
  ]
}
```

**Що передається Claude автоматично на старті кожної сесії:**
```
Вже відомо про підписника:
- Тип бізнесу: послуги (B2B)
- Назва: ТОВ "Альфа"
- Команда: 12 осіб
НЕ запитуй про це знову.
```

**Нода `updateSlot` в flow:**
```json
{
  "type": "updateSlot",
  "data": {
    "slot": "company_type",
    "value": "{{context.extractedCompanyType}}"
  }
}
```

---

## 3. САМОПЕРЕВІРКИ В КРИТИЧНИХ МОМЕНТАХ

**Проблема:** Після побудови Google Sheets таблиці бот не перевіряє чи вона реально створилась і чи правильно заповнена.

**Рішення — Validation нода:**

```json
{
  "type": "validation",
  "data": {
    "label": "Перевірка таблиці Cashflow",
    "checks": [
      {
        "condition": "context.sheetsUrl exists",
        "onFail": "Таблиця не створилась. Спробуємо ще раз або побудуємо вручну.",
        "onFailNext": "node_fallback"
      },
      {
        "condition": "context.sheetsUrl starts_with 'https://docs.google.com'",
        "onFail": "Отримали некоректне посилання. Перевір доступ до Apps Script.",
        "onFailNext": "node_error_msg"
      }
    ],
    "onSuccess": "node_done"
  }
}
```

**Де критично застосувати:**
- Після кожного `httpRequest` до Apps Script
- Після `saveFile` — перевірити що файл не порожній
- Після Claude-ноди де очікується OUTPUT_TAG — перевірити формат
- Перед побудовою P&L — перевірити що cashflow_articles існує

**Аудит через MCP API:**
```
validate_bot(botId) → список критичних точок без validation-нод
```
Можна запустити аудит воронки і отримати список місць де немає самоперевірки.

---

## 4. ТЕСТ ВОРОНКИ ЧЕРЕЗ API

**Мета:** Запустити симуляцію сесії через MCP без реального Telegram.

**API методи:**
```
start_test_session(botId, userId?)
  → { sessionId, firstMessage }

send_test_message(sessionId, message)
  → { botResponse, currentNode, contextSnapshot, slotsSnapshot }

get_test_session_state(sessionId)
  → { currentNode, context, slots, files, history }

end_test_session(sessionId)
  → { summary, nodesVisited, filesCreated, slotsSet }
```

**Сценарій використання через MCP:**
1. `start_test_session("bot-2-1-articles")` → отримую перше повідомлення
2. `send_test_message(sessionId, "Надаємо бухгалтерські послуги B2B")`
3. Бачу відповідь бота, активну ноду, що записалось в context
4. Продовжую до кінця або до помилки
5. `end_test_session` → звіт що створилось

**В UI редактора** — кнопка "Тест" відкриває чат-симулятор в правій панелі. Активна нода підсвічується на канвасі в реальному часі.

---

## 5. РЕЖИМ HANDOFF — відповідь адміна замість AI (для Michael Bot)

**Контекст:** Michael — бот-продавець. Якщо AI не може відповісти або ситуація потребує живої людини, адмін отримує повідомлення і відповідає сам.

**Архітектура:**

```
[Підписник] → [Michael Bot]
                    │
              [AI не може відповісти]
                    │
              [Handoff тригер]
               ↙          ↘
    [Пауза бота]    [Сповіщення адміна в Telegram]
    Підписник чекає  "💬 Michael Bot | @username
                      Питання: [текст]
                      [Відповісти]"
                              │
                         [Адмін пише]
                              │
                    [Відповідь іде підписнику]
                    [Бот відновлюється]
```

**Налаштування воронки — нова секція "Handoff":**
```json
{
  "handoff": {
    "enabled": true,
    "adminTelegramId": "999000111222",
    "triggerConditions": [
      "ai_confidence < 0.6",
      "keyword_match: ['ціна', 'знижка', 'договір', 'оплата']",
      "user_request: 'поговорити з людиною'"
    ],
    "pauseBot": true,
    "notificationTemplate": "💬 *{{botName}}* | @{{username}}\n\n*Питання:* {{lastMessage}}\n\n[Відповісти]({{replyLink}})",
    "resumeAfterAdminReply": true,
    "timeoutMinutes": 30,
    "onTimeout": "resume_ai"
  }
}
```

**Нода "Handoff" в редакторі:**
- Умова передачі (keywords / впевненість AI / явний запит)
- ID адміна або групи
- Шаблон сповіщення
- Що робити після відповіді (продовжити flow / завершити)
- Timeout якщо адмін не відповів — автоматично повертає AI

**В UI адміна** — вкладка "Handoff черга": всі очікуючі розмови з кнопкою "Відповісти" прямо в платформі.

---

## 6. DEEP LINKS — відстежування джерела трафіку

**Аналог UTM-міток для Telegram/Instagram ботів.**

**Як працює:**

Кожне посилання на бота містить унікальний параметр:
```
https://t.me/fineko_bot?start=lesson_2_1__src_instagram_bio
https://t.me/fineko_bot?start=lesson_2_1__src_email_apr26
https://t.me/fineko_bot?start=lesson_2_1__src_webinar_may11
```

При старті сесії платформа парсить `src_*` і зберігає в слот `traffic_source`.

**Управління deep links в UI (розділ в налаштуваннях воронки):**

| Посилання | Джерело | Переходів | Конверсія |
|-----------|---------|-----------|-----------|
| `src_instagram_bio` | Instagram bio | 234 | 18% |
| `src_email_apr26` | Email розсилка | 89 | 34% |
| `src_webinar_may11` | Вебінар 11 травня | 156 | 41% |

**Генератор deep links** — вводиш назву джерела, платформа генерує готове посилання.

**В профілі підписника** — видно звідки він прийшов і який шлях пройшов.

---

## 7. БОТ-КОНСУЛЬТАНТ ПО КУРСУ + WAYFORPAY

**Новий бот:** відповідає на питання по курсу і веде до оплати.

**Архітектура:**

```
[Підписник задає питання]
         │
    [FAQ Claude]
    system prompt: опис курсу + FAQ + ціни
         │
    ┌────┴────┐
    │  Знає?  │
    ├── Так ──► Відповідає
    └── Ні ───► Handoff до адміна
         │
    [Детект наміру купити]
    keywords: "хочу купити", "як оплатити", "скільки"
         │
    [Показує оффер]
    Картка курсу + ціна + кнопка [Оплатити]
         │
    [WayForPay нода]
    Генерує посилання на оплату
         │
    [Підписник платить]
         │
    [Webhook від WayForPay → підтвердження/доступ]
```

**WayForPay як конектор — нода в редакторі:**
```json
{
  "type": "connector",
  "connector": "wayforpay",
  "action": "create_invoice",
  "data": {
    "amount": "{{context.coursePrice}}",
    "currency": "UAH",
    "description": "Курс: Фінансова система малого бізнесу",
    "orderId": "{{userId}}_{{timestamp}}",
    "returnUrl": "https://t.me/fineko_bot?start=payment_success"
  },
  "outputVar": "context.paymentUrl"
}
```

**Webhook нода** (нова) — приймає POST від WayForPay, перевіряє підпис:
```json
{
  "type": "webhook",
  "data": {
    "source": "wayforpay",
    "verifySignature": true,
    "onSuccess": "node_grant_access",
    "onFail": "node_payment_failed"
  }
}
```

**Контент для system prompt бота-консультанта** (підготувати окремо):
- Повний опис курсу (блоки, уроки, результат)
- FAQ (20-30 питань)
- Ціна і тарифи
- Гарантії і відгуки
- Хто автор

---

## 8. ЗБІР ДАНИХ ПІДПИСНИКА

**Що збирати автоматично при першому контакті:**

| Поле | Джерело | Спосіб |
|------|---------|--------|
| `telegram_id` | Telegram API | автоматично з update |
| `username` | Telegram API | автоматично |
| `first_name` | Telegram API | автоматично |
| `last_name` | Telegram API | автоматично |
| `language_code` | Telegram API | автоматично |
| `photo_url` | Telegram getProfilePhotos | асинхронно при першій сесії |
| `bio` | Telegram API | якщо публічний профіль |
| `traffic_source` | deep link параметр | парсинг при старті |
| `registered_at` | платформа | автоматично |
| `last_seen_at` | платформа | оновлюється кожну сесію |

**Важливо:** `getProfilePhotos` — окремий API виклик, не в стандартному update. Робити асинхронно при першій сесії, зберігати URL фото в профілі.

**На сторінці підписника в UI:**
- Аватар (фото з Telegram)
- Ім'я + username (клікабельний — відкриває Telegram)
- Bio
- Джерело трафіку + дата реєстрації
- Остання активність
- Всі слоти у вигляді таблиці

---

## 9. WHISPER TURBO — безкоштовна транскрипція аудіо

**Навіщо:** Підписники в Telegram часто надсилають голосові повідомлення. Зараз платформа їх ігнорує.

**Рекомендований репозиторій:**
`github.com/hwdsl2/docker-whisper`

**Чому саме цей:**
- Docker-образ з OpenAI-сумісним REST API (`POST /v1/audio/transcriptions`)
- Підтримує модель `large-v3-turbo` — найшвидша якісна модель
- Аудіо залишається на власному сервері (немає передачі третім сторонам)
- Підтримує mp3, m4a, ogg, webm — всі формати Telegram
- Розгортається на Railway поряд з основним сервісом

**Розгортання на Railway:**
```bash
docker run --name whisper \
  -v whisper-data:/var/lib/whisper \
  -p 8080:8080 \
  -e WHISPER_MODEL=large-v3-turbo \
  -d hwdsl2/whisper-server
```

Додати `WHISPER_URL` як глобальний ключ проекту в Налаштуваннях.

**Нова нода "Транскрипція аудіо" в редакторі:**
```json
{
  "type": "transcribe",
  "data": {
    "inputVar": "context.voiceMessagePath",
    "model": "large-v3-turbo",
    "language": "uk",
    "outputVar": "context.transcribedText",
    "onFail": "skip"
  }
}
```

**Flow з голосовими повідомленнями:**
```
[Підписник надіслав голосове]
         │
[Telegram нода] → скачати файл → context.voiceMessagePath
         │
[Transcribe нода] → Whisper → context.transcribedText
         │
[Claude нода] → обробляє текст як звичайну відповідь
```

---

## 10. ВІДПИСКА — фіксація і реакція

**Як працює:**

Telegram надсилає event `my_chat_member` коли підписник блокує бота.

**Обробка:**
1. Платформа слухає `my_chat_member` events
2. Якщо `new_chat_member.status = "kicked"` або `"left"` → фіксує в логах
3. Записує в профіль: `unsubscribed_at`, `unsubscribe_type` (kicked/left)
4. Тегує підписника: `unsubscribed`
5. (Опціонально) тригерить воронку реактивації

**В логах підписника:**
```
2026-05-11 14:32 — Заблокував бота (kicked)
2026-05-10 09:15 — Сесія: Bot 2.1 Articles (завершено)
2026-05-09 18:00 — Перший старт (src: instagram_bio)
```

**Метрика на дашборді:** Churn rate — % підписників що відписались за тиждень/місяць по кожній воронці.

---

## 11. АНАЛІЗ ПОВЕДІНКИ В ВОРОНКАХ (Behavior Analytics)

**Що збирати по кожній сесії:**

| Метрика | Опис |
|---------|------|
| `time_in_node` | скільки секунд підписник "думав" перед відповіддю |
| `message_length` | довжина відповідей (короткі = низька залученість) |
| `retry_count` | скільки разів перепитував або отримував помилку |
| `drop_node` | на якій ноді вийшов без завершення |
| `completion_rate` | % підписників що дійшли до кінця |
| `avg_session_duration` | середній час сесії |
| `return_rate` | % що повернулись після першої сесії |

**Звіт "Поведінка у воронці" — нова вкладка в аналітиці воронки:**

```
Воронка: Bot 2.1 Articles
─────────────────────────────────────────────
Почали:             100%  (234 осіб)
Дійшли до Claude:    89%
Підтвердили статті:  71%
Зберегли файл:       68%   ← відвал 3% на збереженні

Середній час сесії:    12 хв
Середня довжина відповіді: 47 слів

Топ точок відвалу:
1. "Claude — збирає статті"   — 18% виходять тут
2. "Intro 2.1"                —  8% виходять одразу
```

**Heatmap на канвасі** (режим Analytics):
- Стрілки між нодами міняють товщину пропорційно кількості підписників
- Вузькі місця підсвічуються жовтим/червоним

**Когортний аналіз:** порівняти підписників з різних джерел — хто краще конвертує, хто швидше проходить курс.

---

## ПІДСУМОК: пріоритети

### Критично (блокує або суттєво обмежує роботу)

| # | Фіча |
|---|------|
| 1 | User Storage Layer — File Store + Slot Store |
| 2 | Slot System — щоб не питати двічі |
| 3 | Validation нода — самоперевірки в критичних точках |
| 4 | Тест воронки через API (MCP + UI симулятор) |

### Важливо (значно покращує курс і продажі)

| # | Фіча |
|---|------|
| 5 | Handoff (Michael Bot → адмін) |
| 6 | WayForPay конектор + Webhook нода |
| 7 | Deep links + аналітика джерел трафіку |
| 8 | Збір даних підписника (фото, bio, автоматично) |
| 9 | Whisper Turbo — транскрипція голосових (docker-whisper) |
| 10 | Фіксація відписки в логах + churn rate |
| 11 | Storage UI на канвасі (блок між ботами) |

### Бажано (оптимізація і розуміння)

| # | Фіча |
|---|------|
| 12 | Behavior Analytics (time_in_node, drop_node, message_length) |
| 13 | Heatmap на канвасі (режим Analytics) |
| 14 | Когортний аналіз по джерелах трафіку |
| 15 | Handoff черга в UI платформи |
| 16 | Бот-консультант (контент підготувати окремо) |

---

*Platform Features v1 — нові фічі та архітектурні рішення.*
*Дата: 2026-05-12*
