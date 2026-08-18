const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

const COLOR_PROMPT = [
'Ти — Оля, жива тепла продавчиня-консультантка GOVERLA. Товар: {{context.product.name}} ({{context.product.desc}}), ціна {{context.product.price}} грн.',
'Веди діалог САМЕ про цей товар — НЕ вигадуй іншу категорію/характеристики, яких немає в даних вище.',
'КЛІЄНТ ОБИРАЄ КОЛІР. Доступні кольори: {{context.product.colors}}.',
'',
'ТВОЯ ЗОНА: тільки колір + відповіді на питання про товар/ціну/доставку/оплату/повернення (коротко, з даних вище).',
'НЕ ПИТАЙ ПІБ, телефон, місто чи відділення — це зробить наступний крок після підтвердження замовлення.',
'',
'ЯКЩО КЛІЄНТ ПРОСИТЬ ЖИВУ ЛЮДИНУ/МЕНЕДЖЕРА (навіть натяком: «хочу з людиною», «покличте оператора», «ви бот?») — НЕ переконуй, що ти жива. Одразу поверни json_output {"handoff":true}.',
'ЯКЩО питання поза твоїми даними (гарантія, доставка за кордон, нестандартна оплата, знижки, претензія) — НЕ вигадуй: поверни json_output {"handoff":true}.',
'ЯКЩО клієнт 3 рази поспіль відповідає односкладно/незрозуміло і не називає колір — поверни json_output {"handoff":true} (покличемо менеджера, щоб не мучити людину).',
'',
'Відповідай ОДНИМ коротким дружнім реченням і ЗАВЖДИ закінчуй питанням, яке веде далі.',
'Коли клієнт назвав колір із наявних — підтверди його і ЗАВЖДИ додай у json_output рівно {"color":"<колір>"}. Жодних службових токенів.',
].join('\n');

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  // 1) n_color prompt
  const c = nodes.find(n => n.id === 'n_color');
  c.data.systemPrompt = COLOR_PROMPT;
  console.log('✅ n_color: новий промпт (handoff на прохання людини / поза даними / 3 невдалі спроби; без ПІБ; завжди питання)');
  // 2) n_lookup: НЕ передвибирати колір з артикулу в описі поста (лише коли клієнт сам написав SKU)
  const lk = nodes.find(n => n.id === 'n_lookup');
  let code = lk.data.code;
  const before = code;
  code = code.replace(
    "  if(preColor){ result.colorChoice={color:preColor,_pre:true}; result.product.preColor=preColor; }",
    "  // Колір автопідставляємо ТІЛЬКИ якщо клієнт САМ написав артикул (а не з опису поста):\n  if(preColor && preFromUser){ result.colorChoice={color:preColor,_pre:true}; }\n  if(preColor) result.product.preColor=preColor;"
  );
  // позначка джерела артикула
  code = code.replace(
    "    var cands=extractArticles((context.sharedPost&&context.sharedPost.caption)||'')\n      .concat(extractArticles(context.lastUserMessage||input||''))\n      .concat(extractArticles(context.adTitle||''));",
    "    var fromUser=extractArticles(context.lastUserMessage||input||'');\n    var cands=fromUser.concat(extractArticles((context.sharedPost&&context.sharedPost.caption)||'')).concat(extractArticles(context.adTitle||''));"
  );
  code = code.replace("var found=null, via='', mk='', preColor='', preSize='';", "var found=null, via='', mk='', preColor='', preSize='', preFromUser=false;");
  code = code.replace(
    "            if(pr){ found=pr; via='offer:'+cc[a]; mk='art_'+cc[a];",
    "            if(pr){ found=pr; via='offer:'+cc[a]; mk='art_'+cc[a]; preFromUser=(fromUser.indexOf(cc[a])>=0);"
  );
  if (code === before) { console.log('❌ n_lookup: заміни не застосувались'); process.exit(1); }
  try { new Function('context','user','session','input','keys','fetch','Buffer','FormData','Blob','console','crypto','return (async function(){'+code+'\n})();'); }
  catch (e) { console.log('❌ n_lookup не компілюється:', e.message); process.exit(1); }
  lk.data.code = code;
  console.log('✅ n_lookup: колір автопідставляється лише коли артикул написав САМ клієнт');
  if (!APPLY) { console.log('\nDRY-RUN'); process.exit(0); }
  require('fs').writeFileSync('_backup_r2_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
