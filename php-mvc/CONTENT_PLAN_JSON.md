# Формат JSON для імпорту контент-плану

Документ описує структуру JSON-файлу, який використовується для завантаження і вивантаження контент-планів через сторінку редагування соціальної мережі (**Завантажити контент-план**).

---

## Загальна структура

```json
{
  "categories": [ ... ],
  "posts": { ... }
}
```

| Ключ | Тип | Опис |
|------|-----|------|
| `categories` | array | Список рубрик/категорій, які використовуються в плані |
| `posts` | object | Пости, згруповані по датах та категоріях |

---

## Об'єкт категорії

```json
{
  "id": 1,
  "name": "Жива історія",
  "is_new": false,
  "client_type": "ТИП 1",
  "avatar_name": "Віктор",
  "avatar_description": "Підприємець 35 років, хоче систематизувати маркетинг"
}
```

| Поле | Тип | Обов'язкове | Опис |
|------|-----|-------------|------|
| `id` | int \| null | Ні | ID категорії в базі. `null` — якщо нова; при імпорті ігнорується — пошук ведеться за `name` |
| `name` | string | **Так** | Назва категорії. За нею система знаходить або створює категорію |
| `is_new` | bool | Ні | Підказка: `true` — новостворена під час експорту. При імпорті не впливає на логіку |
| `client_type` | string | Ні | Тип клієнта: `"ТИП 1"`, `"ТИП 2"`, `"ТИП 3"` або `""` |
| `avatar_name` | string | Ні | Ім'я аватара / персонажа для рубрики (напр. `"Аліна"`) |
| `avatar_description` | string | Ні | Короткий опис аватара (напр. `"Мама у декреті, веде онлайн-бізнес"`) |

> **Tip про типи клієнта:**
> - **ТИП 1** — «Теплий клієнт» — вже знайомий з темою, орієнтований на дії
> - **ТИП 2** — «Скептик» — сумнівається, потребує доказів і аргументів
> - **ТИП 3** — «Новачок» — тільки відкриває тему, потребує простого пояснення

---

## Об'єкт поста

Кожен пост — це або рядок (`string`), або об'єкт розширеного формату:

### Короткий формат (тільки текст)

```json
"Текст посту"
```

### Розширений формат

```json
{
  "text": "Текст посту",
  "post_type": "Карусель",
  "image_path": "",
  "image_type": "photo",
  "image_action": "auto_generate",
  "image_text": "Текст на зображенні",
  "image_prompt": "Prompt для генерації зображення"
}
```

| Поле | Тип | Опис |
|------|-----|------|
| `text` | string | Основний текст поста. Якщо порожній — пост пропускається при імпорті |
| `post_type` | string | Тип публікації: `"Карусель"`, `"Сторіз"`, `"Reels"`, `"Shorts"`, `"Thread"` або `""` (звичайний пост) |
| `image_path` | string | Шлях до вже готового зображення (відносний або порожній) |
| `image_type` | string | Тип зображення: `photo`, `illustration`, `banner`, `source_variation` |
| `image_action` | string | Дія зі зображенням (детальніше нижче) |
| `image_text` | string | Короткий текст, який накладається поверх зображення (для `overlay_text`) |
| `image_prompt` | string | Prompt для ШІ-генерації зображення |

### Значення `post_type`

| Значення | Опис |
|----------|------|
| `""` (порожньо) | Звичайний пост (за замовчуванням) |
| `Карусель` | Instagram/Facebook карусель — категорія об'єднує кілька кадрів |
| `Сторіз` | Stories — кожен пост у масиві це окремий слайд серії |
| `Reels` | Instagram Reels / TikTok — коротке відео |
| `Shorts` | YouTube Shorts |
| `Thread` | Threads / X (Twitter) — ланцюжок коротких постів |

### Значення `image_action`

