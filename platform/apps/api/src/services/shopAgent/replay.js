'use strict';
/**
 * shopAgent/replay.js — прогін реальної розмови через нового агента БЕЗ відправки клієнту.
 * Створює тестову сесію (isTest=true, ctx.testMode=true → CRM/постачальник/інвойс/алерти не
 * бʼються), подає повідомлення клієнта з реальної сесії по черзі і друкує поруч: що відповів
 * тоді старий бот/менеджер і що відповів би агент.
 *
 *   NODE_PATH=... node -e "require('./apps/api/src/services/shopAgent/replay').replaySession('<sessionId>').then(r=>console.log(r.text))"
 */
const { db } = require('./lib');
const { handleTurn } = require('./index');

async function findOrCreateReplayUser() {
    const tg = BigInt(-9000000000000) - BigInt(Math.floor(Math.random() * 1e9));
    return db.user.create({ data: { telegramId: tg, username: 'replay_' + Date.now().toString(36), firstName: 'Replay', metadata: { replay: true } } });
}

async function replaySession(realSessionId, { maxTurns = 30, keep = false, log = () => {} } = {}) {
    const real = await db.session.findUnique({ where: { id: realSessionId } });
    if (!real) throw new Error('real session not found');
    const rc = real.context || {};
    const msgs = await db.message.findMany({ where: { sessionId: realSessionId }, orderBy: { createdAt: 'asc' }, select: { role: true, content: true, metadata: true, createdAt: true } });
    const user = await findOrCreateReplayUser();
    const seed = { testMode: true, replayOf: realSessionId, psid: rc.psid, igUsername: rc.igUsername, senderName: rc.senderName, entryAdId: rc.entryAdId, entryAd: rc.entryAd, lastReferral: rc.lastReferral, adTitle: rc.adTitle, postId: rc.postId, commentProductArticle: rc.commentProductArticle, commentProductAt: rc.commentProductAt };
    for (const k of Object.keys(seed)) if (seed[k] === undefined) delete seed[k];
    const test = await db.session.create({ data: { userId: user.id, botId: real.botId, state: 'inbox', isTest: true, context: seed } });
    const lines = [];
    lines.push('REPLAY of ' + realSessionId.slice(0, 8) + ' (' + (rc.igUsername || rc.senderName || '') + ') → test session ' + test.id.slice(0, 8));
    let turns = 0; let i = 0; const turnsOut = [];
    while (i < msgs.length && turns < maxTurns) {
        const m = msgs[i];
        if (m.role !== 'user') { i++; continue; }
        // склеюємо клієнтські повідомлення, що йдуть підряд (як дебаунс/REST-звірка)
        const batch = [m]; let j = i + 1;
        while (j < msgs.length && msgs[j].role === 'user' && (msgs[j].createdAt - msgs[j - 1].createdAt) < 120 * 1000) { batch.push(msgs[j]); j++; }
        const text = batch.map((b) => String(b.content || '')).filter((t) => t && !/^\[порожнє|^\[вкладення без файлу/.test(t)).join('\n').trim();
        const att = batch.map((b) => (b.metadata || {}).attachment).find((a) => a && a.type === 'photo' && /^https?:/.test(a.url || ''));
        const sharedPost = batch.map((b) => (b.metadata || {}).sharedPost).find(Boolean) || null;
        const entryAdId = batch.map((b) => (b.metadata || {}).adId).find(Boolean) || null;
        const ts = m.createdAt.toISOString().slice(5, 16);
        lines.push('\n[' + ts + '] КЛІЄНТ: ' + (text || '[фото]').replace(/\n/g, ' ⏎ ').slice(0, 300) + (att ? ' [📷]' : '') + (sharedPost ? ' [пост: ' + String(sharedPost.caption || '').slice(0, 60) + ']' : ''));
        // що було насправді далі (до наступного повідомлення клієнта)
        const thenReal = []; for (let k = j; k < msgs.length && msgs[k].role !== 'user'; k++) { const md = msgs[k].metadata || {}; if (md.hidden) continue; thenReal.push((md.source === 'zernio_inbox' ? 'МЕНЕДЖЕР' : 'СТАРИЙ БОТ') + ': ' + String(msgs[k].content || '').replace(/\n/g, ' ⏎ ').slice(0, 220)); }
        const t0 = Date.now();
        let r;
        try { r = await handleTurn({ botId: real.botId, sessionId: test.id, text: text || '', imageUrl: att ? att.url : null, sharedPost, entryAdId }); }
        catch (e) { lines.push('   АГЕНТ: ERROR ' + e.message); i = j; turns++; continue; }
        const u = r.understanding || {};
        lines.push('   ↳ розуміння: ' + u.intent + (u.summary ? ' — ' + u.summary : '') + ' (' + (Date.now() - t0) + ' мс)');
        for (const o of r.replies) lines.push('   АГЕНТ: ' + (o.photoUrls ? '[фото ×' + o.photoUrls.length + '] ' : '') + String(o.text || o.caption || '').replace(/\n/g, ' ⏎ ').slice(0, 320) + '  ⟨' + o.step + '⟩');
        for (const t of thenReal.slice(0, 4)) lines.push('   ' + t);
        if (r.ctx && r.ctx.funnelPaused) { lines.push('   ⏸ пауза: ' + r.ctx.pausedBy); }
        turnsOut.push({ text, replies: r.replies, u, trace: r.trace });
        i = j; turns++;
        if (r.ctx && r.ctx.funnelPaused) break;
    }
    const finalCtx = (await db.session.findUnique({ where: { id: test.id }, select: { context: true } })).context || {};
    lines.push('\nСТАН: product=' + (finalCtx.product && finalCtx.product.sku) + ' size=' + finalCtx.recommendedSize + ' color=' + (finalCtx.colorChoice && finalCtx.colorChoice.color) + ' intent=' + (finalCtx.orderIntent && finalCtx.orderIntent.ready) + ' pay=' + (finalCtx.paymentInfo && finalCtx.paymentInfo.method) + '/' + finalCtx.payAmount + ' addr=' + JSON.stringify(finalCtx.orderData || null) + ' crmOrder=' + finalCtx.crmOrderId + ' paused=' + finalCtx.funnelPaused);
    if (!keep) { await db.message.deleteMany({ where: { sessionId: test.id } }); await db.session.delete({ where: { id: test.id } }); await db.user.delete({ where: { id: user.id } }).catch(() => {}); }
    return { text: lines.join('\n'), turns: turnsOut, testSessionId: test.id, finalCtx };
}

module.exports = { replaySession };
