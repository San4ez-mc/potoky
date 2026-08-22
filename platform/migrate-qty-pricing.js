// Кількісні ціни (CT_1007/1008/1009 "Ціна за 2/3/4 шт", читаються в n_lookup у
// context.product.qtyPrices + готовий текст context.product.qtyPromoText):
// 1) n_order_intent — проактивно пропонує акцію за кількість (коли є) і фіксує qty
//    в json_output разом з ready.
// 2) n_pay_amount — рахує суму САМЕ за акційною ціною для вибраної кількості,
//    якщо вона задана в CRM, а не unit-price * qty.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOTS = ['cc03657f-9e72-46e5-a16d-88826e70c2ee', '5bdb3e38-1936-416f-b1f0-8f1125583193']; // covercar_ua + goverla_shop (той самий клон флоу)
const APPLY = process.argv.includes('--apply');
const NL = String.fromCharCode(10);

const ORDER_INTENT_PROMPT = [
  'Ти — тепла консультантка {{env.SHOP_TAG}}. Товар: {{context.product.name}} — {{context.product.price}} грн, колір {{context.colorChoice.color}}. Клієнт визначився з товаром і кольором. НЕ вигадуй розміри/характеристики.',
  '{{context.product.qtyPromoText}}',
  'Твоя дія: коротко підсумуй (товар, колір, ціна) і спитай «Оформляємо замовлення?» 🙂 ЯКЩО рядок з акцією вище непорожній і клієнт ще не називав кількість — згадай акцію ОДИН раз у цьому підсумку (напр. «До речі, 2 шт зараз дешевше — 800 грн замість 1000»), не нав\'язливо.',
  'ФОРМАТ ВІДПОВІДІ (СУВОРО):',
  '- Якщо клієнт ЩОЙНО дав ЯВНУ ЗГОДУ (так/да/давай/оформляй/+/ок/хочу/беру) — додай У КІНЦІ рівно: {"ready":"yes"} — а якщо клієнт десь у діалозі явно називав КІЛЬКІСТЬ (напр. "2 штуки", "візьму 3") — додай ще й поле qty в те саме json_output: {"ready":"yes","qty":2}. Якщо кількість жодного разу не звучала — просто {"ready":"yes"} (без qty, тоді вважається 1 шт).',
  '- Якщо клієнт ЯВНО відмовився/передумав/«пізніше» — додай у кінці рівно: {"ready":"no"}',
  '- У ВСІХ інших випадках (ти лише питаєш «Оформляємо?», клієнт ще НЕ відповів на це) — пиши ЛИШЕ звичайний текст, БЕЗ фігурних дужок і БЕЗ слова ready. ЗАБОРОНЕНО писати {"ready":"pending"} або {"ready":"waiting"} — таких значень НЕ існує.',
  'Коротке «так/да/+» у відповідь на «Оформляємо?» = згода (yes). Без службових токенів, не згадуй сайтів/кошиків.',
  'ЯКЩО клієнт замість згоди/відмови ставить ІНШЕ питання (доставка, склад, розмір, оплата тощо) — коротко тепло відповідай ЗВИЧАЙНИМ ТЕКСТОМ (без JSON) з наявних даних, тоді знову спитай «Оформляємо замовлення?».',
  'ЯКЩО клієнт ЯВНО просить живу людину/менеджера, або питання СПРАВДІ поза даними (гарантія, міжнародна доставка, знижки, претензія, скарга) — одразу поверни json_output {"handoff":true} (без ready).',
  'ЗАВЖДИ закінчуй повідомлення питанням або чітким наступним кроком — ніколи просто похвалою.',
  'Якщо клієнт питає про СПОСІБ оплати (передоплата/накладений/скільки зараз платити/"як платити") — відповідай РІВНО одним реченням, БЕЗ списку, БЕЗ цифр 1/2, БЕЗ суми комісії: «Оплата гнучка — можна частину зараз і решту при отриманні, або одразу повністю; на наступному кроці зручно оберете 🙂». Саме такою фразою (можеш трохи адаптувати тон, але без списку/цифр/деталей). Деталі (суми, комісію, конкретний вибір) дає ВИКЛЮЧНО наступний крок (n_pay) — якщо повторити їх зараз, клієнту доведеться відповідати на той самий вибір двічі.',
].join(NL);

const PAY_AMOUNT_CODE = "var method=(context.paymentInfo&&context.paymentInfo.method)||'cod'; var qty=Number((context.orderIntent&&context.orderIntent.qty)||1); if(!(qty>=1)) qty=1; var qp=(context.product&&context.product.qtyPrices)||{}; var tierPrice=qp[String(qty)]; var unit=(context.product&&context.product.price)||0; var full=tierPrice!=null?Number(tierPrice):(unit*qty); var ref=String(context.orderRef||'').trim(); if(!ref){ ref=('GOV'+((Number((user&&user.telegramId)||0)).toString(36).slice(-4)+Date.now().toString(36).slice(-4))).toUpperCase(); } return { payAmount: method==='cod'?200:full, payLabel: method==='cod'?'передоплата 200 грн, решта при отриманні':'повна оплата', orderRef: ref, orderQty: qty };";

function compiles(code) { try { new Function('context','user','session','input','keys','fetch','Buffer','FormData','Blob','console','crypto','return (async function(){' + code + '\n})();'); return true; } catch (e) { return e.message; } }

(async () => {
  const c1 = compiles(PAY_AMOUNT_CODE);
  if (c1 !== true) { console.log('PAY_AMOUNT_CODE FAIL:', c1); process.exit(1); }

  for (const BOT of BOTS) {
    const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!fd) { console.log('❌ бот не знайдено:', BOT); continue; }
    const nodes = JSON.parse(JSON.stringify(fd.nodes));
    const oi = nodes.find((x) => x.id === 'n_order_intent');
    const pa = nodes.find((x) => x.id === 'n_pay_amount');
    if (!oi || !pa) { console.log('❌', BOT, 'бракує нод (n_order_intent/n_pay_amount)'); continue; }

    oi.data.systemPrompt = ORDER_INTENT_PROMPT;
    pa.data.code = PAY_AMOUNT_CODE;
    console.log(`✅ ${BOT}: n_order_intent (акція за кількість + qty) + n_pay_amount (акційна ціна за тарифом)`);

    if (!APPLY) continue;
    require('fs').writeFileSync('_backup_qtypricing_' + BOT.slice(0, 8) + '_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
    await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  }

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply'); process.exit(0); }
  console.log('\n✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
