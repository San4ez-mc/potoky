# Архітектура системи генерації контенту

**Платформа:** content.fineko.space/content  
**Воронки:** flows.fineko.space  
**Дата:** 2026-05-24

---

## Огляд мікросервісів

| Сервіс | Домен | Порт | Призначення |
|--------|-------|------|-------------|
| image-processor | img.flows.fineko.space | 3101 | Видалення фону (remove-bg), compose, resize |
| slide-builder | slides.flows.fineko.space | 3002 | Puppeteer → PNG: story, panorama, cover |
| video-processor | video.flows.fineko.space | 3003 | FFmpeg: extract-audio, smart-cut, burn-subs |
| remotion-renderer | remotion.flows.fineko.space | 3004 | Remotion: karaoke субтитри |
| hyperframes | hyperframes.flows.fineko.space | 3005 | Відео-шаблони: список тез, bar chart |

---

## Усі типи контенту та їх воронки

### 🖼️ ЗОБРАЖЕННЯ (8 типів)

| ID | Назва | Стиль | Формат | Розмір | Воронка | Шаблон slide-builder | Статус |
|----|-------|-------|--------|--------|---------|---------------------|--------|
| I-1 | Фото + силует + плашки | admaksmedia | Сторіз 9:16 | 1080×1920 | content-stories-generator | `default` | ✅ Готово |
| I-2 | Фото + силует + плашки | admaksmedia | Пост 4:5 | 1080×1350 | content-stories-generator | `default` (size=post) | 🔧 Потрібен size-param |
| I-3 | Solid фон + великий текст | minimalist | Сторіз 9:16 | 1080×1920 | content-stories-generator | `dark` або `minimal` | 🔍 Перевірити шаблон |
| I-4 | Solid фон + великий текст | minimalist | Пост 1:1 | 1080×1080 | content-stories-generator | `dark` (size=square) | 🔧 Потрібен size-param |
| I-5 | Фото фон + текстові плашки | kors.danil | Сторіз 9:16 | 1080×1920 | content-stories-generator | `kors` | 🏗️ Новий шаблон |
| I-6 | Соціальний доказ | kors.danil | Сторіз 9:16 | 1080×1920 | content-stories-generator | `social-proof` | 🏗️ Новий шаблон |
| I-7 | Рекламний / Анонс події | promo | Сторіз 9:16 | 1080×1920 | content-stories-generator | `promo` | 🏗️ Новий шаблон |
| I-8 | Карусель з безшовним фоном | seamless | Пост 4:5 × N | 1080×1350 | content-carousel | `carousel-default` | ✅ Готово |

### 📹 ВІДЕО (7 типів)

| ID | Назва | Формат | Розмір | Воронка | Статус |
|----|-------|--------|--------|---------|--------|
| V-1 | Рілс: Список тез (animated) | Рілс 9:16 | 1080×1920 | HyperFrames `social-reel` | ✅ Готово |
| V-2 | Рілс: Bar Chart (animated) | Рілс 9:16 | 1080×1920 | HyperFrames `data-chart` | ✅ Готово |
| V-3 | Рілс: Монтаж + статичні субтитри | Рілс 9:16 | 1080×1920 | content-video-basic-subs | ✅ Готово |
| V-4 | Рілс: Монтаж + karaoke субтитри | Рілс 9:16 | 1080×1920 | content-video-remotion | ✅ Готово |
| V-5 | Talking Head: HeyGen аватар | Рілс 9:16 | 1080×1920 | content-avatar-heygen | ✅ Готово |
| V-6 | Talking Head: Бюджетний аватар | Рілс 9:16 | 1080×1920 | content-avatar-budget | ✅ Готово |
| V-7 | Ресайзер форматів (адаптер) | Multi | varies | content-resizer | ✅ Готово |

---

## Детальна карта потоків

### I-1 / I-2: Фото + силует + плашки

```
content-platform
  → POST flows.fineko.space/webhook/bot/content-stories-generator
    { postId, photoUrl, text, subText, brandHandle, template, size, callbackUrl }
  → img.flows.fineko.space/remove-bg   (силует PNG base64)
  → slides.flows.fineko.space/render/story
    { title, subtitle, brandHandle, silhouetteImageUrl, template, size }
  → POST callbackUrl
    { postId, status, mediaType:"image", imageBase64, contentType:"image/png" }
```

