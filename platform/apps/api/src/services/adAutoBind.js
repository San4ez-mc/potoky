// Автоприв'язка оголошень/дописів CRM (/ads) до товару, щоб адміну лишалась лише перевірка.
// 1) артикул у тексті оголошення → товар; 2) Gemini порівнює обкладинку з еталонними фото кандидатів
// (для допису-образу з кількома категоріями — спершу головна річ, потім комплект за складом з тексту).
// Прив'язує лише впевнені збіги і позначає їх productLinkSource='auto_*' — у CRM видно «перевірте».
const { db } = require('@platform/db');
const { geminiKeys, geminiFetch } = require('./geminiKey');
const logger = require('@platform/logger');

const CATS = [
    ['кофта', /кофт|светр|кардиган/i], ['джинси', /джинс/i], ['футболка', /футболк/i], ['лофери', /лофер|туфл/i],
    ['костюм', /костюм/i], ['бомбер', /бомбер/i], ['куртка', /куртк|вітровк|кожанк|плащ/i], ['штани', /штан|брюк/i],
    ['шорти', /шорт/i], ['сорочка', /сорочк/i], ['худі', /худі|світшот/i], ['кросівки', /кросівк|кеди/i],
];
const catsOf = (s) => CATS.filter(([, re]) => re.test(String(s || ''))).map(([c]) => c);

async function keysOf(botId) {
    const rows = await db.funnelKey.findMany({ where: { botId }, select: { key: true, value: true } });
    const o = Object.fromEntries(rows.map((r) => [r.key, String(r.value || '').trim()]));
    o.__geminiKeys = await geminiKeys(botId, o); // ключ воронки → ключ конектора (резерв при 402)
    return o;
}

function extractArticles(txt) {
    const s = String(txt || ''); const out = new Set(); let m;
    const re1 = /(?:артикул|арт\.?|art|sku)\s*[:#№.\-]?\s*([A-Za-z]{0,5}\d{3,8})/gi; while ((m = re1.exec(s))) out.add(m[1].toUpperCase());
    const re2 = /\b(set\d{3,6}|[A-Za-z]{1,3}\d{3,6})\b/gi; while ((m = re2.exec(s))) out.add(m[1].toUpperCase());
    return [...out];
}
const MATERIALS = [['льон', /лля|льон|льня/i], ['замша', /замш/i], ['вельвет', /вельвет/i], ['фліс', /фліс|полар|плюш/i], ['плащівка', /плащів/i], ['ангора', /ангор/i], ['тринитка', /тринит|трьохнит|трехнит/i], ['двонитка', /двонит|двухнит/i], ['рубчик', /рубчик/i], ['шкіра', /шкір/i]];
const PARTS = [['сорочка', /сорочк/i], ['футболка', /футболк/i], ['шорти', /шорт/i], ['штани', /штан|брюк/i], ['піджак', /піджак|жакет/i], ['бомбер', /бомбер/i], ['кофта', /кофт|худі/i], ['поло', /\bполо\b/i]];
const tagsOf = (list, s) => list.filter(([, re]) => re.test(String(s || ''))).map(([t]) => t);
/** Суперечність підпису одиночного допису з обраним товаром: інший матеріал або інший склад костюма. '' — суперечності нема. */
function captionClash(caption, p) {
    const lines = String(caption || '').split('\n').filter((l) => !/окремо/i.test(l)); // «футболка продається окремо» — допродаж, не склад
    const cap = lines.slice(0, 12).join('\n');
    const ptxt = [p.customerName, p.name, p.presentationText, p.aiNotes].filter(Boolean).join('\n');
    const cm = tagsOf(MATERIALS, cap); const pm = tagsOf(MATERIALS, ptxt);
    if (cm.length && pm.length && cm.some((m) => !pm.includes(m))) return 'матеріал у підписі (' + cm.join(', ') + ') ≠ товару (' + pm.join(', ') + ')';
    // Склад лише з дужок/«складається з…» — описує саме цю річ.
    const compTxt = [...cap.matchAll(/\(([^)]{3,60})\)/g)].map((m) => m[1]).concat(lines.filter((l) => /склада/i.test(l))).join(' ');
    const cp = tagsOf(PARTS, compTxt); const pp = tagsOf(PARTS, ptxt);
    if (cp.length >= 2 && pp.length && cp.some((x) => !pp.includes(x))) return 'склад у підписі (' + cp.join(', ') + ') ≠ товару (' + pp.join(', ') + ')';
    return '';
}
function matchArticle(prods, art) {
    const a = String(art).toUpperCase();
    const hit = prods.filter((p) => String(p.sku || '').toUpperCase() === a || String(p.supplierArticle || '').toUpperCase() === a
        || (p.offers || []).some((o) => String(o.sku || '').toUpperCase() === a || String(o.sku || '').toUpperCase().startsWith(a + '-')));
    return hit.length === 1 ? hit[0] : null;
}

