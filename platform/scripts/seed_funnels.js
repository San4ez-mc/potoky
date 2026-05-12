'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function buildFlow(bot) {
  const safeSlug = bot.slug || 'bot';
  const startId = 'start_1';
  const introId = 'msg_intro';
  const aiId = 'claude_main';
  const saveId = 'save_result';
  const doneId = 'msg_done';

  const nodes = [
    {
      id: startId,
      type: 'start',
      position: { x: 80, y: 80 },
      data: {
        label: 'Start',
        trigger: '/start',
      },
    },
    {
      id: introId,
      type: 'message',
      position: { x: 80, y: 240 },
      data: {
        label: 'Intro message',
        text: `Welcome to ${bot.name}. Please describe your current input for this lesson.`,
      },
    },
    {
      id: aiId,
      type: 'claude',
      position: { x: 80, y: 420 },
      data: {
        label: 'Claude generation',
        model: 'claude-haiku-4-5',
        systemPrompt: `You are the assistant for ${bot.name} (${safeSlug}).\nCollect user context and produce a clear structured result for this lesson.`,
        messagesTemplate: '{\n  "input": "{{lastUserMessage}}",\n  "botSlug": "' + safeSlug + '"\n}',
        outputVar: 'context.aiResult',
      },
    },
    {
      id: saveId,
      type: 'saveFile',
      position: { x: 80, y: 600 },
      data: {
        label: 'Save lesson output',
        fileType: safeSlug.replace(/-/g, '_') + '_result',
      },
    },
    {
      id: doneId,
      type: 'message',
      position: { x: 80, y: 780 },
      data: {
        label: 'Completion message',
        text: 'Done. Result generated and saved. You can continue to the next lesson.',
      },
    },
  ];

  const edges = [
    { id: 'e1', source: startId, target: introId, animated: true },
    { id: 'e2', source: introId, target: aiId, animated: true },
    { id: 'e3', source: aiId, target: saveId, animated: true },
    { id: 'e4', source: saveId, target: doneId, animated: true },
  ];

  return {
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.9 },
  };
}

async function main() {
  const project = await prisma.project.findUnique({
    where: { slug: 'finance-course' },
    include: { bots: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } },
  });

  if (!project) {
    throw new Error('Project finance-course not found');
  }

  let updated = 0;
  for (const bot of project.bots) {
    const flow = buildFlow(bot);
    await prisma.flowDefinition.upsert({
      where: { botId: bot.id },
      create: {
        botId: bot.id,
        nodes: flow.nodes,
        edges: flow.edges,
        viewport: flow.viewport,
      },
      update: {
        nodes: flow.nodes,
        edges: flow.edges,
        viewport: flow.viewport,
      },
    });
    updated += 1;
  }

  console.log(JSON.stringify({ ok: true, project: project.slug, bots: project.bots.length, flowsUpserted: updated }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
