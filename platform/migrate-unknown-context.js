// n_unknown_msg: message(статика) -> claude(single) — тримає загальний контекст
// магазину навіть коли конкретний товар ще не визначено (без sharedPost/артикулу).
// Далі як і раніше: notifyTg адміну + adminEngaged=true, handoffKind='product_unknown'
// (авто-резюм на наступний продукт-сигнал вже реалізований і протестований).
//
// ІСТОРІЯ ФІКСУ (важливо, щоб не повторити):
// v1 (useKb:true) — КБ цього бота це generic FAQ-плейбук заперечень («Дорого»/
//   «Не підходить»), НЕ каталог товарів. Використання useKb тут давало моделі
//   нерелевантні chunks і вона ГАЛЮЦИНУВАЛА «так, у нас є футболки» (перевірено
//   живим тестом 2026-08-19).
// v2/v3 (без useKb, явна заборона + bad/good приклад, temperature=0) — МОДЕЛЬ
//   ВСЕ ОДНО галюцинувала («так, у нас точно є футболки») — приклад-заперечення
//   у промпті сам підказував структуру відповіді ("pink elephant" ефект).
// v4 (ФІНАЛЬНА, ця версія) — шаблонна відповідь: модель НЕ міркує про наявність
//   товарів взагалі, лише адаптує привітання під тон клієнта й ретранслює
//   фіксовану фразу-прохання показати конкретний товар.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const NL = String.fromCharCode(10);

const PROMPT = [
  'Ти — {{env.PERSONA_NAME}}, продавчиня {{env.SHOP_TAG}}. Клієнт написав повідомлення, товар ще НЕ визначено.',
  'Повідомлення клієнта: «{{context.lastUserMessage}}»',
  '',
  'Твоє завдання — ЛИШЕ привітатись у тон клієнта (коротко, тепло) і РІВНО ЦЕ повідомити далі, нічого не додаючи від себе про товари:',
  '«Щоб підказати все точно — наявність, ціну, кольори, розміри — покажіть, будь ласка, конкретний товар: скиньте пост чи рілс з Instagram або назвіть артикул 😊»',
  '',
  'СУВОРО ЗАБОРОНЕНО: писати щось про конкретні товари (є/немає, ціни, категорії, асортимент) — ти цього не знаєш, у тебе немає доступу до каталогу.',
  'Дозволено лише: 1) коротке привітання у тон клієнта, 2) фраза вище дослівно або близько до тексту. Без JSON, без службових токенів.',
].join(NL);

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const idx = nodes.findIndex(n => n.id === 'n_unknown_msg');
  if (idx < 0) { console.log('❌ n_unknown_msg NOT FOUND'); process.exit(1); }
  const old = nodes[idx];
  nodes[idx] = {
    ...old,
    type: 'claude',
    data: {
      ...old.data,
      label: '1b. Загальний контекст магазину (шаблон) → запит поста/артикулу',
      mode: 'single',
      connectorId: '2ec53ba5-144e-463b-9758-c217c4a69b0e',
      temperature: 0,
      useKb: false,
      systemPrompt: PROMPT,
    },
  };
  delete nodes[idx].data.text;
  console.log('✅ n_unknown_msg: message → claude(single, шаблонна відповідь, useKb=false)');

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply.'); process.exit(0); }
  require('fs').writeFileSync('_backup_unknownctx_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes, edges: fd.edges }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('\n✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
