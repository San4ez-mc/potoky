# Content Manager Bot — Design Document
*Версія: 0.1 · 28 травня 2026*

---

## 1. Концепція

Бот — **командний центр контенту** для Telegram. Олександр пише голосом або текстом, бот:
- будує / редагує контент-плани на місяць по кожній соцмережі
- аналізує що вже постилось і що зайшло
- генерує пости, каруселі, stories, відео через наявні воронки
- знає кейси і правила контенту
- розуміє аудіо-повідомлення
- лінкує контент з воронками продажів

**Проект:** `Контент для соц.мереж`  
**Назва бота:** `content-manager`  
**Slug:** `content-manager`

---

## 2. Що вміє бот (Capabilities)

| # | Команда / запит | Що робить |
|---|----------------|-----------|
| 1 | "Створи контент-план на червень для Тредс" | Вантажить попередні плани → аналізує статистику → опитує про пріоритети → генерує план |
| 2 | "Покажи план на травень" | Вантажить і відображає збережений план |
| 3 | "Допиши 3 пости про болі клієнтів" | Додає пости до поточного плану |
| 4 | "Зроби сторі з AI фоном: заголовок Фінсистема бізнесу" | Запускає `content-ai-bg` воронку |
| 5 | "Зроби карусель на тему cashflow за 5 слайдів" | Запускає `content-carousel` воронку |
| 6 | "Зроби відео з субтитрами" + файл | Запускає `content-video-basic-subs` |
| 7 | "Зроби AI Аватар: {текст}" | Запускає `content-avatar-budget` або `content-avatar-heygen` |
| 8 | "Глянь що я постив в Тредс цього тижня" | Playwright → статистика постів |
| 9 | "Ось кейс клієнта" + аудіо | Транскрибує через Whisper → зберігає до бази кейсів |
| 10 | "Пов'яжи пост №5 з воронкою bot-sales-spin" | Додає deep-link до поста в плані |
| 11 | "Перепиши пост №3, зроби жорсткіше" | Редагує конкретний пост у плані |
| 12 | "Яка ланцюжок постів для прогріву під курс?" | Claude радить стратегію на основі правил |

---

## 3. Архітектура даних

### 3.1 Content Plan (структура файлу)

Зберігається як `BotFile` (вже існує в системі) з ключем:
```
content_plan_{platform}_{year}_{month}
```
Приклад: `content_plan_threads_2026_06`

**JSON-схема плану:**
```json
{
  "platform": "threads",
  "year": 2026,
  "month": 6,
  "strategy": "Прогрів під курс через болі + 2 прямі реклами в тижні",
  "posts": [
    {
      "id": "post_001",
      "date": "2026-06-02",
      "type": "single",
      "theme": "pain_point",
      "hook": "Ти ведеш бізнес 3 роки і досі не знаєш куди йдуть гроші?",
      "body": "Повний текст посту...",
      "cta": null,
      "funnelLink": null,
      "status": "draft",
      "metrics": null,
      "contentFunnel": null
    },
    {
      "id": "post_002",
      "date": "2026-06-04",
      "type": "thread",
      "threadParts": 3,
      "theme": "case_study",
      "hook": "Кейс: Марія збільшила прибуток на 40% за 2 місяці...",
      "body": ["Частина 1...", "Частина 2...", "Частина 3..."],
      "cta": "Пиши + у коментарях",
      "funnelLink": "https://t.me/den_fineko_bot?start=bot-sales-spin",
      "status": "draft",
      "metrics": null,
      "contentFunnel": "content-ai-bg"
    }
  ],
  "createdAt": "2026-05-28T10:00:00Z",
  "updatedAt": "2026-05-28T10:00:00Z"
}
```

**Типи постів:**
- `single` — один пост
- `thread` — ланцюжок (2–5 частин) + коментар з посиланням
- `story_poll` — сторі з голосуванням
- `reels_teaser` — короткий текст під reels
- `carousel_caption` — підпис під карусель

**Теми постів:**
- `pain_point` — болі клієнтів
- `case_study` — кейс
- `education` — корисний контент
- `promo_soft` — м'який продаж (анонс без тиску)
- `promo_hard` — пряма реклама курсу
- `personal` — особистий контент Олександра
- `social_proof` — відгуки / результати студентів

### 3.2 База кейсів

Ключ: `cases_database`

```json
{
  "cases": [
    {
      "id": "case_001",
      "clientName": "Марія К.",
      "industry": "роздрібна торгівля",
      "problem": "Не розуміла куди йдуть гроші, постійний касовий розрив",
      "solution": "Побудувала Cashflow таблицю, виявила 3 статті прихованих витрат",
      "result": "Зменшила витрати на 18%, прибуток +40% за 2 місяці",
      "quote": "Нарешті зрозуміла куди йдуть гроші!",
      "usedInPosts": ["post_2026_05_002"],
      "addedAt": "2026-05-15T10:00:00Z"
    }
  ]
}
```