**Параметри для size:**
- `size=story` → 1080×1920
- `size=post` → 1080×1350
- `size=square` → 1080×1080

### I-8: Карусель

```
content-platform
  → POST flows.fineko.space/webhook/bot/content-carousel
    { postId, photoUrl, slides:[{text,subText}], brandHandle, template, callbackUrl }
  → img.flows.fineko.space/remove-bg   (силует PNG base64)
  → slides.flows.fineko.space/render/panorama  (широке полотно N×1080×1350)
  → slides.flows.fineko.space/slice    (N окремих слайдів base64[])
  → POST callbackUrl
    { postId, status, mediaType:"carousel", slidesBase64:[], contentType:"image/png" }
```

### V-1 / V-2: HyperFrames (Рілс тез / Bar Chart)

```
content-platform
  → POST hyperframes.flows.fineko.space/render/template
    { template:"social-reel"|"data-chart", data:{...}, quality:"high", fps:30 }
  → (синхронно, до 60с)
  → { videoUrl или videoBase64 }
```

*Примітка: HyperFrames синхронний, не потребує callback.*

### V-3: Монтаж + базові субтитри

```
content-platform
  → POST flows.fineko.space/webhook/bot/content-video-basic-subs
    { postId, videoUrl, script, callbackUrl }
  → video.flows.fineko.space/extract-audio
  → Whisper API (транскрипція + тайм-коди)
  → video.flows.fineko.space/smart-cut  (видалення пауз)
  → video.flows.fineko.space/burn-subtitles (SRT → hardcoded)
  → POST callbackUrl { postId, status, videoUrl }
```

### V-4: Karaoke субтитри

```
content-platform
  → POST flows.fineko.space/webhook/bot/content-video-remotion
    { postId, videoUrl, callbackUrl }
  → video.flows.fineko.space/extract-audio
  → Whisper API (слово-за-словом тайм-коди)
  → video.flows.fineko.space/smart-cut
  → remotion.flows.fineko.space/render  (karaoke animation)
  → POST callbackUrl { postId, status, videoUrl }
```

### V-5: HeyGen Talking Head

```
content-platform
  → POST flows.fineko.space/webhook/bot/content-avatar-heygen
    { postId, script, callbackUrl }
  → HeyGen API (create video → polling)
  → POST callbackUrl { postId, status, videoUrl }
```

### V-6: Бюджетний Talking Head

```
content-platform
  → POST flows.fineko.space/webhook/bot/content-avatar-budget
    { postId, script, photoUrl, callbackUrl }
  → ElevenLabs API (text → audio)
  → LivePortrait API (photo + audio → video)
  → POST callbackUrl { postId, status, videoUrl }
```

---

## Callback-система на content.fineko.space

### Ендпоінти (потрібно додати)

```
POST /api/content-callback   — приймає результат від воронки
GET  /api/content-status     — polling статусу (?jobId=xxx)
```

### Схема статусів

```
pending  → processing → done
                     → error
```

### Зберігання (PHP session або JSON-файл)

```php
// /tmp/content_jobs/{jobId}.json
{
  "jobId": "uuid",
  "status": "done",
  "mediaType": "image",   // image | carousel | video
  "imageBase64": "...",   // для зображень
  "slidesBase64": [...],  // для каруселі
  "videoUrl": "...",      // для відео
  "error": null,
  "createdAt": 1716500000,
  "updatedAt": 1716500030
}
```

---

## Шаблони slide-builder

### Існуючі (за документацією)

```
src/templates/
├── story/
│   ├── default.html   — branded story: фото-силует + плашки з текстом
│   ├── minimal.html   — тільки текст, без фото
│   ├── bold.html      — великий шрифт, яскраві кольори
│   └── dark.html      — темний фон, текст + мінімум графіки
├── carousel/
│   └── carousel-default.html
└── cover/
    └── cover-default.html
```

### Нові шаблони (потрібно створити)

| Шаблон | Опис | Схожий на |
|--------|------|-----------|
| `kors` | Темна/ніч. фото як фон + напівпрозорі плашки з текстом | kors.danil |
| `social-proof` | Фото + скрін переписки (блок) + цифра результату | kors.danil |
| `promo` | Лого + заголовок + дата/місце + ціна/badge | Event poster |

