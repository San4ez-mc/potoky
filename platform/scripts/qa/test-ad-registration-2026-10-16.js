// Реєстрація джерела розмови в CRM /ads (16.10): сторіз — ніколи; пост/рілс — повний запис (назва з підпису, посилання,
// артикул із підпису → товар); справжня реклама — як раніше. Мережа підмінена: нічого не пише ні в CRM, ні в Instagram.
// Запуск: node scripts/qa/test-ad-registration-2026-10-16.js
const path = require('path');
const { matchProduct } = require(path.join(__dirname, '../../apps/api/src/services/shopAgent/productMatch'));

const PRODUCTS = [
    { id: 'p1', sku: 'A0191', name: 'Флісовий костюм', customerName: 'Флісовий костюм', price: 1299, categoryId: 'c1', images: [] },
    { id: 'p2', sku: 'D0043', name: 'Пуховик', customerName: 'Пуховик', price: 1899, categoryId: 'c2', images: [] },
];
const IG = {
    '18000000000000001': { media_product_type: 'STORY', media_type: 'IMAGE', permalink: 'https://www.instagram.com/stories/x/1' },
    '18000000000000002': { media_product_type: 'FEED', media_type: 'VIDEO', permalink: 'https://www.instagram.com/reel/abc/', caption: 'Теплий флісовий костюм\nАртикул: A0191', media_url: 'https://cdn/x.mp4', thumbnail_url: 'https://cdn/x.jpg' },
};

let posts = [];
global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (o, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => o, text: async () => JSON.stringify(o) });
    if (u.includes('graph.instagram.com')) { const id = u.split('/v21.0/')[1].split('?')[0]; return IG[id] ? json(IG[id]) : json({ error: { message: 'no' } }, false); }
    if (u.includes('/ads?externalId=')) return json({ ok: true, data: [] });
    if (u.endsWith('/ads') && opts.method === 'POST') { posts.push(JSON.parse(opts.body)); return json({ ok: true, data: {} }); }
    return json({ ok: true, data: [] });
};

const keys = { CRM_API_BASE: 'http://crm.test/api', CRM_API_KEY: 'k', INSTAGRAM_ACCESS_TOKEN: 'tok' };
let fail = 0;
function check(name, cond, info) { console.log((cond ? '✅ ' : '❌ ') + name + (cond ? '' : '  ' + info)); if (!cond) fail++; }

(async () => {
    const base = () => ({ lookupProductsRaw: PRODUCTS, lookupAdsRaw: [], agent: {} });

    posts = [];
    await matchProduct({ ...base(), entryAd: '18000000000000001', storyId: '18000000000000001' }, keys, 'скільки коштує?', { botId: 'b' }).catch((e) => console.log('err', e.message));
    check('1. відповідь на сторіз (storyId = entryAd) — нічого не реєструємо', posts.length === 0, JSON.stringify(posts));

    posts = [];
    await matchProduct({ ...base(), entryAd: '18000000000000001' }, keys, 'скільки коштує?', { botId: 'b' }).catch((e) => console.log('err', e.message));
    check('2. id сторіз без storyId у памʼяті — Instagram каже STORY → не реєструємо', posts.length === 0, JSON.stringify(posts));

    posts = [];
    await matchProduct({ ...base(), entryAd: '18000000000000002', commentMediaId: '18000000000000002' }, keys, 'ціна?', { botId: 'b' }).catch((e) => console.log('err', e.message));
    const p = posts.find((x) => x.externalId === '18000000000000002') || {};
    check('3. пост/рілс — назва з підпису', p.name === 'Допис в Instagram: Теплий флісовий костюм', JSON.stringify(p));
    check('3. пост/рілс — посилання, підпис, відео', p.postUrl === 'https://www.instagram.com/reel/abc/' && /A0191/.test(p.captionText || '') && p.mediaType === 'video', JSON.stringify(p));
    check('3. пост/рілс — товар за артикулом з підпису', p.productId === 'p1' && p.productLinkSource === 'auto_article', JSON.stringify(p));

    posts = [];
    await matchProduct({ ...base(), entryAd: '120251229300670329', entryAdId: '120251229300670329', adTitle: 'Допис в Instagram: Чоловічий флісовий костюм_Group_1', storyId: '18000000000000001' }, keys, 'ціна?', { botId: 'b' }).catch((e) => console.log('err', e.message));
    const a = posts.find((x) => x.externalId === '120251229300670329') || {};
    check('4. реклама в сторіз — реєструємо саме рекламу з назвою', a.name === 'Допис в Instagram: Чоловічий флісовий костюм_Group_1', JSON.stringify(posts));

    posts = [];
    await matchProduct({ ...base(), entryAd: '18000000000000009' }, keys, 'ціна?', { botId: 'b' }).catch((e) => console.log('err', e.message));
    check('5. Instagram не відповів, звідки id невідомо — не реєструємо', posts.length === 0, JSON.stringify(posts));

    posts = [];
    await matchProduct({ ...base(), entryAd: '18000000000000009', commentMediaId: '18000000000000009' }, keys, 'ціна?', { botId: 'b' }).catch((e) => console.log('err', e.message));
    check('6. Instagram не відповів, але це коментар під постом — реєструємо', posts.some((x) => x.externalId === '18000000000000009'), JSON.stringify(posts));

    console.log(fail ? 'ПРОВАЛЕНО: ' + fail : 'УСЕ ПРОЙШЛО');
    process.exit(fail ? 1 : 0);
})();
