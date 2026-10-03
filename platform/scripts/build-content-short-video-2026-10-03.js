'use strict';
// Воронка «Content Short Video» (slug content-short-video, проєкт content-social): тонка обгортка над мікросервісом
// apps/short-video (рендер коротких вертикальних відео БЕЗ обличчя зі сценарію: кадри fal FLUX + рух камери +
// напис + музика → mp4 1080x1920). Креативна логіка (сценарій) — у Content Manager (структури/промпти),
// важка робота (ffmpeg) — у сервісі; тут лише приймання webhook від content2, нормалізація, запуск і чесна помилка.
// Контракт як у content-video-broll: POST /webhook/bot/content-short-video з { scenes[], style, music, callbackUrl,
// postItemId, postGroupId }; результат сервіс шле на callbackUrl (content2 generation-event: videoUrl / error).
// Idempotent: повторний запуск оновлює код нод. Run on the server: node scripts/build-content-short-video-2026-10-03.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');

const SLUG = 'content-short-video';
const PROJECT = 'content-social';

const normalizeCode = String.raw`// Нормалізація сценарію: приймає scenes[] як масив або JSON-рядок; чистить, обмежує, дає значення за замовчуванням
var scenes = context.scenes;
if (typeof scenes === 'string') { try { scenes = JSON.parse(scenes); } catch (e) { scenes = null; } }
if (!Array.isArray(scenes) || !scenes.length) throw new Error('scenes[] обовʼязковий (сценарій відео: [{visual, text, sec, motion}])');
scenes = scenes.slice(0, 8).map(function (s) {
  s = s || {};
  return {
    visual: String(s.visual || s.imagePrompt || s.prompt || '').trim().slice(0, 600),
    text: String(s.text || s.onScreen || '').trim().slice(0, 140),
    sec: Math.min(6, Math.max(1.5, Number(s.sec || s.duration) || 3)),
    motion: s.motion || null,
    sameCharacter: s.sameCharacter === false ? false : undefined,
    imageUrl: s.imageUrl || null,
    motionPrompt: s.motionPrompt || null,
  };
}).filter(function (s) { return s.visual || s.imageUrl; });
if (!scenes.length) throw new Error('у жодної сцени немає visual (опис кадру англійською)');
var music = context.music;
if (typeof music === 'string') { try { music = JSON.parse(music); } catch (e) { music = { prompt: music }; } }
return {
  svScenes: scenes,
  svStyle: String(context.style || context.styleBible || '').slice(0, 800),
  svMusic: music && (music.prompt || music.url) ? music : null,
  svTotalSec: scenes.reduce(function (a, s) { return a + s.sec; }, 0),
};`;

const startCode = String.raw`// Запуск рендеру в мікросервісі short-video (асинхронно). Якщо запуск не вдався — одразу повідомляємо content2 про помилку,
// щоб пост не висів 15 хвилин до watchdog.
return (async () => {
  var cb = context.callbackUrl || '';
  async function fail(msg) {
    if (cb) { try { await fetch(cb, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'error', error: msg, postItemId: context.postItemId || null }) }); } catch (e) {} }
    return { svError: msg };
  }
  var falKey = (typeof keys !== 'undefined' && keys && keys.FAL_AI_KEY) || '';
  if (!falKey) return await fail('NO_FAL_KEY: у воронки content-short-video нема FAL_CONNECTOR_ID');
  var payload = {
    scenes: context.svScenes, style: context.svStyle, music: context.svMusic, falApiKey: falKey,
    imageModel: context.imageModel || undefined, consistency: context.consistency || undefined,
    callbackUrl: cb || null, postItemId: context.postItemId || null, postGroupId: context.postGroupId || null,
  };
  try {
    var r = await fetch('http://127.0.0.1:3016/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.jobId) return await fail('short-video render HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
    return { svJobId: j.jobId, svStatus: 'queued' };
  } catch (e) { return await fail('short-video недоступний: ' + e.message); }
})();`;