| Значення | Опис |
|----------|------|
| `nothing` | Нічого не робити (за замовчуванням) |
| `auto_generate` | Автоматично згенерувати зображення за `image_prompt` |
| `overlay_text` | Накласти `image_text` поверх зображення |
| `generate_from_source_folder` | Взяти джерело з теки `source_images/` і обробити за `image_prompt` |

---

## Структура `posts`

```json
"posts": {
  "РРРР-ММ-ДД": {
    "Назва категорії": [
      { пост },
      { пост }
    ]
  }
}
```

- Ключ верхнього рівня — дата у форматі `YYYY-MM-DD`
- Ключ другого рівня — **точна назва категорії** (регістр не важливий при порівнянні)
- Значення — масив постів (від 1 до N)

> **Важливо:** При імпорті всі пости за датами, що є у файлі, **видаляються і замінюються** новими. Дати, яких немає у файлі, не зачіпаються.

---

## Приклади для різних форматів і соцмереж

---

### 1. Instagram Posts — стандартні пости

Кожна дата містить 1–3 звичайних пости в різних рубриках.

```json
{
  "categories": [
    {
      "id": 1,
      "name": "Кейс клієнта",
      "is_new": false,
      "client_type": "ТИП 1",
      "avatar_name": "Дмитро",
      "avatar_description": "Власник ресторану, вже 3 роки в бізнесі"
    },
    {
      "id": 2,
      "name": "Корисний лайфхак",
      "is_new": false,
      "client_type": "ТИП 3",
      "avatar_name": "Катя",
      "avatar_description": "Початківець у SMM, хоче навчитися швидко"
    }
  ],
  "posts": {
    "2026-03-02": {
      "Кейс клієнта": [
        {
          "text": "Як Дмитро збільшив виручку кафе на 40% за 2 місяці — без реклами.\n\nІсторія почалася з простого аудиту...",
          "post_type": "",
          "image_type": "photo",
          "image_action": "auto_generate",
          "image_prompt": "Cozy restaurant interior, warm lighting, happy guests, modern design"
        }
      ]
    },
    "2026-03-04": {
      "Корисний лайфхак": [
        {
          "text": "3 інструменти, які заощадять вам 5 годин на тиждень при веденні Instagram:\n\n1. Later\n2. Canva\n3. ChatGPT",
          "post_type": "",
          "image_type": "illustration",
          "image_action": "auto_generate",
          "image_prompt": "Flat design infographic: 3 productivity tools icons, clean minimal style"
        }
      ]
    }
  }
}
```

---

### 2. Instagram Stories — серія слайдів на день

**Концепція:** Кожна категорія — це окрема серія сторіз (тема або рубрика). Кожен пост у масиві — **один слайд** цієї серії. Система зберігає слайди як окремі пости з однаковою датою і категорією, боти/автопостинг можуть їх опублікувати послідовно.

