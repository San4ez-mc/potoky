// n_unknown_msg: message(статика) -> claude(single, useKb) — тримає загальний контекст
// магазину навіть коли конкретний товар ще не визначено (без sharedPost/артикулу).
// Далі як і раніше: notifyTg адміну + adminEngaged=true, handoffKind='product_unknown'
// (авто-резюм на наступний продукт-сигнал вже реалізований і протестований).
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const NL = String.fromCharCode(10);

const PROMPT = [
  'Ти — {{env.PERSONA_NAME}}, тепла продавчиня {{env.SHOP_TAG}}. Клієнт написав повідомлення, але ми ЩЕ НЕ визначили, який саме товар його цікавить (він не поділився постом/рілс і не назвав артикул).',
  'Повідомлення клієнта: «{{context.lastUserMessage}}»',
  '',
  'Використай базу знань магазину (KB), щоб КОРОТКО тепло відповісти по суті, якщо це можливо з даних KB (що продаємо, чи є така категорія, загальна інформація). Якщо в KB немає точної відповіді — не вигадуй, просто привітно поясни чим магазин займається.',
  'ЗАВЖДИ закінчуй рівно такою фразою (можеш трохи адаптувати тон, але сенс лишається): «Скиньте, будь ласка, пост чи рілс із товаром, який вас цікавить, або назвіть артикул — і я одразу підкажу все конкретно 😊»',
  'Не вигадуй характеристик чи наявності товарів, яких немає в KB. Одне тепле повідомлення, без JSON, без службових токенів.',
].join(NL);

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const idx = nodes.findIndex(n => n.id === 'n_unknown_msg');
  if (idx < 0) { console.log('❌ n_unknown_msg NOT FOUND'); process.exit(1); }
  const old = nodes[idx];
  if (old.type === 'claude') { console.log('✓ вже claude — пропуск'); process.exit(0); }
  nodes[idx] = {
    ...old,
    type: 'claude',
    data: {
      ...old.data,
      label: '1b. Загальний контекст магазину (KB) → запит поста/артикулу',
      mode: 'single',
      connectorId: '2ec53ba5-144e-463b-9758-c217c4a69b0e',
      temperature: 0.4,
      useKb: true,
      systemPrompt: PROMPT,
    },
  };
  delete nodes[idx].data.text;
  console.log('✅ n_unknown_msg: message → claude(single, useKb)');

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply.'); process.exit(0); }
  require('fs').writeFileSync('_backup_unknownctx_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes, edges: fd.edges }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('\n✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
