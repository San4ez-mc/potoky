'use strict';
/*
 * Живий поведінковий прогін CRM-клонів через тест-API платформи (реальні Claude/CRM/Mono, але
 * testMode: без замовлень постачальнику, без Telegram-алертів, без реальних інвойсів там, де є гард).
 * Сценарії відтворюють реальні тести власника (oleksii_sirazetdinov) на старих ботах — кожен
 * сценарій = знайдений раніше баг, який має зникнути на нових версіях.
 *
 * ЗАПУСК:  API_SECRET=... node test-live-crm-clones.js [goverla|covercar|all] [--base https://flows.fineko.space]
 *          (локально: NODE_TLS_REJECT_UNAUTHORIZED=0 через Avast)
 * Вивід: діалог кожного сценарію + PASS/FAIL по асерціях. Сесії позначені isTest.
 */
const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '--base=https://flows.fineko.space').slice(7) + '/api';
const SECRET = process.env.API_SECRET || '';
if (!SECRET) { console.log('API_SECRET не задано'); process.exit(2); }
const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'all';
const BOTS = { goverla: 'fcdee415-bef2-4a74-a650-e6e4b5a12322', covercar: 'a2d5ba79-f87b-48f2-8301-56292cdf3972' };
const H = { 'x-api-secret': SECRET, 'Content-Type': 'application/json', Accept: 'application/json' };

async function api(method, path, body) {
    const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = { ok: false, raw: t.slice(0, 300) }; }
    if (!r.ok || j.ok === false) throw new Error(method + ' ' + path + ' → HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
    return j.data;
}
const results = [];
const ok = (sc, name, pass, info) => { results.push({ sc, name, pass: !!pass }); console.log('   ' + (pass ? 'PASS' : 'FAIL') + ' ' + name + (info ? ('  — ' + String(info).slice(0, 200)) : '')); };

async function newSession(botId, tag) {
    const ig = 'rg_' + tag + '_' + Date.now().toString(36);
    const d = await api('POST', '/sessions/test/start', { botId, contextOverride: { channel: 'zernio', igUsername: ig, senderName: 'Regress ' + tag, psid: String(Date.now()), testMode: true } });
    return { id: d.sessionId, ig };
}
async function say(s, text) {
    const t0 = Date.now();
    const d = await api('POST', '/sessions/test/' + s.id + '/send', { message: text });
    const st = await api('GET', '/sessions/test/' + s.id + '/state');
    const hist = st.history || [];
    // усі нові повідомлення бота після останнього user-повідомлення
    let lastUserIdx = -1; hist.forEach((m, i) => { if (m.role === 'user') lastUserIdx = i; });
    const replies = hist.slice(lastUserIdx + 1).filter((m) => m.role === 'assistant').map((m) => String(m.content || ''));
    const ms = Date.now() - t0;
    console.log('  👤 ' + text);
    replies.forEach((r) => console.log('  🤖 ' + r.replace(/\n/g, '\n     ').slice(0, 700)));
    console.log('     (' + ms + ' ms, node=' + (st.context && st.context.flowRuntime && st.context.flowRuntime.currentNodeId) + ')');
    return { replies, all: replies.join('\n'), ctx: st.context || {}, ms, state: st };
}
const has = (r, re) => re.test(r.all);

// Артикули для сценаріїв: беремо з каталогу CRM через самих ботів неможливо, тому артикул
// передається аргументом --article=A0187 (goverla) / --article=40001 (covercar); дефолти з живих тестів.
const ARTICLE = (process.argv.find((a) => a.startsWith('--article=')) || '').slice(10);
const ART = { goverla: ARTICLE || 'A0187', covercar: ARTICLE || '40001' };