### 3.3 Content Rules (правила контенту)

Ключ: `content_rules_{platform}`

```json
{
  "platform": "threads",
  "rules": {
    "tone": "Авторитетний але доступний, без занудства. На 'ти'.",
    "optimalPostLength": "150-300 символів для одного поста",
    "threadOptimal": "3 частини + коментар",
    "hookTypes": ["Питання-провокація", "Факт-шок", "Кейс-анонс", "Список"],
    "postingFrequency": "4-5 разів на тиждень",
    "bestTimes": ["08:00-09:00", "19:00-21:00"],
    "avoidTopics": ["Політика", "Конкурентна критика"],
    "ctaFormats": ["Пиши + у коментарях", "Зберігай 🔖", "Поділись якщо корисно"],
    "funnelRatio": "1 прямий продаж на кожні 4-5 освітніх пости"
  }
}
```

### 3.4 Catalog воронок (для лінкування)

Ключ: `funnels_catalog` (автоматично генерується з платформи)

```json
{
  "funnels": [
    {
      "slug": "bot-sales-spin",
      "name": "Продаж курсу (SPIN)",
      "deepLink": "https://t.me/den_fineko_bot?start=bot-sales-spin",
      "description": "Продажний бот курсу"
    },
    {
      "slug": "bot-course-finance",
      "name": "Бот-курс «Фінансова система»",
      "deepLink": "https://t.me/den_fineko_bot?start=bot-course-finance",
      "description": "Проходження курсу"
    }
  ]
}
```

---

## 4. Архітектура потоку

### 4.1 Загальна схема

```
/start
  │
  ▼
[msg_welcome]          ← Привітання + список команд
  │
  ▼
[claude: intent_router]  ← Класифікує намір, повертає JSON
  │
  ├─ intent: create_plan   → [sub_create_plan]
  ├─ intent: view_plan     → [sub_view_plan]
  ├─ intent: add_posts     → [sub_add_posts]
  ├─ intent: edit_post     → [sub_edit_post]
  ├─ intent: generate_content → [sub_generate_content]
  ├─ intent: check_social  → [sub_check_social]
  ├─ intent: add_case      → [sub_add_case]
  ├─ intent: transcribe    → [sub_transcribe]
  ├─ intent: link_funnel   → [sub_link_funnel]
  └─ intent: general       → [claude: general_chat]
```

### 4.2 Intent Classification Node

**Модель:** `claude-haiku-4-5` (швидко і дешево для класифікації)

**System prompt:**
```
Ти класифікатор намірів для content management бота. 
Поверни ТІЛЬКИ JSON без додаткового тексту.

JSON формат:
{
  "intent": "create_plan|view_plan|add_posts|edit_post|generate_content|check_social|add_case|transcribe|link_funnel|general",
  "platform": "threads|instagram|tiktok|youtube|all|null",
  "period": "YYYY_MM або null",
  "details": "коротке пояснення що хоче користувач"
}
```

### 4.3 Sub-flow: Create Plan

```
[load_previous_plans]     ← loadFile: останні 3 місяці для даної платформи
  │
[load_cases]              ← loadFile: cases_database
  │
[load_rules]              ← loadFile: content_rules_{platform}
  │
[load_funnels_catalog]    ← loadFile: funnels_catalog
  │
[check_social_optional]   ← httpRequest → Playwright мікросервіс (якщо доступний)
  │
[claude: strategy_dialog] ← Діалог зі збором пріоритетів місяця
  │                          Задає 3-4 питання, отримує відповіді
  │                          Пропонує теми, співвідношення типів
  │
[claude: generate_plan]   ← Генерує повний план на місяць (JSON)
  │
[msg_plan_preview]        ← Показує план у читабельному форматі
  │
[wait_confirmation]       ← "Зберегти? Або хочеш щось змінити?"
  │
[save_plan]               ← saveFile: content_plan_{platform}_{year}_{month}
  │
[msg_plan_saved]          ← "✅ План збережено. Ось що далі..."
```

### 4.4 Sub-flow: Generate Content

```
[js: parse_content_type]  ← Визначає яку воронку запускати
  │
[condition]
  ├─ ai-bg     → [http: POST /webhook/bot/content-ai-bg]
  ├─ carousel  → [http: POST /webhook/bot/content-carousel]
  ├─ avatar    → [http: POST /webhook/bot/content-avatar-budget]
  ├─ video     → [msg: "Завантаж відео у відповіді"]
  │              [wait_video_input]
  │              [http: POST /webhook/bot/content-video-basic-subs]
  └─ ...
  │
[msg: "⏳ Генеруємо..."]
[poll_job_status]         ← Перевіряє статус кожні 5 сек
  │
[deliver_result]          ← Надсилає готовий контент
```

