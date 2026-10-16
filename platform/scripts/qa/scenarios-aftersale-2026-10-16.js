'use strict';
// Синтетичні сценарії «після покупки» з повідомленнями МЕНЕДЖЕРА в історії (FunnelTest їх вставляти не вміє): повернення/обмін/
// повернення коштів, скарга на брак, відгук, догляд, нова покупка, продаж з рядком «Обмін/повернення 14 днів».
// Один хід бота на сценарій у тестовій сесії (testMode — нічого не надсилається). ≈ $0.03 на сценарій.
//   BOT_FILES_DIR=... node scripts/qa/scenarios-aftersale-2026-10-16.js [ONLY=<частина назви>]
const path = require('path');
const { db } = require(path.join(__dirname, '../../apps/api/src/services/shopAgent/lib'));
const { handleTurn } = require(path.join(__dirname, '../../apps/api/src/services/shopAgent/index'));
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';

const M = (text) => ({ role: 'assistant', who: 'manager', text });
const B = (text) => ({ role: 'assistant', who: 'bot', text });
const C = (text) => ({ role: 'user', who: 'client', text });
const ORDER = { crmOrderId: 'test-order', payStatus: 'confirmed', supplierTtn: '20451540000000', product: { sku: 'A0187', name: 'Чоловіча вʼязана кофта. Артикул: A0187', customerName: 'Чоловіча вʼязана кофта', price: 1279 } };
const HIST_RETURN = [C('Доброго дня, хочу повернути кофту, не підійшла'), M('Добрий день! Обмін та повернення сюди: Артеменко Олексій, Харків, відділення 132. Оплатіть доставку, без накладеного платежу'), C('Добре, завтра відправлю'), M('Очікуємо на номер накладної')];
const HIST_REFUND = [C('Відправила кофту назад'), M('Повернення прийнято ✅'), M('Напишіть, будь ласка, номер картки для повернення коштів')];
const HIST_DELIVERED = [B('Дякуємо за замовлення! Номер накладної надішлемо сюди'), M('20451540000000 — номер накладної')];
const HIST_SALE_TEMPLATE = [C('Яка ціна кофти?'), M('Кофта 1279 грн. Кольори: сірий, графіт, чорний'), C('Графіт, L'), M('Обмін/повернення 14 днів ✅ Відправка Новою поштою 📦 Бажаєте перейти до оформлення замовлення зараз?🙂')];

const SC = [
    { name: 'С1 картка для повернення коштів з пробілами', hist: HIST_REFUND, ctx: ORDER, input: { text: '4441 1110 4483 0580' }, expect: { paused: 'aftersale', noSteps: /phone_invalid|present|order_intent/ } },
    { name: 'С2 номер зворотної накладної текстом', hist: HIST_RETURN, ctx: ORDER, input: { text: 'Відправила, ось номер 20451560123456' }, expect: { paused: 'aftersale', noSteps: /present|post_order|order_intent/ } },
    { name: 'С3 «коли повернете гроші?»', hist: HIST_REFUND.concat([C('Ось картка 4441111044830580')]), ctx: ORDER, input: { text: 'А коли повернете гроші?' }, expect: { paused: 'aftersale', noSteps: /present|order_intent/ } },
    { name: 'С4 обмін: «коли відправите XXL?»', hist: HIST_RETURN.concat([C('Хочу обміняти на XXL')]), ctx: ORDER, input: { text: 'Я вже відправила, коли відправите мені XXL?' }, expect: { paused: 'aftersale', noSteps: /present|return_easy|order_intent/ } },
    { name: 'С5 КОНТРОЛЬ відгук після отримання', hist: HIST_DELIVERED, ctx: ORDER, input: { text: 'Отримав, все супер, дякую! Якість топ' }, expect: { notPaused: 'aftersale', steps: /feedback|thanks|post_q/ } },
    { name: 'С6 КОНТРОЛЬ «як прати?» після отримання', hist: HIST_DELIVERED, ctx: ORDER, input: { text: 'Кофту отримали, сподобалась. Як її прати?' }, expect: { notPaused: 'aftersale' } },
    { name: 'С7 КОНТРОЛЬ продаж менеджера з рядком «Обмін/повернення 14 днів»', hist: HIST_SALE_TEMPLATE, ctx: {}, input: { text: 'Так, оформляємо' }, expect: { notPaused: 'aftersale' } },
    { name: 'С8 КОНТРОЛЬ перша скарга на брак без менеджера', hist: HIST_DELIVERED.slice(0, 1), ctx: ORDER, input: { text: 'Отримала кофту, а вона розійшлась по шву, що робити?' }, expect: { notPaused: 'aftersale', steps: /return_defect|return_collect/ } },
    { name: 'С9 фото браку після «надішліть фото» (повернення в процесі збору)', hist: HIST_DELIVERED.concat([C('По якості розчарована, нерівна вʼязка'), B('Дуже прикро 😔 Надішліть, будь ласка, фото браку')]), ctx: { ...ORDER, returnFlow: { stage: 'collect', defect: true, at: Date.now(), asks: 1, firstText: 'По якості розчарована' } }, input: { text: '', imageUrl: 'https://pcrm.fineko.space/uploads/51dec598-527e-4a94-a1a9-12cc6a873a25/3a233483-7e7d-45b8-9509-2202b2e6ecc8.jpg' }, expect: { steps: /return_defect_photo/, noSteps: /present/ } },
    { name: 'С10 «Зараз» посеред повернення, менеджер щойно писав', hist: HIST_RETURN, ctx: ORDER, input: { text: 'Зараз' }, mgrNow: true, expect: { paused: 'aftersale', silent: true } },
    { name: 'С11 КОНТРОЛЬ нова покупка після завершеного повернення', hist: HIST_REFUND.concat([M('Кошти повернули ✅')]), ctx: ORDER, input: { text: 'Дякую! А тепер хочу замовити пуховик D0043, яка ціна?' }, expect: { notPaused: 'aftersale' } },
];

