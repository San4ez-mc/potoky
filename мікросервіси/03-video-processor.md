# Мікросервіс 3: Video Processor

## Призначення

HTTP-сервіс для відеообробки через FFmpeg. Центральний інструмент для всіх відео-воронок:
- **content-video-basic-subs** — вирізання пауз + запікання субтитрів
- **content-video-remotion** — вирізання пауз (до передачі в Remotion)
- **content-resizer** — витяг thumbnail-кадру + адаптація метаданих під платформи

Замінює: `js`-ноди з inline FFmpeg-командами у всіх трьох воронках.

---

## Технічний стек

- **Runtime**: Node.js 20 + Express
- **Video**: `fluent-ffmpeg` (Node обгортка над FFmpeg)
- **FFmpeg**: системний FFmpeg 6+ (в Docker — `apt-get install ffmpeg`)
- **Тимчасові файли**: `/tmp/video-processor/<job-id>/`
- **Port**: `3003`

---

## API Endpoints

### POST /extract-audio

Витягує аудіодоріжку з відео у форматі MP3.

**Request:**
```json
{
  "videoUrl": "https://...",     // або videoBase64
  "format": "mp3",               // mp3 | wav | aac
  "sampleRate": 16000            // для Whisper — 16kHz моно оптимально
}
```

**Response:**
```json
{
  "audioUrl": "https://cdn.../audio-uuid.mp3",
  "durationSec": 142.5,
  "sizeBytes": 456789
}
```
або `Content-Type: audio/mpeg` (бінарний, якщо не CDN_UPLOAD_ENABLED).

---

### POST /smart-cut

Вирізає сегменти з відео (паузи, слова-паразити) і безшовно склеює решту.
Основна операція для "розумного монтажу".

**Request:**
```json
{
  "videoUrl": "https://...",
  "removeSegments": [
    { "from": 2.34, "to": 3.87 },
    { "from": 15.10, "to": 16.40 }
  ],
  "outputFormat": "mp4",
  "reencodeAudio": true           // true = стабільніший звук на стиках, false = швидше
}
```

**Алгоритм:**
1. Обчислити `keepSegments` як інверсію `removeSegments`.
2. Для кожного сегменту: `ffmpeg -ss {start} -to {end} -i input.mp4 segment_N.mp4`.
3. Склеїти через `ffmpeg concat demuxer` (без перекодування якщо `reencodeAudio: false`).

**Response:**
```json
{
  "videoUrl": "https://cdn.../cut-uuid.mp4",
  "originalDurationSec": 142.5,
  "finalDurationSec": 127.3,
  "removedSec": 15.2,
  "segmentsRemoved": 8
}
```

---

### POST /burn-subtitles

Запікає SRT-субтитри в відео (hardcoded, не знімаються).

**Request:**
```json
{
  "videoUrl": "https://...",
  "srtContent": "1\n00:00:01,000 --> 00:00:03,500\nПривіт, це перший субтитр\n\n2\n...",
  "style": {
    "fontName": "Arial",          // вбудована в FFmpeg або шлях до .ttf
    "fontSize": 24,
    "primaryColor": "&H00FFFFFF", // ASS color format: AABBGGRR
    "outlineColor": "&H00000000",
    "outlineWidth": 2,
    "alignment": 2,               // ASS alignment: 2=bottom-center, 8=top-center
    "marginV": 30                 // відступ знизу (px)
  }
}
```

**Response:**
```json
{
  "videoUrl": "https://cdn.../subtitled-uuid.mp4"
}
```

---

### POST /thumbnail

Витягує один кадр з відео як PNG (для обкладинки Reels/Shorts).

**Request:**
```json
{
  "videoUrl": "https://...",
  "seekSec": 1.0,                  // час у секундах (або null для автовибору)
  "width": 1080,
  "height": 1350,                  // якщо вказано — кропить до потрібного формату
  "autoSelect": false              // true = вибрати кадр з найменшим рухом
}
```

**Response:** `Content-Type: image/png` або:
```json
{
  "thumbnailUrl": "https://cdn.../thumb-uuid.png"
}
```

---

### POST /adapt-platform

Перепаковує MP4 з метаданими для конкретної платформи (Instagram, TikTok, YouTube Shorts).
Без перекодування — лише container metadata.

