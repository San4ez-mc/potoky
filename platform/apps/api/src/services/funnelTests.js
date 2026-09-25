'use strict';

// Повноцінна система тестування воронок. На відміну від regressionRunner.js
// (старий "smoke"-прогін 3 випадкових повідомлень, який завжди звітував "успіх"),
// тут:
//  - тест — збережена сутність (FunnelTest) з явним "steps" (кроки клієнта, що
//    відтворюють РЕАЛЬНИЙ вхідний: текст/фото/пересланий пост/перехід з реклами —
//    той самий "конверт", що приймає testSession.sendTestTurn, зібраний так само,
//    як production-хендлери (instagramHandler.extractReferral, zernioHandler
//    sharedPost) будують його з живого вебхука);
//  - і явним "expectedOutcome" — вільний текст, яким автор тесту фіксує ЩО САМЕ
//    перевіряється. Pass/fail визначає НЕ факт відсутності exception (як було), а
//    LLM-суддя (обраний connectorId), що читає повну транскрипцію діалогу;
//  - додатково суддя звіряє КОЖНУ ноду, відвідану під час прогону, з її власним
//    data.qaExpectation (якщо автор воронки його заповнив у редакторі ноди) — це
//    ловить регресії в нодах, які тест не мав на меті перевірити;
//  - при провалі — пишеться AppError з context.nodeId на кожну "винну" ноду, тож
//    вона підсвічується у вкладці «Ноди» сесії так само, як звичайна помилка виконання.

const crypto = require('crypto');
const { db } = require('@platform/db');
const { callClaude } = require('@platform/claude');
const { startTestSession, sendTestTurn, endTestSession } = require('./testSession');
const shopAgent = require('./shopAgent');
const { checkInvariants } = require('./funnelInvariants');

/**
 * Один хід клієнта для бота на shopAgent: пишемо повідомлення клієнта в сесію так, як це
 * робить zernioHandler (пост → "[переслав post] підпис", фото → "[фото]"), кладемо в
 * контекст реферал реклами, і викликаємо shopAgent.handleTurn (він сам пише відповіді бота
 * в БД і поважає testMode для сесій із isTest).
 */
async function runAgentTurn({ botId, sessionId, step }) {
    let text = step.text || '';
    if (step.sharedPost) {
        const sp = step.sharedPost;
        const shared = '[переслав ' + (sp.kind || 'post') + '] ' + String(sp.caption || '').slice(0, 4000);
        text = text ? shared + '\n' + text : shared;
    } else if (step.imageUrl && !text) text = '[фото]';

    const adId = step.entryAdId || (step.referral && step.referral.adId) || null;
    if (step.referral) {
        const s = await db.session.findUnique({ where: { id: sessionId }, select: { context: true } });
        const ctx = { ...(s && s.context ? s.context : {}), lastReferral: { ads_context_data: { ad_title: step.referral.adTitle || '' }, ...step.referral }, adTitle: step.referral.adTitle || '' };
        await db.session.update({ where: { id: sessionId }, data: { context: ctx } });
    }

    await db.message.create({
        data: {
            sessionId,
            role: 'user',
            content: text || '',
            metadata: { source: 'test', ...(step.imageUrl ? { imageUrl: step.imageUrl } : {}), ...(step.sharedPost ? { sharedPost: step.sharedPost } : {}), ...(step.referral ? { referral: step.referral } : {}) },
        },
    });
    await shopAgent.handleTurn({ botId, sessionId, text, imageUrl: step.imageUrl || undefined, sharedPost: step.sharedPost || undefined, entryAdId: adId || undefined });
}

function normalizeStep(step) {
    return {
        type: step.type || 'text',
        text: typeof step.text === 'string' ? step.text : '',
        imageUrl: step.imageUrl || null,
        sharedPost: step.sharedPost || null,
        referral: step.referral || null,
        entryAdId: step.entryAdId || null,
        delayMs: Number.isFinite(step.delayMs) ? step.delayMs : null,
        bankPaid: Number(step.bankPaid) > 0 ? Number(step.bankPaid) : null, // імітація: на рахунок надійшла оплата на цю суму (тестова виписка)
    };
}

