'use strict';
/**
 * funnelInvariants.js — детерміновані перевірки, що діють на КОЖНОМУ FunnelTest магазинного агента
 * (без LLM-судді): це «кістяк» від збоїв, які реально траплялись у живих діалогах.
 * Джерело: аналіз 9 511 реальних сесій goverla_shop (2026-09-24), інваріанти I1, I2, I9, I10.
 *
 * transcript: [{role:'user'|'assistant', content}], де фото бота вже подані як «[бот надіслав фото …]».
 * Повертає масив { id, message } — порожній, якщо все гаразд.
 */
const LEAK_RE = /\[object Object\]|\bundefined\b|\bnull\b|\{\{|\}\}|ctx\.|Клієнт щойно|клієнт щойно переслав|системн(а|ий) підказк|nextStep|JSON\b/;

function checkInvariants(transcript, ctx = {}) {
    const v = [];
    const t = Array.isArray(transcript) ? transcript : [];
    const paused = !!(ctx && ctx.funnelPaused);

    // I1. Бот не мовчить: після кожного повідомлення клієнта — хоч одна відповідь бота до наступного клієнтського.
    for (let i = 0; i < t.length; i++) {
        if (t[i].role !== 'user') continue;
        if (t[i + 1] && t[i + 1].role === 'user') continue; // серія повідомлень підряд: відповідь потрібна на останнє з них
        let answered = false;
        for (let j = i + 1; j < t.length && t[j].role !== 'user'; j++) { if (t[j].role === 'assistant') { answered = true; break; } }
        const isLast = !t.slice(i + 1).some((m) => m.role === 'user');
        if (!answered && !(paused && isLast)) v.push({ id: 'I1', message: 'Бот не відповів на повідомлення клієнта: «' + String(t[i].content || '').slice(0, 80) + '»' });
    }

    // I23. Одне й те саме фото не надсилається двічі за один хід клієнта (картка + прев'ю зі списку тощо).
    {
        const key = (u) => { try { const x = new URL(String(u)); return x.searchParams.get('asset_id') || x.pathname.split('/').pop(); } catch (e) { return String(u).split('?')[0].split('/').pop(); } };
        let seen = new Set(); let reported = false;
        for (const m of t) {
            if (m.role === 'user') { seen = new Set(); reported = false; continue; }
            if (m.role !== 'assistant' || !Array.isArray(m.photoUrls)) continue;
            for (const u of m.photoUrls) { const k = key(u); if (!k) continue; if (seen.has(k) && !reported) { v.push({ id: 'I23', message: 'Те саме фото надіслано двічі за один хід клієнта (' + k.slice(0, 40) + ')' }); reported = true; } seen.add(k); }
        }
    }

    // I2. Немає двох однакових текстових повідомлень бота поспіль.
    let prev = null;
    for (const m of t) {
        if (m.role !== 'assistant') { if (m.role === 'user') prev = null; continue; }
        const txt = String(m.content || '').trim();
        if (txt.length > 15 && !txt.startsWith('[бот надіслав фото') && prev && prev === txt) v.push({ id: 'I2', message: 'Двічі поспіль те саме повідомлення бота: «' + txt.slice(0, 80) + '»' });
        prev = txt || prev;
    }
    // I2b. Те саме повідомлення в двох СУСІДНІХ ходах клієнта (бот зациклився), окрім сум/підсумку.
    const botByTurn = []; let cur = null;
    for (const m of t) { if (m.role === 'user') { cur = []; botByTurn.push(cur); } else if (m.role === 'assistant' && cur) cur.push(String(m.content || '').trim()); }
    for (let i = 1; i < botByTurn.length; i++) {
        const a = botByTurn[i - 1].join('\n'), b = botByTurn[i].join('\n');
        if (b.length > 25 && a === b) v.push({ id: 'I2', message: 'Бот дослівно повторив ту саму відповідь на два різні повідомлення клієнта: «' + b.slice(0, 80) + '»' });
    }

    for (const m of t) {
        if (m.role !== 'assistant') continue;
        const txt = String(m.content || '');
        // I9. Арифметика: від'ємна решта.
        if (/решта\s*[-−–]\s*\d/i.test(txt)) v.push({ id: 'I9', message: 'Від\'ємна сума в повідомленні: «' + txt.slice(0, 100) + '»' });
        // I10. Витік службового тексту.
        const lk = txt.match(LEAK_RE);
        if (lk) v.push({ id: 'I10', message: 'Витік службового тексту («' + lk[0] + '») у відповіді бота: «' + txt.slice(0, 100) + '»' });
    }
    return v;
}

module.exports = { checkInvariants };
