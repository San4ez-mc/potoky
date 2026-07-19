// #277 — Воронка org-interview: тонкий релей стадійного інтервʼю орг-структури.
// На кожній стадії: claude(dialog, парс у JSON) → js(складає body) → httpRequest(/agent/act)
// → message(reply). companyId зі Стадії 0 несеться через context далі. Стадія 5 без діалогу.
// Спец: org-репо INTERVIEW_PLAN.md + services/agent-interview.ts.
//
// Запуск:
//   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/fineko_flows?schema=public" \
//   node platform/build-org-interview-funnel.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROJECT_SLUG = 'fineko-org';
const BOT_SLUG = 'org-interview';
const CLAUDE_SONNET = '2ec53ba5-144e-463b-9758-c217c4a69b0e';

// Кожна стадія: action + системний промпт (веде питання, на виході json_output потрібної форми).
const STAGES = [
  {
    key: 's0', action: 'interview_start',
    prompt: 'Стадія 0 інтервʼю орг-структури. Мова українською, тепло, ПО ОДНОМУ питанню з уточненнями. Зʼясуй: чим займається компанія і головний продукт; мету і ЦКП компанії (цінний кінцевий продукт); ідеальну картину через 1-3 роки; власників/інвесторів і їх частки %. Коли зібрав — поверни РІВНО один JSON: {"name":"...","mission":"...","companyCkp":"...","idealPicture":"...","owners":[{"name":"...","kind":"OWNER|INVESTOR","sharePct":0}]}.',
  },
  {
    key: 's1', action: 'interview_divisions',
    prompt: 'Стадія 1: 7 відділень канонічного борду Хаббарда (boardNo: 7 адміністративне, 1 побудови/персоналу, 2 розповсюдження/маркетинг+продажі, 3 фінансове, 4 технічне/виробництво, 5 кваліфікації, 6 по роботі з публікою). Поясни коротко і зʼясуй: які напрями вже є де-факто і хто за них відповідає. Поверни РІВНО один JSON: {"divisions":[{"boardNo":2,"leadName":"Імʼя керівника","ckp":"опційно"}]} — лише ті, де є керівник чи уточнення.',
  },
  {
    key: 's2', action: 'interview_departments',
    prompt: 'Стадія 2: відділи всередині відділень та їх ЦКП. Питай по одному відділенню. Поверни РІВНО один JSON: {"departments":[{"divisionBoardNo":2,"name":"Відділ продажів","ckp":"Дохід","leadName":"опційно"}]}.',
  },
  {
    key: 's3', action: 'interview_posts',
    prompt: 'Стадія 3: посади у відділах, їх ЦКП і хто обіймає (реальне імʼя або вакансія). Поверни РІВНО один JSON: {"posts":[{"departmentName":"Відділ продажів","title":"Менеджер з продажів","ckp":"Закриті угоди","holderName":"опційно імʼя"}]}.',
  },
  {
    key: 's4', action: 'interview_processes',
    prompt: 'Стадія 4: 2-4 ключові бізнес-процеси (потоки цінності). Для кожного — кроки (відповідальна посада → дія → результат). Поверни РІВНО один JSON: {"processes":[{"name":"...","description":"...","steps":[{"post":"...","action":"...","result":"..."}]}]}.',
  },
];