async function resolveJudgeApiKey(connectorId) {
    if (connectorId) {
        const c = await db.savedConnector.findUnique({ where: { id: connectorId }, select: { config: true } }).catch(() => null);
        const k = c?.config?.apiKey || c?.config?.api_key || c?.config?.key;
        if (k) return k;
    }
    const sys = await db.savedConnector.findFirst({
        where: { type: 'system_claude_api', isActive: true },
        orderBy: { updatedAt: 'desc' },
    }).catch(() => null);
    const sysKey = sys?.config?.apiKey || '';
    if (sysKey) return sysKey;
    const envKey = process.env.ANTHROPIC_API_KEY || '';
    return envKey && envKey !== 'placeholder_update_me' ? envKey : '';
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

async function listTests(botId) {
    return db.funnelTest.findMany({
        where: { botId },
        orderBy: { createdAt: 'desc' },
        include: { runs: { orderBy: { startedAt: 'desc' }, take: 1 } },
    });
}

async function getTest(testId) {
    const test = await db.funnelTest.findUnique({
        where: { id: testId },
        include: { runs: { orderBy: { startedAt: 'desc' }, take: 20 } },
    });
    if (!test) throw new Error('Test not found');
    return test;
}

async function createTest({ botId, name, description, steps, expectedOutcome, connectorId, sourceSessionId, createdBy }) {
    if (!botId) throw new Error('botId is required');
    if (!name || !name.trim()) throw new Error('name is required');
    if (!expectedOutcome || !expectedOutcome.trim()) throw new Error('expectedOutcome is required — саме по ньому визначається пройдений тест чи ні');
    const normSteps = Array.isArray(steps) ? steps.map(normalizeStep) : [];
    if (normSteps.length === 0) throw new Error('Тест має містити хоча б один крок');

    return db.funnelTest.create({
        data: {
            botId,
            name: name.trim(),
            description: description || null,
            steps: normSteps,
            expectedOutcome: expectedOutcome.trim(),
            connectorId: connectorId || null,
            sourceSessionId: sourceSessionId || null,
            createdBy: createdBy || null,
        },
    });
}

async function updateTest(testId, patch) {
    const data = {};
    if (patch.name !== undefined) data.name = patch.name.trim();
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.steps !== undefined) data.steps = Array.isArray(patch.steps) ? patch.steps.map(normalizeStep) : [];
    if (patch.expectedOutcome !== undefined) data.expectedOutcome = patch.expectedOutcome.trim();
    if (patch.connectorId !== undefined) data.connectorId = patch.connectorId || null;
    return db.funnelTest.update({ where: { id: testId }, data });
}

async function deleteTest(testId) {
    await db.testRun.deleteMany({ where: { testId } });
    await db.funnelTest.delete({ where: { id: testId } });
    return { ok: true };
}

async function duplicateTest(testId) {
    const src = await db.funnelTest.findUnique({ where: { id: testId } });
    if (!src) throw new Error('Test not found');
    return db.funnelTest.create({
        data: {
            botId: src.botId,
            name: `${src.name} (копія)`,
            description: src.description,
            steps: src.steps,
            expectedOutcome: src.expectedOutcome,
            connectorId: src.connectorId,
            sourceSessionId: src.sourceSessionId,
            createdBy: src.createdBy,
        },
    });
}

// Будує steps[] з реальної історії сесії — використовується кнопкою "Створити тест
// з цієї сесії" (позначив повідомлення помилковим → одразу відтворити ВЕСЬ шлях
// клієнта, включно з пересланими постами/фото/переходом з реклами, а не лише текст).
async function createTestFromSession(sessionId, { name, expectedOutcome, connectorId, uptoMessageId, createdBy }) {
    const session = await db.session.findUnique({ where: { id: sessionId }, include: { bot: true } });
    if (!session) throw new Error('Session not found');

    const messages = await db.message.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    let cutoffAt = null;
    if (uptoMessageId) {
        const target = messages.find((m) => m.id === uptoMessageId);
        if (target) cutoffAt = target.createdAt;
    }

    const userMessages = messages.filter((m) => m.role === 'user' && (!cutoffAt || m.createdAt <= cutoffAt));
    const steps = userMessages.map((m) => {
        const meta = m.metadata || {};
        const sharedPost = meta.sharedPost || null;
        const referral = meta.referral || null;
        const imageUrl = meta.imageUrl || meta.lastReceiptImageUrl || null;
        let type = 'text';
        if (sharedPost) type = 'forward_post';
        else if (referral) type = 'ad_reply';
        else if (imageUrl) type = 'photo';
        return normalizeStep({
            type,
            text: m.content || '',
            imageUrl,
            sharedPost,
            referral,
            entryAdId: meta.entryAdId || null,
        });
    });

    if (steps.length === 0) {
        throw new Error('У цій сесії немає повідомлень клієнта для відтворення');
    }

    return createTest({
        botId: session.botId,
        name: name || `Тест із сесії ${sessionId.slice(0, 8)} (${session.bot?.name || ''})`,
        description: `Автоматично створено з реальної сесії ${sessionId}`,
        steps,
        expectedOutcome,
        connectorId,
        sourceSessionId: sessionId,
        createdBy,
    });
}

