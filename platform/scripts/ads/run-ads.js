'use strict';
// Запуск воронки рекламних креативів за НАЗВОЮ компанії content2 (секрет вебхука береться з ключа воронки, не з аргументів).
// Використання на сервері:
//   node scripts/ads/run-ads.js <image|video> <назва компанії> '<json параметрів>'
// Приклад:
//   node scripts/ads/run-ads.js image "FINEKO — Контент" '{"painsFile":"pains-consult.json#first_six","productName":"Розбір процесу","leadMagnet":"no"}'
// Назву і json можна передати у base64 з префіксом b64: (щоб кирилиця не ламалась в ssh): b64:0J_RgNC+0LTQsNC2...
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { db } = require('@platform/db');

const dec = (v) => (String(v || '').startsWith('b64:') ? Buffer.from(v.slice(4), 'base64').toString('utf8') : String(v || ''));

async function main() {
    const mode = process.argv[2] === 'video' ? 'video' : 'image';
    const name = dec(process.argv[3]).trim();
    const params = JSON.parse(dec(process.argv[4]) || '{}');
    // painsFile: "pains-consult.json#first_six" — болі з каталогу в scripts/ads (рядок "файл#ключ")
    if (typeof params.painsFile === 'string') {
        const [file, key] = params.painsFile.split('#');
        const all = JSON.parse(require('fs').readFileSync(path.join(__dirname, file), 'utf8'));
        if (!Array.isArray(all[key])) throw new Error('у ' + file + ' нема масиву «' + key + '»');
        params.pains = all[key]; delete params.painsFile;
    }
    if (!name) throw new Error('назва компанії обовʼязкова');

    const src = await db.bot.findFirst({ where: { slug: 'ads-creative-' + mode } });
    if (!src) throw new Error('воронка ads-creative-' + mode + ' не створена');
    const keyOf = async (k) => ((await db.funnelKey.findUnique({ where: { botId_key: { botId: src.id, key: k } }, select: { value: true } })) || {}).value || '';
    const secret = await keyOf('CONTENT2_WEBHOOK_SECRET');
    const base = (await keyOf('CONTENT2_URL')) || 'https://content2.fineko.space';

    const r = await fetch(base + '/api/webhooks/resolve-project', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret }, body: JSON.stringify({ name }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error('компанію «' + name + '» не знайдено в content2: ' + JSON.stringify(j));
    console.log('компанія:', j.name, '(' + j.id + ')');

    const hook = 'https://flows.fineko.space/webhook/bot/ads-creative-' + mode;
    const rr = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ projectId: j.id }, params)) });
    console.log('webhook', rr.status, (await rr.text()).slice(0, 200));
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
