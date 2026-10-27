'use strict';

/**
 * stageEvents.js — етапи воронки всередині Flows (нода flowStage).
 * Один рядок на пару «розмова + етап» у funnel_stage_events (сирий SQL, як tracked_links). Таблиця створюється
 * сама при першому використанні, тож деплой не вимагає ручної міграції.
 * recordStage ніколи не кидає виняток: аналітика не має зупиняти воронку.
 */

const { db } = require('@platform/db');
const logger = require('@platform/logger');

let ensured = null;
function ensureTable() {
    if (!ensured) {
        ensured = (async () => {
            await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS funnel_stage_events (
                session_id text NOT NULL, stage_name text NOT NULL, bot_id text NOT NULL, user_id text,
                stage_order integer NOT NULL DEFAULT 0, is_test boolean NOT NULL DEFAULT false,
                first_at timestamptz NOT NULL DEFAULT now(), last_at timestamptz NOT NULL DEFAULT now(),
                count integer NOT NULL DEFAULT 1, PRIMARY KEY (session_id, stage_name))`);
            await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS funnel_stage_events_bot_idx ON funnel_stage_events (bot_id, stage_name)');
            await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS funnel_stage_events_first_idx ON funnel_stage_events (bot_id, first_at)');
        })().catch((e) => { ensured = null; throw e; });
    }
    return ensured;
}

async function recordStage({ botId, sessionId, userId, stageName, stageOrder, isTest }) {
    try {
        const name = String(stageName || '').trim().slice(0, 200);
        if (!name || !sessionId || !botId) return false;
        await ensureTable();
        await db.$executeRaw`
            INSERT INTO funnel_stage_events (session_id, stage_name, bot_id, user_id, stage_order, is_test)
            VALUES (${String(sessionId)}, ${name}, ${String(botId)}, ${userId ? String(userId) : null}, ${Number(stageOrder) || 0}, ${!!isTest})
            ON CONFLICT (session_id, stage_name) DO UPDATE
            SET last_at = now(), count = funnel_stage_events.count + 1, stage_order = EXCLUDED.stage_order`;
        return true;
    } catch (e) {
        logger.warn('[flowStage] запис етапу не вдався: ' + e.message);
        return false;
    }
}

function periodFrom(period) {
    if (period === 'all') return new Date(0);
    const ms = period === '24h' ? 86400000 : period === '7d' ? 7 * 86400000 : 30 * 86400000;
    return new Date(Date.now() - ms);
}

/** Етапи воронки: вузли flowStage з графа (навіть без подій) + лічильники з подій. */
async function getStages(botId, { period = '30d', includeTest = false } = {}) {
    await ensureTable();
    const from = periodFrom(period);
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
    const defined = new Map();
    for (const n of nodes) {
        if (n.type !== 'flowStage') continue;
        const name = String(n.data?.stageName || n.data?.label || '').trim();
        if (!name) continue;
        const order = Number(n.data?.stageOrder) || 0;
        const cur = defined.get(name);
        if (!cur || order < cur.order) defined.set(name, { order, nodeId: n.id, side: !!n.data?.side });
    }
    const rows = await db.$queryRaw`
        WITH ev AS (
            SELECT * FROM funnel_stage_events
            WHERE bot_id = ${botId} AND first_at >= ${from} AND (${!!includeTest} OR is_test = false)
        ), mx AS (SELECT session_id, max(stage_order) AS mo FROM ev GROUP BY session_id)
        SELECT e.stage_name, max(e.stage_order)::int AS ord, count(DISTINCT e.session_id)::int AS sessions,
               count(DISTINCT CASE WHEN m.mo = e.stage_order THEN e.session_id END)::int AS stopped
        FROM ev e JOIN mx m USING (session_id) GROUP BY e.stage_name`;
    const byName = new Map(rows.map((r) => [r.stage_name, r]));
    const names = new Set([...defined.keys(), ...byName.keys()]);
    const list = [...names].map((name) => {
        const r = byName.get(name);
        const d = defined.get(name);
        return { stageName: name, stageOrder: d ? d.order : (r ? r.ord : 0), nodeId: d ? d.nodeId : null, inGraph: !!d, side: d ? d.side : false, sessions: r ? r.sessions : 0, stopped: r ? r.stopped : 0 };
    }).sort((a, b) => a.stageOrder - b.stageOrder || a.stageName.localeCompare(b.stageName));
    // «Бічні виходи» (думає, не актуально…) не входять в основний шлях: конверсію рахуємо лише по основних етапах
    const main = list.filter((s) => !s.side);
    const first = main.length ? main[0].sessions : 0;
    let prev = null;
    for (const s of list) {
        if (s.side) { s.convFromPrev = null; s.convFromFirst = first > 0 ? Math.round((s.sessions / first) * 1000) / 10 : null; continue; }
        s.convFromPrev = prev !== null && prev > 0 ? Math.round((s.sessions / prev) * 1000) / 10 : null;
        s.convFromFirst = first > 0 ? Math.round((s.sessions / first) * 1000) / 10 : null;
        prev = s.sessions;
    }
    return list;
}

/** Люди, які пройшли етап: розмова, контакт, чи пішли далі, найдальший етап. */
async function getStageSessions(botId, stageName, { period = '30d', includeTest = false, onlyStopped = false, limit = 200 } = {}) {
    await ensureTable();
    const from = periodFrom(period);
    const rows = await db.$queryRaw`
        SELECT e.session_id, e.first_at, e.last_at, e.count, e.is_test, s.state, s."lastActive", s."isActive",
               u.id AS user_id, u."firstName", u."lastName", u.username, u."telegramId",
               EXISTS (SELECT 1 FROM funnel_stage_events x WHERE x.session_id = e.session_id AND x.stage_order > e.stage_order) AS went_further,
               (SELECT x.stage_name FROM funnel_stage_events x WHERE x.session_id = e.session_id ORDER BY x.stage_order DESC, x.last_at DESC LIMIT 1) AS furthest
        FROM funnel_stage_events e
        LEFT JOIN sessions s ON s.id = e.session_id
        LEFT JOIN users u ON u.id = COALESCE(e.user_id, s."userId")
        WHERE e.bot_id = ${botId} AND e.stage_name = ${String(stageName)} AND e.first_at >= ${from} AND (${!!includeTest} OR e.is_test = false)
        ORDER BY e.last_at DESC LIMIT ${Math.min(Number(limit) || 200, 500)}`;
    return rows
        .map((r) => ({
            sessionId: r.session_id, userId: r.user_id,
            name: [r.firstName, r.lastName].filter(Boolean).join(' ') || null,
            username: r.username || null, telegramId: r.telegramId != null ? String(r.telegramId) : null,
            firstAt: r.first_at, lastAt: r.last_at, lastActive: r.lastActive, times: r.count, isTest: r.is_test,
            wentFurther: !!r.went_further, furthest: r.furthest, state: r.state, active: r.isActive,
        }))
        .filter((r) => !onlyStopped || !r.wentFurther);
}

/** Канбан: колонки = етапи, картка = людина в колонці свого НАЙДАЛЬШОГО етапу (де зараз стоїть). */
async function getBoard(botId, { period = '30d', includeTest = false, perColumn = 60 } = {}) {
    const columns = await getStages(botId, { period, includeTest });
    const from = periodFrom(period);
    const rows = await db.$queryRaw`
        SELECT DISTINCT ON (e.session_id) e.session_id, e.stage_name, e.first_at, e.last_at, e.is_test,
               s.state, s."lastActive", u.id AS user_id, u."firstName", u."lastName", u.username, u."telegramId"
        FROM funnel_stage_events e
        LEFT JOIN sessions s ON s.id = e.session_id
        LEFT JOIN users u ON u.id = COALESCE(e.user_id, s."userId")
        WHERE e.bot_id = ${botId} AND e.first_at >= ${from} AND (${!!includeTest} OR e.is_test = false)
        ORDER BY e.session_id, e.stage_order DESC, e.last_at DESC`;
    const byStage = new Map();
    for (const r of rows) {
        const card = {
            sessionId: r.session_id, userId: r.user_id,
            name: [r.firstName, r.lastName].filter(Boolean).join(' ') || null,
            username: r.username || null, telegramId: r.telegramId != null ? String(r.telegramId) : null,
            since: r.last_at, lastActive: r.lastActive, isTest: r.is_test, done: r.state === 'completed',
        };
        if (!byStage.has(r.stage_name)) byStage.set(r.stage_name, []);
        byStage.get(r.stage_name).push(card);
    }
    return columns.map((c) => {
        const all = (byStage.get(c.stageName) || []).sort((a, b) => new Date(b.since) - new Date(a.since));
        return { ...c, here: all.length, cards: all.slice(0, perColumn) };
    });
}

module.exports = { recordStage, getStages, getStageSessions, getBoard, ensureTable };
