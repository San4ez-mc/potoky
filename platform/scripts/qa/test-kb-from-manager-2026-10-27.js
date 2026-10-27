// 27.10: відповідь менеджера потрапляє в базу знань лише тоді, коли вона ВІДПОВІДАЄ на питання (shopAgent/kbFromManager.answeredIndex).
// Живі кейси з бази знань goverla: до фіксу «відповіддю» ставало перше-ліпше повідомлення менеджера.
// Запуск на сервері: cd /var/www/flows.fineko.space/platform && node scripts/qa/test-kb-from-manager-2026-10-27.js   (12 викликів Haiku, ≈$0.01)
const { answeredIndex } = require('../../apps/api/src/services/shopAgent/kbFromManager');
const { db } = require('../../apps/api/src/services/shopAgent/lib');

const CASES = [
  ['Яка довжина рукава кофти A0187 у розмірі XL?', 'Без передоплати не працюємо', false],
  ['Як визначити розмір?', 'Читаю діалог', false],
  ['Чи є у складі комплекту set1120 саме гольф, а не светр?', 'З вами менеджер Ірина', false],
  ['Чи тягнеться ця кофта (C0043)?', '20451563545129', false],
  ['Скільки кишень у кофти A0187?', 'Що вирішили нарахунок кольору?', false],
  ['Чи є у вас брюки?', 'Надішліть ще скріншот про оплату, будь ласка', false],
  ['Коли буде M розмір куртки A0156?', 'Не планується поповнення', true],
  ['Чи є кишені всередині куртки?', 'Вітаю, внутрішніх кишень немає', true],
  ['Чи тягнуться джинси j0032?', 'Вітаю, так, тканина трохи тягнеться', true],
  ['Яка посадка у джинсів j0032?', 'Середня', true],
  ['Чи є знижка для військових ЗСУ?', 'так, 10%', true],
  ['Як пошиті брюки внизу — на резинці чи прямий крій?', 'Вітаю, штани трохи звужуються до низу', true],
];

(async () => {
  const s = await db.session.findFirst({ where: { bot: { slug: { contains: 'goverla' } } }, orderBy: { lastActive: 'desc' }, select: { id: true } });
  let ok = 0;
  for (const [q, a, expected] of CASES) {
    // Друге питання в списку — справжнє; перше — стороннє, щоб перевірити й вибір потрібного питання.
    const idx = await answeredIndex(s && s.id, ['Чи є доставка за кордон?', q], a);
    const pass = idx !== null && (idx === 1) === expected;
    if (pass) ok++;
    console.log(pass ? 'OK    ' : 'ПРОВАЛ', JSON.stringify(idx), '|', q.slice(0, 50), '←', a);
  }
  console.log(`${ok}/${CASES.length}`);
  await db.$disconnect();
  process.exit(ok === CASES.length ? 0 : 1);
})().catch((e) => { console.error('ПОМИЛКА', e.message); process.exit(1); });
