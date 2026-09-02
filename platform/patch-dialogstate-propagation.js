'use strict';
/*
 * Завдання 2 (сесія «dialogState — повна пропагація конвенції»): попередній агент завів
 * dialogState/dialogStateText лише в n_lookup/n_size для CRM-клонів. Цей патч додає
 * компактний рядок {{context.dialogStateText}} у СИСТЕМНІ ПРОМПТИ решти claude-нод
 * КЛОНІВ (fcdee415 goverla / a2d5ba79 covercar), що діалогують з клієнтом ПІСЛЯ того,
 * як товар уже визначено (n_lookup відпрацював):
 *
 *   n_color            — вибір кольору
 *   n_order_intent     — підсумок + намір оформити
 *   n_pay_collect      — фіксація способу оплати
 *   n_collect          — збір адреси доставки
 *   n_set_choice       — комплект чи окрема позиція
 *   n_recall_confirm   — повторний клієнт (recall з session-history, ОКРЕМИЙ механізм
 *                        від Buyer.knownMeasurements — сумісний, не замінює)
 *
 * СВІДОМО НЕ ЧІПАЄ:
 *   n_unknown_msg  — товар ЩЕ НЕ визначено (спрацьовує ДО n_lookup) — dialogState там
 *                    ще не має сенсу (немає context.product).
 *   n_upsell2_wait — одна репліка ПІСЛЯ вже оформленого замовлення (діалог по суті
 *                    завершено) — гранична цінність dialogState тут низька, свідомо
 *                    пропущено заради обсягу; якщо власник захоче — та сама техніка.
 *
 * Це ДОПОВНЕННЯ (м'який контекст для моделі), НЕ заміна детермінованих gate'ів —
 * CLAUDE.md §15.7 (токено-обережний бюджет системного промпту), рекомендація
 * fineko-funnel-standard: компактний курований зріз, не сирий JSON.
 *
 * ЗАПУСК:  node patch-dialogstate-propagation.js            (dry-run)
 *          node patch-dialogstate-propagation.js --apply    (записує у БД)
 *
 * Ідемпотентний (маркер на кожен анкор окремо, per-bot, бо n_color/n_order_intent
 * відрізняються текстом між ботами — анкори обрані СПІЛЬНІ для обох).
 */
const { db } = require('@platform/db');

const APPLY = process.argv.includes('--apply');

const BOTS = {
    goverlaClone: 'fcdee415-bef2-4a74-a650-e6e4b5a12322',
    covercarClone: 'a2d5ba79-f87b-48f2-8301-56292cdf3972',
};

const DIALOGSTATE_LINE = 'КОРОТКИЙ СТАН ДІАЛОГУ (додатковий контекст для орієнтації — НЕ заміняє дані/прапорці вище/нижче, вони точніші): {{context.dialogStateText}}';
const DONE_MARKER = 'КОРОТКИЙ СТАН ДІАЛОГУ';

// { nodeId, old (унікальний анкор, спільний для обох ботів), buildNew }
const EDITS = [
    {
        nodeId: 'n_color',
        old: '❌ КЛІЄНТА ВЖЕ ПРИВІТАЛИ раніше в цій розмові — НІКОЛИ не пиши "Привіт"/"Вітаю" знову. Одразу по суті.\n',
        buildNew: (old) => old + DIALOGSTATE_LINE + '\n',
    },
    {
        nodeId: 'n_order_intent',
        old: 'ВАЖЛИВІ НЮАНСИ ЦЬОГО ТОВАРУ (лише для тебе, НІКОЛИ не цитуй дослівно як список — вплети природно, якщо доречно): {{context.product.aiInfo}}\n',
        buildNew: (old) => old + DIALOGSTATE_LINE + '\n',
    },
    {
        nodeId: 'n_pay_collect',
        old: 'Клієнту показали 2 способи оплати (1 — часткова передоплата 200 грн, 2 — повна). Визнач вибір.\n',
        buildNew: (old) => old + DIALOGSTATE_LINE + '\n',
    },
    {
        nodeId: 'n_collect',
        old: 'Збери дані доставки Новою Поштою: ПІБ, ТЕЛЕФОН, МІСТО, № ВІДДІЛЕННЯ.\n',
        buildNew: (old) => old + DIALOGSTATE_LINE + '\n',
    },
    {
        nodeId: 'n_set_choice',
        old: 'Завжди довіряй даним про товар вище.\nСклад комплекту:',
        buildNew: () => 'Завжди довіряй даним про товар вище.\n' + DIALOGSTATE_LINE + '\nСклад комплекту:',
    },
    {
        // n_recall_confirm вже показує власний зріз (returningCustomerData) — додаємо
        // dialogStateText ОКРЕМИМ рядком одразу після, без дублювання формулювання.
        nodeId: 'n_recall_confirm',
        old: "Клієнт УЖЕ замовляв у нас раніше в цій воронці. Радо привітай поверненню (коротко, тепло, доречний емодзі) і одразу покажи, що ми пам'ятаємо його дані:\n",
        buildNew: (old) => old + DIALOGSTATE_LINE + '\n',
    },
];

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const results = [];
    const nodes = flow.nodes.map((n) => {
        const edit = EDITS.find((e) => e.nodeId === n.id);
        if (!edit) return n;
        const prompt = n.data.systemPrompt || '';
        const done = prompt.includes(DONE_MARKER);
        const hasAnchor = prompt.includes(edit.old);
        results.push({ node: n.id, status: done ? 'ALREADY_APPLIED' : (hasAnchor ? 'WILL_PATCH' : 'WARNING_NO_ANCHOR') });
        if (done || !hasAnchor || !APPLY) return n;
        const newPrompt = prompt.split(edit.old).join(edit.buildNew(edit.old));
        return { ...n, data: { ...n.data, systemPrompt: newPrompt } };
    });

    console.log(name, results);
    const missing = EDITS.map((e) => e.nodeId).filter((id) => !flow.nodes.some((n) => n.id === id));
    if (missing.length) console.log(name, 'WARNING: ноди не знайдено у флоу:', missing.join(', '));

    if (!APPLY) return;
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
