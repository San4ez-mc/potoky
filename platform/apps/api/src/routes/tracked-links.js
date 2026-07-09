'use strict';

/**
 * tracked-links.js
 *
 * Per-post deep-link tracking for lead magnets.
 *
 *   POST /api/tracked-links        → mint a unique tracked deep link (called by content2
 *                                    when a post referencing a lead magnet is saved)
 *   GET  /api/tracked-links/stats  → click stats per link / lead magnet (for the dashboard)
 *
 * Token auth (server-to-server): X-Import-Token header or ?token= / body.token,
 * matching the content pipeline secret.
 *
 * The click itself is recorded in platformBotHandler.resolveTargetBot when a user
 * opens t.me/<bot>?start=<code>. Tables (tracked_links, link_clicks) are created
 * out-of-band via SQL (see deploy notes) — no Prisma model, raw queries only.
 */

const express = require('express');
const crypto = require('crypto');
const { db } = require('@platform/db');
const logger = require('@platform/logger');

const router = express.Router();
const TOKEN = process.env.CONTENT_IMPORT_TOKEN || 'fnk_wh_2026_x9mK4pLqR7vNsT1eYcJdBuAw';

function auth(req, res, next) {
  const t = req.headers['x-import-token'] || req.query.token || (req.body && req.body.token);
  if (t !== TOKEN) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

// Mint a unique tracked link for one post + lead magnet.
router.post('/', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const botUsername = String(b.botUsername || '').replace(/^@/, '');
    const funnelSlug = b.funnelSlug || b.baseParam || null;
    if (!botUsername || !funnelSlug) {
      return res.status(400).json({ ok: false, error: 'botUsername and funnelSlug required' });
    }
    const code = 'lm' + crypto.randomBytes(6).toString('hex'); // lm + 12 hex → matches /^lm[a-z0-9]+$/
    const id = crypto.randomUUID();
    await db.$executeRaw`
      INSERT INTO tracked_links (id, code, project_id, lead_magnet_id, funnel_slug, bot_username, post_item_id, post_group_id, platform, base_param)
      VALUES (${id}, ${code}, ${b.projectId || null}, ${b.leadMagnetId || null}, ${funnelSlug}, ${botUsername},
              ${b.postItemId || null}, ${b.postGroupId || null}, ${b.platform || null}, ${b.baseParam || funnelSlug})`;
    const url = `https://t.me/${botUsername}?start=${code}`;
    return res.json({ ok: true, code, url });
  } catch (e) {
    logger.error('[tracked-links] mint failed', { err: e.message });
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Click stats. Optional ?projectId=; returns per-link rows + per-magnet aggregate.
router.get('/stats', auth, async (req, res) => {
  try {
    const projectId = String(req.query.projectId || '');
    const rows = projectId
      ? await db.$queryRaw`
          SELECT code, lead_magnet_id, funnel_slug, post_item_id, post_group_id, platform, clicks, first_click_at, last_click_at, created_at
          FROM tracked_links WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 1000`
      : await db.$queryRaw`
          SELECT code, lead_magnet_id, funnel_slug, post_item_id, post_group_id, platform, clicks, first_click_at, last_click_at, created_at
          FROM tracked_links ORDER BY created_at DESC LIMIT 1000`;

    const byMagnet = {};
    let totalClicks = 0;
    for (const r of rows) {
      const c = Number(r.clicks) || 0;
      totalClicks += c;
      const key = r.lead_magnet_id || 'unknown';
      if (!byMagnet[key]) byMagnet[key] = { lead_magnet_id: key, links: 0, clicks: 0 };
      byMagnet[key].links += 1;
      byMagnet[key].clicks += c;
    }
    return res.json({
      ok: true,
      totalLinks: rows.length,
      totalClicks,
      byMagnet: Object.values(byMagnet),
      links: rows.map((r) => ({ ...r, clicks: Number(r.clicks) || 0 })),
    });
  } catch (e) {
    logger.error('[tracked-links] stats failed', { err: e.message });
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
