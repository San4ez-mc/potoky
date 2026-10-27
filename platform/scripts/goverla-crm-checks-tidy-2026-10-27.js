// 27.10: «Перевірити в CRM» — закрити хибні тривоги (клієнт з реклами товару питав про ІНШУ категорію — привʼязка правильна)
// і дубль (той самий допис 17863157235658414 під двома id реклами).
const fs = require('fs');
const crmEnv = require('/var/www/crm.fineko.space/node_modules/dotenv').parse(fs.readFileSync('/var/www/crm.fineko.space/.env'));
const { PrismaClient } = require('/var/www/crm.fineko.space/node_modules/@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: crmEnv.DATABASE_URL } } });
const FALSE = ['8d1e872a', 'ade8b173', 'f5d8d913', '4bc6ff52'];
(async () => {
  const t = await db.tenant.findFirst({ where: { name: 'goverla_shop' }, select: { id: true, apiKey: true } });
  const H = { Authorization: 'Bearer ' + t.apiKey, 'Content-Type': 'application/json' };
  const call = async (id, body) => { const r = await fetch('http://127.0.0.1:4700/api/crm-checks/' + id, { method: 'PATCH', headers: H, body: JSON.stringify({ ...body, actor: 'claude' }) }); return r.status; };
  const open = await db.crmCheck.findMany({ where: { tenantId: t.id, status: 'open' } });
  const by = (p) => open.find((c) => c.id.startsWith(p));
  for (const p of FALSE) { const c = by(p); console.log('закрито', p, await call(c.id, { answer: 'Привʼязка правильна (назва допису = цей товар). Клієнт з цієї реклами просто спитав про інший товар — бот показав йому список категорії. Дія не потрібна.', status: 'closed' })); }
  const keep = by('8b21c039'); const dup = by('b71e3b38');
  const links = [...(keep.sessionLinks || [])]; for (const l of dup.sessionLinks || []) if (!links.some((x) => x.url === l.url)) links.push(l);
  console.log('посилання злито', await call(keep.id, { sessionLinks: links }));
  console.log('дубль закрито', await call(dup.id, { answer: 'Дубль тікета «реклама 17863157235658414 → A0187, у тексті C0043» (той самий допис під іншим id реклами) — розмови перенесено туди.', status: 'closed' }));
  await db.$disconnect();
})().catch((e) => { console.error('ПОМИЛКА', e.message); process.exit(1); });