### 4.5 Sub-flow: Transcribe Audio

```
[js: extract_voice_file_id]  ← Витягує file_id з Telegram update
  │
[http: GET Telegram file]    ← https://api.telegram.org/bot{TOKEN}/getFile
  │
[http: download file]        ← Завантажує OGG/MP3
  │
[http: POST fal.ai/whisper]  ← Транскрипція
  │
[js: parse_transcript]
  │
[condition: what_to_do]
  ├─ "зберегти як кейс" → [sub_add_case]
  ├─ "написати пост"    → [claude: voice_to_post]
  └─ default            → [msg: transcript_text]
```

---

## 5. Інтеграції

### 5.1 Threads — читання статистики

**❗ Вузьке місце #1 — найскладніше в проекті**

**Варіант A: Meta Threads API (рекомендовано для прод)**
- Threads має офіційний API (публічний з 2024)
- Permissions: `threads_basic`, `threads_manage_insights`
- Ендпоінт: `GET /{user-id}/threads?fields=id,text,timestamp,like_count,replies_count`
- **Проблема:** потрібен OAuth + App Review від Meta + тижні очікування
- **Статус:** Відкладаємо на Фазу 3

**Варіант B: Playwright мікросервіс (рекомендовано для старту)**
- Новий мікросервіс `playwright-scraper` на сервері
- POST `/scrape/threads` з `{ url, cookies }` → повертає posts + лайки
- **Проблема:** потрібні cookies (нестабільні, можуть протухнути)
- **Рішення:** Олександр раз на місяць оновлює cookies в налаштуваннях бота
- **Статус:** Реалізуємо в Фазі 2

**Варіант C: Ручне введення (Фаза 1)**
- Бот запитує: "Яку статистику з Тредс хочеш врахувати?"
- Олександр копіює-пастить топ пости вручну
- Claude аналізує і враховує при генерації плану

**→ Рекомендація для старту: Варіант C → потім B**

### 5.2 Audio Transcription

**Рішення:** fal.ai Whisper (`fal-ai/whisper`)
- Вже є інфраструктура (FAL_AI_KEY)
- POST `https://fal.run/fal-ai/whisper` з `{ audio_url, task: "transcribe", language: "uk" }`
- Підтримує `.ogg` (формат Telegram voice)
- Ціна: ~$0.01/хв

**Проблема:** Telegram voice → треба спочатку завантажити файл → потім відправити URL fal.ai
- Або upload через fal.ai storage API
- Або наш сервер як проміжний proxy

**→ Рекомендація:** Наш сервер як proxy (new endpoint: POST /api/transcribe-voice)

### 5.3 Content Funnels Integration

Бот запускає воронки через `POST /webhook/bot/{slug}` (вже реалізовано).

**Проблема #2 — polling результату:**  
Зараз воронки не вертають результат назад до бота. Є callback URL механізм, але бот має "чекати" на результат.

**Рішення:** 
- content.php вже використовує `POST callbackUrl` коли воронка готова
- Потрібно додати тип сесії "waiting_for_content_job" з `jobId` в контексті
- Коли callback приходить → resume сесії → надіслати результат

### 5.4 Funnels as Deep Links

**Всі активні воронки продажів і курсу:**

| Slug | Deep link | Призначення |
|------|-----------|-------------|
| `bot-sales-spin` | `t.me/den_fineko_bot?start=bot-sales-spin` | Продаж курсу |
| `bot-course-finance` | `t.me/den_fineko_bot?start=bot-course-finance` | Вхід в курс |
| `bot-1-1-onboarding` | `t.me/den_fineko_bot?start=bot-1-1-onboarding` | Онбординг |

---

## 6. Вузькі місця і відкриті питання

### ❓ Питання 1: Де зберігати стан "поточний місяць"?

Бот має пам'ятати: "зараз ми в режимі планування червня для Тредс". Варіанти:
- A. В контексті сесії (поточна сесія має `{ activePlan: "threads_2026_06" }`)
- B. В окремому BotFile `current_context`
- **Рекомендація: A** — контекст сесії, він завжди доступний

### ❓ Питання 2: Одна сесія чи нова щоразу?

Якщо бот тримає одну довгу сесію → він пам'ятає весь контекст розмови.  
Якщо нова щоразу → кожен раз /start, немає пам'яті.

**Рекомендація:** Одна довга сесія (повертаємось через continue session logic). Але сесія може "протухнути" по isActive. Треба додати механізм "resume" — якщо сесія older than 7 days → create new but load context from files.

### ❓ Питання 3: Як показувати контент-план в Telegram?

