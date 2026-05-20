'use strict';

/**
 * Seed script: Project «Контент для соц.мереж» with 7 automation funnels.
 *
 * Run on server:
 *   cd /var/www/flows.fineko.space/platform
 *   node seed_content_funnels.js
 *
 * Or locally with DATABASE_URL:
 *   DATABASE_URL="postgresql://..." node seed_content_funnels.js
 *
 * Or: PLATFORM_URL=https://flows.fineko.space node seed_content_funnels.js
 */

// Try loading .env from common locations
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Webhook URL helper ─────────────────────────────────────────────────────────
// The platform receives POST requests at: /webhook/bot/:slug
// So a content funnel's entry point is: POST https://<your-domain>/webhook/bot/<slug>

const BASE_URL = process.env.PLATFORM_URL || 'https://your-domain.com';
const webhookUrl = (slug) => `${BASE_URL}/webhook/bot/${slug}`;

// ── Node position helpers ──────────────────────────────────────────────────────
const pos = (x, y) => ({ x, y });

// ── Funnel definitions ─────────────────────────────────────────────────────────
const FUNNELS = [
    // ─── Funnel 1: «Автогенерація Stories / Постів» ──────────────────────────
    {
        slug: 'content-stories-generator',
        name: 'Автогенерація Stories / Постів',
        description: 'Приймає текст та фото з Google Drive, стилізує через AI, прибирає фон, генерує бекграунд та збирає фінальний PNG у фірмовому стилі',
        trigger: 'webhook',
        flow: {
            nodes: [
                {
                    id: 'start', type: 'start', position: pos(400, 50),
                    data: {
                        label: 'Webhook Trigger',
                        trigger: 'webhook',
                        description: 'POST-запит від контент-платформи',
                        webhookNote: `POST ${webhookUrl('content-stories-generator')}`,
                        bodySchema: JSON.stringify({
                            text: 'string — основний текст слайду',
                            subText: 'string — додатковий текст (опційно)',
                            googleDrivePhotoId: 'string — ID фото на Google Drive',
                            style: 'string — стиль бренду (опційно, default: "business")',
                        }, null, 2),
                    },
                },
                {
                    id: 'ai-stylize', type: 'connector', position: pos(400, 200),
                    data: {
                        label: 'ШІ-Стилізація фото',
                        connectorType: 'http_request',
                        connectorIcon: '🎨',
                        description: 'Fal.ai / Replicate (Flux/PhotoMaker) — стилізація обличчя під бренд',
                        action: 'POST to Replicate API',
                        outputVar: 'context.aiPhotoUrl',
                    },
                },
                {
                    id: 'remove-bg', type: 'js', position: pos(400, 350),
                    data: {
                        label: 'Видалення фону',
                        description: '@imgly/background-removal-node — чистий PNG-силует',
                        code: '// @imgly/background-removal-node\n// Input: context.aiPhotoUrl\n// Output: context.silhouetteUrl',
                        outputVar: 'context.silhouetteUrl',
                    },
                },
                {
                    id: 'gen-bg', type: 'connector', position: pos(400, 500),
                    data: {
                        label: 'Генератор Бекграунду',
                        connectorType: 'http_request',
                        connectorIcon: '🖼️',
                        description: 'Flux Schnell (Replicate) — тематична фонова абстракція',
                        action: 'POST to Replicate (flux-schnell)',
                        outputVar: 'context.backgroundUrl',
                    },
                },
                {
                    id: 'puppeteer', type: 'js', position: pos(400, 650),
                    data: {
                        label: 'Конструктор слайдів (Puppeteer)',
                        description: 'Рендерить HTML/CSS шаблон: фон + силует + текст → PNG (1080x1920 або 1080x1350)',
                        code: '// Puppeteer: launch browser, open HTML template,\n// inject background, silhouette, text → screenshot PNG\n// Output: context.finalImageBuffer',
                        outputVar: 'context.finalImageBuffer',
                    },
                },
                {
                    id: 'r2-upload', type: 'connector', position: pos(400, 800),
                    data: {
                        label: 'Cloudflare R2 Storage',
                        connectorType: 'http_request',
                        connectorIcon: '☁️',
                        description: 'Завантаження PNG у R2. Env: R2_ACCOUNT_ID, R2_API_TOKEN, R2_BUCKET',
                        action: 'PUT to R2 S3-compatible API',
                        outputVar: 'context.imagePublicUrl',
                    },
                },
                {
                    id: 'response', type: 'httpRequest', position: pos(400, 950),
                    data: {
                        label: 'Webhook Response (Фінал)',
                        description: 'Повертає посилання на готову картинку назад у контент-платформу',
                        method: 'POST',
                        url: '{{context.callbackUrl}}',
                        outputVar: 'context.responseResult',
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'ai-stylize' },
                { id: 'e2', source: 'ai-stylize', target: 'remove-bg' },
                { id: 'e3', source: 'remove-bg', target: 'gen-bg' },
                { id: 'e4', source: 'gen-bg', target: 'puppeteer' },
                { id: 'e5', source: 'puppeteer', target: 'r2-upload' },
                { id: 'e6', source: 'r2-upload', target: 'response' },
            ],
            viewport: { x: 0, y: 0, zoom: 0.8 },
        },
        keys: [
            { key: 'REPLICATE_API_TOKEN', label: 'Replicate API Token', isSecret: true, value: '' },
            { key: 'GOOGLE_DRIVE_API_KEY', label: 'Google Drive API Key', isSecret: true, value: '' },
            { key: 'R2_ACCOUNT_ID', label: 'Cloudflare Account ID', isSecret: false, value: '' },
            { key: 'R2_API_TOKEN', label: 'Cloudflare R2 API Token', isSecret: true, value: '' },
            { key: 'R2_BUCKET', label: 'R2 Bucket Name', isSecret: false, value: '' },
            { key: 'R2_PUBLIC_URL', label: 'R2 Public URL (CDN)', isSecret: false, value: '' },
        ],
    },

    // ─── Funnel 2: «Розумний монтаж + базові субтитри» ───────────────────────
    {
        slug: 'content-video-basic-subs',
        name: 'Розумний монтаж + базові субтитри',
        description: 'Приймає відео через Telegram-бот, очищає від пауз та екання, накладає статичні субтитри через FFmpeg, видає готовий Reels/TikTok',
        trigger: 'telegram',
        flow: {
            nodes: [
                {
                    id: 'start', type: 'start', position: pos(400, 50),
                    data: { label: 'Telegram Bot Trigger', trigger: '/start або відео' },
                },
                {
                    id: 'extract-audio', type: 'js', position: pos(400, 200),
                    data: {
                        label: 'Екстрактор аудіо (FFmpeg)',
                        description: 'Вирізає звук із відео → .mp3. Потребує FFmpeg на сервері',
                        code: '// ffmpeg -i input.mp4 -q:a 0 -map a output.mp3\n// Input: context.videoPath\n// Output: context.audioPath',
                        outputVar: 'context.audioPath',
                    },
                },
                {
                    id: 'whisper', type: 'connector', position: pos(400, 350),
                    data: {
                        label: 'Whisper Транскриптор',
                        connectorType: 'http_request',
                        connectorIcon: '🎙️',
                        description: 'OpenAI Whisper API — транскрибація з таймкодами слів',
                        action: 'POST to OpenAI /v1/audio/transcriptions',
                        outputVar: 'context.transcript',
                    },
                },
                {
                    id: 'claude-analyze', type: 'claude', position: pos(400, 500),
                    data: {
                        label: 'ШІ-Аналітик пауз (Claude)',
                        mode: 'single',
                        exitCondition: 'json_output',
                        systemPrompt: 'Ти аналізуєш транскрипцію відео. Знайди таймкоди довгих пауз (>0.5с) та слів-паразитів (е-е-е, м-м-м, ну, типу). Поверни JSON: {"remove": [{"from": 1.2, "to": 2.5}, ...]}',
                        model: 'claude-haiku-4-5',
                        outputVar: 'context.removeSegments',
                    },
                },
                {
                    id: 'ffmpeg-cut', type: 'js', position: pos(400, 650),
                    data: {
                        label: 'Безшовна склейка (FFmpeg)',
                        description: 'Вирізає паузи та екання, склеює чисті шматки без перекодування',
                        code: '// Uses context.removeSegments to build FFmpeg filter_complex\n// Output: context.cleanVideoPath',
                        outputVar: 'context.cleanVideoPath',
                    },
                },
                {
                    id: 'srt-burn', type: 'js', position: pos(400, 800),
                    data: {
                        label: 'Генератор SRT + FFmpeg-титри',
                        description: 'Формує .srt із таймкодами Whisper, впікає субтитри знизу екрана через FFmpeg',
                        code: '// Generate SRT from context.transcript.words\n// ffmpeg -i cleanVideo -vf subtitles=file.srt output.mp4\n// Output: context.subtitledVideoPath',
                        outputVar: 'context.subtitledVideoPath',
                    },
                },
                {
                    id: 'r2-upload', type: 'connector', position: pos(400, 950),
                    data: {
                        label: 'Cloudflare R2 Storage',
                        connectorType: 'http_request',
                        connectorIcon: '☁️',
                        description: 'Зберігає готове MP4 у хмарі',
                        action: 'PUT to R2',
                        outputVar: 'context.videoPublicUrl',
                    },
                },
                {
                    id: 'send-tg', type: 'message', position: pos(250, 1100),
                    data: {
                        label: 'Відправити в Telegram',
                        text: '✅ Відео готово!\n\n{{context.videoPublicUrl}}',
                    },
                },
                {
                    id: 'callback', type: 'httpRequest', position: pos(550, 1100),
                    data: {
                        label: 'Webhook Response',
                        description: 'Сповіщає контент-платформу про готовість',
                        method: 'POST',
                        url: '{{context.callbackUrl}}',
                        outputVar: 'context.callbackResult',
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'extract-audio' },
                { id: 'e2', source: 'extract-audio', target: 'whisper' },
                { id: 'e3', source: 'whisper', target: 'claude-analyze' },
                { id: 'e4', source: 'claude-analyze', target: 'ffmpeg-cut' },
                { id: 'e5', source: 'ffmpeg-cut', target: 'srt-burn' },
                { id: 'e6', source: 'srt-burn', target: 'r2-upload' },
                { id: 'e7', source: 'r2-upload', target: 'send-tg' },
                { id: 'e8', source: 'r2-upload', target: 'callback' },
            ],
            viewport: { x: 0, y: 0, zoom: 0.8 },
        },
        keys: [
            { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token', isSecret: true, value: '' },
            { key: 'TELEGRAM_BOT_USERNAME', label: 'Telegram Bot Username', isSecret: false, value: '' },
            { key: 'OPENAI_API_KEY', label: 'OpenAI API Key (Whisper)', isSecret: true, value: '' },
            { key: 'CLAUDE_API_KEY', label: 'Claude API Key', isSecret: true, value: '' },
            { key: 'R2_ACCOUNT_ID', label: 'Cloudflare Account ID', isSecret: false, value: '' },
            { key: 'R2_API_TOKEN', label: 'Cloudflare R2 API Token', isSecret: true, value: '' },
            { key: 'R2_BUCKET', label: 'R2 Bucket Name', isSecret: false, value: '' },
            { key: 'R2_PUBLIC_URL', label: 'R2 Public URL (CDN)', isSecret: false, value: '' },
        ],
    },

    // ─── Funnel 3: «Розумний монтаж + Динамічні Reels-Тітри (Remotion)» ──────
    {
        slug: 'content-video-remotion',
        name: 'Розумний монтаж + Remotion-титри',
        description: 'Аналогічно до Воронки 2, але замість статичних субтитрів використовує Remotion для анімованих karaoke-титрів (слово підсвічується, збільшується, ефект pulsation)',
        trigger: 'telegram',
        flow: {
            nodes: [
                {
                    id: 'start', type: 'start', position: pos(400, 50),
                    data: { label: 'Telegram Bot Trigger', trigger: 'video upload' },
                },
                {
                    id: 'extract-audio', type: 'js', position: pos(400, 200),
                    data: {
                        label: 'Екстрактор аудіо (FFmpeg)',
                        code: '// ffmpeg extract audio → .mp3\n// Output: context.audioPath',
                        outputVar: 'context.audioPath',
                    },
                },
                {
                    id: 'whisper', type: 'connector', position: pos(400, 350),
                    data: {
                        label: 'Whisper Транскриптор',
                        connectorType: 'http_request',
                        connectorIcon: '🎙️',
                        description: 'OpenAI Whisper — слова з мілісекундами',
                        action: 'POST /v1/audio/transcriptions',
                        outputVar: 'context.transcript',
                    },
                },
                {
                    id: 'claude-analyze', type: 'claude', position: pos(400, 500),
                    data: {
                        label: 'ШІ-Аналітик пауз (Claude)',
                        mode: 'single',
                        exitCondition: 'json_output',
                        systemPrompt: 'Аналізуй транскрипцію. Знайди паузи >0.5с та слова-паразити. Поверни JSON: {"remove": [{"from": float, "to": float}]}',
                        model: 'claude-haiku-4-5',
                        outputVar: 'context.removeSegments',
                    },
                },
                {
                    id: 'ffmpeg-cut', type: 'js', position: pos(400, 650),
                    data: {
                        label: 'Безшовна склейка (FFmpeg)',
                        code: '// Cut and concat clean segments\n// Output: context.cleanVideoPath',
                        outputVar: 'context.cleanVideoPath',
                    },
                },
                {
                    id: 'remotion', type: 'js', position: pos(400, 800),
                    data: {
                        label: 'Рендер-двигун Remotion',
                        description: 'Remotion CLI: React-скрипт кадр за кадром рендерить анімовані karaoke-субтитри (поточне слово — жовте, великe, з пульсацією)',
                        code: '// npx remotion render --props=\'{"words": context.transcript.words, "video": context.cleanVideoPath}\'\n// Output: context.remotionVideoPath',
                        outputVar: 'context.remotionVideoPath',
                    },
                },
                {
                    id: 'r2-upload', type: 'connector', position: pos(400, 950),
                    data: {
                        label: 'Cloudflare R2 Storage',
                        connectorType: 'http_request',
                        connectorIcon: '☁️',
                        action: 'PUT to R2',
                        outputVar: 'context.videoPublicUrl',
                    },
                },
                {
                    id: 'send-tg', type: 'message', position: pos(250, 1100),
                    data: {
                        label: 'Відправити в Telegram',
                        text: '🎬 Преміум відео готово!\n\n{{context.videoPublicUrl}}',
                    },
                },
                {
                    id: 'callback', type: 'httpRequest', position: pos(550, 1100),
                    data: {
                        label: 'Webhook Response',
                        method: 'POST',
                        url: '{{context.callbackUrl}}',
                        outputVar: 'context.callbackResult',
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'extract-audio' },
                { id: 'e2', source: 'extract-audio', target: 'whisper' },
                { id: 'e3', source: 'whisper', target: 'claude-analyze' },
                { id: 'e4', source: 'claude-analyze', target: 'ffmpeg-cut' },
                { id: 'e5', source: 'ffmpeg-cut', target: 'remotion' },
                { id: 'e6', source: 'remotion', target: 'r2-upload' },
                { id: 'e7', source: 'r2-upload', target: 'send-tg' },
                { id: 'e8', source: 'r2-upload', target: 'callback' },
            ],
            viewport: { x: 0, y: 0, zoom: 0.8 },
        },
        keys: [
            { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token', isSecret: true, value: '' },
            { key: 'TELEGRAM_BOT_USERNAME', label: 'Telegram Bot Username', isSecret: false, value: '' },
            { key: 'OPENAI_API_KEY', label: 'OpenAI API Key (Whisper)', isSecret: true, value: '' },
            { key: 'CLAUDE_API_KEY', label: 'Claude API Key', isSecret: true, value: '' },
            { key: 'R2_ACCOUNT_ID', label: 'Cloudflare Account ID', isSecret: false, value: '' },
            { key: 'R2_API_TOKEN', label: 'Cloudflare R2 API Token', isSecret: true, value: '' },
            { key: 'R2_BUCKET', label: 'R2 Bucket Name', isSecret: false, value: '' },
            { key: 'R2_PUBLIC_URL', label: 'R2 Public URL (CDN)', isSecret: false, value: '' },
        ],
    },

    // ─── Funnel 4: «ШІ-Аватар (Преміум Talking Head)» ────────────────────────
    {
        slug: 'content-avatar-heygen',
        name: 'ШІ-Аватар Talking Head (HeyGen)',
        description: 'Повністю автоматична генерація відео: отримує текст сценарію, HeyGen створює реалістичне відео з вашим цифровим аватаром та клонованим голосом',
        trigger: 'webhook',
        flow: {
            nodes: [
                {
                    id: 'start', type: 'start', position: pos(400, 50),
                    data: {
                        label: 'Webhook Trigger',
                        trigger: 'webhook',
                        webhookNote: `POST ${webhookUrl('content-avatar-heygen')}`,
                        bodySchema: JSON.stringify({
                            script: 'string — текст сценарію',
                            avatarId: 'string — HeyGen avatar_id (або береться з env HEYGEN_AVATAR_ID)',
                            voiceId: 'string — HeyGen voice_id (або HEYGEN_VOICE_ID)',
                            callbackUrl: 'string — URL для відповіді після генерації',
                        }, null, 2),
                    },
                },
                {
                    id: 'heygen-create', type: 'connector', position: pos(400, 200),
                    data: {
                        label: 'HeyGen API — Створити відео',
                        connectorType: 'http_request',
                        connectorIcon: '🎭',
                        description: 'POST https://api.heygen.com/v2/video/generate — передає script + avatar_id + voice_id',
                        action: 'POST /v2/video/generate',
                        outputVar: 'context.heygenVideoId',
                    },
                },
                {
                    id: 'wait-ready', type: 'wait', position: pos(400, 350),
                    data: {
                        label: 'Очікування готовності HeyGen',
                        description: 'Перевіряє статус кожні 15с поки status !== "completed"',
                        duration: '15s poll',
                        hint: 'GET /v2/video/{id} → status: processing | completed | failed',
                    },
                },
                {
                    id: 'r2-upload', type: 'connector', position: pos(400, 500),
                    data: {
                        label: 'Cloudflare R2 Storage',
                        connectorType: 'http_request',
                        connectorIcon: '☁️',
                        description: 'Скачує MP4 з HeyGen і завантажує в R2',
                        action: 'Download + PUT to R2',
                        outputVar: 'context.videoPublicUrl',
                    },
                },
                {
                    id: 'response', type: 'httpRequest', position: pos(400, 650),
                    data: {
                        label: 'Webhook Response (Фінал)',
                        method: 'POST',
                        url: '{{context.callbackUrl}}',
                        description: 'Повертає посилання на готове Talking Head відео',
                        outputVar: 'context.responseResult',
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'heygen-create' },
                { id: 'e2', source: 'heygen-create', target: 'wait-ready' },
                { id: 'e3', source: 'wait-ready', target: 'r2-upload' },
                { id: 'e4', source: 'r2-upload', target: 'response' },
            ],
            viewport: { x: 0, y: 0, zoom: 0.8 },
        },
        keys: [
            { key: 'HEYGEN_API_KEY', label: 'HeyGen API Key', isSecret: true, value: '' },
            { key: 'HEYGEN_AVATAR_ID', label: 'HeyGen Avatar ID (default)', isSecret: false, value: '' },
            { key: 'HEYGEN_VOICE_ID', label: 'HeyGen Voice ID (default)', isSecret: false, value: '' },
            { key: 'R2_ACCOUNT_ID', label: 'Cloudflare Account ID', isSecret: false, value: '' },
            { key: 'R2_API_TOKEN', label: 'Cloudflare R2 API Token', isSecret: true, value: '' },
            { key: 'R2_BUCKET', label: 'R2 Bucket Name', isSecret: false, value: '' },
            { key: 'R2_PUBLIC_URL', label: 'R2 Public URL (CDN)', isSecret: false, value: '' },
        ],
    },

    // ─── Funnel 5: «ШІ-Аватар (Бюджетний — ElevenLabs + LivePortrait)» ──────
    {
        slug: 'content-avatar-budget',
        name: 'ШІ-Аватар Бюджетний (ElevenLabs + LivePortrait)',
        description: 'Talking Head відео за ~$0.20: ElevenLabs озвучує текст, LivePortrait оживляє статичне фото синхронно зі звуком (~20 секунд генерації)',
        trigger: 'webhook',
        flow: {
            nodes: [
                {
                    id: 'start', type: 'start', position: pos(400, 50),
                    data: {
                        label: 'Webhook Trigger',
                        trigger: 'webhook',
                        webhookNote: `POST ${webhookUrl('content-avatar-budget')}`,
                        bodySchema: JSON.stringify({
                            script: 'string — текст сценарію',
                            photoId: 'string — Google Drive ID фото (анфас, бізнес-стиль) або береться default',
                            voiceId: 'string — ElevenLabs voice_id (або ELEVENLABS_VOICE_ID з env)',
                            callbackUrl: 'string — URL для відповіді',
                        }, null, 2),
                    },
                },
                {
                    id: 'elevenlabs', type: 'connector', position: pos(400, 200),
                    data: {
                        label: 'ElevenLabs TTS',
                        connectorType: 'http_request',
                        connectorIcon: '🗣️',
                        description: 'POST /v1/text-to-speech/{voice_id} — генерує voice.mp3 клонованого голосу',
                        action: 'POST /v1/text-to-speech',
                        outputVar: 'context.voiceAudioUrl',
                    },
                },
                {
                    id: 'get-photo', type: 'connector', position: pos(400, 350),
                    data: {
                        label: 'Селектор фото (Google Drive)',
                        connectorType: 'http_request',
                        connectorIcon: '📸',
                        description: 'Забирає заздалегідь підготовлене бізнес-фото з Google Drive',
                        action: 'GET Drive file',
                        outputVar: 'context.photoUrl',
                    },
                },
                {
                    id: 'liveportrait', type: 'connector', position: pos(400, 500),
                    data: {
                        label: 'LivePortrait Аніматор (Replicate)',
                        connectorType: 'http_request',
                        connectorIcon: '🎬',
                        description: 'Replicate: LivePortrait model — оживляє фото під voice.mp3 (~20с). Міміка, кліпання очима, рух голови',
                        action: 'POST to Replicate (fofr/live-portrait)',
                        outputVar: 'context.animatedVideoUrl',
                    },
                },
                {
                    id: 'r2-upload', type: 'connector', position: pos(400, 650),
                    data: {
                        label: 'Cloudflare R2 Storage',
                        connectorType: 'http_request',
                        connectorIcon: '☁️',
                        action: 'PUT to R2',
                        outputVar: 'context.videoPublicUrl',
                    },
                },
                {
                    id: 'response', type: 'httpRequest', position: pos(400, 800),
                    data: {
                        label: 'Webhook Response (Фінал)',
                        method: 'POST',
                        url: '{{context.callbackUrl}}',
                        description: 'Посилання на бюджетне Talking Head відео',
                        outputVar: 'context.responseResult',
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'elevenlabs' },
                { id: 'e2', source: 'elevenlabs', target: 'get-photo' },
                { id: 'e3', source: 'get-photo', target: 'liveportrait' },
                { id: 'e4', source: 'liveportrait', target: 'r2-upload' },
                { id: 'e5', source: 'r2-upload', target: 'response' },
            ],
            viewport: { x: 0, y: 0, zoom: 0.8 },
        },
        keys: [
            { key: 'ELEVENLABS_API_KEY', label: 'ElevenLabs API Key', isSecret: true, value: '' },
            { key: 'ELEVENLABS_VOICE_ID', label: 'ElevenLabs Voice ID (default)', isSecret: false, value: '' },
            { key: 'REPLICATE_API_TOKEN', label: 'Replicate API Token', isSecret: true, value: '' },
            { key: 'GOOGLE_DRIVE_API_KEY', label: 'Google Drive API Key', isSecret: true, value: '' },
            { key: 'GOOGLE_DRIVE_DEFAULT_PHOTO_ID', label: 'ID дефолтного фото на Google Drive', isSecret: false, value: '' },
            { key: 'R2_ACCOUNT_ID', label: 'Cloudflare Account ID', isSecret: false, value: '' },
            { key: 'R2_API_TOKEN', label: 'Cloudflare R2 API Token', isSecret: true, value: '' },
            { key: 'R2_BUCKET', label: 'R2 Bucket Name', isSecret: false, value: '' },
            { key: 'R2_PUBLIC_URL', label: 'R2 Public URL (CDN)', isSecret: false, value: '' },
        ],
    },

    // ─── Funnel 6: «Карусель з єдиним безшовним фоном» ───────────────────────
    {
        slug: 'content-carousel',
        name: 'Карусель з безшовним фоном',
        description: 'Бере сценарій на N слайдів, генерує одне широке панорамне полотно (фон + AI-силует), ріже на окремі слайди для Instagram-каруселі через sharp',
        trigger: 'webhook',
        flow: {
            nodes: [
                {
                    id: 'start', type: 'start', position: pos(400, 50),
                    data: {
                        label: 'Webhook Trigger',
                        trigger: 'webhook',
                        webhookNote: `POST ${webhookUrl('content-carousel')}`,
                        bodySchema: JSON.stringify({
                            slides: 'array<string> — тексти для кожного слайду (до 10)',
                            googleDrivePhotoId: 'string — ID вашого фото на Google Drive',
                            style: 'string — стиль бренду (опційно)',
                            callbackUrl: 'string — URL для відповіді з масивом посилань',
                        }, null, 2),
                    },
                },
                {
                    id: 'ai-photo', type: 'connector', position: pos(400, 200),
                    data: {
                        label: 'ШІ-Стилізація + Видалення фону',
                        connectorType: 'http_request',
                        connectorIcon: '🎨',
                        description: 'Replicate (Flux/PhotoMaker) стилізація + @imgly/background-removal-node для силуету',
                        action: 'POST to Replicate',
                        outputVar: 'context.silhouetteUrl',
                    },
                },
                {
                    id: 'panoramic', type: 'js', position: pos(400, 350),
                    data: {
                        label: 'Панорамний Конструктор (Puppeteer)',
                        description: 'Рендерить одне широке полотно (N×1080 × 1350). Силуети на стиках слайдів, тексти відповідно до кроків',
                        code: '// Puppeteer: render wide canvas\n// e.g. 5 slides → 5400x1350px\n// AI silhouettes placed at slide boundaries\n// Output: context.panoramaBuffer',
                        outputVar: 'context.panoramaBuffer',
                    },
                },
                {
                    id: 'sharp-slice', type: 'js', position: pos(400, 500),
                    data: {
                        label: 'Наріжчик слайдів (Sharp)',
                        description: 'sharp — нарізає панораму на N рівних частин 1080×1350 за мілісекунди без перекодування',
                        code: '// const sharp = require("sharp")\n// split panoramaBuffer into N slides of 1080x1350\n// Output: context.slideBuffers = [buf1, buf2, ...]',
                        outputVar: 'context.slideBuffers',
                    },
                },
                {
                    id: 'r2-upload', type: 'connector', position: pos(400, 650),
                    data: {
                        label: 'Cloudflare R2 Storage (масово)',
                        connectorType: 'http_request',
                        connectorIcon: '☁️',
                        description: 'Масово завантажує всі N слайдів у R2',
                        action: 'PUT all slides to R2',
                        outputVar: 'context.slideUrls',
                    },
                },
                {
                    id: 'response', type: 'httpRequest', position: pos(400, 800),
                    data: {
                        label: 'Webhook Response (Фінал)',
                        method: 'POST',
                        url: '{{context.callbackUrl}}',
                        description: 'Повертає масив посилань на слайди у правильному порядку',
                        outputVar: 'context.responseResult',
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'ai-photo' },
                { id: 'e2', source: 'ai-photo', target: 'panoramic' },
                { id: 'e3', source: 'panoramic', target: 'sharp-slice' },
                { id: 'e4', source: 'sharp-slice', target: 'r2-upload' },
                { id: 'e5', source: 'r2-upload', target: 'response' },
            ],
            viewport: { x: 0, y: 0, zoom: 0.8 },
        },
        keys: [
            { key: 'REPLICATE_API_TOKEN', label: 'Replicate API Token', isSecret: true, value: '' },
            { key: 'GOOGLE_DRIVE_API_KEY', label: 'Google Drive API Key', isSecret: true, value: '' },
            { key: 'R2_ACCOUNT_ID', label: 'Cloudflare Account ID', isSecret: false, value: '' },
            { key: 'R2_API_TOKEN', label: 'Cloudflare R2 API Token', isSecret: true, value: '' },
            { key: 'R2_BUCKET', label: 'R2 Bucket Name', isSecret: false, value: '' },
            { key: 'R2_PUBLIC_URL', label: 'R2 Public URL (CDN)', isSecret: false, value: '' },
        ],
    },

    // ─── Funnel 7: «Автоматичний адаптер (Ресайзер контенту)» ────────────────
    {
        slug: 'content-resizer',
        name: 'Автоматичний адаптер контенту (Ресайзер)',
        description: 'Запускається після Воронки 2 або 3: адаптує готове Reels під інші формати, генерує обкладинку та готує пакет для Instagram, TikTok, YouTube Shorts',
        trigger: 'webhook',
        flow: {
            nodes: [
                {
                    id: 'start', type: 'start', position: pos(400, 50),
                    data: {
                        label: 'Внутрішній Тригер / Webhook',
                        trigger: 'webhook',
                        webhookNote: `POST ${webhookUrl('content-resizer')}`,
                        bodySchema: JSON.stringify({
                            finalVideoUrl: 'string — посилання на готове відео (з Воронки 2 або 3)',
                            description: 'string — текстовий опис відео (для заголовку обкладинки)',
                            platforms: 'array<"instagram"|"tiktok"|"youtube"> — цільові платформи',
                            callbackUrl: 'string — URL для відповіді',
                        }, null, 2),
                    },
                },
                {
                    id: 'thumbnail', type: 'js', position: pos(400, 200),
                    data: {
                        label: 'Генератор обкладинки (FFmpeg)',
                        description: 'Робить скріншот найкращого кадру з перших 3с відео через FFmpeg',
                        code: '// ffmpeg -i video -ss 1 -vframes 1 thumbnail.png\n// Output: context.thumbnailBuffer',
                        outputVar: 'context.thumbnailBuffer',
                    },
                },
                {
                    id: 'cover-constructor', type: 'js', position: pos(400, 350),
                    data: {
                        label: 'Конструктор обкладинок (Puppeteer)',
                        description: 'Накладає клікбейтний заголовок із опису відео на thumbnail → готова обкладинка для Reels/Shorts',
                        code: '// Puppeteer: overlay title text on thumbnail frame\n// Output: context.coverImageBuffer',
                        outputVar: 'context.coverImageBuffer',
                    },
                },
                {
                    id: 'platform-adapt', type: 'js', position: pos(400, 500),
                    data: {
                        label: 'Платформо-адаптер (FFmpeg)',
                        description: 'При потребі перепаковує MP4 контейнер з метаданими для TikTok / YouTube Shorts (watermark, metadata)',
                        code: '// ffmpeg repackage with platform-specific settings\n// Output: context.adaptedVideos = {instagram, tiktok, youtube}',
                        outputVar: 'context.adaptedVideos',
                    },
                },
                {
                    id: 'r2-upload', type: 'connector', position: pos(400, 650),
                    data: {
                        label: 'Cloudflare R2 Storage',
                        connectorType: 'http_request',
                        connectorIcon: '☁️',
                        description: 'Зберігає обкладинку та адаптовані медіафайли',
                        action: 'PUT all to R2',
                        outputVar: 'context.packageUrls',
                    },
                },
                {
                    id: 'response', type: 'httpRequest', position: pos(400, 800),
                    data: {
                        label: 'Webhook Response (Фінал)',
                        method: 'POST',
                        url: '{{context.callbackUrl}}',
                        description: 'Відео + Обкладинка + Опис → контент-платформа маркує як «Готово до публікації»',
                        outputVar: 'context.responseResult',
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'thumbnail' },
                { id: 'e2', source: 'thumbnail', target: 'cover-constructor' },
                { id: 'e3', source: 'cover-constructor', target: 'platform-adapt' },
                { id: 'e4', source: 'platform-adapt', target: 'r2-upload' },
                { id: 'e5', source: 'r2-upload', target: 'response' },
            ],
            viewport: { x: 0, y: 0, zoom: 0.8 },
        },
        keys: [
            { key: 'R2_ACCOUNT_ID', label: 'Cloudflare Account ID', isSecret: false, value: '' },
            { key: 'R2_API_TOKEN', label: 'Cloudflare R2 API Token', isSecret: true, value: '' },
            { key: 'R2_BUCKET', label: 'R2 Bucket Name', isSecret: false, value: '' },
            { key: 'R2_PUBLIC_URL', label: 'R2 Public URL (CDN)', isSecret: false, value: '' },
        ],
    },
];

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀 Seeding project «Контент для соц.мереж»...\n');

    // 1. Create project
    const project = await prisma.project.upsert({
        where: { slug: 'content-social' },
        update: { name: 'Контент для соц.мереж', isActive: true },
        create: {
            name: 'Контент для соц.мереж',
            slug: 'content-social',
            description: 'Автоматизація контент-виробництва: Stories, Reels, Карусель, AI-аватари, монтаж з субтитрами',
            isActive: true,
            settings: {},
        },
    });
    console.log(`✅ Project: ${project.name} (${project.id})`);

    // 2. For each funnel — create bot + flow + keys
    for (const funnel of FUNNELS) {
        const bot = await prisma.bot.upsert({
            where: { projectId_slug: { projectId: project.id, slug: funnel.slug } },
            update: { name: funnel.name, description: funnel.description, isActive: true },
            create: {
                projectId: project.id,
                slug: funnel.slug,
                name: funnel.name,
                description: funnel.description,
                isActive: true,
                settings: { trigger: funnel.trigger },
            },
        });

        await prisma.flowDefinition.upsert({
            where: { botId: bot.id },
            update: {
                nodes: funnel.flow.nodes,
                edges: funnel.flow.edges,
                viewport: funnel.flow.viewport,
            },
            create: {
                botId: bot.id,
                nodes: funnel.flow.nodes,
                edges: funnel.flow.edges,
                viewport: funnel.flow.viewport,
            },
        });

        for (const keyDef of funnel.keys) {
            await prisma.funnelKey.upsert({
                where: { botId_key: { botId: bot.id, key: keyDef.key } },
                update: { label: keyDef.label, isSecret: keyDef.isSecret },
                create: {
                    botId: bot.id,
                    key: keyDef.key,
                    label: keyDef.label,
                    value: keyDef.value,
                    isSecret: keyDef.isSecret,
                },
            });
        }

        const triggerInfo = funnel.trigger === 'webhook'
            ? `🌐 POST ${webhookUrl(funnel.slug)}`
            : `📱 Telegram bot`;

        console.log(`  ✅ [${funnel.trigger.toUpperCase()}] ${funnel.name}`);
        console.log(`     ${triggerInfo}`);
        console.log(`     ${funnel.flow.nodes.length} нод, ${funnel.flow.edges.length} з'єднань, ${funnel.keys.length} ключів`);
    }

    console.log('\n✨ Done! Project «Контент для соц.мереж» created with 7 funnels.');
    console.log('\n📋 Webhook URLs (POST):');
    for (const f of FUNNELS.filter(f => f.trigger === 'webhook')) {
        console.log(`   ${f.name}:`);
        console.log(`   ${webhookUrl(f.slug)}`);
    }
}

main()
    .catch(e => { console.error('❌ Seed failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
