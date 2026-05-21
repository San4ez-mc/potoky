# Мікросервіс 2: Slide Builder

## Призначення

HTTP-сервіс для рендерингу HTML-шаблонів у PNG через Puppeteer (headless Chromium).
Використовується у воронках:
- **content-stories-generator** — фінальний слайд (брендований пост/stories)
- **content-carousel** — широке панорамне полотно для каруселі, яке потім ріжеться на слайди
- **content-resizer** — обкладинка (thumbnail + заголовок)

Замінює: `js`-ноди з inline Puppeteer-кодом у воронках.

---

## Технічний стек

- **Runtime**: Node.js 20 + Express
- **Rendering**: `puppeteer` (headless Chrome, chromium-bundled)
- **Шаблони**: HTML + CSS (вбудовані в сервіс, параметризовані через data-атрибути / URL-параметри)
- **Port**: `3002`
- **Деплой**: VPS, поруч з основною платформою

---

## API Endpoints

### POST /render/story

Рендерить брендований пост/stories (1080×1350) для Instagram.

**Request:**
```json
{
  "title": "Як зекономити 10 годин на тиждень автоматизуючи процеси",
  "subtitle": "Читай далі →",
  "brandHandle": "@mybusiness",
  "backgroundImageUrl": "https://...bg.png",     // фоновий AI-генерований фон
  "silhouetteImageUrl": "https://...sil.png",    // PNG без фону (силует)
  "brandColor": "#6C63FF",
  "accentColor": "#FFFFFF",
  "template": "default"                           // default | minimal | bold | dark
}
```

**Response:** `Content-Type: image/png` — 1080×1350 PNG

---

### POST /render/panorama

Рендерить широке полотно для каруселі (N слайдів × 1080 шириною, висота 1350).
Потім нарізається на N кадрів через `sharp` (або вбудований endpoint `/slice`).

**Request:**
```json
{
  "slides": [
    {
      "title": "Заголовок слайду 1",
      "body": "Короткий текст або буллети",
      "imageUrl": "https://...sil1.png"          // опційно
    },
    {
      "title": "Заголовок слайду 2",
      "body": "Другий слайд"
    }
  ],
  "brandColor": "#6C63FF",
  "accentColor": "#FFDD57",
  "brandHandle": "@mybusiness",
  "template": "carousel-default",
  "slideWidth": 1080,
  "slideHeight": 1350
}
```

**Response:** `Content-Type: image/png` — PNG шириною `slideWidth × N`, висота `slideHeight`

---

### POST /render/cover

Генерує обкладинку для Reels/Shorts: скріншот кадру + заголовок поверх.

**Request:**
```json
{
  "thumbnailUrl": "https://...frame.png",        // або thumbnailBase64
  "title": "Як я автоматизував 80% рутини",
  "subtitle": "Дивись до кінця",
  "style": {
    "titleFontSize": 72,
    "titleColor": "#FFFFFF",
    "titlePosition": "bottom",                   // top | center | bottom
    "overlayOpacity": 0.5,                       // темна підложка під текст
    "brandHandle": "@mybusiness"
  }
}
```

**Response:** `Content-Type: image/png` — 1080×1350 або 1080×1920 (залежно від thumbnailUrl)

---

### POST /slice

Нарізає широкий PNG на N рівних частин по ширині. Відповідь — ZIP з файлами.

**Request:**
```json
{
  "imageUrl": "https://...panorama.png",         // або imageBase64
  "sliceCount": 5,                               // кількість слайдів
  "slideWidth": 1080,
  "slideHeight": 1350
}
```

**Response:** `Content-Type: application/zip` — архів `slide-1.png`, `slide-2.png`, ...
або масив base64:
```json
{
  "slides": ["data:image/png;base64,...", "..."]
}
```

---

## Конфігурація (env)

```
PORT=3002
CHROMIUM_PATH=                     # якщо потрібно вказати кастомний chromium
MAX_SLIDES=10
SLIDE_WIDTH=1080
SLIDE_HEIGHT=1350
PUPPETEER_TIMEOUT_MS=30000
```

---

## Шаблони

Шаблони — це HTML-файли всередині сервісу (`src/templates/`). Параметри передаються через JS-контекст при рендері (`page.evaluate()`).

```
src/templates/
├── story/
│   ├── default.html       # Класичний branded story з великим заголовком
│   ├── minimal.html       # Мінімалістичний, лише текст і силует
│   ├── bold.html          # Bold typography, яскраві кольори
│   └── dark.html          # Темний фон, неонові акценти
├── carousel/
│   └── carousel-default.html  # Широке полотно, N слайдів в ряд
└── cover/
    └── cover-default.html     # Обкладинка для Reels
```

Кожен шаблон отримує JSON з даними через `window.__SLIDE_DATA__` і рендериться при відкритті.

---

## Обробка помилок

| Код | Опис |
|-----|------|
| 400 | Неповні дані (не передано title або slides) |
| 408 | Puppeteer timeout (> PUPPETEER_TIMEOUT_MS) |
| 500 | Chrome crash або помилка рендерингу |

---

## Воронки, що звертаються до цього сервісу

| Воронка | Ендпоінт | Що робить |
|---------|----------|-----------|
| content-stories-generator | `/render/story` | Фінальний branded слайд |
| content-carousel | `/render/panorama` + `/slice` | Широке полотно + нарізка |
| content-resizer | `/render/cover` | Обкладинка для Reels |

**URL сервісу в воронці:** `http://localhost:3002`

---

## Структура файлів проекту

```
мікросервіси/slide-builder/
├── src/
│   ├── index.js
│   ├── routes/
│   │   ├── story.js
│   │   ├── panorama.js
│   │   ├── cover.js
│   │   └── slice.js
│   ├── services/
│   │   ├── puppeteerPool.js   # пул браузерів (до 3 паралельних)
│   │   └── slicer.js          # sharp-based nарізка panorama → slides
│   └── templates/
│       ├── story/
│       ├── carousel/
│       └── cover/
├── package.json
└── Dockerfile
```

---

## Залежності (package.json)

```json
{
  "dependencies": {
    "express": "^4.18",
    "puppeteer": "^22",
    "sharp": "^0.33",
    "archiver": "^6",
    "axios": "^1.6",
    "uuid": "^9"
  }
}
```

---

## Важливі нюанси

- **Puppeteer pool**: не запускати новий Chrome на кожен запит — тримати пул з 2-3 браузерів, щоб уникнути memory leaks і повільного старту.
- **Шрифти**: включити в Docker-образ системні шрифти (Noto Sans Ukrainian, Montserrat, Inter) через `apt-get install fonts-*`.
- **Chromium в Docker**: використати `puppeteer/chromium` або офіційний Docker-образ `ghcr.io/puppeteer/puppeteer`.
- **Timeout**: великі каруселі (10 слайдів) можуть рендеритися 5-10с — timeout 30с.
