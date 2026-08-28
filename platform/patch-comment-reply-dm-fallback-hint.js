'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Живий кейс (тестер matsukoleksandr, 2026-08-28): лишив 2 коментарі поспіль.
 *   Перший — публічна відповідь + приватне DM (Zernio comment-automation) прийшли
 *   ОБИДВА. Другий — публічна відповідь прийшла знову, а DM — ні (Zernio/Meta не
 *   шле повторний автоматичний DM тому самому контакту — підтверджено статистикою
 *   автоматизації: triggered===dmsSent===uniqueContacts, тобто по факту один DM на
 *   унікального контакта). Це поведінка Zernio/Meta, не наш код — керувати нею
 *   напряму ми не можемо.
 *
 *   Запит власника: публічна відповідь має явно попереджати про ОБИДВА сценарії —
 *   "дивіться директ" (якщо DM дійшов) І "якщо не бачите — напишіть самі, можливо
 *   особисті закриті" (якщо ні). Оскільки n_comment_entry не знає синхронно, який
 *   саме сценарій станеться — обидва одразу в одному повідомленні.
 *
 *   Фікс: усі 50 варіантів (5 категорій × 10) отримують один із 3 коротких
 *   хвостиків-хеджів (окремий рандом від основного варіанту — щоб не звести
 *   нанівець антиспам-різноманіття 10 варіантів).
 *
 * ЗАПУСК:  node patch-comment-reply-dm-fallback-hint.js            (dry-run)
 *          node patch-comment-reply-dm-fallback-hint.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const NEW_CODE = fs.readFileSync(path.join(__dirname, 'n_comment_entry-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const n = flow.nodes.find((x) => x.id === 'n_comment_entry');
    if (!n) { console.log(name, 'ERROR: n_comment_entry not found'); return; }

    if (n.data.code.includes('FALLBACK_HINTS')) { console.log(name, 'ALREADY_APPLIED'); return; }

    console.log(name, 'буде додано FALLBACK_HINTS у n_comment_entry.');
    if (!APPLY) return;

    const nodes = flow.nodes.map((x) => (x.id === 'n_comment_entry' ? { ...x, data: { ...x.data, code: NEW_CODE } } : x));
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto',
        'return (async function(){"use strict";\n' + NEW_CODE + '\n})();');
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
