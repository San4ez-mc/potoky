'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Продовження нової конвенції (2026-08-27/28, опис товару в KeyCRM = готова
 *   презентація з ціною/акцією всередині):
 *
 *   1) n_welcome: раніше сам конструював "Вітаємо! {{product.name}} — {{price}} грн
 *      ({{descShort}})" — тепер це ДУБЛЮВАЛО ціну/акцію, яка вже написана в
 *      описі, і descShort/220-символів урізав саме ту частину, де вона стояла.
 *      Замінено на ЄДИНИЙ шаблон: сам опис ДОСЛІВНО + категорійне запитання
 *      (обчислені в n_lookup, патч patch-verbatim-desc-customername.js —
 *      МАЄ бути застосований ПЕРЕД цим). variants очищено (порожній масив —
 *      використовується лише text, як і задумано двигуном).
 *
 *   2) product.name (поле "Назва" з CRM) — тепер ЛИШЕ для внутрішнього
 *      використання (пошук/матчинг/адмін-сповіщення). У 6 клієнтських нодах,
 *      де він досі показувався клієнту напряму, замінено на
 *      product.customerName (перше речення опису — те, що клієнт реально
 *      бачив на початку презентації): n_photo (caption), n_size/n_color/
 *      n_order_intent/n_set_choice (systemPrompt), n_followup_msg (text).
 *      Адмін-ноди (n_create, n_pay_notfound_admin, n_size_oor_admin,
 *      n_supplier_manual) і умова n_have_product — СВІДОМО не чіпаються,
 *      їм потрібна саме внутрішня назва з CRM для однозначного пошуку.
 *
 * ЗАЛЕЖНІСТЬ: спершу node patch-verbatim-desc-customername.js --apply
 *             (інакше product.customerName/followUpQuestion — порожні).
 *
 * ЗАПУСК:  node patch-welcome-verbatim-and-customername-swap.js            (dry-run)
 *          node patch-welcome-verbatim-and-customername-swap.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const NEW_WELCOME_TEXT = '{{context.product.desc}}\n\n{{context.product.followUpQuestion}}';

const NAME_TOKEN = '{{context.product.name}}';
const CUSTOMER_NAME_TOKEN = '{{context.product.customerName}}';
// nodeId -> поле, де product.name показується КЛІЄНТУ напряму (не адмін-сповіщення).
const CUSTOMER_FACING = {
    n_photo: 'caption',
    n_size: 'systemPrompt',
    n_color: 'systemPrompt',
    n_order_intent: 'systemPrompt',
    n_set_choice: 'systemPrompt',
    n_followup_msg: 'text',
};

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nWelcome = flow.nodes.find((n) => n.id === 'n_welcome');
    if (!nWelcome) { console.log(name, 'ERROR: n_welcome not found'); return; }

    const welcomeDone = nWelcome.data.text === NEW_WELCOME_TEXT;
    const swapNeeded = [];
    for (const [nodeId, field] of Object.entries(CUSTOMER_FACING)) {
        const n = flow.nodes.find((x) => x.id === nodeId);
        if (!n) { console.log(name, 'WARNING:', nodeId, 'not found — пропускаю.'); continue; }
        if (typeof n.data[field] === 'string' && n.data[field].includes(NAME_TOKEN)) swapNeeded.push(nodeId);
    }

    if (welcomeDone && swapNeeded.length === 0) { console.log(name, 'ALREADY_APPLIED'); return; }

    console.log(name, 'n_welcome переписати =', !welcomeDone, '| swap product.name->customerName у:', swapNeeded.join(', ') || '(нема)');
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_welcome' && !welcomeDone) {
            return { ...n, data: { ...n.data, text: NEW_WELCOME_TEXT, variants: [] } };
        }
        if (CUSTOMER_FACING[n.id] && swapNeeded.includes(n.id)) {
            const field = CUSTOMER_FACING[n.id];
            return { ...n, data: { ...n.data, [field]: n.data[field].split(NAME_TOKEN).join(CUSTOMER_NAME_TOKEN) } };
        }
        return n;
    });
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