function buildGraph() {
  const nodes = [{ id: 'start_1', type: 'start', position: { x: 80, y: 60 }, data: { label: 'Старт (Telegram)', trigger: 'telegram' } }];
  const edges = [];
  let y = 220;
  let prev = 'start_1';
  const link = (from, to) => edges.push({ id: `e_${from}__${to}`, source: from, target: to });

  for (const st of STAGES) {
    const claudeId = `n_${st.key}_ask`;
    const jsId = `n_${st.key}_body`;
    const httpId = `n_${st.key}_call`;
    const msgId = `n_${st.key}_reply`;

    nodes.push({ id: claudeId, type: 'claude', position: { x: 80, y },
      data: { label: `${st.key.toUpperCase()}: діалог`, mode: 'dialog', connectorId: CLAUDE_SONNET,
        systemPrompt: st.prompt, exitCondition: 'json_output', outputVar: `${st.key}data`, temperature: 0.4 } });
    y += 150;

    // Складаємо тіло /agent/act; companyId несеться в контексті (зʼявляється після Стадії 0).
    nodes.push({ id: jsId, type: 'js', position: { x: 80, y },
      data: { label: `${st.key}: body`,
        code: `return { ${st.key}body: JSON.stringify({ companyId: context.companyId || null, intent: { action: '${st.action}', params: context.${st.key}data || {} } }) };` } });
    y += 150;

    nodes.push({ id: httpId, type: 'httpRequest', position: { x: 80, y },
      data: { label: `${st.key}: /agent/act`, method: 'POST', url: '{{keys.ORG_API_URL}}/agent/act',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer {{keys.ORG_API_TOKEN}}' },
        body: `{{context.${st.key}body}}`, outputVar: `${st.key}res` } });
    y += 150;

    // Стадія 0 — витягуємо companyId у контекст для наступних стадій.
    if (st.key === 's0') {
      const extractId = 'n_s0_cid';
      nodes.push({ id: extractId, type: 'js', position: { x: 80, y },
        data: { label: 's0: companyId', code: 'return { companyId: (context.s0res && context.s0res.companyId) || context.companyId || null };' } });
      y += 150;
      link(prev, claudeId); link(claudeId, jsId); link(jsId, httpId); link(httpId, extractId);
      prev = extractId;
    } else {
      link(prev, claudeId); link(claudeId, jsId); link(jsId, httpId);
      prev = httpId;
    }

    nodes.push({ id: msgId, type: 'message', position: { x: 80, y },
      data: { label: `${st.key}: reply`, parseMode: 'HTML', text: `{{context.${st.key}res.reply}}` } });
    y += 150;
    link(prev, msgId);
    prev = msgId;
  }

  // Стадія 5 — без діалогу: повідомлення → виклик → reply.
  const s5msg = 'n_s5_note';
  const s5body = 'n_s5_body';
  const s5call = 'n_s5_call';
  const s5reply = 'n_s5_reply';
  nodes.push({ id: s5msg, type: 'message', position: { x: 80, y }, data: { label: 's5: нотатка', text: '📝 Генерую чернетки посадових інструкцій…' } });
  y += 150;
  nodes.push({ id: s5body, type: 'js', position: { x: 80, y }, data: { label: 's5: body', code: "return { s5body: JSON.stringify({ companyId: context.companyId || null, intent: { action: 'interview_instructions', params: {} } }) };" } });
  y += 150;
  nodes.push({ id: s5call, type: 'httpRequest', position: { x: 80, y }, data: { label: 's5: /agent/act', method: 'POST', url: '{{keys.ORG_API_URL}}/agent/act', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer {{keys.ORG_API_TOKEN}}' }, body: '{{context.s5body}}', outputVar: 's5res' } });
  y += 150;
  nodes.push({ id: s5reply, type: 'message', position: { x: 80, y }, data: { label: 's5: reply', parseMode: 'HTML', text: '{{context.s5res.reply}}' } });
  link(prev, s5msg); link(s5msg, s5body); link(s5body, s5call); link(s5call, s5reply);

  return { nodes, edges };
}

const KEYS = [
  ['ORG_API_URL', 'http://127.0.0.1:4100/api', 'База ОРГ-платформи API (прод: https://.../api)', false],
  ['ORG_API_TOKEN', 'localsecret', 'Bearer-токен ОРГ API', true],
  ['CLAUDE_CONNECTOR_ID', CLAUDE_SONNET, 'Claude Sonnet конектор', false],
  ['TELEGRAM_CONNECTOR_ID', 'REPLACE_ME', 'UUID savedConnector Telegram-бота орг-агента', true],
];

async function main() {
  const { nodes, edges } = buildGraph();
  const project = await prisma.project.upsert({
    where: { slug: PROJECT_SLUG }, update: {},
    create: { name: 'FINEKO — Орг.структура', slug: PROJECT_SLUG, description: 'Агенти орг-структури' },
  });
  let bot = await prisma.bot.findFirst({ where: { slug: BOT_SLUG } });
  if (!bot) {
    bot = await prisma.bot.create({
      data: { projectId: project.id, name: 'Орг-агент: інтервʼю', slug: BOT_SLUG,
        description: 'Стадійне інтервʼю (0-5): будує орг.структуру+процеси+чернетки інструкцій через /agent/act.',
        goal: 'Побудувати орг.структуру компанії в діалозі.', trigger: 'telegram', isActive: true },
    });
  }
  await prisma.flowDefinition.upsert({ where: { botId: bot.id }, update: { nodes, edges }, create: { botId: bot.id, nodes, edges } });
  for (const [key, value, label, isSecret] of KEYS) {
    await prisma.funnelKey.upsert({ where: { botId_key: { botId: bot.id, key } }, update: { label, isSecret }, create: { botId: bot.id, key, value, label, isSecret } });
  }
  console.log('OK org-interview bot:', bot.id, '| nodes:', nodes.length, '| edges:', edges.length, '| keys:', KEYS.length);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