async function scenarioOrderFlow(name, botId) {
    console.log('\n### ' + name + ': повний шлях (дубль опису, розмір L на кроці кольору, допродаж у сумі, зміна способу оплати)');
    const s = await newSession(botId, 'flow');
    let r = await say(s, 'Артикул ' + ART[name]);
    ok(name, 'презентація одна, без повторного опису від моделі', r.replies.length <= 3 && !/Дякую за артикул/i.test(r.all), r.replies.length + ' повідомл.');
    ok(name, 'перша відповідь ≤ 60 с', r.ms < 60000, r.ms + ' ms');
    if (!r.ctx.product) { ok(name, 'товар знайдено в CRM', false, r.ctx.productUnknownReason); return; }
    const isClothing = !!(r.ctx.product && r.ctx.product.isClothing);
    if (isClothing) {
        r = await say(s, '172 95');
        ok(name, 'розмір порахував, спитав колір/оформлення одним повідомленням', /розмір/i.test(r.all), r.all.slice(0, 120));
    }
    const hasColors = !!(r.ctx.product && String(r.ctx.product.colors || '').trim());
    if (hasColors) {
        ok(name, 'колір НЕ вибрано мовчки за артикулом товару', !(r.ctx.colorChoice && r.ctx.colorChoice.color), JSON.stringify(r.ctx.colorChoice));
        if (!(r.ctx.colorChoice && r.ctx.colorChoice.color)) {
            const firstColor = String(r.ctx.product.colors).split(',')[0].trim();
            r = await say(s, firstColor + (isClothing ? ', розмір я l ношу' : ''));
            if (isClothing) ok(name, 'клієнтський розмір L переписав рекомендований', r.ctx.recommendedSize === 'L', 'recommendedSize=' + r.ctx.recommendedSize);
            ok(name, 'колір прийнято', r.ctx.colorChoice && r.ctx.colorChoice.color, JSON.stringify(r.ctx.colorChoice));
        }
    }
    // очікуємо speakFirst n_order_intent: "Оформляємо?" (з допродажем як одним рішенням, якщо є)
    const lastCtx = r.ctx;
    ok(name, 'бот сам спитав «Оформляємо?» (speakFirst), не мовчить', /оформля|додати .{0,80}чи лише/i.test(r.all), r.all.slice(-160));
    ok(name, 'у підсумку є рядок умов (обмін/повернення, відправка)', /обмін|повернення/i.test(r.all) && /Нов(ою|а) [Пп]ошт/i.test(r.all), r.all.slice(-200));
    const upsell = lastCtx.product && lastCtx.product.upsell;
    const upsellName = (lastCtx.product && lastCtx.product.upsellItems && lastCtx.product.upsellItems[0] && lastCtx.product.upsellItems[0].name) || String(upsell || '').split('—')[0].trim();
    r = await say(s, upsell ? 'Так, і додайте ' + upsellName : 'Так, оформляємо');
    if (upsell && !/1 або 2|спосіб оплати/i.test(r.all) && /кол[іь]р|скільки/i.test(r.all)) {
        ok(name, 'допродаж з кольорами: рівно одне уточнення', (r.all.match(/\?/g) || []).length <= 2, r.all.slice(0, 160));
        r = await say(s, 'Одну чорну');
        ok(name, 'після уточнення: upsellNote/qty записано', r.ctx.orderIntent && r.ctx.orderIntent.addUpsell === true && /чорн/i.test(String(r.ctx.orderIntent.upsellNote || '')), JSON.stringify(r.ctx.orderIntent));
    }
    ok(name, 'перейшов до вибору оплати', /1 або 2|спосіб оплати/i.test(r.all), r.all.slice(0, 120));
    r = await say(s, '2');
    ok(name, 'посилання на оплату + сума', /ibanoplata|оплат/i.test(r.all) && /До сплати зараз/.test(r.all), r.all.slice(0, 200));
    const amount1 = Number(r.ctx.payAmount), url1 = String(r.ctx.ibanPayUrl || '');
    if (upsell) ok(name, 'сума включає допродаж', amount1 === Number(r.ctx.orderTotal) && Number(r.ctx.upsellSum) > 0, 'payAmount=' + amount1 + ' upsellSum=' + r.ctx.upsellSum);
    ok(name, 'бот сам попросив дані доставки (n_collect speakFirst)', /ПІБ|телефон|відділення/i.test(r.all), r.all.slice(-200));
    ok(name, 'реквізити ФОП з CRM', r.ctx.fop && r.ctx.fop.source === 'crm', JSON.stringify(r.ctx.fop));
    r = await say(s, 'Передумав, краще часткова передплата 1');
    const amount2 = Number(r.ctx.payAmount), url2 = String(r.ctx.ibanPayUrl || '');
    // у testMode ibanoplata-конектор віддає детермінований плейсхолдер (з orderRef), тому URL може збігатись;
    // ознака перевипуску — нова сума 200 і непорожній лінк (реальний перевипуск підтверджено api-логами 2026-09-03 21:37).
    ok(name, 'зміна способу → перевипуск: сума 200, лінк є', amount2 === 200 && !!url2, 'url1=' + url1.slice(-12) + ' url2=' + url2.slice(-12) + ' amount=' + amount2 + ' method=' + (r.ctx.paymentInfo && r.ctx.paymentInfo.method));
    r = await say(s, 'Реквізити дайте вручну');
    ok(name, 'ручні реквізити: IBAN з активного ФОП (не порожньо)', /UA\d{20,}/.test(r.all), r.all.replace(/\n/g, ' ').slice(0, 200));
    r = await say(s, 'Іван Тестовий 0671234567 Київ відділення 5');
    ok(name, 'адресу прийняв, без гри в "перевіряємо вручну" як факт', !/перевіряємо оплату вручну/i.test(r.all), r.all.slice(0, 200));
    ok(name, 'постачальнику НЕ пішло без оплати (testMode/гейт)', !/СТВОРЕНО в easydrop|✅ ID:/.test(String(r.ctx.supplierOrderResult || '')), String(r.ctx.supplierOrderResult || '').slice(0, 100));
    ok(name, 'клієнту не обіцяли "вже оформили" без оплати', !/вже його оформили/i.test(r.all), r.all.slice(0, 160));
    await api('POST', '/sessions/test/' + s.id + '/end');
}

