'use strict';
// Patch (source of truth): context.topicHistory (30-денна історія постів з content2,
// вузли "topicHistory: list_posts (30d)" + "topicHistory: parse posts") рахувалась
// щоразу, але НІКОЛИ не потрапляла у промпт ST:Generate — жодного {{context.topicHistory}}
// у messagesTemplate/systemPrompt. Модель бачила лише batchDoneTopics — акумулятор
// ЛОКАЛЬНИЙ для одного HTTP-запиту (одного self-continue шматка плану). Для великого
// плану (>10 постів) кожен наступний шматок стартує з batchDoneTopics='ще немає' —
// про попередні шматки того ж плану модель нічого не знає.
// Наслідок (виявлено 2026-09-29 на реальній генерації для KIRO, план 3/день×14 днів,
// 6 self-continue шматків): одні й ті самі хуки повторювались 3-6 разів у 2-тижневому
// плані («скільки разів ти дізнавався про подію вже після неї», «ще один додаток —
// є ж Telegram/Google», «субота вранці гортаю телеграм-канали» тощо).
// Фікс: додаємо {{context.topicHistory}} у messagesTemplate. Він перезапитується
// СВІЖИМ з content2 на КОЖНОМУ виклику воронки, включно з self-continue-шматками —
// на момент шматка 2 пости шматка 1 вже збережені в content2 і потраплять у 30-денну
// вибірку. Це закриває і повтори всередині одного плану, і повтори з попередніх днів.
// Idempotent. Run on the server:  node scripts/patch-cm-topic-history-2026-09-29.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const CM = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const NODE_ID = 'node_1780590932392'; // "ST: Generate (Sonnet)"
const MARK = 'ОСТАННІ ПОСТИ ЗА 30 ДНІВ';

async function main() {
    const f = await callTool('get_funnel', { botId: CM });
    const n = f.nodes.find((x) => x.id === NODE_ID);
    const mt = String(n.data.messagesTemplate);
    if (mt.includes(MARK)) { console.log('already patched'); return; }

    const needle = 'ВЖЕ ЗГЕНЕРОВАНО В ЦЬОМУ ПЛАНІ (не повторюй теми): {{context.batchDoneTopics}}';
    if (!mt.includes(needle)) throw new Error('маркер "ВЖЕ ЗГЕНЕРОВАНО В ЦЬОМУ ПЛАНІ" не знайдено в messagesTemplate — текст змінився, патч треба оновити вручну');

    const insert = MARK + ' (НЕ повторюй ці теми й хуки — навіть переформульовані іншими словами): {{context.topicHistory}}\\n\\n' + needle;
    const newMt = mt.split(needle).join(insert);

    await callTool('update_node', { botId: CM, nodeId: NODE_ID, data: { messagesTemplate: newMt } });
    console.log('patched: ST: Generate тепер бачить {{context.topicHistory}} (30-денну історію) в промпті');
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
