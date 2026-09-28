'use strict';
// Patch (source of truth): Отіс → edits.fineko.space — для груп зі списку EDITS_GROUPS
// (Говерла - технічна група) у систему правок йде САМЕ ЗОБРАЖЕННЯ (multipart-файл),
// а не текст-транскрибація від Gemini. Gemini лишається лише для груп, що пишуть у Google Docs.
//
// Що змінюється в графі Отіса (bot ccb3c700, ноди n_arc_*):
//   text          — рахує arcUseEdits раніше; arcHasImage (для Gemini) тільки поза edits-групами,
//                   arcSendImage (фото файлом) тільки в edits-групах; чистить тимчасові arcImageB64/arcGeminiResult
//   img_gate      — фото завантажуємо і для Gemini, і для відправки файлом
//   gemini_gate   — НОВА: після завантаження фото Gemini викликаємо лише коли НЕ edits-група
//   finalize_text — підпис-заглушка для фото без тексту; чистка тимчасових полів
//   image_gate    — НОВА (після route_gate=true): фото + edits → окремий шлях
//   image_text / img_edit_send (httpRequest multipart) / img_edit_check / img_edit_done / img_edit_failed — НОВІ
//
// Фото з підписом, надіслані в межах 2-хв вікна після тексту, склеюються з ним в ОДНУ правку
// (текст буфера + підпис + файл). Кожне нове фото створює свою правку (токен ingest не вміє
// докидати зображення в готову правку — /api/edits/:id/images потребує SSO-сесії).
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-otis-edits-images-2026-09-28.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const prisma = new PrismaClient();
const BOT = 'ccb3c700-f46e-4de9-851b-5ed1f8c49ada';

const byKey = (nodes, key) => nodes.find((n) => new RegExp('^n_arc_' + key + '_\\d+$').test(n.id));

const TEXT_CODE =
    "let editsGroups = [];\n" +
    "try { editsGroups = JSON.parse(keys.EDITS_GROUPS || '[]'); } catch (e) { editsGroups = []; }\n" +
    "const useEdits = editsGroups.includes(context.chatTitle) && !!keys.EDITS_API_URL;\n" +
    "const lineText = (input && input !== '[фото]') ? input : '';\n" +
    "const hasImageRaw = !!context.lastUserImageUrl;\n" +
    "// arcImageB64/arcGeminiResult чистимо кожне повідомлення: інакше при невдалому завантаженні\n" +
    "// нового фото у файл піде base64 ПОПЕРЕДНЬОГО (і ~300 КБ висять у контексті сесії).\n" +
    "return {\n" +
    "  arcLineText: lineText,\n" +
    "  arcHasImage: hasImageRaw && !!keys.GEMINI_API_KEY && !useEdits,\n" +
    "  arcSendImage: hasImageRaw && useEdits,\n" +
    "  arcImageB64: '',\n" +
    "  arcGeminiResult: null,\n" +
    "};";