---

## Ключі, які потрібно заповнити

### content-stories-generator

| Ключ | Значення | Де взяти |
|------|---------|----------|
| `R2_ACCOUNT_ID` | ❌ Порожньо | Cloudflare Dashboard → R2 → Account ID |
| `R2_BUCKET` | ❌ Порожньо | Назва bucket'у в Cloudflare R2 |
| `R2_PUBLIC_URL` | ❌ Порожньо | CDN URL bucket'у (напр. `https://cdn.fineko.space`) |
| `REPLICATE_API_TOKEN` | ✅ Заповнено | — |
| `R2_API_TOKEN` | ✅ Заповнено | — |

### content-carousel (ті ж самі)

| Ключ | Значення |
|------|---------|
| `R2_ACCOUNT_ID` | ❌ Порожньо |
| `R2_BUCKET` | ❌ Порожньо |
| `R2_PUBLIC_URL` | ❌ Порожньо |

> **Важливо:** Воронка зараз повертає `imageBase64` напряму в callback — R2 потрібен тільки якщо ти хочеш зберігати медіа тривало (CDN URL замість base64). Для початку тестування без R2 воронка повинна працювати.

---

## План реалізації

### Фаза 1: Зображення (ЗАРАЗ)

**1.1 Callback-система** (PHP, content.fineko.space)
- `/api/content-callback` — POST endpoint (зберігає результат у JSON-файл)
- `/api/content-status` — GET endpoint (повертає статус)
- Job ID — UUID, передається у `postId`

**1.2 Форма для I-1 (Фото + силует, Сторіз)**
- Поля: photoUrl, text, subText, brandHandle
- POST → `content-stories-generator` з `size=story`
- Polling `/api/content-status` → показати зображення

**1.3 Форма для I-2 (Фото + силует, Пост)**
- Ті ж поля + `size=post`
- Той самий funnel

**1.4 Форма для I-8 (Карусель)**
- Поля: photoUrl, brandHandle, slides (textarea JSON)
- POST → `content-carousel`

**1.5 Форма для I-3/I-4 (Solid фон + текст)**
- Поля: text, subText, brandHandle, bgColor
- POST → `content-stories-generator` (template=dark, без photoUrl)

### Фаза 2: Нові шаблони slide-builder

**2.1** Створити `kors.html` в slide-builder на сервері (I-5)
**2.2** Створити `social-proof.html` (I-6)
**2.3** Додати підтримку `size` параметру в `/render/story`

### Фаза 3: Відео (після зображень)

**3.1** Підключити V-1/V-2 (HyperFrames) — синхронні, без callback
**3.2** Підключити V-3/V-4 (video subs) — async, через callback
**3.3** Підключити V-5/V-6 (avatar) — async, через callback

---

## Що потрібно від тебе

1. **Заповнити R2 ключі** в обох воронках (якщо потрібен CDN):
   - Cloudflare Dashboard → R2 → Account ID
   - Bucket name
   - Public CDN URL

2. **Перевірити nginx** на сервері для доменів мікросервісів:
   ```
   img.flows.fineko.space    → :3101
   slides.flows.fineko.space → :3002
   video.flows.fineko.space  → :3003
   remotion.flows.fineko.space → :3004
   hyperframes.flows.fineko.space → :3005
   ```

3. **brandHandle** — твій @хендл в Instagram для тестів

---

## Воронки в проекті "Контент для соц.мереж"

| Slug | Назва | Покриває типи |
|------|-------|--------------|
| content-stories-generator | Автогенерація Stories/Постів | I-1, I-2, I-3, I-4, I-5, I-6, I-7 |
| content-carousel | Карусель з безшовним фоном | I-8 |
| content-video-basic-subs | Монтаж + базові субтитри | V-3 |
| content-video-remotion | Монтаж + karaoke субтитри | V-4 |
| content-avatar-heygen | Talking Head HeyGen | V-5 |
| content-avatar-budget | Talking Head бюджетний | V-6 |
| content-resizer | Ресайзер форматів | V-7 (після V-3/V-4) |

**HyperFrames шаблони** (без окремої воронки, прямий запит):
- `social-reel` → V-1
- `data-chart` → V-2