**Request:**
```json
{
  "videoUrl": "https://...",
  "platforms": ["instagram", "tiktok", "youtube"],
  "metadata": {
    "title": "Назва відео",
    "description": "Опис"
  }
}
```

**Response:**
```json
{
  "results": {
    "instagram": { "videoUrl": "https://cdn.../ig-uuid.mp4", "format": "MP4 H.264" },
    "tiktok":    { "videoUrl": "https://cdn.../tt-uuid.mp4", "format": "MP4 H.264" },
    "youtube":   { "videoUrl": "https://cdn.../yt-uuid.mp4", "format": "MP4 H.264" }
  }
}
```

Специфіки по платформах:
- **Instagram**: max 4GB, H.264 baseline, AAC 44.1kHz, aspect ratio 9:16
- **TikTok**: max 500MB, H.264, потрібен `moov atom` на початку файлу (`-movflags +faststart`)
- **YouTube Shorts**: max 256GB, H.264 або VP9, рекомендовано 1080×1920

---

## Конфігурація (env)

```
PORT=3003
FFMPEG_PATH=ffmpeg              # або /usr/bin/ffmpeg
TEMP_DIR=/tmp/video-processor
MAX_VIDEO_SIZE_MB=500
JOB_CLEANUP_AFTER_MIN=30        # видаляти тимчасові файли після N хвилин
CDN_UPLOAD_ENABLED=false
R2_ACCOUNT_ID=
R2_API_TOKEN=
R2_BUCKET=
R2_PUBLIC_URL=
```

---

## Обробка помилок

| Код | Опис |
|-----|------|
| 400 | Не передано videoUrl або removeSegments порожній |
| 413 | Відео перевищує MAX_VIDEO_SIZE_MB |
| 422 | FFmpeg не може розпарсити відео (пошкоджений файл) |
| 504 | FFmpeg timeout (відео надто довге) |
| 500 | Внутрішня помилка FFmpeg |

---

## Воронки, що звертаються до цього сервісу

| Воронка | Ендпоінт | Що робить |
|---------|----------|-----------|
| content-video-basic-subs | `/extract-audio` | Аудіо для Whisper |
| content-video-basic-subs | `/smart-cut` | Видалення пауз |
| content-video-basic-subs | `/burn-subtitles` | SRT субтитри |
| content-video-remotion | `/extract-audio` | Аудіо для Whisper |
| content-video-remotion | `/smart-cut` | Видалення пауз |
| content-resizer | `/thumbnail` | Кадр для обкладинки |
| content-resizer | `/adapt-platform` | Метадані для платформ |

**URL сервісу в воронці:** `http://localhost:3003`

---

## Структура файлів проекту

```
мікросервіси/video-processor/
├── src/
│   ├── index.js
│   ├── routes/
│   │   ├── extractAudio.js
│   │   ├── smartCut.js
│   │   ├── burnSubtitles.js
│   │   ├── thumbnail.js
│   │   └── adaptPlatform.js
│   ├── services/
│   │   ├── ffmpegWrapper.js   # fluent-ffmpeg з промісами + cleanup
│   │   ├── segmentCutter.js   # логіка інверсії + склейки сегментів
│   │   └── r2Upload.js
│   └── utils/
│       ├── tempDir.js         # створення/cleanup job temp dirs
│       └── downloadVideo.js   # download by URL → temp file
├── package.json
└── Dockerfile
```

---

## Залежності (package.json)

```json
{
  "dependencies": {
    "express": "^4.18",
    "fluent-ffmpeg": "^2.1",
    "axios": "^1.6",
    "uuid": "^9",
    "node-cron": "^3"           // для автоматичного cleanup temp файлів
  }
}
```

---

## Важливі нюанси

- **Склейка без перекодування** (`reencodeAudio: false`): використовувати `concat demuxer` з `ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4`. Швидко, але можливі артефакти на стиках якщо keyframe alignment погано.
- **З перекодуванням** (`reencodeAudio: true`): кожен сегмент ре-кодується → стики чисті, але повільніше (~2× realtime).
- **moov atom**: завжди використовувати `-movflags +faststart` для стримінгу.
- **Великі файли**: прийом через URL (не upload), щоб не завантажувати через тіло запиту.
