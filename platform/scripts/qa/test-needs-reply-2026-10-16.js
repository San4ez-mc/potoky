// Сторож «клієнт чекає менеджера»: чи потребує останнє повідомлення клієнта відповіді (ШІ за змістом). Живі фрази з Edits 16.10
// (17d2ae90, cada3f57) + контролі, де відповідь потрібна. ≈ $0.002 на випадок. Запуск: node scripts/qa/test-needs-reply-2026-10-16.js
const path = require('path');
const C = require(path.join(__dirname, '../../apps/api/src/services/quality/cron'));
const { db } = require(path.join(__dirname, '../../apps/api/src/services/shopAgent/lib'));
const CASES = [
    { name: '«Так, зараз» на «Сьогодні оформимо?»', hist: 'МЕНЕДЖЕР: Сьогодні оформимо замовлення?\nКЛІЄНТ: Так, зараз', want: false },
    { name: '«Є. Дякую» після компенсації', hist: 'КЛІЄНТ: Як це має компенсуватися?\nМЕНЕДЖЕР: Скиньте карту\nКЛІЄНТ: [фото]\nМЕНЕДЖЕР: [фото від менеджера]\nКЛІЄНТ: Є. Дякую', want: false },
    { name: '«Да есть, спасибо»', hist: 'МЕНЕДЖЕР: Зараз докинемо 75 грн\nМЕНЕДЖЕР: [фото від менеджера]\nКЛІЄНТ: Да есть, спасибо', want: false },
    { name: '«Завтра наберу і запитаю»', hist: 'МЕНЕДЖЕР: Ви той номер накладної нам скинули?\nКЛІЄНТ: Завтра наберу і запитаю', want: false },
    { name: 'КОНТРОЛЬ питання про відправку', hist: 'МЕНЕДЖЕР: Дякуємо за замовлення\nКЛІЄНТ: А коли буде відправка?', want: true },
    { name: 'КОНТРОЛЬ надіслана квитанція', hist: 'МЕНЕДЖЕР: Оплата за посиланням\nКЛІЄНТ: [фото]\nКЛІЄНТ: Оплатила', want: true },
    { name: 'КОНТРОЛЬ нетерплячка', hist: 'КЛІЄНТ: Є чорна L?\nКЛІЄНТ: ??', want: true },
    { name: 'КОНТРОЛЬ дані доставки', hist: 'МЕНЕДЖЕР: Напишіть дані для відправки\nКЛІЄНТ: Сич Олена, Київ, НП 36, 0671234567', want: true },
];
(async () => {
    const s = (await db.session.findFirst({ where: { botId: 'fcdee415-bef2-4a74-a650-e6e4b5a12322', isTest: false }, select: { id: true }, orderBy: { lastActive: 'desc' } }));
    let fail = 0;
    for (const [i, c] of CASES.entries()) {
        const v = await C._needsReply({ id: s.id, mid: 'test' + i, content: c.hist.split('\n').pop() }, c.hist);
        const ok = v === c.want; if (!ok) fail++;
        console.log((ok ? '✅ ' : '❌ ') + c.name + ' → ' + (v ? 'чекає відповіді' : 'не чекає'));
    }
    console.log(fail ? 'ПРОВАЛЕНО: ' + fail : 'УСЕ ПРОЙШЛО');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