Telegram не підтримує таблиці. Варіанти:
- A. Текстовий список: `📅 2 червня — Пост про болі клієнтів\n"Ти ведеш бізнес..."`
- B. Inline keyboard: кожен пост — кнопка "редагувати"
- C. HTML `<pre>` для форматування

**Рекомендація:** Комбінація: стислий список з inline кнопками для редагування окремих постів.

### ❓ Питання 4: Multi-platform або по одній?

"Тредс і Інстаграм на червень" — генерувати разом чи окремо?

**Рекомендація:** Окремі файли, але бот може генерувати кілька за одну сесію. Репост-логіка: "Адаптувати Тредс-пост для Інстаграму?" → окрема операція.

### ❓ Питання 5: Де зберігати правила і кейси спочатку?

Потрібна "первинна ініціалізація" — заповнити бази. Варіанти:
- A. Через самого бота (Олександр диктує)
- B. Через admin UI на платформі
- C. Статичні файли в коді

**Рекомендація:** A — окремий режим `/init` або "setup" воронка де Олександр заповнює все голосом/текстом.

### ❓ Питання 6: Playwright мікросервіс — чи не зайве?

Якщо Threads API все одно треба, може краще одразу робити OAuth? Але це місяць роботи з Meta review.

**Рекомендація:** Playwright на старті (дні, не місяці). Cookies оновлюються раз на місяць.

### ❓ Питання 7: Voice-to-Content pipeline

Олександр каже голосом — бот пише пост. Але скільки правок потрібно? 
Чи має бот відразу зберігати в план, чи показувати для підтвердження?

**Рекомендація:** Завжди показувати для підтвердження перед збереженням.

---

## 7. Фази реалізації

### Фаза 1 — MVP (1-2 дні)
**Мета:** Працюючий бот для планування і генерації контенту

- [ ] Создати бот `content-manager` в проекті "Контент для соц.мереж"
- [ ] Стартове повідомлення
- [ ] Intent router (claude-haiku)
- [ ] Sub-flow: create_plan (без Playwright, ручна статистика)
- [ ] Sub-flow: view_plan
- [ ] Sub-flow: add_posts / edit_post
- [ ] Sub-flow: generate_content → запуск наявних воронок
- [ ] Sub-flow: general_chat
- [ ] Ініціалізація правил (content_rules_threads)
- [ ] Setup воронка для заповнення кейсів

### Фаза 2 — Audio + Playwright (3-5 днів)
- [ ] Endpoint POST /api/transcribe-voice (proxy для fal.ai Whisper)
- [ ] Sub-flow: transcribe
- [ ] Playwright мікросервіс (Threads scraping)
- [ ] Sub-flow: check_social
- [ ] Оновлення sub_create_plan з реальними даними

### Фаза 3 — Advanced (1-2 тижні)
- [ ] Threads API (OAuth + Meta App Review)
- [ ] Inline keyboard для редагування плану
- [ ] Callback mechanism для content funnels (очікування готового контенту)
- [ ] Multi-platform в одній сесії
- [ ] Analytics dashboard (що зайшло, що ні)

---

## 8. Технічний план нод (Фаза 1)

### Структура flow nodes:

```
start_1
  → msg_welcome
  → claude_intent_router        [haiku, max_turns:1, returns JSON]
  → js_parse_intent
  → condition_intent
      ├── create_plan → ...
      ├── view_plan   → js_load_plan → msg_show_plan
      ├── add_posts   → claude_add_posts → js_save_plan
      ├── edit_post   → claude_edit_post → js_save_plan
      ├── gen_content → js_pick_funnel → http_trigger_funnel → msg_queued
      └── general     → claude_general [sonnet, full context]
```

### Keys потрібні в боті:
- `ANTHROPIC_API_KEY` (спадкується або окремий)
- `TELEGRAM_BOT_TOKEN` (тот самий бот або окремий)
- `FAL_AI_KEY` (для Whisper в Фазі 2)

---

## 9. Відкриті рішення для обговорення

1. **Окремий Telegram бот чи той самий?**  
   Якщо окремий → окрема кнопка Start, чистий UX.  
   Якщо той самий (`den_fineko_bot`) → конфлікт з курсом.  
   **Рекомендую: окремий бот** (наприклад `@fineko_content_bot`)

2. **Як часто синхронізувати funnels_catalog?**  
   Автоматично при старті? Або ручний `/refresh`?

3. **Чи потрібні інші соцмережі в Фазі 1?**  
   Тільки Threads → потім Instagram → TikTok?

4. **Публічні кейси чи тільки анонімні?**  
   Як зберігати — з іменами чи знеособлено?

5. **Чи буде ще хтось крім Олександра користуватись цим ботом?**  
   Якщо так → потрібна авторизація по Telegram ID.
