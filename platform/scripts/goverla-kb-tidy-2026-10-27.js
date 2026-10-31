// 27.10 (власник: «там багато повторюваного, питань, які мали б попасти до конкретного товару… все правильно порозподіляй»).
// База знань goverla: «Потребують відповіді» — розкласти по товарах/категоріях, злити дублі, прибрати не-питання;
// активні записи, куди «відповіддю» потрапило перше-ліпше повідомлення менеджера («З вами менеджер Ірина»), — назад у «Потребують відповіді».
// Запуск: node kb-tidy.js            — лише показати, що зміниться
//         node kb-tidy.js --apply    — застосувати (бекап усіх записів пишеться до змін)
const fs = require('fs');
const crmEnv = require('/var/www/crm.fineko.space/node_modules/dotenv').parse(fs.readFileSync('/var/www/crm.fineko.space/.env'));
const { PrismaClient } = require('/var/www/crm.fineko.space/node_modules/@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: crmEnv.DATABASE_URL } } });
const APPLY = process.argv.includes('--apply');

// Групи: перший id — головний запис (він лишається), решта зливаються в нього як інші формулювання.
// to: 'P:<sku>' | 'C:<категорія>' | 'S' (весь магазин). title — зрозуміле формулювання питання для Олексія (стає першим варіантом).
// reset: головний запис мав «відповідь» не по темі → знову без відповіді.
const GROUPS = [
  // ── Товари: заміри / посадка ──
  { to: 'P:A0165', ids: ['2a5114fc', '97897991', '4c60f712', '56425013', '49b55fba', '00ad5c8f'], title: 'Бомбер A0165: заміри по розмірах (довжина рукава, заміри XXL) — чи повномірна сітка? Найкраще — завантажити таблицю розмірів у картку товару' },
  { to: 'P:A0165', ids: ['65124ea7', '63ea2a2f'], title: 'Бомбер A0165: яка підкладка і на яку температуру розрахований?' },
  { to: 'P:A0182', ids: ['b9523cf7'], title: 'Куртка A0182: довжина рукава по розмірах (XXL)' },
  { to: 'P:A0187', ids: ['27eb9013', 'a484f76d', 'e99b223c', 'af6c8302'], reset: true, title: 'Кофта A0187: заміри по розмірах (довжина рукава, обʼєм грудей, довжина виробу); посадка вільна чи по тілу; чи підійде на широкі плечі?' },
  { to: 'P:A0187', ids: ['e2cd22c2', 'ec2e7e80', 'bae0c766'], title: 'Кофта A0187: чи тягнеться вʼязка, яка якість?' },
  { to: 'P:A0188', ids: ['4fd45a73', '49845bc3', '4a04de0e', 'dc560b89'], title: 'Костюм A0188: заміри по розмірах (довжина й ширина штанів, напр. на зріст 186 см, ≥108 см) — чи маломірить?' },
  { to: 'P:A0188', ids: ['d3c7117f', '0bd766b8', '02ab89b2', '8aff8617'], title: 'Костюм A0188 (вельвет): тонкий чи щільний, теплий чи демісезонний, чи тягнеться, чи є трикотажна основа?' },
  { to: 'P:A0191', ids: ['824da5e8', '3875cb33', '1288e67a'], reset: true, title: 'Костюм A0191: довжина штанів і кофти по розмірах (L, XL; на зріст 190 см)' },
  { to: 'P:A0191', ids: ['59f84aef', 'e8b4f425'], title: 'Костюм A0191: деталі — блискавка чорна матова? на штанах резинка/шнурок?' },
  { to: 'P:F0029', ids: ['0f2d65d4', '6897d6a4', '6b86dd40', '04584251'], title: 'Бомбер F0029: заміри (довжина рукава, по спині), чи маломірить, як сидить у плечах і на животі?' },
  { to: 'P:L0056', ids: ['3e659665', '610a0070', '8b7f0c1a', '2f8e4a7d'], title: 'Футболка L0056: тканина і якість — склад, щільна чи тонка?' },
  { to: 'P:L0056', ids: ['ee006d28', 'c54f2913', '7b19897e'], title: 'Футболка L0056: наскільки оверсайз, довжина (чи довша за кофту A0187), який ворот?' },
  { to: 'P:j0032', ids: ['dd2de9a8', 'b0118463', 'a3a35e31', '6ca17973'], title: 'Джинси j0032: крій — прямий, слім, mom чи кльош? Чи є стрілки?' },
  { to: 'P:j0032', ids: ['22c5a729'], reset: true, title: 'Джинси j0032: чи є бічні кишені та два гудзики на поясі?' },
  { to: 'P:C0043', ids: ['3fcb397a', 'a7db6f89', 'def082cd'], reset: true, title: 'Кофта C0043: якість — матеріал, щільність, чи тягнеться, довговічність' },
  { to: 'P:D0043', ids: ['d3bbfa63', '283cdcc7', 'bea25a90'], reset: true, title: 'Пуховик D0043: верх цупкий чи мʼякий, як оброблений рукав, як поводиться після прання?' },
  { to: 'P:A0156', ids: ['d402142b', 'd88a457a'], title: 'Куртка A0156: чи є внутрішні кишені та утяжка внизу?' },
  { to: 'P:sh667999', ids: ['122d3be0', '7a602d87'], title: 'Костюм sh667999 (мікрозамша): чи тягнеться, чи линяє?' },
  // ── Товари: по одному (лише перенос на правильний товар) ──
  { to: 'P:D0005', ids: ['4178299c'], title: 'Куртка D0005 (Кожанка Преміум): якої якості матеріал?' },
  { to: 'P:D0050', ids: ['321764d1'], title: 'Кофта D0050: чи не тонка?' },
  { to: 'P:A0148', ids: ['c71552ce'], title: 'Светр A0148: прямий крій? Яка посадка?' },
  { to: 'P:A0188', ids: ['2c86222e'], title: 'Костюм A0188: чи є у штанів стрілка?' },
  { to: 'P:A0187', ids: ['fb780af9'], reset: true, title: 'Кофта A0187: скільки кишень?' },
  { to: 'P:L0056', ids: ['e36ec2db'] }, // відповідь є (3 шт — 1199 грн), був прив'язаний до бомбера
  { to: 'P:j0032', ids: ['3dd5eb7c'] }, // відповідь є, був прив'язаний до комплекту
  { to: 'P:j0032', ids: ['72232dfb'] }, // відповідь є, був прив'язаний до комплекту
  // ── Категорії ──
  { to: 'C:Кофти', ids: ['2a06666f', '8a8e795a', '12377db5'], title: 'Як прати вʼязану кофту (ангора) — пральна машина чи хімчистка?' },
  { to: 'C:Кофти', ids: ['6e67b044', '5244943f'], title: 'Чим відрізняються кофти Мажор петля (D0050), Ангора (C0043), Сейн ангора (A0187): склад пряжі, фасон, вигляд?' },
  { to: 'C:Кофти', ids: ['2e4cb804'], title: 'Чи є кофти з капюшоном?' },
  { to: 'C:Кофти', ids: ['ec9156d3'], title: 'Чи є кофта з блискавкою лише до грудей (1/3 замок)?' },
  { to: 'C:Кофти', ids: ['7c0070da'], reset: true, title: 'Чи є не вʼязаний світшот (білий) на металевій блискавці?' },
  { to: 'C:Куртки', ids: ['6f8e88b2'], title: 'Зимові куртки/пуховики — до якої температури (до −20?)' },
  { to: 'C:Куртки', ids: ['bbf4be66'], title: 'Чи є куртки без резинок на манжетах і поясі?' },
  { to: 'C:Куртки', ids: ['978c5413'], title: 'Як розпрямити або безпечно розпрасувати куртку?' },
  { to: 'C:Костюми', ids: ['c234a4e2'], title: 'Чи можна взяти костюм з різним розміром верху і низу (кофта XL, штани L)?' },
  { to: 'C:Костюми', ids: ['862df6d1'], reset: true, title: 'Чи є зимовий (теплий) костюм для холодної погоди?' },
  { to: 'C:Футболки', ids: ['57968e95'], title: 'Чи є звичайна (не оверсайз) футболка?' },
  { to: 'C:Взуття', ids: ['ba27e4c4'], title: 'Яка фірма/бренд лоферів?' },
  // ── Весь магазин ──
  { to: 'S', ids: ['238a061f', '21a96734'], reset: true, title: 'Чи доставляєте за кордон (Іспанія, інші країни)?' },
  { to: 'S', ids: ['9c505921', '8763ed0f'], title: 'Проблеми з оплатою: незручно через Monobank / банк не знаходить отримувача за IBAN і ЄДРПОУ — що відповідати?' },
  { to: 'S', ids: ['c7b97083', 'e5a5af26'], title: 'Чи можна змінити мірки під себе (довша кофта, ширші штани)?' },
  { to: 'S', ids: ['f5b68c56', 'de45511a'], title: 'Чи є жилетки (з капюшоном)?' },
  { to: 'S', ids: ['22f998ad', '78799121'], reset: true, title: 'Чи є брюки / чи продаєте штани від костюма окремо?' },
  { to: 'S', ids: ['c636aea9'], title: 'Товару (кольору/розміру) немає в наявності — чи можна під замовлення, чи буде поповнення?' },
  { to: 'S', ids: ['aa73c5f0'], title: 'Чи підійде одяг підлітку (зріст 170 см)?' },
  { to: 'S', ids: ['fe74e695'], title: 'Чи повномірні розміри (відповідають стандартній сітці)?' },
  { to: 'S', ids: ['a7b0a886'], title: 'Чому товар по акції — чи немає дефектів?' },
];

// Злити в наявний запис З ВІДПОВІДДЮ (питання вже розібране — бот знатиме і це формулювання).
const INTO_ANSWERED = [
  ['d1ef68f6', ['27f3cf7b', 'd86cfe6c', 'c20d0f82', '148394a9', 'e30a3068', 'fbcf422b']], // підбір розміру за зростом і вагою
  ['bf6abaf5', ['bade4af7', '1fe95ce3', '715bc4d8', '18706dfb']], // великі розміри / які розміри є
  ['7dacd3ee', ['1bb07f76', 'b2d43a4f']], // як замовити
  ['67c4db19', ['2c6ed7b2', '1584021f', 'ee6ff336']], // передоплата / накладений платіж
  ['139978f1', ['292b9ee0']], // обмін, якщо не підійде
  ['e564bff2', ['58647cc6']], // коли відправка
  ['6939f682', ['0005fb39']], // скільки йде посилка
  ['203ef188', ['604134aa']], // більше фото
  ['cf701b81', ['f6b4daf9']], // склад кофти A0187
  ['958955b2', ['fe003589']], // чи кошлатиться кофта
  ['e49b903a', ['66a08144']], // замок/застібка на піджаку 234286
  ['8be43e8f', ['e1ec4be6']], // знижка ЗСУ
  ['4a0fe365', ['7cbd1e59']], // товар не відповідає фото
  ['2c2f6016', ['7f672867']], // set1120 гольф чи светр → питання Олексію про set1120
  ['0d96464e', ['3af32921']], // дубль A0182 кишені (вимкнена копія)
];

// Не питання до бази знань: бот сам неправильно записав власну репліку чи разову ситуацію в замовленні.
const DELETE = [
  ['fd8aca07', 'разове: «чи буде відповідь щодо позицій» у конкретному замовленні'],
  ['050c9d54', '«Яку саме кофту хоче клієнт?» — ситуація розмови, не питання'],
  ['580d8853', '«Яка модель вас цікавить?» — це питання бота, не клієнта'],
  ['140d6416', '«Який зріст і вага дядька?» — питання бота'],
  ['d1a80001', '«Це другий варіант зі списку?» — ситуація розмови'],
  ['cdf6eb5a', 'наявність кофти з поста — бот бачить наявність у CRM'],
  ['cdbdfef4', '«Чи можна додати футболку до замовлення» — дія, бот робить сам'],
  ['27b74939', 'разове: сума в конкретному замовленні'],
  ['ef14d327', 'смак клієнта (чи пасує футболка до кофти) — не факт про товар'],
  ['f55d48ef', '«Це єдиний варіант зимової куртки?» — бот бачить каталог'],
  ['4731fa0b', '«Чи є флісовий костюм?» з хибною відповіддю «немає» — флісові костюми є в каталозі (A0068, A0189, A0191, SH617927)'],
  ['f1a7b96a', 'вимкнена копія «знижка ЗСУ» (є загальний запис)'], ['f68bdf60', 'те саме'], ['5caa011c', 'те саме'], ['1520fefd', 'те саме'],
  ['8b9a0373', 'те саме'], ['c6bb7049', 'те саме'], ['a78f02f5', 'те саме'], ['2fcb4014', 'те саме'],
];

// Активні записи з відповіддю-опискою — виправити текст (зміст — те, що менеджер реально відповів).
const FIX_ANSWER = [
  ['fe20e2e5', 'Ні, знижок і розстрочки на комплект немає.', 'було «ны»'],
  ['9f312fdb', 'Поповнення розміру M не планується.', 'було «Вітаю, на звʼязку менеджер Анастасія» — справжня відповідь менеджера в розмові: «Не планується поповнення»'],
];

const splitQ = (q) => String(q || '').split('|').map((s) => s.trim()).filter(Boolean);
const joinQ = (arr) => { const seen = new Set(); return arr.filter((s) => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).join('|'); };

(async () => {
  const t = await db.tenant.findFirst({ where: { name: 'goverla_shop' }, select: { id: true } });
  const all = await db.knowledgeEntry.findMany({ where: { tenantId: t.id } });
  if (APPLY) fs.writeFileSync('/tmp/kb-backup-before-tidy-' + Date.now() + '.json', JSON.stringify(all));
  const byPfx = (p) => { const m = all.filter((e) => e.id.startsWith(p)); if (m.length !== 1) throw new Error('id ' + p + ': знайдено ' + m.length); return m[0]; };
  const prods = await db.product.findMany({ where: { tenantId: t.id }, select: { id: true, sku: true } });
  const cats = await db.category.findMany({ where: { tenantId: t.id }, select: { id: true, name: true } });
  const target = (to) => {
    if (to === 'S') return { scope: 'shop', productId: null, categoryId: null, supplierId: null };
    const [k, v] = [to.slice(0, 1), to.slice(2)];
    if (k === 'P') { const p = prods.find((x) => x.sku === v); if (!p) throw new Error('товар ' + v); return { scope: 'product', productId: p.id, categoryId: null, supplierId: null }; }
    const c = cats.find((x) => x.name === v); if (!c) throw new Error('категорія ' + v); return { scope: 'category', categoryId: c.id, productId: null, supplierId: null };
  };
  const touched = new Set();
  const once = (e) => { if (touched.has(e.id)) throw new Error('запис двічі: ' + e.id.slice(0, 8)); touched.add(e.id); };
  const ops = []; const log = [];

  for (const g of GROUPS) {
    const rows = g.ids.map(byPfx); rows.forEach(once);
    const [main, ...rest] = rows;
    const variants = joinQ([...(g.title ? [g.title] : []), ...rows.flatMap((r) => splitQ(r.question))]);
    const data = {
      ...target(g.to),
      question: g.title ? variants : main.question,
      askCount: rows.reduce((s, r) => s + (r.askCount || 1), 0),
      lastAskedAt: rows.map((r) => r.lastAskedAt || r.createdAt).sort().pop(),
      ...(g.reset ? { answer: '', isActive: false, source: 'from_dialog', tags: [] } : {}),
    };
    ops.push(db.knowledgeEntry.update({ where: { id: main.id }, data }));
    for (const r of rest) ops.push(db.knowledgeEntry.delete({ where: { id: r.id } }));
    log.push(`${g.to.padEnd(12)} ${g.reset ? 'СКИНУТИ відповідь+' : ''}${rows.length > 1 ? 'злити ' + rows.length : 'перенести'} → «${(g.title || main.question).slice(0, 90)}»`);
  }
  for (const [into, from] of INTO_ANSWERED) {
    const tgt = byPfx(into); const rows = from.map(byPfx); rows.forEach(once);
    ops.push(db.knowledgeEntry.update({ where: { id: tgt.id }, data: { question: joinQ([...splitQ(tgt.question), ...rows.flatMap((r) => splitQ(r.question))]), askCount: (tgt.askCount || 1) + rows.reduce((s, r) => s + (r.askCount || 1), 0) } }));
    for (const r of rows) ops.push(db.knowledgeEntry.delete({ where: { id: r.id } }));
    log.push(`У ГОТОВУ відповідь «${splitQ(tgt.question)[0].slice(0, 50)}» ← ${rows.length}: ${rows.map((r) => '«' + splitQ(r.question)[0].slice(0, 40) + '»').join(', ')}`);
  }
  for (const [id, why] of DELETE) { const r = byPfx(id); once(r); ops.push(db.knowledgeEntry.delete({ where: { id: r.id } })); log.push(`ПРИБРАТИ «${splitQ(r.question)[0].slice(0, 60)}» — ${why}`); }
  for (const [id, ans, why] of FIX_ANSWER) { const r = byPfx(id); once(r); ops.push(db.knowledgeEntry.update({ where: { id: r.id }, data: { answer: ans } })); log.push(`ВИПРАВИТИ відповідь «${splitQ(r.question)[0].slice(0, 50)}» → «${ans}» (${why})`); }

  console.log(log.join('\n'));
  console.log(`\nзаписів зачеплено: ${touched.size}, операцій: ${ops.length}`);
  if (APPLY) { await db.$transaction(ops); console.log('ЗАСТОСОВАНО'); }
  const un = await db.knowledgeEntry.groupBy({ by: ['scope'], where: { tenantId: t.id, source: 'from_dialog', isActive: false }, _count: { _all: true } });
  console.log('без відповіді зараз:', JSON.stringify(un));
  await db.$disconnect();
})().catch((e) => { console.error('ПОМИЛКА', e.message); process.exit(1); });
