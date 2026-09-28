'use strict';
// Patch (source of truth): Отіс — авторозшифровка голосових у групі. Коли хтось надсилає
// голосове/аудіо в групу, одразу під ним Отіс пише «🎙 Розшифровка аудіо: …».
//
// Розшифровку робить транспорт (Whisper, platformBotHandler) і виставляє context.voiceTranscript
// для САМЕ цього повідомлення ('' для решти). Що з нею робити — рішення воронки, тут:
//   n_arc_voice_gate (condition) : група + є розшифровка
//   n_arc_voice_msg  (message)   : «🎙 Розшифровка аудіо: …»
// Гейт вставляється перед «Звернулись до Отіса?» (node_1788965563508): усі ребра, що вели туди
// (архівні гілки), тепер ведуть у гейт. Довгі розшифровки ріже на частини доставка (3500 симв.).
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-otis-voice-transcript-2026-09-28.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const prisma = new PrismaClient();
const BOT = 'ccb3c700-f46e-4de9-851b-5ed1f8c49ada';
const NEXT = 'node_1788965563508'; // «Звернулись до Отіса?»
const GATE = 'n_arc_voice_gate_p2';
const MSG = 'n_arc_voice_msg_p2';

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    if (flow.nodes.some((n) => n.id === GATE)) {
        console.log('already patched');
        return;
    }
    if (!flow.nodes.some((n) => n.id === NEXT)) throw new Error('немає ноди ' + NEXT + ' — граф змінився, патч треба оновити');

    const nodes = flow.nodes.slice();
    const edges = flow.edges.map((e) => ({ ...e }));

    nodes.push({
        id: GATE, type: 'condition', position: { x: 0, y: 0 },
        data: {
            label: 'Голосове в групі з розшифровкою?',
            condition: "context.chatType && context.chatType !== 'private' && !!context.voiceTranscript",
        },
    });
    nodes.push({
        id: MSG, type: 'message', position: { x: 0, y: 0 },
        data: {
            label: 'Розшифровка аудіо в групу',
            text: '🎙 Розшифровка аудіо:\n{{context.voiceTranscript}}',
            variants: [],
        },
    });

    // Усі наявні ребра, що вели в NEXT, перенаправляємо в гейт.
    let retargeted = 0;
    for (const e of edges) {
        if (e.target === NEXT) { e.target = GATE; retargeted += 1; }
    }
    if (!retargeted) throw new Error('жодного ребра в ' + NEXT + ' — граф змінився');

    edges.push({ id: 'edge_voice_p2_1', source: GATE, target: MSG, sourceHandle: 'true' });
    edges.push({ id: 'edge_voice_p2_2', source: GATE, target: NEXT, sourceHandle: 'false' });
    edges.push({ id: 'edge_voice_p2_3', source: MSG, target: NEXT });

    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes, edges } });
    console.log('patched: retargeted', retargeted, 'edges; nodes', nodes.length, 'edges', edges.length);

    await callTool('auto_layout', { botId: BOT });
    console.log('auto_layout done');
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error('ERR', e.message); process.exit(1); });