// ── Runner ───────────────────────────────────────────────────────────────────

// Виклики інструментів агента та зовнішніх систем за сесію (збереження в content2, MCP, http-ноди…).
// Клієнт їх не бачить у діалозі, тож без цього суддя не може перевірити «бот РЕАЛЬНО зберіг дані».
// Службові рядки моделі (claude / agent-context) пропускаємо — там лише шум.
async function collectToolEvidence(sessionId) {
    const calls = await db.apiCall.findMany({
        where: { sessionId, NOT: { service: { in: ['claude', 'agent'] } } },
        orderBy: { createdAt: 'asc' },
        take: 80,
        select: { service: true, method: true, requestData: true, responseData: true, statusCode: true, error: true },
    }).catch(() => []);
    const clip = (v, n) => { const s = typeof v === 'string' ? v : JSON.stringify(v || {}); return s.length > n ? s.slice(0, n) + '…' : s; };
    return calls.map((c, i) => {
        const req = c.requestData || {};
        const res = c.responseData || {};
        return `${i + 1}. ${c.service}.${c.method} [${c.statusCode == null ? 'n/a' : c.statusCode}]${c.error ? ' ПОМИЛКА: ' + clip(c.error, 200) : ''}\n   запит: ${clip(req.input !== undefined ? req.input : req, 500)}\n   відповідь: ${clip(res.preview !== undefined ? res.preview : res, 400)}`;
    }).join('\n');
}

function buildJudgePrompt({ test, transcript, nodeQaEntries, stateText, toolText }) {
    const transcriptText = transcript
        .map((m) => `${m.role === 'user' ? 'КЛІЄНТ' : 'БОТ'}: ${m.content}`)
        .join('\n');

    const nodeQaText = nodeQaEntries.length
        ? nodeQaEntries.map((n, i) => `${i + 1}. Нода "${n.label || n.nodeId}" (${n.nodeId}): очікується — ${n.qaExpectation}\n   Вхід ноди (userInput): ${n.userInput || '(немає)'}\n   Ефект ноди (зміни контексту): ${n.outputSummary}`).join('\n\n')
        : '(жодна відвідана нода не має власних QA-очікувань)';

    const system = [
        'Ти — QA-суддя для чат-воронки (Telegram/Instagram-бот на базі LLM).',
        'Тобі дають: 1) що очікується від УСЬОГО тесту (expectedOutcome), 2) повну транскрипцію діалогу клієнт↔бот,',
        '3) список нод, які автор воронки позначив власними QA-очікуваннями (перевіряй їх НЕЗАЛЕЖНО від головного expectedOutcome — це регресійні перевірки, навіть якщо цей тест писався не для них).',
        'Відповідай ЛИШЕ строгим JSON — НІЯКОГО тексту, аналізу чи markdown до або після нього; починай відповідь одразу з символу {. Поле reasoning — не довше 700 символів:',
        '{"passed": boolean, "reasoning": "коротко чому", "failingNodeId": "id ноди-винуватця або null", "nodeVerdicts": [{"nodeId":"...","passed":boolean,"reasoning":"..."}]}',
        'passed=false якщо: головна мета тесту НЕ досягнута, АБО бот вигадав факт (ціну/наявність/дані клієнта), АБО зациклився, АБО замовк, АБО хоч ОДНА нода зі списку QA-очікувань не виконала своє очікування.',
        'nodeVerdicts — по одному запису на КОЖНУ ноду зі списку QA-очікувань вище (навіть якщо вона не винна).',
        'Якщо тест вимагає, щоб бот щось зберіг/викликав (профіль, пости, правила, пошук у базі знань) — звіряй із розділом «ВИКЛИКИ ІНСТРУМЕНТІВ»: слова бота «зберіг» без відповідного успішного виклику (статус 200, ok:true) = вигадка й провал.',
    ].join(' ');

    const user = [
        `Назва тесту: ${test.name}`,
        `Що перевіряємо (expectedOutcome): ${test.expectedOutcome}`,
        '',
        '=== ТРАНСКРИПЦІЯ ДІАЛОГУ ===',
        transcriptText || '(порожньо — бот жодного разу не відповів)',
        ...(stateText ? ['', '=== ФІНАЛЬНИЙ СТАН ЗАМОВЛЕННЯ У СИСТЕМІ (структуровані дані, клієнт їх не бачить; джерело правди про те, що реально зафіксовано) ===', stateText] : []),
        '',
        '=== НОДИ З ВЛАСНИМИ QA-ОЧІКУВАННЯМИ, ВІДВІДАНІ ПІД ЧАС ЦЬОГО ПРОГОНУ ===',
        nodeQaText,
        ...(toolText ? ['', '=== ВИКЛИКИ ІНСТРУМЕНТІВ І ЗОВНІШНІХ СИСТЕМ ПІД ЧАС ПРОГОНУ (клієнт їх не бачить; джерело правди про збереження й пошук) ===', toolText] : []),
    ].join('\n');

    return { system, user };
}

