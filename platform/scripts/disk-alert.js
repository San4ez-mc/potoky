#!/usr/bin/env node
'use strict';
/**
 * scripts/disk-alert.js — інфраструктурний вотчдог вільного місця на диску сервера.
 *
 * НАВІЩО (живий інцидент 2026-09-18): диск заповнився на 100% (crash-дампи apport, 12 ГБ),
 * Postgres впав і не міг стабільно відновитись 6 ГОДИН — ніхто не помітив, бо не було
 * жодного моніторингу вільного місця. Власник дізнався сам, вручну.
 *
 * Свідомо НЕ через звичайний T.alert()/notifyTg (ті йдуть через сам Flows API, який
 * залежить від Postgres) — цей скрипт має продовжувати попереджати САМЕ КОЛИ Postgres/
 * платформа вже лежать через диск. Тому: чистий cron-скрипт, креденшели читає з
 * локального root-only файлу /etc/fineko/disk-alert.env (записаного окремо, одноразово,
 * з БД — див. коментар у тому записуючому скрипті), а не з бойової БД під час перевірки.
 *
 * Пороги: WARN 85% (нагадування раз на WARN_REPEAT_HOURS, доки не впаде нижче), CRIT 95%
 * (нагадування частіше, WARN_REPEAT_HOURS/3). Стан (коли востаннє попереджали) — у
 * локальному JSON, щоб не спамити щохвилини.
 */
const fs = require('fs');
const os = require('os');
const https = require('https');

const ENV_FILE = '/etc/fineko/disk-alert.env';
const STATE_FILE = '/etc/fineko/disk-alert-state.json';
const WARN_PCT = 85;
const CRIT_PCT = 95;
const WARN_REPEAT_HOURS = 2;
const CRIT_REPEAT_HOURS = WARN_REPEAT_HOURS / 3;
const PATH_TO_CHECK = '/';

function loadEnv() {
    const raw = fs.readFileSync(ENV_FILE, 'utf8');
    const out = {};
    for (const line of raw.split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) out[m[1]] = m[2];
    }
    return out;
}

function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveState(s) {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(s), { mode: 0o600 }); } catch (e) { /* best-effort */ }
}

function diskUsedPct(p) {
    const st = fs.statfsSync(p);
    const total = st.blocks * st.bsize;
    const free = st.bfree * st.bsize;
    const used = total - free;
    return { pct: Math.round((used / total) * 1000) / 10, totalGb: total / 1e9, freeGb: free / 1e9 };
}

function sendTelegram(token, chatId, text) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
        const req = https.request({
            hostname: 'api.telegram.org', path: '/bot' + token + '/sendMessage', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 8000,
        }, (res) => { res.on('data', () => {}); res.on('end', () => resolve(res.statusCode === 200)); });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.write(body); req.end();
    });
}

(async () => {
    const { pct, totalGb, freeGb } = diskUsedPct(PATH_TO_CHECK);
    const state = loadState();
    const now = Date.now();
    const host = os.hostname();

    const level = pct >= CRIT_PCT ? 'CRIT' : (pct >= WARN_PCT ? 'WARN' : null);

    if (!level) {
        if (state.lastLevel) {
            // Відновлення після попередження — одне повідомлення, що все ок.
            const env = loadEnv();
            await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID,
                '✅ <b>Диск сервера ' + host + ' — вільно знову</b>\n\nЗайнято ' + pct + '% (' + freeGb.toFixed(1) + ' ГБ вільно з ' + totalGb.toFixed(0) + ' ГБ). Попередній рівень тривоги знято.');
        }
        saveState({});
        return;
    }

    const repeatHours = level === 'CRIT' ? CRIT_REPEAT_HOURS : WARN_REPEAT_HOURS;
    const dueForRepeat = !state.lastSentAt || (now - state.lastSentAt) >= repeatHours * 3600 * 1000;
    const escalated = state.lastLevel !== level;

    if (dueForRepeat || escalated) {
        const env = loadEnv();
        const emoji = level === 'CRIT' ? '🔴' : '🟠';
        const text = emoji + ' <b>Диск сервера ' + host + ' заповнюється (' + level + ')</b>\n\n' +
            'Зайнято ' + pct + '% — вільно лише ' + freeGb.toFixed(1) + ' ГБ з ' + totalGb.toFixed(0) + ' ГБ.\n' +
            (level === 'CRIT' ? 'Це той самий поріг, з якого 2026-09-18 стався 6-годинний простій (Postgres впав через брак місця). Реагувати одразу.' : 'Перевірте, що росте (du -sh /var/* найкраще), поки не дійшло до критичного рівня.');
        const ok = await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID, text);
        if (ok) saveState({ lastLevel: level, lastSentAt: now });
    }
})().catch(() => { /* best-effort watchdog — ніколи не падає з нетривіальним кодом виходу в cron-логи */ });
