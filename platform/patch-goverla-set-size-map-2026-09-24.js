'use strict';
/*
 * Аудит постачальників 2026-09-24: розміри позицій КОМПЛЕКТУ n_calc віддавав лише текстом (setSizesText),
 * тож постачальник/CRM отримували порожній size для кожної позиції комплекту. Додаємо структурований
 * setSizeMap {article: size} (policy.js переносить його у ctx.setSelection[].size).
 * Ідемпотентно. Запуск: node patch-goverla-set-size-map-2026-09-24.js  (з каталогу platform, DATABASE_URL у оточенні)
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BOT_IDS = ['fcdee415-bef2-4a74-a650-e6e4b5a12322'];

function patchCode(code) {
  if (code.includes('setSizeMap')) return { code, changed: false };
  let out = code;
  const a = "var __setLines = [];";
  const b = "    __setLines.push('📏 ' + __it.name + '\n' + __itSizeLine);";
  const c = "    setSizesText: __setLines.join('\n\n'),";
  const d = "      __itSizeLine = __r.size ? ('Розмір: ' + __r.size)";
  if (![a, b, c, d].every((s) => out.includes(s))) return { code, changed: false, reason: 'фрагменти не знайдено: ' + [a, b, c, d].map((x, i) => (out.includes(x) ? '' : 'abcd'[i])).join('') };
  out = out.replace(a, a + " var __setSizeMap = {};");
  out = out.replace(d, "      if (__r.size && __it.article) __setSizeMap[__it.article] = __r.size;\n" + d);
  out = out.replace(c, c + "\n    setSizeMap: __setSizeMap,");
  return { code: out, changed: true };
}

(async () => {
  for (const botId of BOT_IDS) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(botId, 'немає flowDefinition'); continue; }
    let changed = false;
    const nodes = (flow.nodes || []).map((n) => {
      if (n.id !== 'n_calc') return n;
      const key = ['code', 'script', 'js'].find((k) => n.data && typeof n.data[k] === 'string' && n.data[k].includes('__setLines'));
      if (!key) { console.log(botId, 'n_calc: не знайдено поле з кодом'); return n; }
      const r = patchCode(n.data[key]);
      if (!r.changed) { console.log(botId, 'n_calc:', r.reason || 'вже пропатчено'); return n; }
      changed = true; console.log(botId, 'n_calc: додано setSizeMap');
      return { ...n, data: { ...n.data, [key]: r.code } };
    });
    if (changed) await prisma.flowDefinition.update({ where: { botId }, data: { nodes } });
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
