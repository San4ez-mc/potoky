'use strict';

/**
 * channel-links.js
 *
 * Persistent per-network deep links for a funnel (Threads / Instagram / Telegram …).
 * Stored as rows in `tracked_links` with post_item_id IS NULL (immune to the funnel-key
 * wiping that lost the old FUNNEL_LINK_COUNTS/META-based links).
 *
 * Each channel link has a stable code `k<hex8>` → t.me/<bot>?start=k<hex8>. Per-post
 * tracked links are minted UNDER a channel link with code `<channelcode>_<postNumber>`
 * (see tracked-links.js), so analytics can roll up clicks per network.
 *
 *   POST   /api/channel-links            create
 *   GET    /api/channel-links?botId=     list (with rolled-up clicks)
 *   DELETE /api/channel-links/:id        delete
 *
 * Token auth (server-to-server / admin via ?token=).
 */

const express = require('express');
const crypto = require('crypto');
const { db } = require('@platform/db');
const logger = require('@platform/logger');

const router = express.Router();
// Auth is handled by authMiddleware at mount (session — used by the admin UI).

// Normalize any platform/network key to a base network label.
function baseNetwork(p) {
  const s = String(p || '').toLowerCase();
  if (s.startsWith('instagram') || s === 'ig') return 'instagram';
  if (s.startsWith('threads')) return 'threads';
  if (s.startsWith('telegram') || s === 'tg') return 'telegram';
  if (s.startsWith('tiktok')) return 'tiktok';
  if (s.startsWith('linkedin')) return 'linkedin';
  if (s.startsWith('youtube') || s === 'shorts') return 'youtube';
  if (s.startsWith('facebook') || s === 'fb') return 'facebook';
  if (s === 'x' || s.startsWith('twitter')) return 'x';
  return s || 'other';
}

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const botUsername = String(b.botUsername || '').replace(/^@/, '');
    const funnelSlug = b.funnelSlug || null;
    const platform = baseNetwork(b.platform);
    if (!botUsername || !funnelSlug) {
      return res.status(400).json({ ok: false, error: 'botUsername and funnelSlug required' });
    }
    const code = 'k' + crypto.randomBytes(4).toString('hex'); // k + 8 hex
    const id = crypto.randomUUID();
    await db.$executeRaw`
      INSERT INTO tracked_links (id, code, project_id, funnel_slug, bot_username, bot_id, platform, name, description, base_param)
      VALUES (${id}, ${code}, ${b.projectId || null}, ${funnelSlug}, ${botUsername}, ${b.botId || null},
              ${platform}, ${b.name || null}, ${b.description || null}, ${code})`;
    const url = `https://t.me/${botUsername}?start=${code}`;
    return res.json({ ok: true, id, code, url, platform });
  } catch (e) {
    logger.error('[channel-links] create failed', { err: e.message });
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const botId = String(req.query.botId || '');
    const funnelSlug = String(req.query.funnelSlug || '');
    if (!botId && !funnelSlug) return res.status(400).json({ ok: false, error: 'botId or funnelSlug required' });

    const rows = botId
      ? await db.$queryRaw`SELECT id, code, post_item_id, parent_id, platform, name, description, bot_username, funnel_slug, clicks, created_at
                           FROM tracked_links WHERE bot_id = ${botId} ORDER BY created_at ASC`
      : await db.$queryRaw`SELECT id, code, post_item_id, parent_id, platform, name, description, bot_username, funnel_slug, clicks, created_at
                           FROM tracked_links WHERE funnel_slug = ${funnelSlug} ORDER BY created_at ASC`;

    const chById = {};
    const channels = [];
    for (const r of rows) {
      if (!r.post_item_id) {
        const ch = {
          id: r.id, code: r.code, platform: r.platform, name: r.name, description: r.description,
          botUsername: r.bot_username, funnelSlug: r.funnel_slug,
          url: r.bot_username ? `https://t.me/${r.bot_username}?start=${r.code}` : null,
          directClicks: Number(r.clicks) || 0, postLinks: 0, postClicks: 0, totalClicks: Number(r.clicks) || 0,
          createdAt: r.created_at,
        };
        chById[r.id] = ch;
        channels.push(ch);
      }
    }
    for (const r of rows) {
      if (r.post_item_id && r.parent_id && chById[r.parent_id]) {
        const c = Number(r.clicks) || 0;
        chById[r.parent_id].postLinks += 1;
        chById[r.parent_id].postClicks += c;
        chById[r.parent_id].totalClicks += c;
      }
    }
    return res.json({ ok: true, channels });
  } catch (e) {
    logger.error('[channel-links] list failed', { err: e.message });
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    // Detach children (keep per-post links working via their own funnel_slug), then delete channel
    await db.$executeRaw`UPDATE tracked_links SET parent_id = NULL WHERE parent_id = ${id}`;
    await db.$executeRaw`DELETE FROM tracked_links WHERE id = ${id} AND post_item_id IS NULL`;
    return res.json({ ok: true });
  } catch (e) {
    logger.error('[channel-links] delete failed', { err: e.message });
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
module.exports.baseNetwork = baseNetwork;