```json
{
  "categories": [
    {
      "id": 1,
      "name": "Сторіз понеділка",
      "is_new": false,
      "client_type": "ТИП 2",
      "avatar_name": "Олег",
      "avatar_description": "Скептично налаштований підприємець, чекає доказів"
    },
    {
      "id": 2,
      "name": "Сторіз п'ятниці",
      "is_new": false,
      "client_type": "ТИП 1",
      "avatar_name": "",
      "avatar_description": ""
    }
  ],
  "posts": {
    "2026-03-02": {
      "Сторіз понеділка": [
        {
          "text": "Слайд 1 / 5\nЯк ми готуємося до нового тижня 🗓️",
          "post_type": "Сторіз",
          "image_type": "photo",
          "image_action": "overlay_text",
          "image_text": "Тиждень старт!",
          "image_prompt": "Minimalist workspace flat lay, notebook, coffee, morning light"
        },
        {
          "text": "Слайд 2 / 5\nТри завдання на цей тиждень:",
          "post_type": "Сторіз",
          "image_type": "illustration",
          "image_action": "auto_generate",
          "image_prompt": "Clean checklist illustration, bold icons, white background"
        },
        {
          "text": "Слайд 3 / 5\nЗавдання 1: Закрити 2 угоди",
          "post_type": "Сторіз",
          "image_type": "banner",
          "image_action": "overlay_text",
          "image_text": "Мета 1",
          "image_prompt": ""
        },
        {
          "text": "Слайд 4 / 5\nЗавдання 2: Запустити новий продукт",
          "post_type": "Сторіз",
          "image_type": "banner",
          "image_action": "overlay_text",
          "image_text": "Мета 2",
          "image_prompt": ""
        },
        {
          "text": "Слайд 5 / 5\nПишіть у Direct — розповім як це зробити і у вас 💬",
          "post_type": "Сторіз",
          "image_type": "photo",
          "image_action": "auto_generate",
          "image_prompt": "Person typing on phone, soft blurred background, call to action mood"
        }
      ]
    },
    "2026-03-06": {
      "Сторіз п'ятниці": [
        {
          "text": "П'ятниця! Підсумок тижня 🔥",
          "post_type": "Сторіз",
          "image_type": "photo",
          "image_action": "overlay_text",
          "image_text": "Тиждень = ✅",
          "image_prompt": ""
        },
        {
          "text": "Що вдалося: +2 нових клієнти, успішний запуск продукту",
          "post_type": "Сторіз",
          "image_type": "illustration",
          "image_action": "auto_generate",
          "image_prompt": "Success celebration illustration, confetti, minimal flat style"
        },
        {
          "text": "На наступний тиждень ставлю ще більшу планку. А ви? 👇",
          "post_type": "Сторіз",
          "image_type": "photo",
          "image_action": "nothing",
          "image_text": "",
          "image_prompt": ""
        }
      ]
    }
  }
}
```

> **Порада:** Для серій сторіз зручно нумерувати слайди в тексті (`Слайд 1 / 5`, `Слайд 2 / 5`), щоб при плануванні відразу бачити послідовність.

---

### 3. Instagram Carousel — карусель

**Концепція:** Кожна категорія — це **упаковка** для однієї каруселі. Кожен пост у масиві — **один кадр** (картинка) каруселі. Перший пост — відкривний слайд (обкладинка), решта — сторінки або діалог з аудиторією.

