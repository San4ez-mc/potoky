// Наскрізна перевірка відповіді на коментар: реальний handleZernioEvent → агент → доставка. Зовнішні ЗАПИСИ (Meta/Zernio/Telegram/CRM POST)
// підмінено записом викликів, читання (CRM, LLM) — справжні. Запуск на сервері: node scripts/test-comment-flow.js [ключ_сценарію...]
process.env.NODE_PATH = process.env.NODE_PATH || '/var/www/flows.fineko.space/platform/node_modules';
require('module').Module._initPaths();
const path = require('path');
const { db } = require(path.join(__dirname, '..', 'packages', 'db'));
const zh = require(path.join(__dirname, '..', 'apps', 'api', 'src', 'services', 'zernioHandler'));

const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const TAIL = '\n\nЧому нам довіряють?\n✅ 8 років досвіду та тисячі задоволених клієнтів\n✅ Обмін та повернення без зайвих складнощів\n✅ 15 000 позитивних відгуків\n✅ Накладний платіж';
const POSTS = {
  velvet: { id: '18121951252903932', cap: 'Чоловічий вельветовий костюм, артикул: A0188\n\n📩 Щоб замовити - пишіть нам у Direct\n\n📌 Характеристики:\n✔️Костюм складається із кофти та штанів\n✔️Матеріал костюму: вельвет\n✔️Склад матеріалу: 100% бавовна\n✔️Кольори: світло-сірий, графітовий, чорний, синій\n✔️Розміри: S, M, L, XL, XXL (до 110 кг.)\n✔️Сезон: осінь, весна 🍂🍁\n👕Футболка продається окремо: 449 ₴\n\nЗараз діє акція на костюм:\n💵 Стара ціна: 2800 ₴\n💵 Нова ціна: 1999 ₴' + TAIL },
  sweater: { id: '17863157235658414', cap: 'Останні дні розпродажу. Осіння чоловіча вʼязана кофта🔥\nВстигніть придбати до подорожчання в сезон😉\n\n📩 Щоб замовити - пишіть нам у Direct.\n\n🧶 Матеріал кофти: ангора\n🎨 Кольори: чорний, графітовий, світло-сірий\n📏 Розміри: S, M, L, XL, XXL (до 110 кг)\n⚡️ Кофта має металеву блискавку\n🍂 Сезон: осінь, весна\n👕 Футболка продається окремо, 449 ₴\n\nЗараз діє акція:\n💵 Стара ціна кофти: 1600 ₴\n💵 Нова ціна кофти: 999 ₴\n💵 Нова ціна двох кофт: 1790 ₴\n\nЧому 190 тис. українців обрали нас?\n✅ 15 000 позитивних відгуків\n✅ Обмін та повернення\n✅ Накладний платіж\n✅ 8 років досвіду' },
  set1117: { id: '18622619473028708', cap: 'Чоловічий осінній комплект. Артикул: set1117\n\nЗамовити можна як повний комплект (кофту, джинси тафутболку), так і окремі товари\n\n📩 Щоб замовити - пишіть нам у Direct.\n\nВʼязана кофта (артикул: A0187):\n🧶 Матеріал: ангора. Склад: 80% акрил, 20% віскоза.\n🎨 Кольори: чорний, графітовий, світло-сірий\n✔️ Надійна металева блискавка\n📏 Розміри: S, M, L, XL, XXL (до 110 кг.)\n\nДжинси (артикул: j0032):\n🧶 Матеріал джинсів: 98% бавовна, 2% спандекс\n🎨 Кольори: чорний, темно-синій, синій, світло-синій\n📏 Розміри: 29, 30, 31, 32, 33, 34, 36\n\nФутболка (артикул: L0056):\n🧶 Матеріал футболки: 100% бавовна\n🎨 Кольори: чорний, білий\n📏 Розміри: S, M, L, XL, XXL (до 110 кг.)\n\nЗараз діють акційні ціни:\n💵 Кофта: 1279 ₴ (2 шт: 2199 ₴)\n💵 Джинси: 1590 ₴ (2 шт: 2990 ₴)\n💵 Футболка: 449 ₴ (2 шт: 799 ₴)\n💵 Комплект (3 в 1): 3290 ₴' + TAIL },
  suede: { id: '18143379604494430', cap: 'Чоловічий замшевий костюм. Артикул: sh667999\n\n📩 Щоб замовити - пишіть нам у Direct\n\n📌 Характеристики:\n✔️ Костюм складається із кофти та штанів\n✔️ Матеріал: преміум мікрозамша\n✔️ Штани мають пояс на резинці без шнурків\n✔️ Кофта має дві кишені, штани мають дві кишені\n✔️ Кольори: чорний, графітовий, темно-синій, темно-коричневий, темно-зелений\n✔️ Розміри: S, M, L, XL, XXL (до 110 кг.)\n✔️ Сезон: осінь 🍂🍁\n👕 Футболка продається окремо, 449 ₴\n\nЗараз діє акція:\n💵 Стара ціна костюму: 3200 ₴\n💵 Нова ціна костюму: 2279 ₴' + TAIL },
  set4: { id: '17988980490041362', cap: 'Осіння вʼязана кофта, джинси, футболка, лофери🔥\nВстигніть придбати до подорожчання в сезон😉\n\n📩 Щоб замовити - пишіть нам у Direct.\n\nКофта:\n🧶 Матеріал кофти: ангора. Склад: 80% акрил, 20% віскоза\n🎨 Кольори: чорний, графітовий, світло-сірий\n📏 Розміри: S, M, L, XL, XXL (до 110 кг.)\n⚡️ Кофта має металеву блискавку\nДжинси:\n🧶 Матеріал джинсів: 98% бавовна, 2% спандекс\n🎨 Кольори: чорний, графітовий, темно-синій, синій, світло-синій, блакитний\n📏 Розміри: 29, 30, 31, 32, 33, 34, 36\nФутболка:\n🧶 Матеріал футболки: 100% бавовна\n🎨 Кольори: чорний, білий\n📏 Розміри: S, M, L, XL, XXL (до 110 кг.)\nЛофери:\n🎨 В наявності більше 20 моделей лоферів\n✔️ Лофери є як шкіряні так і замшеві\n📏 Розміри: 40-45 (залежить від моделі)\n\nЗараз діють акційні ціни:\n💵 Кофта: 1279 ₴ (2 шт: 2199 ₴)\n💵 Джинси: 1590 ₴ (2 шт: 2990 ₴)\n💵 Футболка: 449 ₴ (2 шт: 799 ₴)\n💵 Лофери: від 1990 ₴' + TAIL },
};
const CAPS = Object.fromEntries(Object.values(POSTS).map((p) => [p.id, p.cap]));