async function fetchImage(url, headers) {
    if (!url) return null;
    const ac = new AbortController(); const to = setTimeout(() => { try { ac.abort(); } catch (e) { /* noop */ } }, 12000);
    try {
        const r = await fetch(url, { signal: ac.signal, headers: headers || {} });
        if (!r.ok) return null;
        const buf = Buffer.from(await r.arrayBuffer());
        if (!buf.length || buf.length > 4 * 1024 * 1024) return null;
        let mime = (r.headers.get('content-type') || '').split(';')[0];
        if (!/^image\//.test(mime)) mime = 'image/jpeg';
        return { mime, data: buf.toString('base64') };
    } catch (e) { return null; } finally { clearTimeout(to); }
}

// Свіжий текст і обкладинка: органічний допис (IG media id) або платне оголошення (Marketing API creative).
async function mediaInfo(k, ad) {
    const id = String(ad.externalId || '');
    const out = { caption: ad.captionText || '', image: '' };
    if (!id) return out;
    try {
        if (k.INSTAGRAM_ACCESS_TOKEN) {
            const r = await fetch(`https://graph.instagram.com/v21.0/${encodeURIComponent(id)}?fields=caption,media_type,media_url,thumbnail_url&access_token=${encodeURIComponent(k.INSTAGRAM_ACCESS_TOKEN)}`);
            const d = await r.json().catch(() => ({}));
            if (r.ok && !d.error) { out.caption = d.caption || out.caption; out.image = d.thumbnail_url || d.media_url || ''; return out; }
        }
        if (k.META_SYSTEM_USER_TOKEN) {
            const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(id)}?fields=creative{body,thumbnail_url,image_url,object_story_spec}&access_token=${encodeURIComponent(k.META_SYSTEM_USER_TOKEN)}`);
            const d = await r.json().catch(() => ({}));
            const c = (d && d.creative) || {};
            if (r.ok && !d.error) {
                const oss = c.object_story_spec || {};
                out.caption = out.caption || c.body || (oss.video_data && oss.video_data.message) || (oss.link_data && oss.link_data.message) || '';
                out.image = c.image_url || c.thumbnail_url || '';
            }
        }
    } catch (e) { /* best-effort */ }
    if (!out.image) out.image = ad.thumbnailUrl || '';
    return out;
}

function refPhoto(p, resolve) {
    const offerImg = (p.offers || []).map((o) => (o.images || [])[0]).filter(Boolean)[0];
    return resolve(offerImg || (p.images || [])[0] || p.thumbnailUrl || '');
}

async function geminiPick(k, adImg, caption, cands, resolve, question) {
    const parts = [{ text: question + '\n\nТекст допису:\n' + String(caption || '').slice(0, 800) + '\n\nОбкладинка допису:' }, { inline_data: { mime_type: adImg.mime, data: adImg.data } }];
    const used = [];
    for (const p of cands.slice(0, 10)) {
        const img = await fetchImage(refPhoto(p, resolve));
        if (!img) continue;
        parts.push({ text: 'Кандидат ' + used.length + ': ' + (p.customerName || p.name) + ' (' + p.sku + ')' });
        parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
        used.push(p);
    }
    if (!used.length) return null;
    parts.push({ text: 'Порівнюй крій, фасон, довжину блискавки, фактуру в\'язки, комір, деталі — не лише колір. Якщо на 100% не впевнений — index null. Поверни ЛИШЕ JSON {"index":число_або_null,"confident":true_або_false,"reason":"коротко"}' });
    const r = await geminiFetch(k.__geminiKeys, { contents: [{ parts }], generationConfig: { temperature: 0 } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) { const err = new Error('Gemini ' + r.status + ': ' + String((j.error && (j.error.status || j.error.message)) || '').slice(0, 80)); err.infra = true; throw err; }
    const t = String(((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join(' '));
    const m = t.match(/\{[\s\S]*\}/); if (!m) return null;
    let v; try { v = JSON.parse(m[0]); } catch (e) { return null; }
    if (v.confident !== true || v.index == null || !used[v.index]) return { product: null, reason: v.reason || '' };
    return { product: used[v.index], reason: v.reason || '' };
}

async function decide(k, prods, ad, resolve) {
    const info = await mediaInfo(k, ad);
    const text = [info.caption, ad.name].filter(Boolean).join('\n');
    const capArts = extractArticles(info.caption || ad.captionText || '');
    for (const a of capArts) {
        const p = matchArticle(prods, a);
        if (p) return { product: p, source: 'auto_article', note: 'артикул ' + a + ' у тексті допису' };
    }
    // Артикул у підписі є, але такого товару в CRM нема — за фото «найсхожіший» НЕ шукаємо (2026-09-29: A0084 плащівка → A0189 фліс).
    const explicitArts = [...String(info.caption || ad.captionText || '').matchAll(/(?:артикул|арт\.)\s*[:#№.\-]?\s*([A-Za-z]{0,5}\d{3,8})/gi)].map((x) => x[1].toUpperCase());
    if (explicitArts.length) return { product: null, note: 'артикулу ' + [...new Set(explicitArts)].join(', ') + ' немає в CRM — додайте товар або привʼяжіть вручну' };
    if (!(k.__geminiKeys || []).length) return { product: null, note: 'немає GEMINI_API_KEY' };
    const adImg = await fetchImage(info.image);
    if (!adImg) return { product: null, note: 'не вдалось дістати обкладинку' };
    // «Футболка продається окремо» — не склад образу, а допродаж: такі рядки не рахуємо.
    // Заголовок (перший рядок з категорією) вирішує: одна річ чи образ. «Костюм складається із кофти та штанів» — опис однієї речі, не склад образу.
    const capLines = String(info.caption || ad.name || '').split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !/окремо|складаєт|складаєть/i.test(l));
    const titleLine = capLines.find((l) => catsOf(l).length) || '';
    const titleCats = catsOf(titleLine);
    // «Лляний костюм (сорочка та шорти)» — костюм це одна річ, навіть якщо в дужках перелічено його частини.
    const cats = titleCats.includes('костюм') ? ['костюм'] : (titleCats.length === 1 ? titleCats : catsOf(capLines.join('\n')));
    const compOf = (c) => prods.find((x) => x.id === (c.productId || c.id)) || prods.find((x) => c.sku && String(x.sku) === String(c.sku)) || null;
    const sets = prods.filter((p) => Array.isArray(p.setComponents) && p.setComponents.length);
    const singles = prods.filter((p) => !(Array.isArray(p.setComponents) && p.setComponents.length));
    if (cats.length >= 2 && sets.length) {
        // Допис-образ: визначаємо головну річ серед компонентів комплектів, далі — комплект, склад якого збігається з категоріями тексту.
        const compIds = new Set(sets.flatMap((s) => s.setComponents.map((c) => (compOf(c) || {}).id).filter(Boolean)));
        const mainCands = singles.filter((p) => compIds.has(p.id) && catsOf((p.customerName || '') + ' ' + p.name).includes(cats[0]));
        if (!mainCands.length) return { product: null, note: 'немає компонентів категорії «' + cats[0] + '»' };
        const main = mainCands.length === 1 ? { product: mainCands[0], reason: 'єдиний кандидат' } : await geminiPick(k, adImg, info.caption, mainCands, resolve, 'На обкладинці — образ з кількох речей. Визнач, яка з кандидатів — ' + cats[0] + ' на фото.');
        if (!main || !main.product) return { product: null, note: 'фото: головну річ не визначено впевнено' + (main && main.reason ? ' (' + main.reason + ')' : '') };
        const fit = sets.filter((s) => s.setComponents.some((c) => (compOf(c) || {}).id === main.product.id)).filter((s) => {
            const sc = new Set(s.setComponents.flatMap((c) => { const cp = compOf(c); return catsOf(cp ? ((cp.customerName || '') + ' ' + cp.name) : (c.name || '')); }));
            return cats.every((c) => sc.has(c)) && [...sc].every((c) => cats.includes(c));
        });
        if (fit.length === 1) return { product: fit[0], source: 'auto_vision', note: 'фото: ' + cats[0] + ' = ' + main.product.sku + ', склад з тексту (' + cats.join(', ') + ') → ' + fit[0].sku };
        return { product: null, note: 'фото: ' + main.product.sku + ', але комплектів за складом ' + fit.length };
    }
    let cands = cats.length ? singles.filter((p) => catsOf((p.customerName || '') + ' ' + p.name).some((c) => cats.includes(c))) : [];
    if (!cands.length) return { product: null, note: 'категорію з тексту не визначено' };
    const pick = await geminiPick(k, adImg, info.caption, cands, resolve, 'Який із кандидатів — ТОЧНО той самий товар, що на обкладинці допису?');
    if (pick && pick.product) {
        // Модель інколи обирає «єдиного схожого» (2026-09-29, резерв Claude: лляний костюм → замшевий/вельветовий) — підпис перевіряє вибір.
        const clash = captionClash(info.caption || ad.captionText || '', pick.product);
        if (clash) return { product: null, note: 'фото вказало ' + pick.product.sku + ', але ' + clash };
        return { product: pick.product, source: 'auto_vision', note: 'фото: ' + (pick.reason || 'збіг') };
    }
    return { product: null, note: 'фото: не впевнено' + (pick && pick.reason ? ' (' + pick.reason + ')' : '') };
}

async function autoBindAds(botId, { dryRun = false, limit = 60, onlyExternalIds = null, includeBound = false } = {}) {
    const k = await keysOf(botId);
    if (!k.CRM_API_BASE || !k.CRM_API_KEY) return { ok: false, error: 'немає CRM_API_BASE/CRM_API_KEY' };
    const base = k.CRM_API_BASE.replace(/\/$/, '');
    const pub = String(k.CRM_PUBLIC_BASE || base.replace(/\/api$/, '')).replace(/\/$/, '');
    const resolve = (u) => { u = String(u || ''); if (!u) return ''; return /^https?:/.test(u) ? u : pub + (u.startsWith('/') ? u : '/' + u); };
    const H = { Authorization: 'Bearer ' + k.CRM_API_KEY, Accept: 'application/json', 'Content-Type': 'application/json' };
    const prods = [];
    for (let p = 1; p <= 10; p++) { const d = await (await fetch(base + '/products?limit=100&page=' + p, { headers: H })).json().catch(() => ({})); prods.push(...(d.data || [])); if ((d.data || []).length < 100) break; }
    // Органічні дописи Instagram за 60 днів, яких ще нема в /ads, — реєструємо, щоб товар був відомий ще до першого коментаря.
    let registered = 0;
    if (!onlyExternalIds && k.INSTAGRAM_ACCESS_TOKEN && !dryRun) {
        try {
            const md = await (await fetch('https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,thumbnail_url,media_url,timestamp&limit=50&access_token=' + encodeURIComponent(k.INSTAGRAM_ACCESS_TOKEN))).json();
            const since = Date.now() - 60 * 24 * 3600 * 1000;
            for (const m of (md.data || [])) {
                if (!m.id || Date.parse(m.timestamp || 0) < since) continue;
                const ex = await (await fetch(base + '/ads?externalId=' + encodeURIComponent(m.id) + '&take=1', { headers: H })).json().catch(() => ({}));
                if ((ex.data || []).length) continue;
                const cap = String(m.caption || '');
                const pr = await fetch(base + '/ads', { method: 'POST', headers: H, body: JSON.stringify({ externalId: m.id, name: ('Допис в Instagram: ' + cap.split('\n')[0]).slice(0, 200), captionText: cap || undefined, mediaType: m.media_type || undefined, thumbnailUrl: m.thumbnail_url || m.media_url || undefined, adCreatedAt: m.timestamp || undefined }) });
                if (pr.ok) registered++;
            }
        } catch (e) { logger.warn('[adAutoBind] IG media sync: ' + e.message, { botId }); }
    }
    let ads = [];
    if (onlyExternalIds && onlyExternalIds.length) {
        for (const e of onlyExternalIds) { const d = await (await fetch(base + '/ads?externalId=' + encodeURIComponent(e) + '&take=1', { headers: H })).json().catch(() => ({})); if ((d.data || [])[0]) ads.push(d.data[0]); }
    } else {
        const d = await (await fetch(base + '/ads?status=all&take=1000', { headers: H })).json().catch(() => ({}));
        ads = (d.data || []);
    }
    // Невдалу спробу (auto_none, дата на початку нотатки) повторюємо не раніше ніж за 7 днів — щоб черга йшла далі, а не крутилась на тих самих.
    const recentFail = (a) => a.productLinkSource === 'auto_none' && (Date.now() - (Date.parse(String(a.productLinkNote || '').split(' ')[0]) || 0)) < 7 * 24 * 3600 * 1000;
    ads = ads.filter((a) => (includeBound || !a.productId) && a.externalId && (onlyExternalIds || !recentFail(a))).slice(0, limit);
    const report = []; let infraError = null;
    for (const ad of ads) {
        let r;
        try { r = await decide(k, prods, ad, resolve); } catch (e) { r = { product: null, note: 'помилка: ' + e.message, infra: !!e.infra }; }
        if (r.infra) { infraError = r.note; report.push({ externalId: ad.externalId, name: ad.name, sku: null, note: r.note }); break; }
        const row = { externalId: ad.externalId, name: ad.name, sku: r.product ? r.product.sku : null, source: r.source || null, note: r.note };
        if (r.product && !dryRun) {
            const pr = await fetch(base + '/ads', { method: 'POST', headers: H, body: JSON.stringify({ externalId: ad.externalId, productId: r.product.id, productLinkSource: r.source, productLinkNote: String(r.note || '').slice(0, 300) }) });
            row.saved = pr.ok;
        } else if (!r.product && !dryRun && !ad.productId && !r.infra) {
            await fetch(base + '/ads', { method: 'POST', headers: H, body: JSON.stringify({ externalId: ad.externalId, productLinkSource: 'auto_none', productLinkNote: (new Date().toISOString() + ' ' + String(r.note || '')).slice(0, 300) }) }).catch(() => {});
        }
        report.push(row);
    }
    const bound = report.filter((x) => x.sku).length;
    logger.info('[adAutoBind] done', { botId, registered, checked: report.length, bound, dryRun, infraError });
    return { ok: !infraError, error: infraError, registered, checked: report.length, bound, report };
}

// Воронки продажів магазину за ключем CRM (той самий підхід, що crm-secrets-sync).
async function salesBotForCrmKey(crmApiKey) {
    const rows = await db.funnelKey.findMany({ where: { key: 'CRM_API_KEY', value: crmApiKey }, select: { botId: true } });
    for (const { botId } of rows) {
        const k = await keysOf(botId);
        if ((k.__geminiKeys || []).length && (k.INSTAGRAM_ACCESS_TOKEN || k.ZERNIO_API_TOKEN)) return botId;
    }
    return rows[0] ? rows[0].botId : null;
}

module.exports = { autoBindAds, salesBotForCrmKey, extractArticles, catsOf, captionClash, geminiPick };