```json
{
  "categories": [
    {
      "id": 1,
      "name": "Карусель: помилки новачків",
      "is_new": false,
      "client_type": "ТИП 3",
      "avatar_name": "Маша",
      "avatar_description": "Починає власний онлайн-бізнес, робить перші кроки"
    },
    {
      "id": 2,
      "name": "Карусель: інструкція крок за кроком",
      "is_new": false,
      "client_type": "ТИП 1",
      "avatar_name": "Ігор",
      "avatar_description": "Досвідчений SMM, хоче прискорити процеси"
    }
  ],
  "posts": {
    "2026-03-03": {
      "Карусель: помилки новачків": [
        {
          "text": "5 помилок, які роблять усі новачки в Instagram\n\n👉 Гортай далі →",
          "post_type": "Карусель",
          "image_type": "banner",
          "image_action": "auto_generate",
          "image_prompt": "Eye-catching carousel cover, bold text block, gradient background, modern typography"
        },
        {
          "text": "Помилка 1:\nПостять без стратегії — просто «щоб щось було»",
          "post_type": "Карусель",
          "image_type": "illustration",
          "image_action": "auto_generate",
          "image_prompt": "Flat design: confused person with random posts, minimal icons"
        },
        {
          "text": "Помилка 2:\nІгнорують аналітику. Без цифр — немає росту.",
          "post_type": "Карусель",
          "image_type": "illustration",
          "image_action": "auto_generate",
          "image_prompt": "Flat design: analytics dashboard ignored, graphs in background, minimal"
        },
        {
          "text": "Помилка 3:\nНемає заклику до дії. Люди хочуть, але не знають що робити.",
          "post_type": "Карусель",
          "image_type": "illustration",
          "image_action": "auto_generate",
          "image_prompt": "Flat design: CTA button illustration, arrow pointing, clean background"
        },
        {
          "text": "Помилка 4:\nНе відповідають на коментарі. Алгоритм за це карає.",
          "post_type": "Карусель",
          "image_type": "illustration",
          "image_action": "auto_generate",
          "image_prompt": "Flat design: chat bubbles ignored, algorithm robot watching, minimal"
        },
        {
          "text": "Помилка 5:\nМіняють стиль кожні 2 тижні. Аудиторія не встигає запам'ятати.",
          "post_type": "Карусель",
          "image_type": "illustration",
          "image_action": "auto_generate",
          "image_prompt": "Flat design: chameleon changing colors representing inconsistent brand identity"
        },
        {
          "text": "Збережи цей пост — щоб не повторити.\nЯка помилка у тебе була? Пиши в коментарях 👇",
          "post_type": "Карусель",
          "image_type": "banner",
          "image_action": "auto_generate",
          "image_prompt": "Closing carousel slide: save icon, warm CTA colors, friendly tone"
        }
      ]
    },
    "2026-03-10": {
      "Карусель: інструкція крок за кроком": [
        {
          "text": "Як скласти контент-план за 30 хвилин\n\n→ Покрокова інструкція",
          "post_type": "Карусель",
          "image_type": "banner",
          "image_action": "auto_generate",
          "image_prompt": "Bold cover design: stopwatch + content planning concept, clean style"
        },
        {
          "text": "Крок 1: Визнач 3–5 рубрик (категорії, які будеш чергувати)",
          "post_type": "Карусель",
          "image_type": "illustration",
          "image_action": "auto_generate",
          "image_prompt": "Step 1: categories/folders icons, numbered layout, minimal flat design"
        },
        {
          "text": "Крок 2: Заповни календар датами — де посту немає, постав нагадування",
          "post_type": "Карусель",
          "image_type": "illustration",
          "image_action": "auto_generate",
          "image_prompt": "Step 2: calendar grid with colored dots for content categories"
        },
        {
          "text": "Крок 3: Для кожного посту напиши 1 речення — про що він",
          "post_type": "Карусель",
          "image_type": "illustration",
          "image_action": "auto_generate",
          "image_prompt": "Step 3: writing one sentence, pen and paper, minimal icons"
        },
        {
          "text": "Крок 4: Скористайся шаблоном prompt для ШІ — і текст готовий за 5 хвилин",
          "post_type": "Карусель",
          "image_type": "illustration",
          "image_action": "auto_generate",
          "image_prompt": "Step 4: AI robot writing text, chat interface, clean illustration"
        },
        {
          "text": "Збережи і поділись з другом, якому це потрібно 💙\nЩо у тебе займає найбільше часу в плануванні?",
          "post_type": "Карусель",
          "image_type": "banner",
          "image_action": "auto_generate",
          "image_prompt": "Closing slide: share and save CTA, warm gradient, friendly style"
        }
      ]
    }
  }
}
```

> **Порада:** Перший пост у масиві — обкладинка каруселі (cover). Останній — фінальний слайд із закликом до дії (CTA). Решта — змістовні сторінки.

---

### 4. Threads / Twitter — декілька постів за день

Для Threads або X (Twitter) зручно публікувати кілька коротких постів за день у різних рубриках:

```json
{
  "categories": [
    {
      "id": 1,
      "name": "Думка дня",
      "is_new": false,
      "client_type": "ТИП 2",
      "avatar_name": "Андрій",
      "avatar_description": "Аналітик, цінує факти і логіку"
    },
    {
      "id": 2,
      "name": "Мікро-порада",
      "is_new": false,
      "client_type": "ТИП 1",
      "avatar_name": "",
      "avatar_description": ""
    }
  ],
  "posts": {
    "2026-03-05": {
      "Думка дня": [
        {
          "text": "Стратегія без тактики — це мрія. Тактика без стратегії — це хаос.\n\nВибирайте обидві.",
          "post_type": "Thread",
          "image_action": "nothing"
        }
      ],
      "Мікро-порада": [
        {
          "text": "Перед тим як писати пост — дайте відповідь на одне питання:\n«Що людина зробить після прочитання?»",
          "post_type": "Thread",
          "image_action": "nothing"
        },
        {
          "text": "Якщо відповіді немає — текст треба переписати.",
          "post_type": "Thread",
          "image_action": "nothing"
        }
      ]
    }
  }
}
```

