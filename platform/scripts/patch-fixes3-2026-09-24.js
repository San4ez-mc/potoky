'use strict';
// Patch (source of truth), третя хвиля виправлень за QA-набором 2026-09-24.
//  Онбординг: зберігати в ТОМУ Ж ході (кейс, переваги), спрощене qaExpectation ноди агента (без сценарних умов, які суддя
//    невдало застосовував до кожного прогону).
//  Content Manager: підтверджувати виконані дії; відповіді про стратегію/теми — з конкретикою профілю.
//  QA: чистий проєкт «QA — Content Manager» (старий був забруднений тестами онбордингу).
// Idempotent. Run on the server:  node scripts/patch-fixes3-2026-09-24.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');
const { PROFILE } = require('./qa/qa-profile');

const ONBOARD = 'ab566038-395e-4da8-b500-8f9b226bc77a';
const CM = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const QA_CM_PROJECT = 'QA — Content Manager';
const out = [];

async function nodeOf(botId, nodeId) {
    const f = await callTool('get_funnel', { botId });
    const n = f.nodes.find((x) => x.id === nodeId);
    if (!n) throw new Error('node not found ' + nodeId);
    return n;
}
async function replaceIn(botId, nodeId, field, from, to, alreadyHas) {
    const n = await nodeOf(botId, nodeId);
    const cur = String(n.data[field] || '');
    if (alreadyHas && cur.includes(alreadyHas)) { out.push(`${nodeId}.${field}: already`); return; }
    if (!cur.includes(from)) throw new Error(`${nodeId}.${field}: фрагмент не знайдено: ${from.slice(0, 60)}`);
    await callTool('update_node', { botId, nodeId, data: { [field]: cur.replace(from, to) } });
    out.push(`${nodeId}.${field}: patched`);
}

async function main() {
    // ── Онбординг ───────────────────────────────────────────────────────────
    await replaceIn(ONBOARD, 'n_agent', 'systemPrompt',
        'ПІДТВЕРДЖЕНА ГІПОТЕЗА:',
        'ЗБЕРІГАЙ У ТОМУ Ж ХОДІ: кожне повідомлення клієнта з новою інформацією про бізнес = виклик save у ЦЬОМУ Ж ході, ДО відповіді (не «збережу потім» і не «уточню й тоді збережу»). ' +
        'Особливість/перевага бізнесу («печу тільки на вершковому маслі») → save kind:"brand" (title:"Переваги") або в product.benefits; профіль засновника — kind:"founder".\n' +
        'КЕЙС: якщо клієнт назвав, хто клієнт, яка була ситуація і який результат — зберігай кейс ОДРАЗУ (навіть якщо деталей небагато), привʼязавши до продукту; ' +
        'після збереження постав НЕ більше одного уточнення (напр. чи є точні цифри) і не перепитуй те, що клієнт уже сказав. Нічого не домислюй.\n' +
        'ПІДТВЕРДЖЕНА ГІПОТЕЗА:',
        'ЗБЕРІГАЙ У ТОМУ Ж ХОДІ:');

    await callTool('update_node', {
        botId: ONBOARD, nodeId: 'n_agent',
        data: {
            qaExpectation:
                'Агент онбордингу: відповідає зрозуміло й по-людськи українською на «ти» (списки гіпотез чи тем до 3-4 пунктів допустимі), 1-2 питання за раз; ' +
                'НЕ вигадує факти про клієнта; не перепитує те, що клієнт уже сказав; і не каже, що щось «збережено», якщо відповідного успішного виклику save у цьому ході не було.',
        },
    });
    out.push('onboard qaExpectation: simplified');

    // ── Content Manager: агент ──────────────────────────────────────────────
    await replaceIn(CM, 'node_agent_content_mgr', 'systemPrompt',
        'ПОКАЗ ПОСТІВ (обовʼязково):',
        'ПІДТВЕРДЖУЙ ДІЇ: після успішного create_post / edit_post / delete_post(s) / save_rule коротко скажи, що саме зроблено (номер поста, що змінилось / яке правило збережено).\n' +
        'СТРАТЕГІЯ І ТЕМИ: відповідаючи на питання про теми, рубрики чи стратегію — спирайся на дані профілю (get_strategy, get_topics) і НАЗИВАЙ конкретні контент-стовпи та теми з банку проєкту, а не загальні поради.\n\n' +
        'ПОКАЗ ПОСТІВ (обовʼязково):',
        'ПІДТВЕРДЖУЙ ДІЇ:');

    // ── QA: чистий проєкт для Content Manager ───────────────────────────────
    const secretRow = await db.funnelKey.findUnique({ where: { botId_key: { botId: ONBOARD, key: 'CONTENT2_WEBHOOK_SECRET' } }, select: { value: true } });
    const secret = secretRow && secretRow.value;
    const save = async (body) => {
        const r = await fetch('http://localhost:3002/api/webhooks/onboarding-save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret }, body: JSON.stringify(body) });
        const j = await r.json();
        if (!j.ok) throw new Error('onboarding-save failed: ' + JSON.stringify(j).slice(0, 200));
        return j;
    };
    const first = await save({ projectName: QA_CM_PROJECT, kind: PROFILE[0].kind, data: PROFILE[0].data });
    for (const item of PROFILE.slice(1)) await save({ projectId: first.projectId, kind: item.kind, data: item.data });
    await callTool('update_funnel_key', { botId: CM, key: 'CONTENT2_TEST_PROJECT_ID', value: first.projectId, label: 'Ізольований QA-проєкт Content Manager' });
    out.push('CM QA project: ' + first.projectId);

    console.log(out.join('\n'));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); console.log(out.join('\n')); process.exit(1); });