const FINALIZE_CODE =
    "let lineText = context.arcLineText || '';\n" +
    "const c = context.arcGeminiResult;\n" +
    "const desc = c && c.candidates && c.candidates[0] && c.candidates[0].content && c.candidates[0].content.parts && c.candidates[0].content.parts[0] && c.candidates[0].content.parts[0].text;\n" +
    "if (desc) {\n" +
    "  let clean = String(desc).trim().replace(/\\n{3,}/g, '\\n\\n');\n" +
    "  if (clean.length > 1500) clean = clean.slice(0, 1500) + '\\u2026';\n" +
    "  lineText = (lineText ? lineText + ' ' : '') + '[зображення: ' + clean + ']';\n" +
    "}\n" +
    "// Фото без підпису йде в edits файлом — текст правки обовʼязковий, тож ставимо заглушку.\n" +
    "if (!lineText && context.arcSendImage && context.arcImageB64) lineText = '(скриншот без підпису)';\n" +
    "// Байти фото потрібні далі лише на шляху «фото файлом»; в інших випадках не тримаємо їх у контексті.\n" +
    "const keepImage = context.arcSendImage === true;\n" +
    "if (!lineText) return { arcSkip: true, arcImageB64: '', arcGeminiResult: null };\n" +
    "const ts = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });\n" +
    "return Object.assign(\n" +
    "  { arcLineText: lineText, arcNewLine: '\\ud83d\\udcac [' + ts + '] ' + lineText, arcSkip: false, arcGeminiResult: null },\n" +
    "  keepImage ? {} : { arcImageB64: '' }\n" +
    ");";

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    let edges = flow.edges.slice();

    if (nodes.some((n) => /^n_arc_img_edit_send_/.test(n.id))) {
        console.log('already patched');
        await prisma.$disconnect();
        return;
    }

    const need = ['text', 'img_gate', 'fetch_image', 'gemini', 'finalize_text', 'route_gate', 'window_gate'];
    const N = {};
    for (const k of need) {
        N[k] = byKey(nodes, k);
        if (!N[k]) throw new Error('не знайдено ноду n_arc_' + k + '_* — граф Отіса змінився, патч треба оновити');
    }
    const NEXT = 'node_1788965563508';

    // ── 1. Змінюємо існуючі ноди ───────────────────────────────
    const setData = (node, patch) => { node.data = Object.assign({}, node.data, patch); };
    setData(N.text, { code: TEXT_CODE, label: 'Базовий текст + як відправляти фото' });
    setData(N.img_gate, { condition: 'context.arcHasImage === true || context.arcSendImage === true', label: 'Є фото (Gemini або файлом)?' });
    setData(N.finalize_text, { code: FINALIZE_CODE });

    // ── 2. Нові ноди ─────────────────────────────────────────
    const add = (key, type, data) => {
        const node = { id: 'n_arc_' + key + '_p1', type, position: { x: 0, y: 0 }, data };
        nodes.push(node);
        return node.id;
    };
    const geminiGate = add('gemini_gate', 'condition', {
        label: 'Це НЕ edits-група? (Gemini)',
        condition: 'context.arcSendImage !== true',
    });
    const imageGate = add('image_gate', 'condition', {
        label: 'Фото файлом у edits?',
        condition: 'context.arcSendImage === true && !!context.arcImageB64',
    });
    const imageText = add('image_text', 'js', {
        label: 'Текст правки (+ буфер у вікні)',
        code:
            "const t = (context.arcWithinWindow && context.arcOldPending) ? context.arcOldPending + '\\n' + context.arcNewLine : context.arcNewLine;\n" +
            "return { arcImageEditText: t };",
    });
    const imgSend = add('img_edit_send', 'httpRequest', {
        label: 'edits.fineko.space: правка + фото (multipart)',
        url: '{{env.EDITS_API_URL}}',
        method: 'POST',
        headers: JSON.stringify({ Authorization: 'Bearer {{env.EDITS_API_TOKEN}}' }),
        multipart: {
            fields: { text: '{{context.arcImageEditText}}', source: '{{env.EDITS_SOURCE}}', sourceRef: '{{context.chatTitle}}' },
            files: [{ field: 'images', filename: 'telegram-photo.jpg', contentType: 'image/jpeg', base64Var: 'context.arcImageB64' }],
        },
        outputVar: 'context.arcImageEditResult',
    });
    const imgCheck = add('img_edit_check', 'condition', {
        label: 'Правку з фото створено?',
        condition: 'context.arcImageEditResult && context.arcImageEditResult.ok === true',
    });
    const imgDone = add('img_edit_done', 'js', {
        label: 'Готово: скинути буфер (якщо склеїли)',
        code:
            "return Object.assign(\n" +
            "  { arcImageB64: '', arcImageEditResult: null },\n" +
            "  context.arcWithinWindow ? { editsPendingText: '', editsLastMessageAt: 0, editsPendingSince: 0 } : {}\n" +
            ");",
    });
    const imgFailed = add('img_edit_failed', 'js', {
        label: 'Не вдалось — зберегти текст у буфері',
        code:
            "// Фото не пішло: текст не губимо (піде звичайним буфером/воркером), позначаємо, що скриншот не передався.\n" +
            "const line = context.arcNewLine + ' [скриншот не вдалось передати]';\n" +
            "return {\n" +
            "  editsPendingText: context.arcOldPending ? context.arcOldPending + '\\n' + line : line,\n" +
            "  editsLastMessageAt: context.arcNow,\n" +
            "  editsPendingSince: context.editsPendingSince || context.arcNow,\n" +
            "  arcImageB64: '', arcImageEditResult: null,\n" +
            "};",
    });

    // ── 3. Ребра ──────────────────────────────────────────────
    let seq = 0;
    const eid = () => 'edge_arc_p1_' + (++seq);
    const link = (source, target, handle) => {
        const e = { id: eid(), source, target };
        if (handle) e.sourceHandle = handle;
        edges.push(e);
    };
    // fetch_image → gemini  ==>  fetch_image → gemini_gate → (true) gemini / (false) finalize_text
    const before = edges.length;
    edges = edges.filter((e) => !(e.source === N.fetch_image.id && e.target === N.gemini.id));
    if (edges.length !== before - 1) throw new Error('ребро fetch_image→gemini не знайдено');
    link(N.fetch_image.id, geminiGate);
    link(geminiGate, N.gemini.id, 'true');
    link(geminiGate, N.finalize_text.id, 'false');
    // route_gate(true) → window_gate  ==>  route_gate(true) → image_gate → (true) шлях фото / (false) window_gate
    const rg = edges.find((e) => e.source === N.route_gate.id && e.target === N.window_gate.id);
    if (!rg) throw new Error('ребро route_gate→window_gate не знайдено');
    rg.target = imageGate;
    link(imageGate, imageText, 'true');
    link(imageGate, N.window_gate.id, 'false');
    link(imageText, imgSend);
    link(imgSend, imgCheck);
    link(imgCheck, imgDone, 'true');
    link(imgCheck, imgFailed, 'false');
    link(imgDone, NEXT);
    link(imgFailed, NEXT);

    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes, edges } });
    console.log('patched: nodes', nodes.length, 'edges', edges.length);

    await callTool('auto_layout', { botId: BOT });
    console.log('auto_layout done');
    await prisma.$disconnect();
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
