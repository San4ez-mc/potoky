'use strict';
// Мок-тести публікаторів (Threads / TikTok / YouTube) і content-scheduler: код нод запускається так само, як його запускає двигун
// (async-функція з `context` і `keys`), але fetch підмінений сценарієм відповідей. Реальних токенів не потрібно.
//   node scripts/autopost/test-publishers.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

global.setTimeout = (fn) => { fn(); return 0; }; // паузи/опитування в тестах миттєві

const load = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const resp = (body, { status = 200, headers = {} } = {}) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => headers[String(k).toLowerCase()] || null },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => { const b = Buffer.from(body && body.buf ? body.buf : 'VIDEOBYTES'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
});
function mockFetch(handlers) {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body, headers: opts.headers || {} });
        for (const h of handlers) { if (h.when(String(url), opts)) { const r = typeof h.reply === 'function' ? h.reply(String(url), opts, calls) : h.reply; return r; } }
        return resp({ error: 'no mock for ' + url }, { status: 599 });
    };
    return calls;
}
async function run(file, context, keys) { return new AsyncFunction('context', 'keys', load(file))(context, keys); }
const has = (calls, sub, method) => calls.filter((c) => c.url.includes(sub) && (!method || c.method === method));

let passed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('✅', name); } catch (e) { console.error('❌', name, '\n   ', e.message); process.exitCode = 1; } }

