# Мікросервіс 4: Remotion Renderer

## Призначення

HTTP-сервіс для рендерингу анімованих karaoke-субтитрів через Remotion CLI.
Використовується виключно у воронці:
- **content-video-remotion** — підсвічування слова по слову, pulsation-ефект, анімовані титри

Замінює: `js`-ноду з inline `npx remotion render` у воронці.

---

## Технічний стек

- **Runtime**: Node.js 20 + Express
- **Rendering**: `@remotion/cli` + `@remotion/renderer`
- **React-компонент**: кастомний `KaraokeSubtitles.tsx` (React + Remotion)
- **Compositing**: Remotion рендерить React-компонент кадр-за-кадром поверх відео
- **Port**: `3004`
- **Вимоги до сервера**: мінімум 4 CPU cores (Remotion паралелізує рендер по кадрах), 8GB RAM, 20GB тимчасового диску

---

## Що таке Remotion

Remotion — бібліотека де відео описується як React-компонент. Кожен кадр = React render у певний момент часу `t`. Рендер відбувається через Headless Chrome + `ffmpeg` для склейки кадрів у відео.

---

## API Endpoints

### POST /render

Рендерить відео з анімованими karaoke-субтитрами.

**Request:**
```json
{
  "videoUrl": "https://...",
  "transcript": {
    "words": [
      { "word": "Привіт",  "start": 0.12, "end": 0.55 },
      { "word": "це",      "start": 0.58, "end": 0.72 },
      { "word": "тест",    "start": 0.75, "end": 1.10 }
    ]
  },
  "style": {
    "fontFamily": "Montserrat",
    "fontSize": 64,
    "activeColor": "#FFDD57",          // колір поточного слова
    "inactiveColor": "#FFFFFF",        // колір решти слів у рядку
    "activeScale": 1.15,               // масштаб активного слова
    "pulseDuration": 0.12,             // секунди pulse-in ефекту
    "position": "bottom",              // top | center | bottom
    "wordsPerLine": 3,                 // скільки слів показувати одночасно
    "backgroundRect": true,            // напівпрозорий прямокутник під рядком
    "shadowEnabled": true
  },
  "outputFormat": "mp4",
  "callbackUrl": "https://..."         // опційно — POST коли готово
}
```

**Response (sync, якщо відео < 60с):**
```json
{
  "videoUrl": "https://cdn.../remotion-uuid.mp4",
  "durationSec": 127.3,
  "renderTimeSec": 42.1,
  "framesRendered": 3819
}
```

**Response (async, якщо відео > 60с або передано callbackUrl):**
```json
{
  "jobId": "job-uuid-1234",
  "status": "queued",
  "estimatedSec": 120
}
```

---

### GET /status/:jobId

Статус асинхронного рендеру.

**Response:**
```json
{
  "jobId": "job-uuid-1234",
  "status": "rendering",           // queued | rendering | done | failed
  "progress": 0.63,                // 0.0 – 1.0
  "framesRendered": 2412,
  "framesTotal": 3819,
  "videoUrl": null                 // заповнюється коли status === "done"
}
```

---

## React-компонент KaraokeSubtitles

Зберігається в `src/composition/KaraokeSubtitles.tsx` всередині сервісу.

```tsx
// Спрощена логіка:
export const KaraokeSubtitles: React.FC<{ words, style }> = ({ words, style }) => {
  const frame = useCurrentFrame();
  const fps = useVideoConfig().fps;
  const timeSec = frame / fps;

  // Визначаємо активне слово
  const activeIdx = words.findIndex(w => timeSec >= w.start && timeSec < w.end);

  // Визначаємо вікно слів (wordsPerLine слів навколо активного)
  const windowStart = Math.max(0, activeIdx - 1);
  const visibleWords = words.slice(windowStart, windowStart + style.wordsPerLine);

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', padding: 40 }}>
      <div style={{ background: 'rgba(0,0,0,0.4)', padding: '12px 24px', borderRadius: 12 }}>
        {visibleWords.map((w, i) => {
          const isActive = windowStart + i === activeIdx;
          const pulse = isActive ? spring({ frame, fps, from: 1, to: style.activeScale }) : 1;
          return (
            <span key={i} style={{
              color: isActive ? style.activeColor : style.inactiveColor,
              fontSize: style.fontSize * pulse,
              fontWeight: isActive ? 800 : 600,
              transition: 'color 0.1s',
              marginRight: 8,
            }}>
              {w.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
```

---

## Конфігурація (env)

```
PORT=3004
REMOTION_CONCURRENCY=4          # паралельні потоки рендеру (= кількість CPU cores)
REMOTION_TIMEOUT_MS=600000      # 10 хвилин max для довгих відео
TEMP_DIR=/tmp/remotion-renderer
MAX_VIDEO_DURATION_SEC=600      # 10 хвилин — більше не обробляємо
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
| 400 | Не передано videoUrl або transcript.words |
| 413 | Відео довше MAX_VIDEO_DURATION_SEC |
| 422 | Невалідний формат transcript (слова без start/end) |
| 503 | Зайнята черга рендеру (throttle) |
| 500 | Remotion / Chromium crash |

---

## Воронки, що звертаються до цього сервісу

| Воронка | Ендпоінт | Що робить |
|---------|----------|-----------|
| content-video-remotion | `POST /render` | Рендерить karaoke відео |
| content-video-remotion | `GET /status/:jobId` | Polling статусу (якщо async) |

**URL сервісу в воронці:** `http://localhost:3004`

---

## Структура файлів проекту

```
мікросервіси/remotion-renderer/
├── src/
│   ├── index.js                  # Express app
│   ├── routes/
│   │   ├── render.js
│   │   └── status.js
│   ├── services/
│   │   ├── renderJob.js          # Remotion CLI wrapper, queue management
│   │   ├── jobQueue.js           # In-memory job queue (або Bull+Redis)
│   │   └── r2Upload.js
│   └── composition/
│       ├── index.ts              # Remotion root — реєстрація composition
│       ├── KaraokeSubtitles.tsx  # Основний React-компонент
│       └── remotion.config.ts    # Конфіг Remotion
├── package.json
└── Dockerfile
```

---

## Залежності (package.json)

```json
{
  "dependencies": {
    "express": "^4.18",
    "remotion": "^4",
    "@remotion/renderer": "^4",
    "@remotion/cli": "^4",
    "react": "^18",
    "react-dom": "^18",
    "uuid": "^9",
    "axios": "^1.6"
  },
  "devDependencies": {
    "@types/react": "^18",
    "typescript": "^5"
  }
}
```

---

## Важливі нюанси

- **Remotion потребує Chromium**: в Docker-образ додати `puppeteer/chromium` або встановити через `apt-get`.
- **Рендер CPU-bound**: 1 хвилина відео при 30fps ≈ 1800 кадрів. На 4 cores — ~60-90 секунд рендеру.
- **Async-by-default**: відео > 30с рендерити асинхронно, повертати `jobId` і `callbackUrl`.
- **Черга**: якщо сервер завантажений (2 паралельні рендери) — повертати 503, воронка retry через хвилину.
- **Compositor**: Remotion накладає React-компонент поверх відео через `<Video src={videoUrl} />` всередині composition — відео перекодується. Це OK, тому що subtitles запікаються назавжди.
- **Транскрипт**: слова Whisper мають `start`/`end` у секундах з точністю до мілісекунди — використовувати напряму.
