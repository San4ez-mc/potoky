'use strict';
// Онбординг експерта: кейси не склеюються в один запис і не обрізаються; оригінал документа зберігається.
//  1) вузол «Записати в content2»: O12 розбивається на окремі кейси («Кейс N (ніша): ситуація. Що зробили. Результат: …») → kind=cases
//     (кожен зі своїм ДОЗВОЛЕНО казати: результат кейсу, якщо експерт дозволив цифри); старий склеєний «Кейс експерта» прибирається;
//  2) вузол теж кладе в content2 оригінали документів експерта (kind=doc, «Матеріали експерта: <файл>»), що зберіг agent-нода;
//  3) agent-нода: data.saveIncomingDocs=true (зберігати текст вхідних документів) + правило формату O12.
// Потребує деплою Flows (testSession.js, /documents) і content2 (kind=cases). Ідемпотентно.
// Запуск з кореня platform/:  PLATFORM_ROOT=$PWD node scripts/patch-onboard-seller-cases-split-2026-11-04.js  (DRY_RUN=1 — лише показати)
const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');

const DRY = !!process.env.DRY_RUN;
const MARK = '/* CASES_SPLIT */';

// ── 1) заміна рядка з одним кейсом ───────────────────────────────────────────────────────────────
const NEW_CASES_BLOCK = String.raw`${MARK}
  if (v('O12') && !/^(нема|немає|нет|no)(?![\p{L}])/iu.test(v('O12').trim())) {
    const raw = v('O12');
    const quote = (F.O12 && F.O12.quote) || '';
    const permMatch = raw.match(/Дозволено казати:\s*([\s\S]*?)(?:\.?\s*Не казати:|$)/i);
    const permAll = permMatch ? permMatch[1].trim() : '';
    const numbersOk = !!permAll || /цифр\S*\s+(?:можна|дозвол)|(?:можна|дозвол\S*)\s+(?:називати\s+)?цифр/i.test(quote + ' ' + raw);
    const body = raw.split(/(?:Дозволено казати:|Не казати:)/i)[0].trim();
    const parts = body.split(/(?=Кейс\s*\d+\s*[(:])/i).map((s) => s.trim()).filter((s) => /^Кейс\s*\d+/i.test(s));
    const cases = parts.map((s) => {
      const m = /^Кейс\s*(\d+)\s*(?:\(([^)]*)\))?\s*:?\s*([\s\S]*)$/i.exec(s);
      const tag = ((m && m[2]) || '').trim();
      const text = ((m && m[3]) || s).trim();
      const rm = /Результат:\s*([\s\S]*)$/i.exec(text);
      const result = rm ? rm[1].trim() : '';
      const before = (rm ? text.slice(0, rm.index) : text).trim();
      const first = /^([\s\S]*?[.!?])\s+([\s\S]*)$/.exec(before);
      const problem = first ? first[1].trim() : before;
      const done = first ? first[2].trim() : '';
      return {
        title: 'Кейс ' + m[1] + (tag ? ': ' + tag : ''),
        niche: tag || undefined,
        product: svc || undefined,
        problem,
        solution: [done, result ? 'Результат: ' + result : ''].filter(Boolean).join(' ') || problem,
        allowedClaims: numbersOk && result ? result : undefined,
      };
    });
    if (cases.length) add('кейси (' + cases.length + ')', ['O12', 'K2'], 'cases', { cases, replaceMerged: true });
    else add('кейс', ['O12', 'K2'], 'case', { title: 'Кейс експерта', product: svc || undefined, solution: raw, allowedClaims: permAll || undefined });
  }`;

