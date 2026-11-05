'use strict';
// Воронки рекламних креативів Meta (Facebook/Instagram) для БУДЬ-ЯКОГО експерта з content2:
//   ads-creative-image  — тексти + картинки (4:5 для стрічки, 9:16 для Stories/Reels)
//   ads-creative-video  — сценарії коротких відео-креативів (рендерить content-short-video)
//   ads-render-image    — рендер одного креатива: фон OpenAI gpt-image-2 + текст через slide-builder → content2
// Креативна логіка — в Claude-нодах, правила й перевірка — в content2 (src/lib/adRules.ts, /api/webhooks/ad-check),
// у воронках їх копії немає. Дані про експерта/продукт/ЦА/кейси/факти воронка бере з content2 (/api/webhooks/ad-context).
// Секрети в цей файл НЕ пишуться: ключі копіюються з уже налаштованих воронок (content-manager-v2 тощо) всередині БД платформи.
// Ідемпотентно: повторний запуск перебудовує ноди зі скриптів (джерело істини — ці файли).
// Запуск на сервері: node scripts/build-ads-creatives-2026-11-05.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');
const P = require('./ads/ads-prompts.js');
const C = require('./ads/node-code.js');

const PROJECT = 'content-social';
const CONTENT2_URL = 'https://content2.fineko.space';
const SONNET = 'claude-sonnet-4-6';

async function readKey(slug, key) {
    const bot = await db.bot.findFirst({ where: { slug } });
    if (!bot) return '';
    const k = await db.funnelKey.findUnique({ where: { botId_key: { botId: bot.id, key } }, select: { value: true } });
    return k ? k.value : '';
}

async function ensureBot(slug, name, description, goal) {
    let bot = await db.bot.findFirst({ where: { slug } });
    if (!bot) {
        await callTool('new_bot', { projectSlug: PROJECT, name, slug, description, goal, trigger: 'webhook', isActive: true });
        bot = await db.bot.findFirst({ where: { slug } });
        console.log('bot created', slug, bot.id);
    } else {
        try { await callTool('update_bot', { botId: bot.id, name, description, goal }); } catch (e) { /* описи не критичні */ }
        console.log('bot exists', slug, bot.id);
    }
    return bot;
}

// Чистимо все, крім start, і будуємо заново (джерело істини — цей скрипт).
async function resetFlow(botId) {
    let f = await callTool('get_funnel', { botId });
    for (const n of f.nodes) if (n.type !== 'start') await callTool('delete_node', { botId, nodeId: n.id });
    f = await callTool('get_funnel', { botId });
    return f.nodes.find((n) => n.type === 'start');
}

function builder(botId) {
    const ids = {};
    return {
        ids,
        async add(key, type, label, data) {
            await callTool('add_node', { botId, type, position: { x: 160, y: 160 + Object.keys(ids).length * 160 }, data: Object.assign({ label }, data) });
            const f = await callTool('get_funnel', { botId });
            const node = f.nodes.filter((n) => n.data && n.data.label === label).pop();
            if (!node) throw new Error('нода не знайдена після додавання: ' + label);
            ids[key] = node.id;
            return node.id;
        },
        async edge(a, b) { await callTool('create_edge', { botId, source: ids[a] || a, target: ids[b] || b }); },
    };
}

const claudeNode = (systemPrompt, template, outputVar, qa, maxTokens = 7000) => ({
    mode: 'single', systemPrompt, messagesTemplate: template, outputVar, exitCondition: 'json_output',
    model: SONNET, maxTokens, temperature: 0.8, qaExpectation: qa,
});
const c2Headers = { 'x-webhook-secret': '{{env.CONTENT2_WEBHOOK_SECRET}}' };
const MSG_BRIEF = '[{"role":"user","content":"{{context.adBrief}}"}]';
const MSG_REPAIR = '[{"role":"user","content":"{{context.adRepairBrief}}"}]';

async function copyKeys(botId, specs) {
    for (const [key, value, label, isSecret] of specs) {
        if (value === '' || value == null) { console.log('  ! ключ порожній, пропущено:', key); continue; }
        await callTool('update_funnel_key', { botId, key, value, label, isSecret: !!isSecret });
    }
}

