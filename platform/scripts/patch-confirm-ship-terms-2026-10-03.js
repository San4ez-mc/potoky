'use strict';
// Patch (source of truth): goverla — n_confirm_prep, підтвердження після оформлення замовлення (власник 03.10: «чому люди все ще
// питають, коли відправка?», GOV76KRU0AV). Неоплачений варіант казав «після підтвердження оплати ОДРАЗУ відправляємо», а про
// пошиття до 5 робочих днів у підтвердженні не було ні слова — люди питали «коли відправка?». Тепер:
//   • без «одразу відправляємо» — «передамо в роботу»;
//   • рядок строку відправки — context.shipTermsText (той самий текст, що в підсумку замовлення: shipTerms() у policy.js, умови магазину).
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-confirm-ship-terms-2026-10-03.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_confirm_prep';
const MARK = 'shipTermsText';

const EDITS = [
    ["pick(['Дякуємо! 🎉 Замовлення зафіксували — щойно побачимо оплату, одразу передамо у відправку 💛', 'Дякуємо! 🎉 Дані отримали, замовлення в системі — після підтвердження оплати одразу відправляємо 💛']);",
        "pick(['Дякуємо! 🎉 Замовлення зафіксували — щойно побачимо оплату, передамо його в роботу 💛', 'Дякуємо! 🎉 Дані отримали, замовлення в системі — після підтвердження оплати передамо його в роботу 💛']);\n// Строк відправки — той самий текст, що в підсумку замовлення (policy.js shipTerms → context.shipTermsText).\nif (context.shipTermsText) lead = lead + '\\n' + context.shipTermsText;"],
];

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === NODE);
    if (i < 0) throw new Error('немає ноди ' + NODE);
    let changed = false;
    let code = String(nodes[i].data.code || '');
    if (code.includes(MARK)) console.log(NODE, 'already patched');
    else {
        for (const [from, to] of EDITS) {
            if (!code.includes(from)) throw new Error('не знайдено фрагмент: ' + from.slice(0, 70) + ' — код ноди змінився, патч треба оновити');
            code = code.replace(from, to);
        }
        nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
        changed = true; console.log('patched', NODE);
    }
    // Сповіщення «Клієнт написав після оформлення»: тепер у ньому відповідь бота (policy.js), тож не «бот лише подякував».
    const ai = nodes.findIndex((n) => n.id === 'n_post_order_admin');
    const OLD_MAIN = 'Відповідайте в чаті — бот лише подякував і далі діалог не веде.';
    if (ai >= 0 && nodes[ai].data.alertMain === OLD_MAIN) {
        nodes[ai] = { ...nodes[ai], data: { ...nodes[ai].data, alertMain: 'Перевірте відповідь бота нижче — якщо потрібно, допишіть у чаті.' } };
        changed = true; console.log('patched n_post_order_admin alertMain');
    }
    if (changed) await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
