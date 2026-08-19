// Розширює патерн "відповідай з даних + вузький handoff" на ноди без запобіжника:
// n_order_intent, n_pay_collect, n_collect, n_upsell2_wait.
// Причина: клієнти ставлять питання в хаотичному порядку — кожна dialog-нода
// має вміти відповісти з наявних даних і мати явний handoff-запобіжник.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const NL = String.fromCharCode(10);

const PATCHES = {
  n_order_intent: {
    find: 'ЗАВЖДИ закінчуй повідомлення питанням або чітким наступним кроком — ніколи просто похвалою.',
    insertBefore: [
      'ЯКЩО клієнт замість згоди/відмови ставить ІНШЕ питання (доставка, склад, розмір, оплата тощо) — коротко тепло відповідай ЗВИЧАЙНИМ ТЕКСТОМ (без JSON) з наявних даних, тоді знову спитай «Оформляємо замовлення?».',
      'ЯКЩО клієнт ЯВНО просить живу людину/менеджера, або питання СПРАВДІ поза даними (гарантія, міжнародна доставка, знижки, претензія, скарга) — одразу поверни json_output {"handoff":true} (без ready).',
      '',
    ].join(NL),
  },
  n_pay_collect: {
    find: 'Поверни ТІЛЬКИ json_output {"method":"cod"} або {"method":"full"} — БЕЗ видимого тексту (клієнту напише наступний крок). Інших способів не вигадуй.',
    replace: [
      'Якщо вибір ЗРОЗУМІЛИЙ — поверни ТІЛЬКИ json_output {"method":"cod"} або {"method":"full"} — БЕЗ видимого тексту (клієнту напише наступний крок).',
      'Якщо клієнт замість вибору ставить ІНШЕ питання (доставка, термін, гарантія тощо) — коротко тепло відповідай ЗВИЧАЙНИМ ТЕКСТОМ (без JSON) і в кінці знову спитай «Який спосіб оплати оберете — 1 чи 2?».',
      'Якщо клієнт ЯВНО просить живу людину/менеджера — поверни json_output {"handoff":true}.',
      'Інших способів оплати не вигадуй.',
    ].join(NL),
  },
  n_collect: {
    find: 'Коли у повідомленні є ВСІ 4 поля — НЕ перепитуй підтвердження, НЕ пиши видимого тексту, одразу поверни ТІЛЬКИ json_output {"fullName":"...","phone":"...","city":"...","branch":"..."} (подяку напише наступний крок). Не згадуй сайтів.',
    replace: [
      'Коли у повідомленні є ВСІ 4 поля — НЕ перепитуй підтвердження, НЕ пиши видимого тексту, одразу поверни ТІЛЬКИ json_output {"fullName":"...","phone":"...","city":"...","branch":"..."} (подяку напише наступний крок). Не згадуй сайтів.',
      'Якщо клієнт замість даних доставки ставить ІНШЕ питання (оплата, термін, гарантія тощо) — коротко тепло відповідай ЗВИЧАЙНИМ ТЕКСТОМ з відомих даних, і одразу після відповіді знову попроси саме ті поля, яких бракує.',
      'Якщо клієнт ЯВНО просить живу людину/менеджера — поверни json_output {"handoff":true} (без інших полів).',
    ].join(NL),
  },
  n_upsell2_wait: {
    find: 'Відповідай ОДНИМ теплим реченням українською. ЗАВЖДИ додай у json_output рівно один JSON: {"done": true}. Жодних службових токенів.',
    replace: [
      'Відповідай ОДНИМ теплим реченням українською. ЗАВЖДИ додай у json_output рівно один JSON: {"done": true}. Жодних службових токенів.',
      'ВИНЯТОК: якщо клієнт явно просить живу людину/менеджера — замість цього поверни ТІЛЬКИ json_output {"handoff":true} (без done).',
    ].join(NL),
  },
};

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  let changed = 0;

  for (const id of Object.keys(PATCHES)) {
    const n = nodes.find(x => x.id === id);
    if (!n) { console.log('❌ ' + id + ' NOT FOUND'); continue; }
    const p = PATCHES[id];
    const sp = String((n.data && n.data.systemPrompt) || '');
    if (!sp.includes(p.find)) {
      console.log('⚠️  ' + id + ': опорний текст не знайдено (можливо вже пропатчено) — пропуск');
      continue;
    }
    const already = p.replace ? sp.includes(p.replace) : sp.includes(p.insertBefore);
    if (already) { console.log('✓ ' + id + ': вже застосовано'); continue; }
    const next = p.replace
      ? sp.replace(p.find, p.replace)
      : sp.replace(p.find, p.insertBefore + p.find);
    n.data.systemPrompt = next;
    changed++;
    console.log('✅ ' + id + ': патч додано (' + next.length + ' симв.)');
  }

  if (!changed) { console.log('\nНічого змінювати — DRY-RUN або вже застосовано.'); if (!APPLY) process.exit(0); }

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply щоб записати.'); process.exit(0); }
  require('fs').writeFileSync('_backup_chaos_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes, edges: fd.edges }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('\n✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