async function content2Secret() {
    const v = (await readKey('content-manager-v2', 'CONTENT2_WEBHOOK_SECRET')) || (await readKey('onboard', 'CONTENT2_WEBHOOK_SECRET'));
    if (!v) throw new Error('Не знайдено ключ CONTENT2_WEBHOOK_SECRET у content-manager-v2/onboard: додай його воронкам вручну і запусти знову.');
    return v;
}

// ── Воронка креативів (image | video) ─────────────────────────────────────────────────────────────────
async function buildCreativeFunnel(mode) {
    const video = mode === 'video';
    const slug = video ? 'ads-creative-video' : 'ads-creative-image';
    const bot = await ensureBot(
        slug,
        video ? 'Реклама FB/IG: відео-креативи' : 'Реклама FB/IG: фото-креативи',
        video
            ? 'Бере з content2 інформацію про експерта, продукт, болі ЦА, кейси й актуальні факти та складає сценарії коротких відео-креативів (9:16, до 15 с) для реклами Facebook/Instagram. Перевіряє правила Meta, ставить креативи в план мережі «Реклама FB/IG» і запускає рендер відео.'
            : 'Бере з content2 інформацію про експерта, продукт, болі ЦА, кейси й актуальні факти та створює готові фото-креативи для реклами Facebook/Instagram: текст оголошення + картинка (4:5 для стрічки, 9:16 для Stories/Reels). Перевіряє правила Meta, ставить креативи в план мережі «Реклама FB/IG» і запускає рендер картинок.',
        'Запит {projectId, count, landingUrl|leadMagnet, ...} → креативи у плані content2, що пройшли правила реклами Meta, або чесне повідомлення, чого не вистачило.',
    );
    await copyKeys(bot.id, [
        ['CONTENT2_URL', CONTENT2_URL, 'content2 (дані експерта, імпорт у план)', false],
        ['CONTENT2_WEBHOOK_SECRET', await content2Secret(), 'Секрет вебхуків content2', true],
        ['CLAUDE_CONNECTOR_ID', await readKey('content-manager-v2', 'CLAUDE_CONNECTOR_ID'), 'Claude (збережений конектор)', false],
        // Збережений конектор «Telegram — Контент бот»: двигун сам дістає з нього токен (CLAUDE.md §3, §16).
        ['TELEGRAM_CONNECTOR_ID', (await readKey('content-imagen4-vertex', 'TELEGRAM_CONNECTOR_ID')) || 'eb411228-6318-4e15-8ddb-286d3776fe8b', 'Telegram-бот для сповіщень (конектор)', false],
        ['ADMIN_TELEGRAM_ID', (await readKey('content-imagen4-vertex', 'OWNER_TELEGRAM_ID')) || '345126254', 'Кому слати звіт про створені креативи', false],
    ]);

    const start = await resetFlow(bot.id);
    await callTool('update_node', { botId: bot.id, nodeId: start.id, data: {
        label: 'Webhook Trigger', trigger: 'webhook',
        description: 'POST /webhook/bot/' + slug + ' (асинхронно). Звіт приходить у Telegram.',
        bodySchema: JSON.stringify({
            projectId: 'string, обовʼязково: id компанії в content2',
            productId: 'string, необовʼязково (інакше головний продукт)', productName: 'string, необовʼязково',
            count: video ? 'число 1-5, за замовчуванням 2' : 'число 1-8, за замовчуванням 4',
            landingUrl: 'string, https-сторінка запису/пропозиції (необовʼязково: посилання можна додати в кабінеті Meta)',
            leadMagnet: 'true | false | назва/ідентифікатор; за замовчуванням auto (є магніт з ботом → один кут про нього)',
            angles: 'масив: pain, outcome, objection, proof, curiosity, lead_magnet (необовʼязково)',
            aspects: video ? '(не використовується, відео завжди 9:16)' : 'масив: 4:5, 9:16, 1:1; за замовчуванням ["4:5","9:16"]',
            date: 'YYYY-MM-DD, дата в плані (за замовчуванням сьогодні)',
            note: 'додаткова вказівка власника для копірайтера',
            render: 'false = без рендера медіа (лише тексти/сценарії в плані)',
        }, null, 1),
    } });

    const b = builder(bot.id);
    b.ids.start = start.id;
    await b.add('params', 'js', 'Параметри запиту', { code: C.withMode(C.paramsCode, mode), qaExpectation: 'Без projectId ставить adFatal; count обмежено; за замовчуванням аспекти 4:5 і 9:16.' });
    await b.add('ctx', 'httpRequest', 'Контекст з content2 (експерт, продукт, ЦА, правила)', {
        url: '{{env.CONTENT2_URL}}/api/webhooks/ad-context', method: 'POST', headers: c2Headers,
        bodyFields: { projectId: '{{context.adProjectId}}', productId: '{{context.adProductId}}', productName: '{{context.adProductName}}', ensureNetwork: true },
        outputVar: 'context.adCtx', qaExpectation: 'Віддає дані з content2 і створює мережу meta_ads, якщо її ще нема.',
    });
    await b.add('prepare', 'js', 'Підготовка: кути, магніт, посилання, бриф', { code: C.withMode(C.prepareCode, mode), qaExpectation: 'Без продукту ставить adFatal з поясненням; посилання необовʼязкове і ніколи не вигадується.' });
    await b.add('c1', 'condition', 'Є дані для креативів?', { conditions: [
        { id: 'ok', label: 'так', expression: '!context.adFatal' },
        { id: 'fatal', label: 'ні', expression: '!!context.adFatal' },
    ] });
    await b.add('claude', 'claude', video ? 'Сценарії відео-креативів (Claude)' : 'Тексти й картинки креативів (Claude)',
        claudeNode(video ? P.VIDEO_SYSTEM : P.IMAGE_SYSTEM, MSG_BRIEF, 'context.creativesRaw', 'Повертає JSON {creatives:[…]} рівно за кількістю й кутами; нічого не вигадує поза даними.', video ? 9000 : 7000));
    await b.add('parse', 'js', 'Розбір відповіді, посилання й utm', { code: C.withMode(C.parseCode, mode), qaExpectation: 'Посилання ставить код, не модель; кнопка лише зі списку.' });
    await b.add('c2', 'condition', 'Креативи розібрано?', { conditions: [
        { id: 'ok', label: 'так', expression: '!context.adFatal' },
        { id: 'fatal', label: 'ні', expression: '!!context.adFatal' },
    ] });
    await b.add('gate1', 'httpRequest', 'Перевірка правил Meta #1 (content2)', {
        url: '{{env.CONTENT2_URL}}/api/webhooks/ad-check', method: 'POST', headers: c2Headers,
        bodyFields: { ads: '{{context.ads}}' }, outputVar: 'context.gate1', qaExpectation: 'Повертає список порушень по кожному креативу.',
    });
    await b.add('c3', 'condition', 'Є порушення правил?', { conditions: [
        { id: 'clean', label: 'ні', expression: '!(context.gate1 && context.gate1.anyBad)' },
        { id: 'bad', label: 'так', expression: '!!(context.gate1 && context.gate1.anyBad)' },
    ] });
    await b.add('repairBrief', 'js', 'Бриф на виправлення', { code: C.repairBriefCode });
    await b.add('repair', 'claude', 'Виправлення креативів із порушеннями (Claude)', claudeNode(P.REPAIR_SYSTEM, MSG_REPAIR, 'context.fixedRaw', 'Переписує лише креативи з порушеннями, зберігає index і кут.', video ? 9000 : 6000));
    await b.add('merge', 'js', 'Підстановка виправлених', { code: C.mergeCode });
    await b.add('gate2', 'httpRequest', 'Перевірка правил Meta #2 (після виправлення)', {
        url: '{{env.CONTENT2_URL}}/api/webhooks/ad-check', method: 'POST', headers: c2Headers,
        bodyFields: { ads: '{{context.ads}}' }, outputVar: 'context.gate2',
    });
    await b.add('assemble', 'js', 'Збірка постів для плану', { code: video ? C.assembleVideoCode : C.assembleImageCode, qaExpectation: 'Один пост на креатив × формат; креатив з порушеннями піде в план як чернетка зі списком порушень.' });
    await b.add('import', 'httpRequest', 'Постановка в план content2 (bulk-import)', {
        url: '{{env.CONTENT2_URL}}/api/posts/bulk-import', method: 'POST', headers: { 'x-import-token': '{{env.CONTENT2_WEBHOOK_SECRET}}' },
        bodyFields: { projectId: '{{context.adProjectId}}', posts: '{{context.importPayload.posts}}' }, outputVar: 'context.importResult',
        qaExpectation: 'Креативи зʼявляються в календарі content2 у мережі «Реклама FB/IG»; генерація медіа стартує автоматично.',
    });
    await b.add('notifyOk', 'notifyTg', 'Звіт: креативи створено', {
        targetKey: 'ADMIN_TELEGRAM_ID',
        message: '🎯 <b>Рекламні креативи для «{{context.adOfferName}}»</b>\nУ плані content2 (мережа «Реклама FB/IG», дата {{context.adDate}}): {{context.importResult.inserted}} шт.\n\n{{context.adSummary}}\n\n' + (video ? 'Відео рендеряться кілька хвилин.' : 'Картинки рендеряться 1-3 хвилини.') + '\nВідкрити: ' + CONTENT2_URL + '/\nЗапуск у Meta вручну: Ads Manager → завантажити файл, скопіювати блок тексту з поста.',
    });
    await b.add('notifyFatal', 'notifyTg', 'Звіт: не вийшло', {
        targetKey: 'ADMIN_TELEGRAM_ID',
        message: '⚠️ <b>Рекламні креативи не створено</b>\n{{context.adFatal}}',
    });

    // Порядок ребер важливий для condition: перше ребро = перша умова.
    await b.edge('start', 'params');
    await b.edge('params', 'ctx');
    await b.edge('ctx', 'prepare');
    await b.edge('prepare', 'c1');
    await b.edge('c1', 'claude');
    await b.edge('c1', 'notifyFatal');
    await b.edge('claude', 'parse');
    await b.edge('parse', 'c2');
    await b.edge('c2', 'gate1');
    await b.edge('c2', 'notifyFatal');
    await b.edge('gate1', 'c3');
    await b.edge('c3', 'assemble');     // немає порушень → одразу збірка
    await b.edge('c3', 'repairBrief');  // є порушення → виправлення
    await b.edge('repairBrief', 'repair');
    await b.edge('repair', 'merge');
    await b.edge('merge', 'gate2');
    await b.edge('gate2', 'assemble');
    await b.edge('assemble', 'import');
    await b.edge('import', 'notifyOk');
    try { await callTool('auto_layout', { botId: bot.id }); } catch (e) { /* косметика */ }
    console.log('ok', slug, bot.id);
    return bot;
}

