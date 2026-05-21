# Мікросервіс 1: Image Processor

## Призначення

HTTP-сервіс для обробки зображень. Використовується у воронках:
- **content-stories-generator** — видалення фону + композитинг слайду
- **content-carousel** — видалення фону для силуету + накладання тексту

Замінює: `@imgly/background-removal-node` (in-process), ручний Puppeteer-композитинг у `js`-нодах.

---

## Технічний стек

- **Runtime**: Node.js 20 + Express
- **Background removal**: `@imgly/background-removal-node` (onnxruntime-node backend)
- **Image composition**: `sharp` (libvips)
- **Text rendering**: `sharp` + SVG overlay (без Puppeteer, чисто векторно)
- **Port**: `3001`
- **Деплой**: VPS, поруч з основною платформою

---

## API Endpoints

### POST /remove-bg

Видаляє фон з зображення, повертає PNG із прозорістю.

**Request:**
```json
{
  "imageUrl": "https://...",       // або
  "imageBase64": "data:image/jpeg;base64,...",
  "outputFormat": "png"            // завжди png (прозорість)
}
```

**Response:** `Content-Type: image/png` — бінарний PNG, або:
```json
{ "url": "https://cdn.your-domain.com/result-uuid.png" }
```

---

### POST /overlay-text

Накладає текст (заголовок, підпис) на зображення з кастомним стилем.

**Request:**
```json
{
  "imageUrl": "https://...",
  "text": "Як зекономити 10 годин на тиждень",
  "style": {
    "fontFamily": "Inter",          // Inter, Roboto, Montserrat (вбудовані)
    "fontSize": 64,
    "fontWeight": "bold",
    "color": "#FFFFFF",
    "shadowColor": "#000000",
    "shadowBlur": 8,
    "position": "bottom-center",    // top-left | center | bottom-center | custom
    "paddingX": 60,
    "paddingY": 80,
    "maxWidth": 960,                // px, для wrap
    "lineHeight": 1.3,
    "background": {                 // напівпрозора підложка під текст (опційно)
      "color": "#00000080",
      "borderRadius": 12,
      "paddingX": 24,
      "paddingY": 12
    }
  }
}
```

**Response:** `Content-Type: image/png`

---

### POST /compose

Збирає фінальне зображення: фон + силует (PNG з прозорістю) + текстові блоки.
Основна операція для stories/постів.

**Request:**
```json
{
  "width": 1080,
  "height": 1350,
  "layers": [
    {
      "type": "color",
      "color": "#1A1A2E"            // суцільний фон
    },
    {
      "type": "image",
      "url": "https://...bg.png",   // або imageBase64
      "fit": "cover",               // cover | contain | fill
      "opacity": 1.0
    },
    {
      "type": "image",
      "url": "https://...silhouette.png",
      "position": { "x": "center", "y": "bottom" },
      "width": 800
    },
    {
      "type": "text",
      "text": "Заголовок слайду",
      "style": { "fontSize": 72, "color": "#FFFFFF", "fontWeight": "bold" },
      "position": { "x": "center", "y": 120 }
    },
    {
      "type": "text",
      "text": "@brand_handle",
      "style": { "fontSize": 32, "color": "#FFFFFF80" },
      "position": { "x": "center", "y": 1280 }
    }
  ]
}
```

**Response:** `Content-Type: image/png`

---

### POST /resize

Ресайз + кроп зображення під потрібний формат.

**Request:**
```json
{
  "imageUrl": "https://...",
  "width": 1080,
  "height": 1080,
  "fit": "cover",      // cover | contain | fill | inside | outside
  "format": "png"      // png | jpeg | webp
}
```

**Response:** бінарний файл відповідного формату

---

## Конфігурація (env)

```
PORT=3001
MAX_IMAGE_SIZE_MB=20
UPLOAD_TEMP_DIR=/tmp/image-processor
CDN_UPLOAD_ENABLED=false         # якщо true — повертає URL замість бінарника
R2_ACCOUNT_ID=
R2_API_TOKEN=
R2_BUCKET=
R2_PUBLIC_URL=
```

---

## Обробка помилок

| Код | Опис |
|-----|------|
| 400 | Не передано imageUrl або imageBase64 |
| 413 | Зображення перевищує MAX_IMAGE_SIZE_MB |
| 422 | Не вдалося розпарсити зображення |
| 500 | Помилка обробки (onnxruntime / sharp) |

Формат помилки:
```json
{ "error": "human-readable message", "code": "BG_REMOVAL_FAILED" }
```

---

## Воронки, що звертаються до цього сервісу

| Воронка | Ендпоінт | Нода в воронці |
|---------|----------|----------------|
| content-stories-generator | `/remove-bg` + `/compose` | `ai-stylize`, `bg-removal`, `slide-builder` |
| content-carousel | `/remove-bg` + `/compose` | `ai-photo` |
| content-resizer | `/overlay-text` | `cover-constructor` |

**URL сервісу в воронці:** `http://localhost:3001` (або `http://image-processor:3001` в docker-compose)

---

## Структура файлів проекту

```
мікросервіси/image-processor/
├── src/
│   ├── index.js           # Express app + маршрути
│   ├── routes/
│   │   ├── removeBg.js
│   │   ├── overlayText.js
│   │   ├── compose.js
│   │   └── resize.js
│   ├── services/
│   │   ├── bgRemoval.js   # @imgly/background-removal-node wrapper
│   │   ├── compositor.js  # sharp compositing pipeline
│   │   └── svgText.js     # SVG-based text rendering
│   └── utils/
│       ├── fetchImage.js  # завантаження imageUrl → Buffer
│       └── upload.js      # опційний R2 upload
├── fonts/                 # Inter, Montserrat (woff2 → не потрібні, sharp SVG використовує системні)
├── package.json
└── Dockerfile
```

---

## Залежності (package.json)

```json
{
  "dependencies": {
    "express": "^4.18",
    "sharp": "^0.33",
    "@imgly/background-removal-node": "^1.4",
    "axios": "^1.6",
    "uuid": "^9"
  }
}
```

---

## Приклад виклику з ноди воронки (httpRequest)

```json
{
  "method": "POST",
  "url": "http://localhost:3001/remove-bg",
  "headers": { "Content-Type": "application/json" },
  "body": {
    "imageUrl": "{{context.stylizedPhotoUrl}}"
  },
  "responseType": "base64",
  "outputVar": "context.silhouetteBase64"
}
```