async function scenarioReturnAndUnknown(name, botId) {
    console.log('\n### ' + name + ': повернення без сигналу, невідомий товар, петля');
    const s = await newSession(botId, 'ret');
    let r = await say(s, 'Привіт');
    ok(name, 'привітання без товару — представляється і пропонує категорії або пост/артикул', /пост|рілс|артикул|кофт|бомбер|накидк|джинс/i.test(r.all) && !/Перепрошуємо за очікування/.test(r.all), r.all.slice(0, 200));
    r = await say(s, 'Яка доставка?');
    ok(name, 'загальне питання без товару — відповідь з довідки + питання про товар', /Нов(а|ою) Пошт|днів/i.test(r.all) && !/Перепрошуємо за очікування/.test(r.all), r.all.slice(0, 200));
    r = await say(s, name === 'goverla' ? 'Яка ціна кофти?' : 'Скільки коштують накидки?');
    ok(name, 'категорія без артикулу — список реальних товарів з артикулами й цінами', /Артикул/.test(r.all) && /грн/.test(r.all) && !!r.ctx.catalogHint, r.all.slice(0, 220));
    r = await say(s, 'Артикул ' + ART[name]);
    ok(name, 'після артикулу — презентація', !!r.ctx.product, r.ctx.productUnknownReason);
    r = await say(s, 'дякую, подумаю');
    r = await say(s, 'так, актуально');
    ok(name, 'після "актуально" — не повторює "З поверненням" по колу', !/З поверненням/i.test(r.all) || /розмір|колір|оформля/i.test(r.all), r.all.slice(0, 160));
    await api('POST', '/sessions/test/' + s.id + '/end');
}