// очікування щодо товару в приватному DM
const PRODUCT = {
  velvet: { yes: [/вельвет/i, /1999/], no: [/флісов|поларфліс/i], label: 'вельветовий костюм 1999 ₴' },
  sweater: { yes: [/кофт/i], no: [/джинс/i, /лофер/i, /комплект/i, /Ось ціни/i, /(^|\n)\s*1[.)]\s/], label: 'ОДНА кофта карткою (не список з кількох товарів)' },
  set1117: { yes: [/set1117/i, /3290/], no: [/set1112/i], label: 'комплект set1117 (3 в 1, 3290 ₴)' },
  suede: { yes: [/замшев/i, /2279/], no: [/комплект 4 в 1/i, /флісов/i], label: 'замшевий костюм 2279 ₴' },
  set4: { yes: [/set1112/i], no: [/set1119/i, /Ось ціни/i, /(^|\n)\s*1[.)]\s/], label: 'комплект 4 в 1 (set1112), не список' },
};

let META_MODE = 'ok'; let calls = [];
const realFetch = global.fetch;
const jres = (status, obj) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => obj, text: async () => JSON.stringify(obj) });
global.fetch = async (url, opts = {}) => {
  const u = String(url); const method = String(opts.method || 'GET').toUpperCase();
  let body = null; if (typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch (e) { body = opts.body; } }
  const rec = { t: Date.now(), url: u, method, body };
  const cap = u.match(/graph\.instagram\.com\/v21\.0\/(\d+)\?fields=caption/);
  if (cap) return jres(200, { id: cap[1], caption: CAPS[cap[1]] || null });
  if (/graph\.instagram\.com/.test(u) && method === 'POST') {
    calls.push(rec);
    if (/\/me\/messages/.test(u)) {
      if (body && body.recipient && body.recipient.comment_id) return META_MODE === 'fail' ? jres(500, { error: { code: 1, type: 'OAuthException', message: 'An unknown error has occurred.' } }) : jres(200, { message_id: 'pr_' + Date.now(), recipient_id: 'x' });
      return jres(200, { message_id: 'dm_' + Date.now() });
    }
    if (/message_attachments/.test(u)) return jres(200, { attachment_id: 'att_' + Date.now() });
  }
  if (/zernio\.com/.test(u) && method === 'POST') {
    calls.push(rec);
    if (/inbox\/comments\//.test(u)) return jres(200, { success: true, data: { id: 'pub_' + Date.now(), isReply: true } });
    if (/inbox\/conversations\/.+\/messages/.test(u)) return jres(200, { success: true, data: { messageId: 'zm_' + Date.now() } });
  }
  if (/api\.telegram\.org/.test(u)) { calls.push(rec); return jres(200, { ok: true, result: {} }); }
  if (/127\.0\.0\.1:4700/.test(u) && method !== 'GET') { calls.push(rec); return jres(200, { ok: true }); }
  return realFetch(url, opts);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileKey = (u) => String(u || '').split('?')[0].split('/').pop();
let _crmProds = null;
async function crmThumb(sku) {
  if (!_crmProds) {
    const k = Object.fromEntries((await db.funnelKey.findMany({ where: { botId: BOT, key: { in: ['CRM_API_BASE', 'CRM_API_KEY'] } } })).map((x) => [x.key, x.value]));
    _crmProds = [];
    for (let p = 1; p <= 5; p++) { const d = await (await realFetch(k.CRM_API_BASE.replace(/\/$/, '') + '/products?limit=100&page=' + p, { headers: { Authorization: 'Bearer ' + k.CRM_API_KEY } })).json(); _crmProds.push(...(d.data || [])); if ((d.data || []).length < 100) break; }
  }
  const p = _crmProds.find((x) => String(x.sku) === String(sku));
  // мініатюра, що є ще й серед загальних фото товару (images), — легітимне фото, не рахуємо її
  if (!p || !p.thumbnailUrl || (p.images || []).some((u) => fileKey(u) === fileKey(p.thumbnailUrl))) return '';
  return p.thumbnailUrl;
}
const results = [];
function check(scn, name, ok, detail) { results.push({ scn, name, ok: !!ok, detail: ok ? '' : String(detail || '').slice(0, 300) }); console.log((ok ? '  PASS ' : '  FAIL ') + name + (ok ? '' : ' — ' + String(detail || '').slice(0, 300))); }

let seq = 0;
async function sendComment(post, text, { commentId, contactId }) {
  await zh.handleZernioEvent(BOT, {
    event: 'comment.received', id: 'tcf_' + commentId,
    comment: { id: commentId, platformPostId: POSTS[post].id, text },
    conversation: { contact: { id: contactId, username: 'matsukoleksandr', name: 'Олександр' } },
  });
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(1500); } return false; }
const priv = () => calls.filter((c) => /me\/messages/.test(c.url) && c.body && c.body.recipient && c.body.recipient.comment_id);
const pub = () => calls.filter((c) => /inbox\/comments\//.test(c.url));
const igsidSends = () => calls.filter((c) => /me\/messages|message_attachments/.test(c.url) && !(c.body && c.body.recipient && c.body.recipient.comment_id));
const tg = () => calls.filter((c) => /telegram/.test(c.url));

async function runComment(post, commentText, mode) {
  META_MODE = mode; calls = [];
  const n = ++seq; const commentId = 'TCF' + Date.now() + n; const contactId = '9990' + Date.now().toString().slice(-8) + n;
  await sendComment(post, commentText, { commentId, contactId });
  const done = await waitFor(() => pub().length >= 1, 150000);
  await sleep(2500);
  return { done, commentId, contactId };
}

const SCEN = {
  async ok_delivery() { // приватна OK: 1 приватна відповідь, товар правильний, публічна «дивіться директ», фото відкладені
    for (const post of Object.keys(POSTS)) {
      console.log('\n## ' + post + ' | DM ок | коментар «Яка ціна?»');
      const r = await runComment(post, 'Яка ціна?', 'ok');
      const p = priv(); const text = (p[0] && p[0].body.message.text) || '';
      check(post, 'публічна відповідь під коментарем опублікована (1 шт.)', r.done && pub().length === 1, 'pub=' + pub().length);
      check(post, 'у приват надіслано РІВНО одну приватну відповідь', p.length === 1, 'private_reply=' + p.length);
      check(post, 'у приватному повідомленні є текст', text.length > 20, text);
      check(post, 'жодних фото/повідомлень на ID клієнта до його відповіді', igsidSends().length === 0, JSON.stringify(igsidSends().map((c) => c.url.slice(-30))));
      const pubText = (pub()[0] && pub()[0].body && pub()[0].body.message) || '';
      check(post, 'публічна відповідь без «закриті/напишіть самі» (DM дійшов)', pubText && !/закрит|напишіть нам самі|черкніть/i.test(pubText), pubText);
      check(post, 'публічна відповідь відсилає в директ/приват', /директ|приват/i.test(pubText), pubText);
      const P = PRODUCT[post];
      check(post, 'товар у приваті: ' + P.label, P.yes.every((re) => re.test(text)) && !P.no.some((re) => re.test(text)), text.replace(/\n/g, ' ').slice(0, 260));
      check(post, 'жодного алерта в Telegram', tg().length === 0, 'tg=' + tg().length);
      const sess = await db.session.findFirst({ where: { botId: BOT, context: { path: ['psid'], equals: r.contactId } }, orderBy: { lastActive: 'desc' } });
      const sku = sess && sess.context.product && sess.context.product.sku;
      const pend = ((sess && sess.context.commentPendingPhotos) || []).flatMap((x) => x.urls || []);
      const thumb = sku ? await crmThumb(sku) : '';
      check(post, 'мініатюра CRM не входить у фото для клієнта (' + sku + ')', pend.length && !pend.some((u) => fileKey(u) === fileKey(thumb)), 'thumb=' + fileKey(thumb) + ' photos=' + pend.map(fileKey).join(','));
    }
  },
  async dm_fail() { // приватна 500: ретрай, публічна «напишіть самі», алерт
    console.log('\n## velvet | DM 500 | коментар «Яка ціна?»');
    const r = await runComment('velvet', 'Яка ціна?', 'fail');
    const pubText = (pub()[0] && pub()[0].body && pub()[0].body.message) || '';
    check('fail', 'публічна відповідь опублікована', r.done && pub().length === 1, 'pub=' + pub().length);
    check('fail', 'було 2 спроби приватної (ретрай)', priv().length === 2, 'private_reply=' + priv().length);
    check('fail', 'публічна відповідь просить написати самим', /напишіть нам|черкніть нам/i.test(pubText), pubText);
    check('fail', 'публічна відповідь НЕ обіцяє «дивіться директ»', !/дивіться директ|перевірте директ|надсилаю в директ|вже надсилаю/i.test(pubText), pubText);
    check('fail', 'адміну пішов алерт про недоставлене DM', tg().length >= 1, 'tg=' + tg().length);
  },
  async deferred_photos() { // після відповіді клієнта в директ спершу йдуть відкладені фото, потім відповідь
    console.log('\n## velvet | DM ок → клієнт відповідає в директ');
    const r = await runComment('velvet', 'Яка ціна?', 'ok');
    const sess = await db.session.findFirst({ where: { botId: BOT, context: { path: ['psid'], equals: r.contactId } }, orderBy: { lastActive: 'desc' } });
    const pend = sess && sess.context && sess.context.commentPendingPhotos;
    check('deferred', 'фото збережено як відкладені після коментаря', Array.isArray(pend) && pend.length >= 1, JSON.stringify(pend));
    calls = [];
    await zh.handleZernioEvent(BOT, { event: 'message.received', id: 'tcf_dm_' + Date.now(), conversation: { id: 'tcf_conv_' + r.contactId, contact: { id: r.contactId, username: 'matsukoleksandr', name: 'Олександр' } }, message: { id: 'tcf_m_' + Date.now(), text: 'Зріст 180 вага 85', direction: 'incoming' } });
    const got = await waitFor(() => calls.some((c) => /inbox\/conversations\/.+\/messages/.test(c.url)), 120000);
    await sleep(2500);
    const iPhoto = calls.findIndex((c) => /message_attachments/.test(c.url));
    const iText = calls.findIndex((c) => /inbox\/conversations\/.+\/messages/.test(c.url));
    check('deferred', 'бот відповів клієнту в директ', got, 'calls=' + calls.length);
    check('deferred', 'відкладені фото надіслано ПЕРЕД відповіддю', iPhoto >= 0 && iText >= 0 && iPhoto < iText, 'photoIdx=' + iPhoto + ' textIdx=' + iText);
    const s2 = await db.session.findFirst({ where: { botId: BOT, context: { path: ['psid'], equals: r.contactId } }, orderBy: { lastActive: 'desc' } });
    check('deferred', 'відкладені фото очищено після надсилання', !(s2.context.commentPendingPhotos || []).length, JSON.stringify(s2.context.commentPendingPhotos));
  },
};

(async () => {
  const only = process.argv.slice(2);
  for (const [k, fn] of Object.entries(SCEN)) {
    if (only.length && !only.includes(k)) continue;
    try { await fn(); } catch (e) { check(k, 'сценарій не впав з помилкою', false, e.stack || e.message); }
  }
  const failed = results.filter((r) => !r.ok);
  console.log('\n=== ПІДСУМОК: ' + (results.length - failed.length) + '/' + results.length + ' пройшло ===');
  failed.forEach((f) => console.log('FAIL [' + f.scn + '] ' + f.name + ' — ' + f.detail));
  process.exit(failed.length ? 1 : 0);
})();
