'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Запит користувача (скріншот Telegram-групи): кращий формат сповіщень —
 *   смайлики, відступи (порожні рядки між блоками), жирний заголовок (HTML
 *   <b>, notifyTg вже шле parse_mode:'HTML').
 *
 *   Оновлює ВСІ notifyTg-шаблони (обидва боти, ідентичні): n_unknown_admin,
 *   n_size_oor_admin, n_pay_notfound_admin, n_create, n_supplier_manual,
 *   n_supplier_notify.
 *
 * ЗАПУСК:  node patch-notify-formatting.js            (dry-run)
 *          node patch-notify-formatting.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const TEMPLATES = {
    n_unknown_admin: {
        old: '🔔 БОТ НЕ ВИЗНАЧИВ ТОВАР — опрацюйте вручну.\nКлієнт: {{context.senderName}} ({{context.igUsername}})\nОстаннє: {{context.lastCustomerMessage}}',
        new: '🔔 <b>БОТ НЕ ВИЗНАЧИВ ТОВАР</b> — опрацюйте вручну\n\n👤 Клієнт: {{context.senderName}} ({{context.igUsername}})\n💬 Останнє: «{{context.lastCustomerMessage}}»',
    },
    n_size_oor_admin: {
        old: '📏 РОЗМІР ПОЗА СІТКОЮ — потрібен менеджер.\nКлієнт: {{context.senderName}} ({{context.igUsername}})\nТовар: {{context.product.name}}\nПараметри: зріст {{context.sizeInput.height}} см, вага {{context.sizeInput.weight}} кг\nПричина: {{context.sizeOorReason}}',
        new: '📏 <b>РОЗМІР ПОЗА СІТКОЮ</b> — потрібен менеджер\n\n👤 Клієнт: {{context.senderName}} ({{context.igUsername}})\n🛍️ Товар: {{context.product.name}}\n📐 Параметри: зріст {{context.sizeInput.height}} см, вага {{context.sizeInput.weight}} кг\n❗ Причина: {{context.sizeOorReason}}',
    },
    n_pay_notfound_admin: {
        old: '⚠️ Клієнт каже, що оплатив, але оплату НЕ знайдено у виписці.\nКлієнт: {{user.username}} ({{context.senderName}})\nЗамовлення: {{context.orderRef}} | сума {{context.payAmount}} грн\nТовар: {{context.product.name}} / {{context.recommendedSize}} / {{context.colorChoice.color}}\nПеревір вручну.',
        new: '⚠️ <b>Клієнт каже, що оплатив, але оплату НЕ знайдено у виписці</b>\n\n👤 Клієнт: {{user.username}} ({{context.senderName}})\n🧾 Замовлення: {{context.orderRef}} | сума {{context.payAmount}} грн\n🛍️ Товар: {{context.product.name}} / {{context.recommendedSize}} / {{context.colorChoice.color}}\n\n🔍 Перевір вручну',
    },
    n_create: {
        old: 'НОВЕ ЗАМОВЛЕННЯ #{{context.crmOrderId}}\nТовар: {{context.product.name}}\nАртикул: {{context.orderSku}}\nРозмір: {{context.recommendedSize}} | Колір: {{context.colorChoice.color}}\nОплата: {{context.payLabel}}\nКлієнт: {{context.senderName}} — https://instagram.com/{{context.igUsername}}\nОтримувач: {{context.orderData.fullName}}, {{context.orderData.phone}}\nАдреса: {{context.orderData.city}}, НП {{context.orderData.branch}}\n———\n[ТУТ БУДЕ відправка постачальнику: {{context.supplier}}]\n(KeyCRM, статус: Отримано дані доставки)',
        new: '🎉 <b>НОВЕ ЗАМОВЛЕННЯ #{{context.crmOrderId}}</b>\n\n🛍️ Товар: {{context.product.name}}\n🔖 Артикул: {{context.orderSku}}\n📏 Розмір: {{context.recommendedSize}} | 🎨 Колір: {{context.colorChoice.color}}\n💳 Оплата: {{context.payLabel}}\n\n👤 Клієнт: {{context.senderName}} — https://instagram.com/{{context.igUsername}}\n📦 Отримувач: {{context.orderData.fullName}}, {{context.orderData.phone}}\n📍 Адреса: {{context.orderData.city}}, НП {{context.orderData.branch}}\n\n———\n[ТУТ БУДЕ відправка постачальнику: {{context.supplier}}]\n(KeyCRM, статус: Отримано дані доставки)',
    },
    n_supplier_manual: {
        old: '📦 ЗАМОВЛЕННЯ ПОТРЕБУЄ РУЧНОГО ОФОРМЛЕННЯ У ПОСТАЧАЛЬНИКА\nПостачальник: {{context.supplier}} (механізм: {{context.supplierMechanism}})\nЗамовлення: {{context.orderRef}} | CRM: {{context.crmOrderId}}\nТовар: {{context.product.name}} | колір {{context.colorChoice.color}}\nКлієнт: {{context.orderData.fullName}}, {{context.orderData.phone}}\nДоставка: {{context.orderData.city}}, {{context.orderData.branch}}\nСклад комплекту:\n{{context.supplierSetBreakdown}}',
        new: '📦 <b>ЗАМОВЛЕННЯ ПОТРЕБУЄ РУЧНОГО ОФОРМЛЕННЯ У ПОСТАЧАЛЬНИКА</b>\n\n🏭 Постачальник: {{context.supplier}} (механізм: {{context.supplierMechanism}})\n🧾 Замовлення: {{context.orderRef}} | CRM: {{context.crmOrderId}}\n🛍️ Товар: {{context.product.name}} | 🎨 колір {{context.colorChoice.color}}\n\n👤 Клієнт: {{context.orderData.fullName}}, {{context.orderData.phone}}\n📍 Доставка: {{context.orderData.city}}, {{context.orderData.branch}}\n\n📋 Склад комплекту:\n{{context.supplierSetBreakdown}}',
    },
    n_supplier_notify: {
        old: '🏭 Постачальник (замовлення {{context.orderRef}}):\n{{context.supplierOrderResult}}',
        new: '🏭 <b>Постачальник</b> (замовлення {{context.orderRef}})\n\n{{context.supplierOrderResult}}',
    },
};

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    let anyChange = false;
    const report = [];
    const nodes = flow.nodes.map((n) => {
        const t = TEMPLATES[n.id];
        if (!t) return n;
        if (n.data.message === t.new) { report.push(n.id + ':already'); return n; }
        if (n.data.message !== t.old) { report.push(n.id + ':ANCHOR_MISMATCH'); return n; }
        anyChange = true;
        report.push(n.id + ':will_update');
        return { ...n, data: { ...n.data, message: t.new } };
    });

    console.log(name, report.join(', '));
    if (!anyChange) { console.log(name, 'ALREADY_APPLIED / нічого змінювати.'); return; }
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
