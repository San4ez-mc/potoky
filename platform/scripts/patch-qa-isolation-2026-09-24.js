'use strict';
// Patch (source of truth): ізольоване QA-середовище для тестів воронок онбордингу й Content Manager.
//  1) content2: проєкти «QA — тести воронок» (наповнений профіль) і «QA — порожній» (для гейта).
//  2) ключ CONTENT2_TEST_PROJECT_ID на обох воронках.
//  3) guard у нодах: у testMode онбординг/Content Manager працюють лише з QA-проєктом (не з реальними компаніями).
//  4) qaExpectation на ключових нодах (суддя перевіряє їх на КОЖНОМУ прогоні).
// Idempotent. Run on the server:  node scripts/patch-qa-isolation-2026-09-24.js

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');
const { QA_PROJECT_NAME, QA_EMPTY_PROJECT_NAME, PROFILE } = require('./qa/qa-profile');

const ONBOARD = 'ab566038-395e-4da8-b500-8f9b226bc77a';
const CM = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const C2 = 'http://localhost:3002';
const GUARD_MARK = 'CONTENT2_TEST_PROJECT_ID';

async function c2Save(secret, body) {
    const r = await fetch(C2 + '/api/webhooks/onboarding-save', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret },
        body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) throw new Error('onboarding-save failed: ' + JSON.stringify(j).slice(0, 300));
    return j;
}

async function main() {
    const out = {};

    // ── 1. content2 QA projects ─────────────────────────────────────────────
    const secretRow = await db.funnelKey.findUnique({ where: { botId_key: { botId: ONBOARD, key: 'CONTENT2_WEBHOOK_SECRET' } }, select: { value: true } });
    const secret = secretRow && secretRow.value;
    if (!secret) throw new Error('CONTENT2_WEBHOOK_SECRET missing on onboard funnel');

    const first = await c2Save(secret, { projectName: QA_PROJECT_NAME, kind: PROFILE[0].kind, data: PROFILE[0].data });
    const qaId = first.projectId;
    for (const item of PROFILE.slice(1)) await c2Save(secret, { projectId: qaId, kind: item.kind, data: item.data });
    const empty = await c2Save(secret, { projectName: QA_EMPTY_PROJECT_NAME, kind: 'brand', data: { title: 'Створення профілю', content: 'Порожній QA-проєкт для перевірки гейта.' } });
    out.qaProjectId = qaId;
    out.qaEmptyProjectId = empty.projectId;

    // ── 2. keys ─────────────────────────────────────────────────────────────
    for (const botId of [ONBOARD, CM]) {
        await callTool('update_funnel_key', { botId, key: 'CONTENT2_TEST_PROJECT_ID', value: qaId, label: 'Ізольований QA-проєкт для funnel-тестів' });
    }

    // ── 3. guards ───────────────────────────────────────────────────────────
    const ob = await callTool('get_funnel', { botId: ONBOARD });
    const resolveNode = ob.nodes.find((n) => n.id === 'n_resolve_project');
    if (String(resolveNode.data.code).includes(GUARD_MARK)) {
        out.onboardGuard = 'already present';
    } else {
        const guard = "// funnel-тести: лише ізольований QA-проєкт, не створюємо «Клієнт TG…» і не чіпаємо реальні компанії\n" +
            "if (context.testMode && keys.CONTENT2_TEST_PROJECT_ID) { return { content2ProjectId: keys.CONTENT2_TEST_PROJECT_ID, startArg: null }; }\n";
        await callTool('update_node', { botId: ONBOARD, nodeId: 'n_resolve_project', data: { code: guard + resolveNode.data.code } });
        out.onboardGuard = 'added';
    }

    const cm = await callTool('get_funnel', { botId: CM });
    const pickNode = cm.nodes.find((n) => n.data && n.data.label === 'Обрати проєкт (контекст → збережений → за замовчуванням)');
    if (!pickNode) throw new Error('pick-project node not found');
    await callTool('update_node', { botId: CM, nodeId: pickNode.id, data: { code: fs.readFileSync(path.join(__dirname, 'handoff', 'pick-project.js'), 'utf8') } });
    out.cmGuard = 'pick-project code updated';

    // ── 4. qaExpectation ────────────────────────────────────────────────────
    const qa = async (botId, nodeId, text) => callTool('update_node', { botId, nodeId, data: { qaExpectation: text } });
    await qa(ONBOARD, 'n_agent',
        'Агент онбордингу: пише коротко (2-4 речення) українською на «ти», ставить 1-2 питання за раз; на старті викликає get_profile й називає компанію; ' +
        'дані клієнта зберігає інструментом save одразу і з правильним kind; не перепитує те, що клієнт уже сказав або що вже є в профілі; ' +
        'не відсилає клієнта генерувати пости вручну на сайті; на прохання згенерувати пости чи коли профіль повний — підсумовує й викликає finish_onboarding.');
    await qa(ONBOARD, 'n_done',
        'Після завершення онбордингу надсилається повідомлення «Документи онбордингу створені» з посиланнями на content2 і пропозицією перейти до Content Manager.');
    await qa(CM, 'node_1780590851896',
        'Диспетчер повертає валідний JSON з intent із {create, edit, save_rule, new_plan, dialog}; для create правильно розбиває запит на tasks (format/platform/count/date/topic); ' +
        'не задає уточнень текстом.');
    await qa(CM, 'node_agent_content_mgr',
        'Content Agent виконує запит через інструменти (list_posts/get_post/edit_post/save_rule/get_* тощо) без вигаданих даних; тексти постів виводить окремими code-блоками; ' +
        'пише від імені бізнесу поточного проєкту і НЕ згадує чужого автора чи проєкт (Олександр Мацук, FINEKO, консалтинг з автоматизації), якщо поточний проєкт інший.');
    out.qaExpectations = 'set on 5 nodes';

    console.log(JSON.stringify(out, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
