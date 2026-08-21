// Прив'язка вже створених власником проєктних Claude-конекторів до ботів
// відповідних проєктів (щоб бачити, скільки токенів реально їсть кожен проєкт).
// Торкаємось ЛИШЕ ботів, які вже мали CLAUDE_CONNECTOR_ID=generic (2ec53ba5) —
// боти без Claude-ноди взагалі (claudeConn=немає) не чіпаємо навмисно.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const GENERIC_ID = '2ec53ba5-144e-463b-9758-c217c4a69b0e';

const MAPPING = [
  { projectId: 'd1b14d77-1d13-4144-8382-91ec915775fa', projectName: 'Курс "Налаштування фінансової звітності"', connectorId: '3d3d20f0-aca2-428c-855c-fe907b7cabd2' },
  { projectId: 'a45a10a5-d678-43a0-bc53-a749915e347b', projectName: 'Контент для соц.мереж', connectorId: '4f9fbe29-e85a-40dd-93ed-4ed1b5f9fba6' },
  { projectId: 'a023d6dc-02fb-4720-99a4-d358f13b099f', projectName: 'Публікація в соц.мережах', connectorId: '4f9fbe29-e85a-40dd-93ed-4ed1b5f9fba6' },
  { projectId: 'cdf44275-8c34-49bf-b5e1-8fd6a18307ea', projectName: 'Орг.структура та бізнес процеси', connectorId: 'b2695a13-8381-40ca-a496-066a50af1f03' },
  { projectId: '3e5a58c2-a0da-4d68-8c18-53e3af22ebb3', projectName: 'Таск Трекер', connectorId: 'cce1e5d7-0279-4a61-99ab-0fda8545a732' },
];

// Косметика: два старі проєктні конектори ще мають тип claude_sonnet (створені
// до того, як з'явився об'єднаний тип 'claude') — вирівнюємо.
const TYPE_FIX = ['91b1a062-aa6e-4dcf-a01a-b3cfef017921', '4f9fbe29-e85a-40dd-93ed-4ed1b5f9fba6'];

(async () => {
  let planTotal = 0;
  for (const m of MAPPING) {
    const bots = await db.bot.findMany({ where: { projectId: m.projectId }, select: { id: true, name: true } });
    const botIds = bots.map(b => b.id);
    const toMove = await db.funnelKey.findMany({ where: { botId: { in: botIds }, key: 'CLAUDE_CONNECTOR_ID', value: GENERIC_ID } });
    console.log(`${m.projectName} -> ${m.connectorId}: ${toMove.length} ботів`);
    planTotal += toMove.length;
    m._toMove = toMove;
  }
  console.log('\nТипи конекторів вирівняти на "claude":', TYPE_FIX.join(', '));
  console.log('\nУсього ключів до переносу:', planTotal);

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply'); process.exit(0); }

  for (const m of MAPPING) {
    for (const row of m._toMove) {
      await db.funnelKey.update({ where: { id: row.id }, data: { value: m.connectorId } });
    }
  }
  for (const id of TYPE_FIX) {
    await db.savedConnector.update({ where: { id }, data: { type: 'claude' } });
  }

  console.log('\n✅ готово');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