(async () => {
    const proj = (await db.$queryRawUnsafe(`select u."projectId" p from sessions s join users u on u.id = s."userId" where s."botId" = $1 limit 1`, BOT).catch(() => [{}]))[0] || {};
    let fail = 0;
    for (const sc of SC.filter((x) => !process.env.ONLY || x.name.includes(process.env.ONLY))) {
        const user = await db.user.create({ data: { telegramId: BigInt(-9200000000000) - BigInt(Math.floor(Math.random() * 1e9)), username: 'scn_' + Date.now().toString(36), firstName: 'Scenario', metadata: { scenario: true }, ...(proj.p ? { projectId: proj.p } : {}) } });
        const ctx = { testMode: true, channel: 'meta', agent: {}, ...JSON.parse(JSON.stringify(sc.ctx || {})) };
        const test = await db.session.create({ data: { userId: user.id, botId: BOT, state: 'inbox', isTest: true, context: ctx } });
        const base = Date.now() - (sc.mgrNow ? 30 * 60 * 1000 : 2 * 86400000);
        let k = 0;
        for (const h of sc.hist) {
            k++;
            await db.message.create({ data: { sessionId: test.id, role: h.role, content: h.text, createdAt: new Date(base + k * 60000), metadata: h.who === 'manager' ? { source: 'zernio_inbox' } : h.who === 'bot' ? { source: 'shop_agent' } : { source: 'scenario' } } });
        }
        await db.message.create({ data: { sessionId: test.id, role: 'user', content: sc.input.text || '[фото]', metadata: { source: 'scenario', ...(sc.input.imageUrl ? { attachment: { type: 'photo', url: sc.input.imageUrl } } : {}) } } });
        let r; try { r = await handleTurn({ botId: BOT, sessionId: test.id, text: sc.input.text || '', imageUrl: sc.input.imageUrl || null }); } catch (e) { console.log('❌ ' + sc.name + ' ERROR ' + e.message); fail++; continue; }
        const u = r.understanding || {};
        const steps = (r.replies || []).map((o) => o.step).join(',');
        const paused = r.ctx && r.ctx.funnelPaused ? r.ctx.pausedBy : '';
        const e = sc.expect; const bad = [];
        if (e.paused && paused !== e.paused) bad.push('пауза ' + (paused || '—') + ' ≠ ' + e.paused);
        if (e.notPaused && paused === e.notPaused) bad.push('зайва пауза ' + paused);
        if (e.steps && !e.steps.test(steps)) bad.push('немає кроку ' + e.steps);
        if (e.noSteps && e.noSteps.test(steps)) bad.push('зайвий крок ' + steps);
        if (e.silent && steps) bad.push('мав мовчати');
        if (bad.length) fail++;
        console.log((bad.length ? '❌ ' : '✅ ') + sc.name + (bad.length ? '  — ' + bad.join('; ') : '') + '\n    afterSale=' + u.afterSale + ' intent=' + u.intent + ' пауза=' + (paused || '—') + ' кроки=' + (steps || '— (мовчить)') + '\n    відповідь: ' + ((r.replies || []).map((o) => String(o.text || '').replace(/\n/g, ' ')).join(' | ').replace(/\d{12,19}/g, '<№>').slice(0, 220) || '—'));
        await db.message.deleteMany({ where: { sessionId: test.id } }); await db.session.delete({ where: { id: test.id } }).catch(() => {}); await db.user.delete({ where: { id: user.id } }).catch(() => {});
    }
    console.log(fail ? 'ПРОВАЛЕНО: ' + fail : 'УСЕ ПРОЙШЛО');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