// Реальні переписки goverla 2026-09-04 (менеджери відповідали замість бота): клієнт не за алгоритмом.
const CTA_LIVE_RE = /\?|напиш|скиньт|підкаж|оберіть|надішл|скопіюй|можна написати|чекаю|підтверд|оформля|перевір|надійде|підкажу|допоможу|поруч/i;
async function scenarioOffScript(name, botId) {
    console.log('\n### ' + name + ': не за алгоритмом (параметри+колір у першому повідомленні, питання не по темі, фото, адреса наперед)');
    const s = await newSession(botId, 'off');
    const turns = [];
    const say2 = async (t) => { const r = await say(s, t); turns.push({ t, r }); return r; };
    let r = await say2('Артикул ' + ART[name] + ' Чорний колір Параметри 182/100');
    if (!r.ctx.product) { ok(name, 'товар знайдено', false, r.ctx.productUnknownReason); return; }
    const isClothing = !!r.ctx.product.isClothing;
    if (isClothing) {
        ok(name, 'параметри з першого повідомлення прийнято без перепитування', !!r.ctx.recommendedSize, 'recommendedSize=' + r.ctx.recommendedSize + ' node=' + (r.ctx.flowRuntime && r.ctx.flowRuntime.currentNodeId));
        ok(name, 'колір із першого повідомлення зафіксовано', !!(r.ctx.colorChoice && /чорн/i.test(r.ctx.colorChoice.color)), JSON.stringify(r.ctx.colorChoice));
    }
    r = await say2('Хто виробник? І чи можна до вас підʼїхати приміряти?');
    ok(name, 'питання не по темі: відповідь є, бот не замовк і не втік до менеджера без потреби', r.replies.length > 0 && !r.ctx.adminEngaged, r.all.slice(0, 200));
    r = await say2('[фото]');
    ok(name, 'фото посеред діалогу не скинуло товар', !!r.ctx.product && r.ctx.product.sku, 'product=' + (r.ctx.product && r.ctx.product.sku));
    r = await say2('Ігнатьєв Андрій, м. Суми, відділення 13, 0503072828');
    ok(name, 'адреса замість "так": згода + prefill → оплата', /1 або 2|спосіб оплати/i.test(r.all) && r.ctx.orderData && r.ctx.orderData.phone, JSON.stringify(r.ctx.orderData));
    r = await say2('1');
    ok(name, 'після оплати адресу НЕ перепитує (prefill повний → n_collect пропущено)', !/ПІБ.*телефон.*місто/is.test(r.all) || /Оплату поки не бачу|Дякуємо/i.test(r.all), r.all.slice(-200));
    const noCta = turns.filter((x) => x.r.replies.length && !CTA_LIVE_RE.test(x.r.replies[x.r.replies.length - 1])).map((x) => x.t.slice(0, 25) + ' → ' + x.r.replies[x.r.replies.length - 1].slice(-60));
    ok(name, 'кожна відповідь бота закінчується питанням/кроком', noCta.length === 0, noCta.join(' | '));
    await api('POST', '/sessions/test/' + s.id + '/end');
}

async function scenarioTrust(name, botId) {
    console.log('\n### ' + name + ': заперечення проти передоплати → виняток довіри (softHandoffOff)');
    const s = await newSession(botId, 'trust');
    let r = await say(s, 'Артикул ' + ART[name]);
    if (!r.ctx.product) { ok(name, 'товар знайдено', false); return; }
    if (r.ctx.product.isClothing) r = await say(s, '180 80');
    if (String((r.ctx.product || {}).colors || '').trim() && !r.ctx.colorChoice) r = await say(s, String(r.ctx.product.colors).split(',')[0].trim());
    r = await say(s, 'так, оформляємо, тільки основний');
    r = await say(s, 'Не хочу передоплату, тільки накладений');
    ok(name, 'крок 1: пояснення, без handoff', !/покличу менеджера/i.test(r.all) && !r.ctx.adminEngaged, r.all.slice(0, 160));
    r = await say(s, 'Все одно не хочу');
    r = await say(s, 'Мене вже кидали з передоплатою, боюсь що обманете');
    ok(name, 'крок 3: слово "обманете" НЕ перехопив двигун, є пропозиція без передоплати', /без передоплати/i.test(r.all) && !r.ctx.adminEngaged, r.all.slice(0, 200));
    r = await say(s, 'Домовились');
    ok(name, 'cod_trust: 0 грн, без звірки Mono, просить адресу', Number(r.ctx.payAmount) === 0 && /ПІБ|телефон|відділення/i.test(r.all), 'payAmount=' + r.ctx.payAmount);
    await api('POST', '/sessions/test/' + s.id + '/end');
}

(async () => {
    const names = which === 'all' ? Object.keys(BOTS) : [which];
    for (const n of names) {
        const botId = BOTS[n];
        for (const sc of [scenarioOrderFlow, scenarioReturnAndUnknown, scenarioTrust, scenarioOffScript]) {
            try { await sc(n, botId); } catch (e) { ok(n, sc.name + ' без винятків', false, e.message); }
        }
    }
    const failed = results.filter((t) => !t.pass);
    console.log('\n===== ПІДСУМОК: ' + (results.length - failed.length) + '/' + results.length + ' PASS' + (failed.length ? ('; FAIL: ' + failed.map((t) => t.sc + ':' + t.name).join(' | ')) : '') + ' =====');
    process.exit(failed.length ? 1 : 0);
})();