// ── 2) оригінали документів → content2 (після циклу DOCS, перед «let projectId») ─────────────────
const DOCS_BLOCK = String.raw`${MARK}
  try {
    const dres = await fetch(String(keys.SELLER_DOSSIER_URL || '').replace(/\/$/, '') + '/documents?sessionId=' + encodeURIComponent(session.id), { method: 'POST', headers: { 'X-Search-Secret': String(keys.SEARCH_SECRET || ''), 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) });
    const dj = await dres.json().catch(() => ({}));
    for (const d of (dj && dj.documents) || []) if (d.text && String(d.text).trim()) items.push({ label: 'матеріали: ' + d.fileName, kind: 'doc', data: { fileName: 'Матеріали експерта: ' + d.fileName, text: d.text } });
  } catch (e) { /* архів матеріалів не критичний для запису досьє */ }
`;

const FORMAT_RULE = 'ФОРМАТ КЕЙСІВ (поле O12): кожен кейс записуй окремим абзацом у вигляді «Кейс N (ніша без імені): ситуація. Що зробили. Результат: …». Не склеюй кейси в один абзац і не скорочуй цифри та факти експерта. Наприкінці, якщо експерт дозволив цифри, додай рядок «Дозволено казати: цифри результатів» (назви компаній — лише якщо дозволив).';

(async () => {
    const bot = await db.bot.findFirst({ where: { slug: 'onboard-seller' } });
    if (!bot) throw new Error('onboard-seller не знайдено');
    const f = await callTool('get_funnel', { botId: bot.id });

    // 1+2: вузол запису в content2
    const w = (f.nodes || []).find((x) => x.type === 'js' && x.data && x.data.label === 'Записати в content2');
    if (!w) throw new Error('вузол «Записати в content2» не знайдено');
    let code = w.data.code;
    if (code.includes(MARK)) console.log('  = вузол запису вже оновлено');
    else {
        const i = code.indexOf("if (v('O12') && !/^(нема|немає|нет|no)");
        if (i < 0) throw new Error('не знайдено рядок кейсу в вузлі');
        const j = code.indexOf('\n  const DOCS = [', i);
        if (j < 0) throw new Error('не знайдено кінець рядка кейсу (const DOCS)');
        code = code.slice(0, i) + NEW_CASES_BLOCK + code.slice(j);
        const k = code.indexOf("\n  let projectId = '';");
        if (k < 0) throw new Error("не знайдено «let projectId» для вставки архіву матеріалів");
        code = code.slice(0, k) + '\n  ' + DOCS_BLOCK + code.slice(k);
        if (!DRY) await callTool('update_node', { botId: bot.id, nodeId: w.id, data: { code } });
        console.log('  ✔ вузол «Записати в content2»', DRY ? '(dry-run)' : 'оновлено', '| код', w.data.code.length, '→', code.length);
    }

    // 3: agent-нода
    const a = (f.nodes || []).find((x) => x.type === 'agent' && x.data && typeof x.data.systemPrompt === 'string');
    if (!a) throw new Error('агент онбордингу не знайдено');
    const patch = {};
    if (!a.data.saveIncomingDocs) patch.saveIncomingDocs = true;
    if (!a.data.systemPrompt.includes('ФОРМАТ КЕЙСІВ (поле O12)')) {
        const anchor = a.data.systemPrompt.indexOf('Питання 10, 12, 15, 19 і 20 став ЗАВЖДИ');
        const at = anchor >= 0 ? anchor : a.data.systemPrompt.indexOf('ТЕХНІЧНИЙ ЕТАП НЕ ТУТ');
        if (at < 0) throw new Error('не знайдено місце для правила формату кейсів');
        patch.systemPrompt = a.data.systemPrompt.slice(0, at) + FORMAT_RULE + '\n' + a.data.systemPrompt.slice(at);
    }
    if (Object.keys(patch).length) {
        if (!DRY) await callTool('update_node', { botId: bot.id, nodeId: a.id, data: patch });
        console.log('  ✔ агент онбордингу', DRY ? '(dry-run)' : 'оновлено:', Object.keys(patch).join(', '));
    } else console.log('  = агент уже оновлено');
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
