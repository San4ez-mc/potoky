'use strict';
// Patch (source of truth), друга хвиля виправлень за QA-набором 2026-09-24.
//  1) Content Manager: історія діалогу для диспетчера з сесії (у Telegram context.history був порожній) — нода перед Setup context.
//  2) Онбординг: одразу зберігає підтверджену гіпотезу; на «що ще потрібно» перечитує get_profile; архетип лише з query_vector;
//     посилання/«збережено» лише після успішного save.
//  3) Окремий QA-проєкт «QA — онбординг» для онбордингу (щоб тести онбордингу не забруднювали проєкт Content Manager).
// Idempotent. Run on the server:  node scripts/patch-fixes2-2026-09-24.js

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');
const { PROFILE } = require('./qa/qa-profile');

const ONBOARD = 'ab566038-395e-4da8-b500-8f9b226bc77a';
const CM = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const QA_ONBOARD_PROJECT = 'QA — онбординг';
const out = [];

async function nodeOf(botId, nodeId) {
    const f = await callTool('get_funnel', { botId });
    const n = f.nodes.find((x) => x.id === nodeId);
    if (!n) throw new Error('node not found ' + nodeId);
    return { node: n, funnel: f };
}
async function replaceIn(botId, nodeId, field, from, to, alreadyHas) {
    const { node } = await nodeOf(botId, nodeId);
    const cur = String(node.data[field] || '');
    if (alreadyHas && cur.includes(alreadyHas)) { out.push(`${nodeId}.${field}: already`); return; }
    if (!cur.includes(from)) throw new Error(`${nodeId}.${field}: фрагмент не знайдено: ${from.slice(0, 60)}`);
    await callTool('update_node', { botId, nodeId, data: { [field]: cur.replace(from, to) } });
    out.push(`${nodeId}.${field}: patched`);
}

async function main() {
    // ── 1. CM: історія діалогу з сесії ──────────────────────────────────────
    const { funnel: cm } = await nodeOf(CM, 'node_1780590806221'); // Setup context
    if (cm.nodes.some((n) => n.data && n.data.label === 'Історія діалогу з сесії')) {
        out.push('cm history node: already');
    } else {
        const swCond = cm.nodes.find((n) => n.data && n.data.label === 'Це перемикання проєкту?');
        if (!swCond) throw new Error('sw cond node not found (запусти patch-onboard-handoff спершу)');
        const old = cm.edges.find((e) => e.source === swCond.id && e.target === 'node_1780590806221');
        if (!old) throw new Error('edge swCond -> Setup not found');
        const hist = (await callTool('add_node', {
            botId: CM, type: 'js', position: { x: 0, y: 0 },
            data: { label: 'Історія діалогу з сесії', code: fs.readFileSync(path.join(__dirname, 'handoff', 'hist-build.js'), 'utf8') },
        })).added.id;
        await callTool('delete_edge', { botId: CM, edgeId: old.id });
        await callTool('create_edge', { botId: CM, source: swCond.id, target: hist });      // appended => index1 (звичайний потік)
        await callTool('create_edge', { botId: CM, source: hist, target: 'node_1780590806221' });
        await callTool('auto_layout', { botId: CM });
        out.push('cm history node: added + rewired');
    }

    // ── 2. Онбординг: промпт ────────────────────────────────────────────────
    await replaceIn(ONBOARD, 'n_agent', 'systemPrompt',
        'НЕ ПЕРЕПИТУЙ:',
        'ПІДТВЕРДЖЕНА ГІПОТЕЗА: коли клієнт підтвердив гіпотезу («підходить», «збережи», «так, друга») — ОДРАЗУ викликай save (kind=persona/…) з полями з цієї гіпотези, без додаткових питань ПЕРЕД збереженням; уточнення — після збереження.\n' +
        'ЩО ЩЕ ТРЕБА / ЩО ДАЛІ: щоразу, коли клієнт питає «що ще потрібно», «що далі», «чи повний профіль» — ЗАВЖДИ заново виклич get_profile і перелічи реальні прогалини (gaps); ' +
        'якщо прогалин нема — так і скажи (профіль повний, прогрес) і запропонуй 1-2 корисні кроки (лід-магніт, ще кейси, перехід до генерації постів).\n' +
        'АРХЕТИП: пропонуй ЛИШЕ з результатів query_vector (2-3 найближчі, з їхнім описом з бази); не вигадуй архетип з голови. ' +
        'Посилання «👀» і слова «збережено/оновлено» — ТІЛЬКИ після успішного save (статус 200), не раніше.\n\nНЕ ПЕРЕПИТУЙ:',
        'ПІДТВЕРДЖЕНА ГІПОТЕЗА:');

    // ── 3. Окремий QA-проєкт для онбордингу ─────────────────────────────────
    const secretRow = await db.funnelKey.findUnique({ where: { botId_key: { botId: ONBOARD, key: 'CONTENT2_WEBHOOK_SECRET' } }, select: { value: true } });
    const secret = secretRow && secretRow.value;
    const save = async (body) => {
        const r = await fetch('http://localhost:3002/api/webhooks/onboarding-save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret }, body: JSON.stringify(body) });
        const j = await r.json();
        if (!j.ok) throw new Error('onboarding-save failed: ' + JSON.stringify(j).slice(0, 200));
        return j;
    };
    const first = await save({ projectName: QA_ONBOARD_PROJECT, kind: PROFILE[0].kind, data: PROFILE[0].data });
    for (const item of PROFILE.slice(1)) await save({ projectId: first.projectId, kind: item.kind, data: item.data });
    await callTool('update_funnel_key', { botId: ONBOARD, key: 'CONTENT2_TEST_PROJECT_ID', value: first.projectId, label: 'Ізольований QA-проєкт онбордингу' });
    out.push('onboard QA project: ' + first.projectId);

    console.log(out.join('\n'));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); console.log(out.join('\n')); process.exit(1); });