// ── Рендер одного фото-креатива ─────────────────────────────────────────────────────────────────────────
async function buildRenderFunnel() {
    const slug = 'ads-render-image';
    const bot = await ensureBot(
        slug, 'Реклама FB/IG: рендер фото-креатива',
        'Рендерить одну картинку рекламного креатива: фон від OpenAI gpt-image-2 за описом сцени (без тексту й облич) + текст на картинці через slide-builder. Розмір за форматом: 4:5 (1080×1350), 9:16 (1080×1920), 1:1 (1080×1080). Результат віддає в content2 (generation-event).',
        'Повернути на callbackUrl готовий PNG креатива або status:error з причиною.',
    );
    await copyKeys(bot.id, [
        ['OPENAI_CONNECTOR_ID', (await readKey('content-manager-v2', 'OPENAI_CONNECTOR_ID')) || '54a9dabc-88e3-47a5-a4b5-a7c551428053', 'OpenAI (збережений конектор «GPT для воронок»): генерація фону', false],
        ['CONTENT2_WEBHOOK_SECRET', await content2Secret(), 'Секрет вебхуків content2', true],
    ]);
    const start = await resetFlow(bot.id);
    await callTool('update_node', { botId: bot.id, nodeId: start.id, data: {
        label: 'Webhook Trigger', trigger: 'webhook', description: 'POST від content2 (fireGeneration / bulk-import) для рекламного креатива',
        bodySchema: JSON.stringify({ bgPrompt: 'опис сцени (EN), без тексту', title: 'текст на картинці', subtitle: 'підзаголовок', aspect: '4:5 | 9:16 | 1:1', accent: '#hex', callbackUrl: 'string', postItemId: 'string', projectId: 'string' }, null, 1),
    } });
    const b = builder(bot.id);
    b.ids.start = start.id;
    await b.add('params', 'js', 'Параметри рендера', { code: C.renderParamsCode, qaExpectation: 'Розмір за аспектом; промпт фону без тексту/облич.' });
    await b.add('imagen', 'httpRequest', 'OpenAI gpt-image-2: фон креатива', {
        url: 'https://api.openai.com/v1/images/generations', method: 'POST', headers: { Authorization: 'Bearer {{env.OPENAI_API_KEY}}' },
        body: '{"model":"gpt-image-2","prompt":"{{context.bgPromptFinal}}","size":"{{context.openaiSize}}","quality":"medium","n":1}',
        outputVar: 'context.bgBase64', responseField: 'data.0.b64_json',
        qaExpectation: 'Повертає фон без тексту; ~25 с. Якщо баланс OpenAI закінчився — status:error у content2.',
    });
    await b.add('bgReady', 'js', 'Фон готовий?', { code: C.bgReadyCode });
    await b.add('c1', 'condition', 'Є фон?', { conditions: [
        { id: 'ok', label: 'так', expression: 'context.bgOk === true' },
        { id: 'fail', label: 'ні', expression: 'context.bgOk !== true' },
    ] });
    await b.add('stagger', 'js', 'Черга рендера (розкид у часі)', { code: C.staggerCode, qaExpectation: 'Розводить одночасні креативи по 5 с, щоб slide-builder не віддавав 504.' });
    await b.add('render', 'httpRequest', 'Slide-builder: текст на фоні', {
        url: 'https://slides.flows.fineko.space/render/story', method: 'POST',
        bodyFields: {
            title: '{{context.title}}', subtitle: '{{context.subtitle}}', width: '{{context.width}}', height: '{{context.height}}',
            accent: '{{context.accent}}', bgColor: '{{context.bgColor}}', bgStyle: '{{context.bgStyle}}', template: '{{context.template}}',
            photoUrl: '{{context.finalPhotoUrl}}', backgroundImageUrl: '{{context.finalPhotoUrl}}',
        },
        outputVar: 'context.finalImageBase64', responseField: 'result.imageBase64',
    });
    await b.add('check', 'js', 'Перевірка картинки', { code: C.renderCheckCode, qaExpectation: 'HTML 504 або обрізана відповідь не вважається картинкою.' });
    await b.add('c2', 'condition', 'Картинка ок?', { conditions: [
        { id: 'ok', label: 'так', expression: 'context.renderOk === true' },
        { id: 'retry', label: 'повтор', expression: 'context.renderOk !== true && context.renderTry < 3' },
        { id: 'fail', label: 'помилка', expression: 'context.renderOk !== true' },
    ] });
    await b.add('retryWait', 'js', 'Пауза перед повтором', { code: C.retryWaitCode });
    await b.add('done', 'httpRequest', 'Віддати в content2', {
        url: '{{context.callbackUrl}}', method: 'POST', headers: { 'x-webhook-token': '{{env.CONTENT2_WEBHOOK_SECRET}}' },
        bodyFields: { projectId: '{{context.projectId}}', status: 'success', imageBase64: '{{context.finalImageBase64}}', tags: ['ads-meta', 'openai-image'], postItemId: '{{context.postItemId}}' },
        outputVar: 'context.callbackResult',
    });
    await b.add('fail', 'httpRequest', 'Помилка → content2', {
        url: '{{context.callbackUrl}}', method: 'POST', headers: { 'x-webhook-token': '{{env.CONTENT2_WEBHOOK_SECRET}}' },
        body: '{"status":"error","error":"{{context.failMsg}}","postItemId":"{{context.postItemId}}"}',
        outputVar: 'context.callbackResult',
    });
    await b.edge('start', 'params');
    await b.edge('params', 'imagen');
    await b.edge('imagen', 'bgReady');
    await b.edge('bgReady', 'c1');
    await b.edge('c1', 'stagger');
    await b.edge('c1', 'fail');
    await b.edge('stagger', 'render');
    await b.edge('render', 'check');
    await b.edge('check', 'c2');
    await b.edge('c2', 'done');
    await b.edge('c2', 'retryWait');
    await b.edge('c2', 'fail');
    await b.edge('retryWait', 'render');
    try { await callTool('auto_layout', { botId: bot.id }); } catch (e) { /* косметика */ }
    console.log('ok', slug, bot.id);
    return bot;
}

async function main() {
    await buildRenderFunnel();
    await buildCreativeFunnel('image');
    await buildCreativeFunnel('video');
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.stack || e); process.exit(1); });
