'use strict';
/*
 * Рішення власника 2026-09-24: при відмові від посилки на пошті передоплата 200 грн НЕ повертається (йде на компенсацію
 * доставки) — як кажуть менеджери; бот раніше в скрипті довіри обіцяв «повернемо ці 200 грн одразу».
 * Ідемпотентно. Запуск: node patch-goverla-refund-policy-2026-09-24.js (з каталогу platform, DATABASE_URL у оточенні)
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BOT_IDS = ['fcdee415-bef2-4a74-a650-e6e4b5a12322'];
const OLD = 'Якщо прийдете на пошту і вам щось не підійде — ми повернемо ці 200 грн одразу.';
const NEW = 'Посилку можна оглянути й приміряти на пошті перед оплатою. Якщо забрали й вдома щось не підійшло — обмін або повернення протягом 14 днів. А якщо відмовитесь від посилки на пошті, передплата 200 грн не повертається: вона йде на компенсацію доставки.';
(async () => {
  for (const botId of BOT_IDS) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) continue;
    let changed = false;
    const nodes = (flow.nodes || []).map((n) => {
      if (n.id !== 'n_agent_trust1' || !n.data || typeof n.data.text !== 'string' || !n.data.text.includes(OLD)) return n;
      changed = true; return { ...n, data: { ...n.data, text: n.data.text.replace(OLD, NEW) } };
    });
    console.log(botId, changed ? 'n_agent_trust1: політику повернення виправлено' : 'без змін');
    if (changed) await prisma.flowDefinition.update({ where: { botId }, data: { nodes } });
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
