'use strict';

/**
 * Clone the Content Manager Web funnel into Content Manager 2.0 (Telegram).
 *
 * The two bots share IDENTICAL logic (dispatcher → tasks[] → propose_theme /
 * confirm → ST generate → humanizer → import → agent). The ONLY difference is
 * I/O:
 *   - Web  : input from webhook payload, output via HTTP callback (mid-flow async)
 *   - CM2.0: input from Telegram message, output via flow `message` nodes that
 *            deliverSessionMessages() sends to the channel (batched at step end)
 *
 * This script copies web's nodes+edges into CM2.0 and patches the I/O nodes.
 *
 * SAFETY:
 *   - Dry-run by default. Prints the plan. Pass --apply to write.
 *   - Always writes a timestamped backup of CM2.0's current flow to ./backups.
 *
 * Run on the server (where @platform/db resolves):
 *   CM2_PROJECT_CUID=<content2 project cuid> node scripts/clone-web-to-cm2.js
 *   CM2_PROJECT_CUID=<content2 project cuid> node scripts/clone-web-to-cm2.js --apply
 *
 * KNOWN CAVEAT: Telegram delivers all assistant messages produced in one flow
 * step together. The web "early confirm → … → result" timing therefore collapses
 * into one delivery on CM2.0 unless the flow is split across steps. v1 keeps the
 * confirm as a message node; verify the UX live and split if needed.
 */

const fs = require('fs');
const path = require('path');
const { db } = require('@platform/db');

const WEB_BOT = 'f8e725fc-2c13-4e27-8bbf-e7b501f6737c';
const CM2_BOT = '22f2bce5-ac62-4297-8ea0-66e258e8b505';

const CONTENT2 = process.env.CONTENT2_URL || 'https://content2.fineko.space';
const IMPORT_TOKEN = process.env.CONTENT_IMPORT_TOKEN || 'fnk_wh_2026_x9mK4pLqR7vNsT1eYcJdBuAw';
const PROJECT_CUID = process.env.CM2_PROJECT_CUID || '';

const APPLY = process.argv.includes('--apply');

// Web callback httpRequest nodes → the context var that holds their text.
// Each becomes a `message` node so deliverSessionMessages sends it to Telegram.
const CALLBACK_TO_TEXT = {
  // TG batches delivery, so fold the "Зрозумів N завдань…" confirm into the result.
  node_1781269120944: '{{context.confirmText}}\n\n{{context.webResponseText}}', // ST result
  node_1780591002750: '{{context.dialogResponse}}',       // dialog agent
  node_agent_callback_1780678764262: '{{context.agentResult}}', // content agent / propose_theme
  node_1780591011470: 'Повний план на місяць — це багатоетапний процес. Напиши «план на місяць» окремо. Тут можу: пости, сторіз, карусель, reels, Threads, LinkedIn.',
  node_1781121620199: '✅ Правило збережено в базу знань. Враховуватиму при наступних генераціях.',
};

function log(...a) { console.log('[clone]', ...a); }

(async () => {
  if (!PROJECT_CUID) {
    throw new Error('Set CM2_PROJECT_CUID to the content2 project cuid for Content Manager 2.0.');
  }

  const web = await db.flowDefinition.findUnique({ where: { botId: WEB_BOT } });
  const cm2 = await db.flowDefinition.findUnique({ where: { botId: CM2_BOT } });
  if (!web || !Array.isArray(web.nodes)) throw new Error('Web flow not found / empty.');

  // ── Backup current CM2.0 flow ────────────────────────────────────────────
  const backupDir = path.join(__dirname, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `cm2-flow-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(cm2 || {}, null, 2));
  log('Backed up current CM2.0 flow →', backupPath);

  // Deep clone web definition
  const nodes = JSON.parse(JSON.stringify(web.nodes));
  const edges = JSON.parse(JSON.stringify(web.edges || []));
  const byId = (id) => nodes.find((n) => n.id === id);

  // ── Patch 1: start trigger webhook → telegram ────────────────────────────
  const start = nodes.find((n) => n.type === 'start');
  if (start) { start.data = { ...(start.data || {}), trigger: 'telegram', label: 'Telegram — з каналу' }; log('start → telegram trigger'); }

  // ── Patch 2: Setup context — TG input + fixed keys instead of payload ─────
  const setup = byId('node_1780590806221');
  if (setup && typeof setup.data.code === 'string') {
    let code = setup.data.code;
    // input already falls back to context.message/text; runtime sets `input` from the TG message.
    code = code.replace(
      'importUrl: context.importUrl || null,',
      `importUrl: context.importUrl || '${CONTENT2}/api/posts/bulk-import?token=${IMPORT_TOKEN}',`
    );
    code = code.replace(
      'projectId: context.projectId || 2,',
      `projectId: context.projectId || '${PROJECT_CUID}',`
    );
    // No web callback on TG — message nodes handle delivery.
    code = code.replace('webCallbackUrl: context.callbackUrl || null,', 'webCallbackUrl: null,');
    setup.data.code = code;
    log('Setup context patched (importUrl, projectId, webCallbackUrl=null)');
  }

  // ── Patch 3: convert web callback httpRequest nodes → message nodes ───────
  for (const [id, text] of Object.entries(CALLBACK_TO_TEXT)) {
    const n = byId(id);
    if (!n) { log('  ! callback node missing:', id); continue; }
    n.type = 'message';
    n.data = { label: (n.data && n.data.label) || 'Send to Telegram', text };
    log('  callback → message:', id);
  }

  // ── Patch 4: early-confirm JS node — keep placeholder fire, add confirm msg ─
  // The confirm text is in context.confirmText; on TG we surface it via a message
  // node inserted right after the early-reply JS node.
  const early = byId('node_1781008575166');
  if (early) {
    // strip the web fire-and-forget callback block (webCallbackUrl is null anyway)
    log('early-reply node kept (placeholder fire still active; confirm via context.confirmText)');
  }

  const def = { nodes, edges, viewport: web.viewport || { x: 0, y: 0, zoom: 1 } };

  log(`Prepared CM2.0 flow: ${nodes.length} nodes, ${edges.length} edges.`);
  if (!APPLY) {
    log('DRY-RUN. Re-run with --apply to write. Nothing changed.');
    fs.writeFileSync(path.join(backupDir, `cm2-flow-PREVIEW-${Date.now()}.json`), JSON.stringify(def, null, 2));
    return;
  }

  await db.flowDefinition.update({
    where: { botId: CM2_BOT },
    data: { nodes: def.nodes, edges: def.edges },
  });
  log('APPLIED. CM2.0 flow replaced. Test the Telegram bot end-to-end.');
  log('Rollback: restore', backupPath, 'into flowDefinition.nodes/edges for', CM2_BOT);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