async function runTest(testId, onProgress = () => {}) {
    const test = await db.funnelTest.findUnique({ where: { id: testId } });
    if (!test) throw new Error('Test not found');

    const run = await db.testRun.create({
        data: { testId: test.id, botId: test.botId, status: 'running', connectorId: test.connectorId || null },
    });

    try {
        const flow = await db.flowDefinition.findUnique({ where: { botId: test.botId } });
        const nodesById = new Map((flow?.nodes || []).map((n) => [n.id, n]));

        const steps = Array.isArray(test.steps) ? test.steps : [];
        const firstStepIsRaw = steps[0] && steps[0].type === 'text';
        // 2026-09-23: боти на shopAgent v2 (SHOP_AGENT_V2=1) у проді відповідають через
        // shopAgent.handleTurn (zernioHandler), а НЕ через граф flow-двигуна — раніше тест
        // ганяв стару графову гілку, яку клієнти вже не бачать. Для таких ботів тест іде
        // ТИМ САМИМ шляхом, що й живий клієнт (без привітання-preran: у живому каналі бот
        // мовчить, доки клієнт не напише першим).
        const agentMode = await shopAgent.isAgentBot(test.botId).catch(() => false);
        const started = await startTestSession({
            botId: test.botId,
            contextOverride: (agentMode || !firstStepIsRaw) ? { noPrerun: true } : {},
        });

        const sessionId = started.sessionId;
        const visitedNodeIds = new Set();

        onProgress({ phase: 'started', sessionId });
        for (let i = 0; i < steps.length; i += 1) {
            const step = normalizeStep(steps[i]);
            const label = step.text || (step.sharedPost ? '[пересланий пост]' : step.imageUrl ? '[фото]' : step.referral ? '[перехід з реклами]' : '');
            onProgress({ phase: 'step', index: i, total: steps.length, label: String(label).slice(0, 80), sessionId });
            if (step.bankPaid) { global.__testBankPaid = global.__testBankPaid || {}; global.__testBankPaid[sessionId] = step.bankPaid; } // тестова виписка: читає shopAgent/tools.monoStatement (у тому ж процесі)
            if (agentMode) {
                await runAgentTurn({ botId: test.botId, sessionId, step });
                continue;
            }
            const turn = await sendTestTurn({
                sessionId,
                text: step.text,
                imageUrl: step.imageUrl,
                sharedPost: step.sharedPost,
                referral: step.referral,
                entryAdId: step.entryAdId,
            });
            for (const tr of turn.newNodeTraces || []) visitedNodeIds.add(tr.nodeId);
        }

        const finalSession = await db.session.findUnique({
            where: { id: sessionId },
            include: { messages: { orderBy: { createdAt: 'asc' } } },
        });
        await endTestSession({ sessionId });

        const transcript = finalSession.messages
            .filter((m) => (m.role === 'user' || m.role === 'assistant') && !(m.metadata && m.metadata.hidden))
            .map((m) => {
                // Фото бота (метадані attachment) без тексту раніше виглядали для судді як порожній рядок —
                // і він вирішував, що бот «обіцяв сітку, але не надіслав».
                const att = m.metadata && m.metadata.attachment;
                if (m.role === 'assistant' && att) {
                    const n = Array.isArray(att.urls) ? att.urls.length : (Array.isArray(att.photoUrls) ? att.photoUrls.length : 1);
                    return { role: m.role, content: '[бот надіслав фото ×' + n + (m.content ? ' з підписом: ' + m.content : '') + ']' };
                }
                return { role: m.role, content: m.content };
            });
        // Знімок стану замовлення (структура, якої клієнт не бачить у тексті): судді треба знати, що РЕАЛЬНО
        // зафіксовано — позиції, кольори допродажу, суми, адреса — а не лише що бот сказав.
        const c = finalSession.context || {};
        const stateRaw = JSON.stringify({
            crmOrderId: c.crmOrderId, payment: c.paymentInfo, payAmount: c.payAmount, payStatus: c.payStatus,
            mainProduct: c.product && { sku: c.product.sku, name: c.product.customerName || c.product.name, isSet: c.product.isSet, setItems: Array.isArray(c.product.setItems) ? c.product.setItems.map((i) => i.article) : undefined },
            colorChoice: c.colorChoice, recommendedSize: c.recommendedSize,
            setSelection: Array.isArray(c.setSelection) ? c.setSelection.map((i) => ({ article: i.article, color: i.color, size: i.size, qty: i.qty, price: i.price })) : undefined,
            upsellItem: c.product && Array.isArray(c.product.upsellItems) && c.product.upsellItems[0] ? { sku: c.product.upsellItems[0].sku, name: c.product.upsellItems[0].name, price: c.product.upsellItems[0].price } : undefined,
            orderIntent: c.orderIntent && { addUpsell: c.orderIntent.addUpsell, upsellQty: c.orderIntent.upsellQty, upsellUnits: c.orderIntent.upsellUnits },
            orderUnits: c.orderUnits, orderTotal: c.orderTotal, orderData: c.orderData,
            extraItems: Array.isArray(c.extraItems) && c.extraItems.length ? c.extraItems.map((i) => ({ sku: i.sku, name: i.name, color: i.color, size: i.size, qty: i.qty, price: i.price })) : undefined,
            managerAlertsSent: c.testAlerts && c.testAlerts.length ? c.testAlerts : undefined,
            handoffPaused: c.funnelPaused || undefined,
        });
        // Не-магазинні воронки (онбординг, Content Manager…) не мають цих полів → "{}". Порожній обʼєкт суддя
        // читає як «нічого не збережено», тому для них блок стану не показуємо (докази — у розділі викликів інструментів).
        const stateText = stateRaw === '{}' ? '' : stateRaw;

        const allTraces = finalSession.context?.flowRuntime?.nodeTraces || [];
        const nodeQaEntries = [];
        for (const nodeId of visitedNodeIds) {
            const node = nodesById.get(nodeId);
            const qaExpectation = node?.data?.qaExpectation;
            if (!qaExpectation || !qaExpectation.trim()) continue;
            const lastTrace = [...allTraces].reverse().find((t) => t.nodeId === nodeId);
            nodeQaEntries.push({
                nodeId,
                label: node?.data?.label || nodeId,
                qaExpectation: qaExpectation.trim(),
                userInput: lastTrace?.userInput || '',
                outputSummary: lastTrace ? JSON.stringify(lastTrace.output || {}).slice(0, 500) : '(немає трейсу)',
            });
        }

        onProgress({ phase: 'judge', sessionId });
        const apiKey = await resolveJudgeApiKey(test.connectorId);
        let verdict;
        if (!apiKey) {
            verdict = { passed: false, reasoning: 'Немає доступного Claude API ключа для судді тесту (ні обраний конектор, ні системний ключ).', failingNodeId: null, nodeVerdicts: [] };
        } else {
            const toolText = await collectToolEvidence(sessionId);
            const { system, user } = buildJudgePrompt({ test, transcript, nodeQaEntries, stateText, toolText });
            // Суддя інколи починає з прози й упирається в ліміт токенів → невалідний JSON. Даємо запас токенів і ОДИН повтор.
            // Економія токенів: рутинний суддя — Haiku 4.5 (~5× дешевше); якщо він видав «не пройшов» — підозрілий випадок,
            // перевіряємо Sonnet 4.6 і беремо його вердикт (FUNNEL_TEST_JUDGE_MODEL / FUNNEL_TEST_ESCALATE=0 змінюють поведінку).
            const judgeWith = async (model) => {
                let raw = ''; let v;
                for (let attempt = 0; attempt < 2; attempt += 1) {
                    raw = await callClaude({
                        sessionId: null,
                        systemPrompt: system,
                        messages: [{ role: 'user', content: user }],
                        options: { maxTokens: 3500, apiKey, model, temperature: 0 },
                    });
                    try {
                        const jsonMatch = raw.match(/\{[\s\S]*\}/);
                        v = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
                        break;
                    } catch (_e) {
                        v = { passed: false, reasoning: `Суддя повернув невалідний JSON: ${raw.slice(0, 300)}`, failingNodeId: null, nodeVerdicts: [] };
                    }
                }
                return v;
            };
            const cheapModel = process.env.FUNNEL_TEST_JUDGE_MODEL || 'claude-haiku-4-5-20251001';
            const strongModel = 'claude-sonnet-4-6';
            verdict = await judgeWith(cheapModel);
            const looksFailed = !verdict.passed || (Array.isArray(verdict.nodeVerdicts) && verdict.nodeVerdicts.some((x) => x && x.passed === false));
            if (looksFailed && cheapModel !== strongModel && process.env.FUNNEL_TEST_ESCALATE !== '0') {
                const strong = await judgeWith(strongModel);
                strong.reasoning = '[перевірено Sonnet] ' + (strong.reasoning || '');
                verdict = strong;
            }
        }

        const nodeVerdicts = Array.isArray(verdict.nodeVerdicts) ? verdict.nodeVerdicts : [];
        const failingNodes = nodeVerdicts.filter((v) => v && v.passed === false);
        // Детерміновані інваріанти (лише для магазинного агента): «не мовчить», «немає дублів», «жодних витоків»…
        const invariantViolations = (typeof agentMode !== 'undefined' && agentMode) ? checkInvariants(transcript, finalSession.context) : [];
        if (invariantViolations.length) verdict.reasoning = 'ПОРУШЕНО ІНВАРІАНТИ: ' + invariantViolations.map((x) => x.id + ' — ' + x.message).join(' | ') + ' || ' + (verdict.reasoning || '');
        verdict.invariantViolations = invariantViolations;
        const overallPassed = Boolean(verdict.passed) && failingNodes.length === 0 && invariantViolations.length === 0;
        const status = overallPassed ? 'passed' : 'failed';

        // AppError на кожну "винну" ноду — та сама модель, яку читає вкладка «Ноди».
        const errorTargets = [];
        if (!overallPassed && verdict.failingNodeId && !failingNodes.some((f) => f.nodeId === verdict.failingNodeId)) {
            errorTargets.push({ nodeId: verdict.failingNodeId, reasoning: verdict.reasoning || 'Тест не пройдено' });
        }
        for (const f of failingNodes) errorTargets.push({ nodeId: f.nodeId, reasoning: f.reasoning || 'QA-очікування ноди не виконано' });

        for (const target of errorTargets) {
            // NodeTraceTab (SessionDetail.jsx) прив'язує помилку до картки ноди за ВІКНОМ
            // ЧАСУ (createdAt має впасти між timestamp цієї ноди й наступної) — а не лише
            // за nodeId. Наш AppError пишеться вже ПІСЛЯ всього прогону (суддя оцінює по
            // завершенню), тому без цього він завжди приліплювався б до ОСТАННЬОЇ ноди.
            // Підставляємо createdAt = момент виконання самої ноди-винуватця з трейсу.
            const lastTrace = [...allTraces].reverse().find((t) => t.nodeId === target.nodeId);
            const createdAt = lastTrace?.tsIso ? new Date(Date.parse(lastTrace.tsIso) + 1) : new Date();
            await db.appError.create({
                data: {
                    sessionId,
                    botId: test.botId,
                    errorType: 'test_failed',
                    message: `Тест «${test.name}» провалено: ${target.reasoning}`,
                    context: { nodeId: target.nodeId, testId: test.id, runId: run.id, testName: test.name },
                    createdAt,
                },
            }).catch(() => {});
        }

        const finalVerdict = { ...verdict, passed: overallPassed };
        await db.testRun.update({
            where: { id: run.id },
            data: { status, verdict: finalVerdict, sessionId, finishedAt: new Date() },
        });
        await db.funnelTest.update({
            where: { id: test.id },
            data: { lastRunStatus: status, lastRunAt: new Date() },
        });

        return { runId: run.id, testId: test.id, status, verdict: finalVerdict, sessionId, transcript };
    } catch (error) {
        await db.testRun.update({
            where: { id: run.id },
            data: { status: 'error', verdict: { passed: false, reasoning: error.message }, finishedAt: new Date() },
        }).catch(() => {});
        await db.funnelTest.update({
            where: { id: testId },
            data: { lastRunStatus: 'error', lastRunAt: new Date() },
        }).catch(() => {});
        return { runId: run.id, testId, status: 'error', verdict: { passed: false, reasoning: error.message }, sessionId: null, transcript: [] };
    }
}