async function main() {
    let bot = await db.bot.findFirst({ where: { slug: SLUG } });
    if (!bot) {
        const created = await callTool('new_bot', {
            projectSlug: PROJECT, name: 'Short Video (відео без обличчя зі сценарію)', slug: SLUG,
            description: 'Збирає коротке вертикальне відео (9:16, до 30 с) без людини в кадрі зі сценарію: AI-кадри в єдиному стилі з одним персонажем, рух камери, великі написи, музика. Для TikTok / YouTube Shorts / Reels. Креативний сценарій пише Content Manager, рендерить мікросервіс apps/short-video.',
            goal: 'Повернути на callbackUrl готовий mp4 (videoUrl) за сценарієм scenes[] або помилку.',
            trigger: 'webhook', isActive: true,
        });
        bot = await db.bot.findFirst({ where: { slug: SLUG } });
        console.log('bot created', bot.id, JSON.stringify(created).slice(0, 80));
    } else console.log('bot exists', bot.id);

    // ключ fal — з того ж конектора, що й content-video-broll
    const broll = await db.bot.findFirst({ where: { slug: 'content-video-broll' } });
    const fk = await db.funnelKey.findUnique({ where: { botId_key: { botId: broll.id, key: 'FAL_CONNECTOR_ID' } }, select: { value: true } });
    await callTool('update_funnel_key', { botId: bot.id, key: 'FAL_CONNECTOR_ID', value: fk.value, label: 'fal.ai (кадри, музика, AI-анімація)' });

    const f = await callTool('get_funnel', { botId: bot.id });
    const find = (label) => f.nodes.find((n) => n.data && n.data.label === label);
    let start = f.nodes.find((n) => n.type === 'start');
    const L1 = 'Нормалізація сценарію';
    const L2 = 'Запуск рендеру (short-video)';
    let n1 = find(L1), n2 = find(L2);

    if (start) {
        await callTool('update_node', { botId: bot.id, nodeId: start.id, data: {
            label: 'Webhook Trigger', trigger: 'webhook', description: 'POST від content2 (fireGeneration) для медіа-типу video',
            bodySchema: '{\n  "scenes": "[{visual (EN опис кадру), text (UA напис на екрані), sec (1.5-6), motion (zoom_in|zoom_out|pan_left|pan_right|ai)}]",\n  "style": "string — єдиний стиль усіх кадрів і опис персонажа (EN)",\n  "music": "{prompt: настрій музики EN} | {url}",\n  "callbackUrl": "string — content2 generation-event",\n  "postItemId": "string", "postGroupId": "string"\n}',
        } });
    }
    if (!n1) { const r = await callTool('add_node', { botId: bot.id, type: 'js', position: { x: 160, y: 320 }, data: { label: L1, code: normalizeCode, qaExpectation: 'Відхиляє виклик без scenes; обрізає сцени до 8, sec до 1.5-6.' } }); n1 = { id: r.added ? r.added.id || r.added : r.id }; console.log('added', L1, JSON.stringify(r).slice(0, 80)); }
    else await callTool('update_node', { botId: bot.id, nodeId: n1.id, data: { code: normalizeCode } });
    if (!n2) { const r = await callTool('add_node', { botId: bot.id, type: 'js', position: { x: 160, y: 480 }, data: { label: L2, code: startCode, qaExpectation: 'Запускає рендер у сервісі short-video; при збої одразу шле на callbackUrl status:error.' } }); n2 = { id: r.added ? r.added.id || r.added : r.id }; console.log('added', L2, JSON.stringify(r).slice(0, 80)); }
    else await callTool('update_node', { botId: bot.id, nodeId: n2.id, data: { code: startCode } });

    const f2 = await callTool('get_funnel', { botId: bot.id });
    const id1 = (f2.nodes.find((n) => n.data && n.data.label === L1) || {}).id;
    const id2 = (f2.nodes.find((n) => n.data && n.data.label === L2) || {}).id;
    const startId = f2.nodes.find((n) => n.type === 'start').id;
    const has = (a, b) => f2.edges.some((e) => e.source === a && e.target === b);
    if (!has(startId, id1)) await callTool('create_edge', { botId: bot.id, source: startId, target: id1 });
    if (!has(id1, id2)) await callTool('create_edge', { botId: bot.id, source: id1, target: id2 });
    try { await callTool('auto_layout', { botId: bot.id }); } catch (e) { /* косметика */ }
    console.log('ok: nodes', f2.nodes.length, 'edges', f2.edges.length, 'bot', bot.id);
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