---

### 5. YouTube Shorts / TikTok / Reels — сценарії

Для короткого відео зручно зберігати не готовий текст, а **сценарій** поста:

```json
{
  "categories": [
    {
      "id": 1,
      "name": "Лайфхак (Shorts)",
      "is_new": false,
      "client_type": "ТИП 3",
      "avatar_name": "Саша",
      "avatar_description": "21 рік, студент, хоче монетизувати знання"
    }
  ],
  "posts": {
    "2026-03-07": {
      "Лайфхак (Shorts)": [
        {
          "text": "[ГАЧОК] Ти витрачаєш 2 години на те, що можна автоматизувати за 10 хвилин.\n[ПРОБЛЕМА] Більшість людей не знають про цей інструмент.\n[РІШЕННЯ] Покажу три кроки прямо зараз.\n[ЗАКЛИК ДО ДІЇ] Підписуйся щоб не пропустити наступний лайфхак.",
          "post_type": "Shorts",
          "image_type": "source_variation",
          "image_action": "generate_from_source_folder",
          "image_prompt": "Short video thumbnail: bold text overlay, high contrast, viral YouTube style"
        }
      ]
    }
  }
}
```

> **Порада:** Для Shorts/Reels/TikTok корисно структурувати текст по блоках через `[ГАЧОК]`, `[ПРОБЛЕМА]`, `[РІШЕННЯ]`, `[ЗАКЛИК ДО ДІЇ]` — це спрощує роботу ШІ і полегшує перевірку плану очима.

---

## Правила імпорту

1. **Категорії ідентифікуються за назвою** (не за `id`). Якщо категорія з такою назвою вже є — оновлюються її `client_type`, `avatar_name`, `avatar_description`. Якщо нема — створюється нова.

2. **Пости за датами замінюються повністю.** Для кожної дати, що є у файлі, старі пости цієї соцмережі видаляються і записуються нові. Дати поза файлом залишаються без змін.

3. **Порожній `text`** — пост пропускається (не імпортується).

4. **Короткий рядковий формат** (`"Просто текст поста"`) еквівалентний розширеному з `image_action: "nothing"` та порожніми полями зображення.

5. **Поля категорій** `client_type`, `avatar_name`, `avatar_description` — необов'язкові; якщо відсутні у файлі, залишаються як є в базі (або порожніми для нових).

---

## Шаблон для передачі ШІ

Якщо хочете доручити заповнення контент-плану ChatGPT або іншому ШІ — дайте йому цей шаблон і поясніть правила вище:

```
Заповни контент-план у форматі JSON для соцмережі [назва].
Період: з [дата] по [дата].
Частота: [кількість постів на тиждень / день].

Категорії:
- [назва категорії] (тип клієнта: ТИП 1/2/3, аватар: [ім'я і опис])

Формат відповіді — суворо JSON:
{
  "categories": [ { "name": "...", "client_type": "...", "avatar_name": "...", "avatar_description": "..." } ],
  "posts": {
    "РРРР-ММ-ДД": {
      "Назва категорії": [
        { "text": "...", "post_type": "...", "image_type": "photo", "image_action": "auto_generate", "image_prompt": "..." }
      ]
    }
  }
}

Вимоги:
- text не може бути порожнім
- post_type: "" | "Карусель" | "Сторіз" | "Reels" | "Shorts" | "Thread"
- image_action: "nothing" | "auto_generate" | "overlay_text" | "generate_from_source_folder"
- image_type: "photo" | "illustration" | "banner" | "source_variation"
- image_prompt — англійською, описує зображення для ШІ-генерації
```