/**
 * opts.only — масив id (або префіксів id) тестів; opts.failedOnly — лише ті, що в останньому прогоні не пройшли
 * (економія токенів: повний набір з 47 тестів коштує близько $1.5–2 за прогін, тому після точкової правки ганяємо лише зачеплені).
 */
async function runAllTests(botId, opts = {}) {
    let tests = await db.funnelTest.findMany({ where: { botId }, select: { id: true, lastRunStatus: true } });
    if (Array.isArray(opts.only) && opts.only.length) tests = tests.filter((t) => opts.only.some((p) => t.id.startsWith(p)));
    if (opts.failedOnly) tests = tests.filter((t) => t.lastRunStatus !== 'passed');
    const results = [];
    for (const t of tests) {
        const result = await runTest(t.id);
        results.push(result);
    }
    return {
        botId,
        total: results.length,
        passed: results.filter((r) => r.status === 'passed').length,
        failed: results.filter((r) => r.status === 'failed').length,
        errored: results.filter((r) => r.status === 'error').length,
        results,
    };
}

// ── Асинхронні прогони з живим прогресом ─────────────────────────────────────
// Довгий HTTP-запит (кілька тестів × десятки секунд) впирається в таймаут проксі, а UI
// не бачить, що відбувається. Тому запуск повертає jobId одразу, а прогрес (який тест,
// який крок, суддя) лежить у памʼяті процесу і читається опитуванням getJob().
const jobs = new Map();

