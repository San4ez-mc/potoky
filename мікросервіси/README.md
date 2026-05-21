# Мікросервіси — FINEKO Flows

Кастомні HTTP-сервіси для контент-воронок. Деплоються на той самий VPS поруч з платформою.
Воронки звертаються до них через `httpRequest`-ноди.

---

## Сервіси

| # | Сервіс | Порт | Файл ТЗ | Воронки |
|---|--------|------|---------|---------|
| 1 | **image-processor** | 3001 | [01-image-processor.md](01-image-processor.md) | content-stories-generator, content-carousel, content-resizer |
| 2 | **slide-builder** | 3002 | [02-slide-builder.md](02-slide-builder.md) | content-stories-generator, content-carousel, content-resizer |
| 3 | **video-processor** | 3003 | [03-video-processor.md](03-video-processor.md) | content-video-basic-subs, content-video-remotion, content-resizer |
| 4 | **remotion-renderer** | 3004 | [04-remotion-renderer.md](04-remotion-renderer.md) | content-video-remotion |

---

## Що замінюють

| Поточне рішення у воронці | Замінюється на |
|--------------------------|----------------|
| `@imgly/background-removal-node` inline в js-ноді | `image-processor` `/remove-bg` |
| Puppeteer inline в js-ноді (слайди, обкладинки) | `slide-builder` `/render/story`, `/render/panorama`, `/render/cover` |
| `sharp` slice inline в js-ноді | `slide-builder` `/slice` |
| FFmpeg inline в js-ноді (extract, cut, subtitles) | `video-processor` `/extract-audio`, `/smart-cut`, `/burn-subtitles` |
| FFmpeg thumbnail + platform adapt в js-ноді | `video-processor` `/thumbnail`, `/adapt-platform` |
| `npx remotion render` inline в js-ноді | `remotion-renderer` `/render` |

---

## Зовнішні API (НЕ мікросервіси — залишаються як connector-ноди)

- **Replicate** — AI стилізація фото, LivePortrait animation
- **OpenAI Whisper** — транскрипція аудіо
- **Claude** — аналіз пауз
- **HeyGen** — talking head відео
- **ElevenLabs** — TTS
- **Cloudflare R2** — storage
- **Google Drive** — файли

---

## Структура папок після розробки

```
мікросервіси/
├── README.md                    ← цей файл
├── 01-image-processor.md        ← ТЗ
├── 02-slide-builder.md          ← ТЗ
├── 03-video-processor.md        ← ТЗ
├── 04-remotion-renderer.md      ← ТЗ
├── image-processor/             ← код (буде додано)
├── slide-builder/               ← код (буде додано)
├── video-processor/             ← код (буде додано)
└── remotion-renderer/           ← код (буде додано)
```

---

## Як підключити мікросервіс до воронки

Замінити `js`-ноду з inline кодом на `httpRequest`-ноду:

```json
{
  "type": "httpRequest",
  "data": {
    "method": "POST",
    "url": "http://localhost:3001/remove-bg",
    "headers": { "Content-Type": "application/json" },
    "body": {
      "imageUrl": "{{context.stylizedPhotoUrl}}"
    },
    "outputVar": "context.silhouetteBase64"
  }
}
```

URL сервісів у production: `http://localhost:300X` або `http://image-processor:300X` (якщо docker-compose).
