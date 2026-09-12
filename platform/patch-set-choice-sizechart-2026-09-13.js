// Патч: n_set_choice тепер бачить розмірну сітку (довжина стопи/см тощо) КОЖНОГО компонента
// комплекту, не лише голі номери розмірів. Живий баг (MaksimKapelyan, знайдено агентом-
// розслідувачем): "лофери 5934, стелька 30 см — чи є такий розмір?" ескалювало на менеджера,
// хоча context.product.setItems[].sizeChartData вже мав потрібні дані — просто ніде в промпт
// не потрапляло (n_lookup-crm-code.js тепер рендерить це окремим полем setSizeChartText).
// Ідемпотентно: анкер-based insert, guard на !/setSizeChartText/.test(...).

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BOT_IDS = ['fcdee415-bef2-4a74-a650-e6e4b5a12322'];
const ANCHOR = 'Кольори, доступні для цього комплекту: {{context.product.colors}}.';
const CLAUSE = '\nРозмірні сітки (довжина стопи/см тощо) окремих позицій комплекту, якщо є (порожньо = нема жодної): {{context.product.setSizeChartText}} — ЯКЩО клієнт питає про розмір/стельку/довжину стопи КОНКРЕТНОЇ позиції і дані вище її містять — відповідай ПРЯМО з цих цифр (не проси зачекати, не клич менеджера). Лише якщо потрібної позиції чи цифри в списку справді нема — тоді {"askManager":"<питання клієнта>"}.';

(async () => {
  for (const botId of BOT_IDS) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(botId, '— немає flowDefinition'); continue; }
    const nodes = flow.nodes || [];
    const idx = nodes.findIndex((n) => n.id === 'n_set_choice');
    if (idx === -1) { console.log(botId, '— немає ноди n_set_choice'); continue; }
    const sp = (nodes[idx].data && nodes[idx].data.systemPrompt) || '';
    if (/setSizeChartText/.test(sp)) { console.log(botId, '= вже застосовано'); continue; }
    const pos = sp.indexOf(ANCHOR);
    if (pos === -1) { console.log(botId, '⚠️ анкер не знайдено — перевірити вручну'); continue; }
    const insertAt = pos + ANCHOR.length;
    const newSp = sp.slice(0, insertAt) + CLAUSE + sp.slice(insertAt);
    const newNodes = nodes.slice();
    newNodes[idx] = Object.assign({}, nodes[idx], { data: Object.assign({}, nodes[idx].data, { systemPrompt: newSp }) });
    await prisma.flowDefinition.update({ where: { botId }, data: { nodes: newNodes } });
    console.log(botId, '✅ застосовано');
  }
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); }).finally(() => prisma.$disconnect());