function pruneJobs() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, j] of jobs) if (j.finishedAtMs && j.finishedAtMs < cutoff) jobs.delete(id);
}

async function startJob({ botId, testIds = null }) {
    pruneJobs();
    const tests = await db.funnelTest.findMany({
        where: { botId, ...(testIds ? { id: { in: testIds } } : {}) },
        orderBy: { createdAt: 'asc' },
    });
    const job = {
        id: crypto.randomUUID(),
        botId,
        status: 'running',
        startedAtMs: Date.now(),
        finishedAtMs: null,
        items: tests.map((t) => ({
            testId: t.id,
            name: t.name,
            status: 'pending',
            phase: null,
            stepIndex: null,
            totalSteps: Array.isArray(t.steps) ? t.steps.length : 0,
            stepLabel: '',
            startedAtMs: null,
            finishedAtMs: null,
            sessionId: null,
            verdict: null,
            transcript: null,
        })),
    };
    jobs.set(job.id, job);

    (async () => {
        for (const item of job.items) {
            item.status = 'running';
            item.startedAtMs = Date.now();
            const r = await runTest(item.testId, (p) => {
                item.phase = p.phase;
                if (p.sessionId) item.sessionId = p.sessionId;
                if (p.phase === 'step') { item.stepIndex = p.index; item.stepLabel = p.label; }
            });
            item.status = r.status;
            item.phase = 'done';
            item.verdict = r.verdict;
            item.sessionId = r.sessionId || item.sessionId;
            item.transcript = r.transcript;
            item.finishedAtMs = Date.now();
        }
        job.status = 'done';
        job.finishedAtMs = Date.now();
    })().catch((e) => {
        job.status = 'error';
        job.error = e.message;
        job.finishedAtMs = Date.now();
    });

    return job;
}

function getJob(jobId) {
    const job = jobs.get(jobId);
    return job ? { ...job, nowMs: Date.now() } : null;
}

module.exports = {
    listTests,
    getTest,
    createTest,
    updateTest,
    deleteTest,
    duplicateTest,
    createTestFromSession,
    runTest,
    runAllTests,
    startJob,
    getJob,
};