(async () => {
    // ── Threads ────────────────────────────────────────────────────────────
    await t('threads: відео чекає FINISHED, потім публікує; callback з externalId', async () => {
        let statusPolls = 0;
        const calls = mockFetch([
            { when: (u, o) => u.includes('/threads?') && o.method === 'POST', reply: resp({ id: 'c1' }) },
            { when: (u) => u.includes('/c1?fields=status'), reply: () => resp({ status: ++statusPolls < 3 ? 'IN_PROGRESS' : 'FINISHED' }) },
            { when: (u) => u.includes('/threads_publish'), reply: resp({ id: 'p1' }) },
            { when: (u) => u.includes('fields=permalink'), reply: resp({ permalink: 'https://threads.net/x' }) },
            { when: (u) => u.includes('/cb'), reply: resp({ ok: true }) },
        ]);
        const r = await run('publish-threads-node-code.js', { items: [{ text: 'hi', videoUrl: 'https://v/x.mp4' }], postGroupId: 'g1', callbackUrl: 'https://c2/cb' }, { THREADS_USER_ID: 'u', THREADS_ACCESS_TOKEN: 't' });
        assert.strictEqual(r.threadId, 'p1'); assert.strictEqual(r.publishError, null);
        assert.ok(statusPolls >= 3, 'мав опитувати статус');
        assert.ok(String(has(calls, '/threads?')[0].body).includes('media_type=VIDEO'));
        const cb = JSON.parse(has(calls, '/cb')[0].body);
        assert.strictEqual(cb.status, 'published'); assert.strictEqual(cb.externalId, 'p1'); assert.strictEqual(cb.postGroupId, 'g1');
    });
    await t('threads: ERROR контейнера → failed без публікації', async () => {
        const calls = mockFetch([
            { when: (u, o) => u.includes('/threads?') && o.method === 'POST', reply: resp({ id: 'c2' }) },
            { when: (u) => u.includes('/c2?fields=status'), reply: resp({ status: 'ERROR', error_message: 'bad video' }) },
            { when: (u) => u.includes('/cb'), reply: resp({}) },
        ]);
        const r = await run('publish-threads-node-code.js', { items: [{ text: 'hi', videoUrl: 'https://v/x.mp4' }], postGroupId: 'g2', callbackUrl: 'https://c2/cb' }, { THREADS_USER_ID: 'u', THREADS_ACCESS_TOKEN: 't' });
        assert.ok(/MEDIA_FAILED/.test(r.publishError));
        assert.strictEqual(has(calls, '/threads_publish').length, 0);
        assert.strictEqual(JSON.parse(has(calls, '/cb')[0].body).status, 'failed');
    });

    // ── TikTok ─────────────────────────────────────────────────────────────
    const tiktokOk = (privacyOptions, extra = []) => [
        ...extra,
        { when: (u) => u.includes('creator_info/query'), reply: resp({ data: { privacy_level_options: privacyOptions }, error: { code: 'ok' } }) },
        { when: (u) => u.includes('video/init'), reply: resp({ data: { publish_id: 'pub1', upload_url: 'https://upload.tiktok/u1' }, error: { code: 'ok' } }) },
        { when: (u) => u === 'https://upload.tiktok/u1', reply: resp({}, { status: 201 }) },
        { when: (u) => u.includes('status/fetch'), reply: resp({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }) },
        { when: (u) => u.includes('v/x.mp4'), reply: resp({ buf: 'VIDEOBYTES' }) },
        { when: (u) => u.includes('/cb'), reply: resp({}) },
    ];
    await t('tiktok: FILE_UPLOAD → init → PUT → статус; приватність знижується до дозволеної (SELF_ONLY для неаудиту)', async () => {
        const calls = mockFetch(tiktokOk(['SELF_ONLY']));
        const r = await run('publish-tiktok-node-code.js', { videoUrl: 'https://v/x.mp4', title: 'Привіт TikTok', postGroupId: 'g3', callbackUrl: 'https://c2/cb' }, { TIKTOK_ACCESS_TOKEN: 'tok' });
        assert.strictEqual(r.publishError, null); assert.strictEqual(r.publishId, 'pub1'); assert.strictEqual(r.privacy, 'SELF_ONLY');
        const init = JSON.parse(has(calls, 'video/init')[0].body);
        assert.strictEqual(init.source_info.source, 'FILE_UPLOAD'); assert.strictEqual(init.source_info.video_size, 10);
        assert.strictEqual(init.post_info.privacy_level, 'SELF_ONLY'); assert.strictEqual(init.post_info.title, 'Привіт TikTok');
        const put = has(calls, 'upload.tiktok')[0]; assert.strictEqual(put.method, 'PUT'); assert.strictEqual(put.headers['Content-Range'], 'bytes 0-9/10');
        assert.ok(r.note && /ПРИВАТНО/.test(r.note));
        const cb = JSON.parse(has(calls, '/cb')[0].body); assert.strictEqual(cb.status, 'published'); assert.strictEqual(cb.externalId, 'pub1');
    });
    await t('tiktok: акаунт дозволяє PUBLIC → публікуємо публічно', async () => {
        const calls = mockFetch(tiktokOk(['PUBLIC_TO_EVERYONE', 'SELF_ONLY']));
        const r = await run('publish-tiktok-node-code.js', { videoUrl: 'https://v/x.mp4', content: 'x' }, { TIKTOK_ACCESS_TOKEN: 'tok' });
        assert.strictEqual(r.privacy, 'PUBLIC_TO_EVERYONE'); assert.ok(!r.note);
    });
    await t('tiktok: оновлення токена через refresh перед публікацією', async () => {
        const calls = mockFetch(tiktokOk(['SELF_ONLY'], [{ when: (u) => u.includes('oauth/token'), reply: resp({ access_token: 'fresh', refresh_token: 'NEWREFRESH' }) }]));
        const r = await run('publish-tiktok-node-code.js', { videoUrl: 'https://v/x.mp4', content: 'x' }, { TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'cs', TIKTOK_REFRESH_TOKEN: 'OLD' });
        assert.strictEqual(r.publishError, null); assert.strictEqual(r.tiktokRefreshRotated, true);
        assert.strictEqual(has(calls, 'creator_info')[0].headers.Authorization, 'Bearer fresh');
    });
    await t('tiktok: ротація refresh-токена зберігається у ключі воронки через mcp-edit', async () => {
        const calls = mockFetch(tiktokOk(['SELF_ONLY'], [
            { when: (u) => u.includes('oauth/token'), reply: resp({ access_token: 'fresh', refresh_token: 'NEWREFRESH' }) },
            { when: (u) => u.includes('mcp-edit'), reply: resp({ result: {} }) },
        ]));
        await run('publish-tiktok-node-code.js', { videoUrl: 'https://v/x.mp4', content: 'x' }, { TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'cs', TIKTOK_REFRESH_TOKEN: 'OLD', MCP_SECRET: 'm', SELF_BOT_ID: 'bot-1' });
        const w = JSON.parse(has(calls, 'mcp-edit')[0].body).params.arguments;
        assert.strictEqual(w.botId, 'bot-1'); assert.strictEqual(w.key, 'TIKTOK_REFRESH_TOKEN'); assert.strictEqual(w.value, 'NEWREFRESH');
        assert.strictEqual(has(calls, 'mcp-edit')[0].headers.Authorization, 'Bearer m');
    });
    await t('tiktok: без ключів / без відео → чесна помилка і callback failed', async () => {
        const calls = mockFetch([{ when: (u) => u.includes('/cb'), reply: resp({}) }]);
        const r1 = await run('publish-tiktok-node-code.js', { videoUrl: 'https://v/x.mp4', callbackUrl: 'https://c2/cb', postGroupId: 'g' }, {});
        assert.ok(/NEED_TIKTOK_KEYS/.test(r1.publishError));
        const r2 = await run('publish-tiktok-node-code.js', { callbackUrl: 'https://c2/cb', postGroupId: 'g' }, { TIKTOK_ACCESS_TOKEN: 't' });
        assert.strictEqual(r2.publishError, 'NO_VIDEO_URL');
        assert.ok(has(calls, '/cb').every((c) => JSON.parse(c.body).status === 'failed'));
    });
    await t('tiktok: INIT з помилкою API → publishError, без завантаження', async () => {
        const calls = mockFetch([
            { when: (u) => u.includes('creator_info'), reply: resp({ data: { privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok' } }) },
            { when: (u) => u.includes('video/init'), reply: resp({ error: { code: 'spam_risk_too_many_posts', message: 'limit' } }) },
            { when: (u) => u.includes('v/x.mp4'), reply: resp({ buf: 'VIDEOBYTES' }) },
        ]);
        const r = await run('publish-tiktok-node-code.js', { videoUrl: 'https://v/x.mp4', content: 'x' }, { TIKTOK_ACCESS_TOKEN: 'tok' });
        assert.ok(/INIT_FAILED/.test(r.publishError)); assert.strictEqual(has(calls, 'upload.tiktok').length, 0);
    });

    // ── YouTube ────────────────────────────────────────────────────────────
    const ytKeys = { YT_CLIENT_ID: 'i', YT_CLIENT_SECRET: 's', YT_REFRESH_TOKEN: 'r' };
    const ytOk = (finalJson) => [
        { when: (u) => u.includes('oauth2.googleapis.com/token'), reply: resp({ access_token: 'at' }) },
        { when: (u) => u.includes('upload/youtube/v3/videos'), reply: resp({}, { headers: { location: 'https://upload.yt/u1' } }) },
        { when: (u) => u === 'https://upload.yt/u1', reply: resp(finalJson) },
        { when: (u) => u.includes('v/x.mp4'), reply: resp({ buf: 'VIDEOBYTES' }) },
        { when: (u) => u.includes('/cb'), reply: resp({}) },
    ];
    await t('youtube: refresh → resumable → PUT; назва без хештегів ≤100, #Shorts і теги', async () => {
        const calls = mockFetch(ytOk({ id: 'vid1', status: { privacyStatus: 'public' } }));
        const r = await run('publish-youtube-node-code.js', { videoUrl: 'https://v/x.mp4', hook: 'Субота. Чати мовчать.', content: 'Опис ролика #KIRO #київ', postGroupId: 'g4', callbackUrl: 'https://c2/cb' }, ytKeys);
        assert.strictEqual(r.videoId, 'vid1'); assert.strictEqual(r.url, 'https://youtube.com/shorts/vid1'); assert.strictEqual(r.publishError, null);
        const meta = JSON.parse(has(calls, 'upload/youtube/v3/videos')[0].body);
        assert.strictEqual(meta.snippet.title, 'Субота. Чати мовчать.'); assert.ok(meta.snippet.description.includes('#Shorts'));
        assert.deepStrictEqual(meta.snippet.tags, ['KIRO', 'київ']);
        const cb = JSON.parse(has(calls, '/cb')[0].body); assert.strictEqual(cb.status, 'published'); assert.strictEqual(cb.externalId, 'vid1');
    });
    await t('youtube: Google залишив private → примітка про аудит', async () => {
        mockFetch(ytOk({ id: 'vid2', status: { privacyStatus: 'private' } }));
        const r = await run('publish-youtube-node-code.js', { videoUrl: 'https://v/x.mp4', content: 'x' }, ytKeys);
        assert.ok(r.note && /аудит/.test(r.note));
    });
    await t('youtube: помилка квоти → publishError з причиною', async () => {
        mockFetch(ytOk({ error: { message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }));
        const r = await run('publish-youtube-node-code.js', { videoUrl: 'https://v/x.mp4', content: 'x' }, ytKeys);
        assert.ok(/quotaExceeded/.test(r.publishError));
    });

    // ── OAuth-воронка TikTok/YouTube ───────────────────────────────────────
    const oKeys = { TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'cs', YT_CLIENT_ID: 'yid', YT_CLIENT_SECRET: 'ysec', MCP_SECRET: 'm', PUBLISH_TIKTOK_BOT_ID: 'tt-bot', PUBLISH_YOUTUBE_BOT_ID: 'yt-bot' };
    await t('oauth: крок 1 дає посилання авторизації (TikTok і YouTube), без ключів — підказка', async () => {
        mockFetch([]);
        const a = await run('oauth-video-node-code.js', { platform: 'tiktok' }, oKeys);
        assert.ok(a.oauthMessage.includes('tiktok.com/v2/auth/authorize') && a.oauthMessage.includes('video.publish') && a.oauthOk);
        const b = await run('oauth-video-node-code.js', { platform: 'youtube' }, oKeys);
        assert.ok(b.oauthMessage.includes('accounts.google.com') && b.oauthMessage.includes('access_type=offline') && b.oauthMessage.includes('youtube.upload'));
        const c = await run('oauth-video-node-code.js', { platform: 'tiktok' }, {});
        assert.strictEqual(c.oauthOk, false);
    });
    await t('oauth: TikTok code (URL-закодований) → токени записані у publish-tiktok', async () => {
        const calls = mockFetch([
            { when: (u) => u.includes('oauth/token'), reply: resp({ access_token: 'AT', refresh_token: 'RT', open_id: 'oid', scope: 'video.publish' }) },
            { when: (u) => u.includes('mcp-edit'), reply: resp({ result: {} }) },
        ]);
        const r = await run('oauth-video-node-code.js', { platform: 'tiktok', code: 'abc%2Adef' }, oKeys);
        assert.strictEqual(r.oauthOk, true);
        assert.ok(String(has(calls, 'oauth/token')[0].body).includes('code=abc*def'));
        const writes = has(calls, 'mcp-edit').map((c) => JSON.parse(c.body).params.arguments);
        assert.deepStrictEqual(writes.map((w) => w.key).sort(), ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN']);
        assert.ok(writes.every((w) => w.botId === 'tt-bot'));
    });
    await t('oauth: YouTube code → refresh_token у publish-youtube-shorts; без refresh_token — зрозуміла помилка', async () => {
        let calls = mockFetch([{ when: (u) => u.includes('googleapis.com/token'), reply: resp({ access_token: 'x', refresh_token: 'RT' }) }, { when: (u) => u.includes('mcp-edit'), reply: resp({}) }]);
        const r = await run('oauth-video-node-code.js', { platform: 'youtube', code: 'gcode' }, oKeys);
        assert.strictEqual(r.oauthOk, true);
        assert.deepStrictEqual(has(calls, 'mcp-edit').map((c) => JSON.parse(c.body).params.arguments.key).sort(), ['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN']);
        mockFetch([{ when: (u) => u.includes('googleapis.com/token'), reply: resp({ access_token: 'x' }) }]);
        const r2 = await run('oauth-video-node-code.js', { platform: 'youtube', code: 'gcode' }, oKeys);
        assert.strictEqual(r2.oauthOk, false); assert.ok(/refresh_token/.test(r2.oauthMessage));
    });

    // ── content-scheduler ──────────────────────────────────────────────────
    const schedKeys = { TELEGRAM_BOT_TOKEN: 'bot', OWNER_TELEGRAM_ID: '1', TELEGRAM_CHANNEL_ID: '2' };
    const videoPost = (over = {}) => ({ id: 'pg1', platform: 'tiktok', postDirectly: true, autopostSlug: 'publish-tiktok', sendToTelegram: true, hook: 'Хук ролика', formatKey: 'reel',
        items: [{ content: 'Підпис #kiro', imagePath: '/uploads/media/x/v.mp4', mediaKind: 'video' }], ...over });
    await t('scheduler: відео → videoUrl (не imageUrl), title/callbackUrl у публікатор, sendVideo в Telegram, без «published» від планувальника', async () => {
        const calls = mockFetch([{ when: () => true, reply: resp({ ok: true }) }]);
        const r = await run('content-scheduler-node-code.js', { mode: 'publish', posts: [videoPost()], today: '2026-10-05', callbackUrl: 'https://c2/done?token=t', telegramChatId: '2' }, schedKeys);
        assert.strictEqual(r.autoposted, 1);
        const pub = has(calls, 'webhook/bot/publish-tiktok')[0]; const b = JSON.parse(pub.body);
        assert.strictEqual(b.videoUrl, 'https://content2.fineko.space/uploads/media/x/v.mp4'); assert.strictEqual(b.imageUrl, null);
        assert.strictEqual(b.title, 'Хук ролика'); assert.strictEqual(b.callbackUrl, 'https://c2/done?token=t'); assert.strictEqual(b.postGroupId, 'pg1');
        assert.ok(has(calls, 'sendVideo').length >= 1, 'у Telegram має піти sendVideo'); assert.strictEqual(has(calls, 'sendPhoto').length, 0);
        assert.strictEqual(has(calls, 'c2/done').length, 0, 'планувальник не має ставити published автопосту');
    });
    await t('scheduler: збій запуску публікатора → callback failed і алерт власнику', async () => {
        const calls = mockFetch([
            { when: (u) => u.includes('webhook/bot/publish-tiktok'), reply: resp({}, { status: 500 }) },
            { when: () => true, reply: resp({ ok: true }) },
        ]);
        const r = await run('content-scheduler-node-code.js', { mode: 'publish', posts: [videoPost({ sendToTelegram: false })], today: '2026-10-05', callbackUrl: 'https://c2/done?token=t' }, schedKeys);
        assert.strictEqual(r.autoposted, 0); assert.ok(r.errors.length === 1);
        const failed = has(calls, 'c2/done').map((c) => JSON.parse(c.body)); assert.strictEqual(failed.length, 1); assert.strictEqual(failed[0].status, 'failed');
        assert.ok(has(calls, 'sendMessage').length >= 1, 'власнику має піти алерт');
    });
    await t('scheduler: пост без автопубліктора лишається «доставлено» (published)', async () => {
        const calls = mockFetch([{ when: () => true, reply: resp({ ok: true }) }]);
        await run('content-scheduler-node-code.js', { mode: 'publish', posts: [{ id: 'pg9', platform: 'telegram', postDirectly: false, sendToTelegram: true, items: [{ content: 'текст' }] }], today: '2026-10-05', callbackUrl: 'https://c2/done?token=t', telegramChatId: '2' }, schedKeys);
        const cbs = has(calls, 'c2/done').map((c) => JSON.parse(c.body)); assert.strictEqual(cbs.length, 1); assert.strictEqual(cbs[0].status, 'published');
    });

    console.log(process.exitCode ? '\nFAILED' : `\nAll ${passed} publisher tests passed`);
})();
