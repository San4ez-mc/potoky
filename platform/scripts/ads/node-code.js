'use strict';
// Код js-нод воронок рекламних креативів Meta (FB/IG). Джерело істини для нод у БД: build-ads-creatives-*.js відтворює їх звідси.
// Зовнішні HTTP-виклики тут НЕ робляться (правило 7a): content2, Claude, OpenAI — окремі ноди.
// Версія 2 (06.11.2026): креатив будується від БОЛЮ ЦА; картинку малює gpt-image-2 цілою (плашка «для кого», заголовок, акцент, пропозиція).

const withMode = (code, mode) => code.split('context.__adMode').join("'" + mode + "'");


// Спільні функції розбору (один код і для parse, і для merge): JSON, що прощає зайву закриваючу дужку, і нормалізація основного тексту.
const JSON_HELPERS = String.raw`function tryParse(t) {
  for (var k = 0; k < 8; k++) {
    try { return JSON.parse(t); } catch (e) {
      var m = /position (\d+)/.exec(String(e.message || ''));
      if (!m) return null;
      var p = Number(m[1]);
      if ('}]'.indexOf(t.charAt(p)) >= 0) t = t.slice(0, p) + t.slice(p + 1); else return null;
    }
  }
  return null;
}
function pickJson(v) {
  if (v && typeof v === 'object') return v;
  var s = String(v || '');
  var i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  return tryParse(s.slice(i, j + 1));
}
function normPrimary(t) {
  t = String(t || '').replace(/\r/g, '').trim();
  var nl = t.indexOf('\n');
  var first = nl < 0 ? t : t.slice(0, nl);
  var rest = nl < 0 ? '' : t.slice(nl + 1).trim();
  if (Array.from(first).length > 120) {
    var m = /^([\s\S]{20,120}?[.!?…])\s+([\s\S]*)$/.exec(first);
    if (m) { first = m[1]; rest = (m[2] + (rest ? '\n' + rest : '')).trim(); }
  }
  var joined = first + (rest ? '\n\n' + rest : '');
  return joined.split(/\n\s*\n/).map(function (par) {
    var c = 0;
    return par.replace(/\s*—\s*/g, function (x) { c++; return c === 1 ? x : ', '; });
  }).join('\n\n');
}`;

// ── Спільне ────────────────────────────────────────────────────────────────────────────────────────────

const paramsCode = String.raw`// Нормалізація входу webhook. Нічого не вигадуємо: projectId обовʼязковий, решта має розумні значення за замовчуванням.
function arr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { var j = JSON.parse(v); if (Array.isArray(j)) return j; } catch (e) {}
    return v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  return [];
}
var projectId = String(context.projectId || '').trim();
if (!projectId) return { adFatal: 'projectId обовʼязковий (id компанії в content2)' };
var video = context.__adMode === 'video';
var pains = context.pains;
if (typeof pains === 'string') { try { pains = JSON.parse(pains); } catch (e) { pains = []; } }
pains = (Array.isArray(pains) ? pains : []).filter(function (p) { return p && p.id && p.hook; }).slice(0, video ? 5 : 10);
var count = pains.length || Math.min(video ? 5 : 8, Math.max(1, parseInt(context.count, 10) || (video ? 2 : 4)));
var aspects = arr(context.aspects).filter(function (a) { return ['4:5', '9:16', '1:1'].indexOf(a) >= 0; });
if (!aspects.length) aspects = ['4:5', '9:16'];
var d = context.date && /^\d{4}-\d{2}-\d{2}$/.test(String(context.date)) ? String(context.date) : new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
var useMagnet = context.leadMagnet === false || context.leadMagnet === 'false' ? 'no' : (context.leadMagnet === true || context.leadMagnet === 'true' ? 'yes' : (context.leadMagnet ? String(context.leadMagnet) : 'auto'));
return {
  adProjectId: projectId,
  adCount: count,
  adPains: pains,
  adAspects: aspects,
  adRender: !(context.render === false || context.render === 'false'),
  adLanding: String(context.landingUrl || '').trim(),
  adMagnetMode: useMagnet,
  adDate: d,
  adProductId: context.productId ? String(context.productId) : '',
  adProductName: context.productName ? String(context.productName) : '',
  adNote: String(context.note || '').slice(0, 800),
  adAnglesWanted: arr(context.angles),
};`;

// Підготовка: перевірка контексту, вибір магніту/посилання, болів, кутів, бриф для Claude.
const prepareCode = String.raw`var r = context.adCtx;
if (context.adFatal) return {};
if (!r || typeof r !== 'object' || r.ok !== true) return { adFatal: 'content2 не віддав контекст: ' + JSON.stringify(r || {}).slice(0, 220) };
if (!r.offer) return { adFatal: 'У компанії «' + (r.project && r.project.name) + '» нема активного продукту (пропозиції). Додай продукт у content2 → Продукти.' };
var offer = r.offer;
var magnets = (offer.leadMagnets || []).filter(function (m) { return m && m.link; });
var magnet = null;
if (context.adMagnetMode === 'yes' || context.adMagnetMode === 'auto') magnet = magnets[0] || null;
else if (context.adMagnetMode !== 'no') magnet = magnets.filter(function (m) { return m.id === context.adMagnetMode || String(m.name).toLowerCase().indexOf(String(context.adMagnetMode).toLowerCase()) >= 0; })[0] || null;
if (context.adMagnetMode === 'yes' && !magnet) return { adFatal: 'Просили лід-магніт, але в продукту «' + offer.name + '» нема магніту з ботом/посиланням (content2 → Лід-магніти).' };

var pains = (context.adPains || []).filter(function (p) { return p.angle !== 'lead_magnet' || magnet; });
var angles = [];
var count = context.adCount;
var painBlock = '';
if (pains.length) {
  count = pains.length;
  angles = pains.map(function (p) { return p.angle || 'pain'; });
  painBlock = 'БОЛІ, ПО ЯКИХ ПОТРІБНІ КРЕАТИВИ (рівно по одному на біль, у цьому порядку; поле "pain" у відповіді = id болю):\n' + pains.map(function (p, i) {
    return (i + 1) + '. [' + p.id + '] Біль: ' + p.pain + '\n   Підказка заголовка: ' + p.hook + '\n   Доказ: ' + (p.evidence === 'case' ? 'РЕАЛЬНИЙ КЕЙС («' + (p.proof || '') + '»): цифри з нього можна називати дослівно' : 'ГІПОТЕЗА, доказів у базі нема: жодних цифр-результатів; арифметику подавай умовно («якщо…»)') + (p.layout ? '\n   Макет: ' + p.layout : '');
  }).join('\n');
} else {
  var hasProof = (r.cases || []).some(function (c) { return c.allowedClaims && String(c.allowedClaims).trim(); });
  var order = ['pain', 'outcome', 'objection', 'curiosity'];
  if (hasProof) order.push('proof');
  if (magnet) order.splice(1, 0, 'lead_magnet');
  var wanted = (context.adAnglesWanted || []).filter(function (a) { return ['pain', 'outcome', 'objection', 'proof', 'curiosity', 'lead_magnet'].indexOf(a) >= 0; });
  if (wanted.length) order = wanted;
  for (var i = 0; i < count; i++) angles.push(order[i % order.length]);
  painBlock = 'КУТИ ПО ПОРЯДКУ: ' + angles.join(', ') + '. Біль для кожного кута бери з даних про ЦА (поле "pain" у відповіді = короткий id на твій вибір).';
}

var prev = (r.previousAds || []).slice(0, 25).map(function (a) { return '- ' + a.headline + (a.angle ? ' [' + a.angle + ']' : ''); }).join('\n');
var brief = [
  'ЗАВДАННЯ: ' + count + ' рекламних креативів для пропозиції «' + offer.name + '». Звертання до читача: на «ви».',
  painBlock,
  'Усі креативи ведуть до ОДНІЄЇ дії. ' + (magnet ? 'Дія для кута lead_magnet: отримати «' + magnet.name + '». Для інших: записатися / написати на пропозицію «' + offer.name + '».' : 'Дія: записатися / написати на пропозицію «' + offer.name + '».'),
  magnet ? 'ЛІД-МАГНІТ (лише для кута lead_magnet): «' + magnet.name + '». Що це: ' + (magnet.description || '(опису нема, не вигадуй, назви лише як є)') : 'ЛІД-МАГНІТ: не використовується.',
  context.adNote ? 'ДОДАТКОВА ВКАЗІВКА ВЛАСНИКА: ' + context.adNote : '',
  prev ? 'ВЖЕ Є В ПЛАНІ (не повторюй ні заголовки, ні ідеї):\n' + prev : '',
  '--- ДАНІ ПРО ЕКСПЕРТА, ПРОПОЗИЦІЮ І ЦА ---',
  r.text,
].filter(Boolean).join('\n\n');
return {
  adOffer: { id: offer.id, name: offer.name },
  adOfferName: offer.name,
  adMagnet: magnet,
  adPains: pains,
  adCount: count,
  adAngles: angles,
  adRules: r.rules,
  adBrief: brief,
  adNetworkId: r.networkId,
};`;

// Розбір відповіді Claude → масив креативів + посилання/utm (посилання ставить КОД, не модель).
const parseCode = String.raw`/*HELPERS*/
var obj = pickJson(context.creativesRaw);
var list = obj && Array.isArray(obj.creatives) ? obj.creatives : (Array.isArray(obj) ? obj : []);
if (!list.length) return { adFatal: 'Claude не повернув креативів у JSON: ' + String(typeof context.creativesRaw === 'string' ? context.creativesRaw : JSON.stringify(context.creativesRaw || '')).slice(0, 200) };
var CTA = ['Дізнатися більше', "Зв'язатися з нами", 'Записатися', 'Надіслати повідомлення', 'Завантажити', 'Отримати пропозицію'];
function s(v, n) { return String(v == null ? '' : v).replace(/\s+\n/g, '\n').trim().slice(0, n); }
function slug(t) { return encodeURIComponent(String(t || '').toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/g, '-').replace(/^-+|-+$/g, '')); }
function linkFor(angle, idx, painId) {
  // Посилання необовʼязкове (його часто додають у кабінеті Meta): лід-магніт має свій, інші кути — landingUrl, якщо передали.
  var base = angle === 'lead_magnet' && context.adMagnet ? context.adMagnet.link : (context.adLanding || '');
  if (!base) return '';
  if (/^https?:\/\/t\.me\//i.test(base)) return base; // Telegram-посилання без utm: відстеження дає start-параметр
  var sep = base.indexOf('?') >= 0 ? '&' : '?';
  return base + sep + 'utm_source=facebook&utm_medium=paid_social&utm_campaign=' + slug(context.adOfferName) + '&utm_content=' + slug(painId || angle) + '-' + (idx + 1);
}
var video = context.__adMode === 'video';
var pains = context.adPains || [];
var ads = list.slice(0, context.adCount).map(function (c, i) {
  c = c || {};
  var p = pains[i] || null;
  var angle = ['pain', 'outcome', 'objection', 'proof', 'curiosity', 'lead_magnet'].indexOf(c.angle) >= 0 ? c.angle : ((p && p.angle) || context.adAngles[i] || 'pain');
  var ad = {
    pain: p ? p.id : s(c.pain, 20),
    angle: angle,
    primary: normPrimary(s(c.primary, 700)), headline: s(c.headline, 120), description: s(c.description, 80),
    cta: CTA.indexOf(c.cta) >= 0 ? c.cta : (angle === 'lead_magnet' ? 'Завантажити' : 'Дізнатися більше'),
    link: linkFor(angle, i, p ? p.id : angle),
    leadMagnet: angle === 'lead_magnet' && context.adMagnet ? context.adMagnet.name : null,
    aspect: video ? '9:16' : '4:5',
  };
  if (!video) {
    ad.audience = s(c.audience, 80);
    ad.overlayTitle = s(c.overlayTitle, 240);
    ad.accent = s(c.accent, 80);
    ad.points = Array.isArray(c.points) ? c.points.slice(0, 3).map(function (x) { return s(x, 120); }).filter(Boolean) : [];
    ad.overlaySub = s(c.overlaySub, 240);
    ad.visual = s(c.visual, 900);
    ad.layout = ['headline_illustration', 'before_after', 'list'].indexOf(c.layout) >= 0 ? c.layout : (ad.points.length ? 'list' : 'headline_illustration');
  } else {
    ad.style = s(c.style, 900); ad.music = c.music && typeof c.music === 'object' ? c.music : { prompt: s(c.music, 200) }; ad.scenes = Array.isArray(c.scenes) ? c.scenes.slice(0, 6) : [];
  }
  return ad;
});
return { ads: ads };`;

// Бриф на виправлення лише для креативів із порушеннями.
const repairBriefCode = String.raw`var res = (context.gate1 && context.gate1.results) || [];
var bad = [];
res.forEach(function (r) { if (r.violations && r.violations.length) bad.push({ index: r.index, violations: r.violations, ad: context.ads[r.index] }); });
var brief = 'Ось креативи з порушеннями. Перепиши кожен так, щоб усі порушення зникли, збережи "index", біль (pain), кут і ідею. Посилання (link) не змінюй і не пиши.\n\n' + JSON.stringify(bad);
return { adBad: bad.map(function (b) { return b.index; }), adRepairBrief: brief };`;

// Підстановка виправлених креативів (за index); посилання лишаємо наші.
const mergeCode = String.raw`/*HELPERS*/
var obj = pickJson(context.fixedRaw);
var list = obj && Array.isArray(obj.creatives) ? obj.creatives : [];
var ads = context.ads.slice();
var CTA = ['Дізнатися більше', "Зв'язатися з нами", 'Записатися', 'Надіслати повідомлення', 'Завантажити', 'Отримати пропозицію'];
var KEEP = ['link', 'leadMagnet', 'aspect', 'angle', 'pain'];
list.forEach(function (f) {
  var i = Number(f && f.index);
  if (!(i >= 0 && i < ads.length)) return;
  var cur = ads[i];
  var next = Object.assign({}, cur);
  Object.keys(f).forEach(function (k) { if (k !== 'index' && KEEP.indexOf(k) < 0 && f[k] != null) next[k] = f[k]; });
  if (CTA.indexOf(next.cta) < 0) next.cta = cur.cta;
  next.primary = normPrimary(next.primary);
  // Опис необовʼязковий і часто не показується: якщо після виправлення все ще > 30 символів, прибираємо його, а не тримаємо креатив у чернетках.
  if (Array.from(String(next.description || '')).length > 30) next.description = '';
  ads[i] = next;
});
return { ads: ads, adRepaired: list.length };`;

// Збірка постів для bulk-import: креатив × формат. Для відео — один пост на креатив.
const assembleImageCode = String.raw`var STRUCT = { pain: 'ad_pain', outcome: 'ad_outcome', objection: 'ad_objection', proof: 'ad_proof', curiosity: 'ad_curiosity', lead_magnet: 'ad_lead_magnet' };
var gate = ((context.gate2 || context.gate1) || {}).results || [];
var posts = [];
var lines = [];
context.ads.forEach(function (ad, i) {
  var bad = (gate[i] && gate[i].violations) || [];
  lines.push((i + 1) + '. [' + (ad.pain || ad.angle) + '] ' + (ad.overlayTitle || ad.headline) + (bad.length ? '  ⚠ потребує правок: ' + bad.slice(0, 2).join('; ') : ''));
  context.adAspects.forEach(function (asp) {
    var a = Object.assign({}, ad, { aspect: asp });
    posts.push({
      platform: 'meta_ads',
      format: asp === '9:16' ? 'ad_story' : 'ad_image',
      date: context.adDate,
      audience: 'cold',
      structure: STRUCT[ad.angle] || null,
      used_topic: context.adOfferName + (ad.pain ? ' · ' + ad.pain : ''),
      hook_type: ad.angle === 'pain' ? 'pain' : (ad.angle === 'curiosity' ? 'question' : 'promise'),
      intent: 'sell',
      content: '',
      funnel_slug: context.adRender ? 'ads-render-image' : null,
      funnel_params: { ad: a, aspect: asp, projectId: context.adProjectId },
    });
  });
});
return { importPayload: { projectId: context.adProjectId, posts: posts }, adPostCount: posts.length, adSummary: lines.join('\n') };`;

const assembleVideoCode = String.raw`var STRUCT = { pain: 'ad_video_hook', outcome: 'ad_video_hook', objection: 'ad_video_hook', proof: 'ad_video_hook', curiosity: 'ad_video_hook', lead_magnet: 'ad_video_hook' };
var gate = ((context.gate2 || context.gate1) || {}).results || [];
var posts = [];
var lines = [];
context.ads.forEach(function (ad, i) {
  var bad = (gate[i] && gate[i].violations) || [];
  var scenes = (ad.scenes || []).map(function (s) {
    return { visual: String(s.visual || '').slice(0, 600), text: String(s.text || '').slice(0, 60), sec: Math.min(4, Math.max(2, Number(s.sec) || 3)), motion: s.motion || null };
  });
  var total = scenes.reduce(function (t, s) { return t + s.sec; }, 0);
  var sceneOk = scenes.length >= 3 && scenes.every(function (s) { return s.visual; }) && total <= 18;
  lines.push((i + 1) + '. [' + (ad.pain || ad.angle) + '] ' + ad.headline + ' (' + scenes.length + ' сцен, ' + total + ' с)' + (bad.length ? '  ⚠ ' + bad.slice(0, 2).join('; ') : '') + (sceneOk ? '' : '  ⚠ сценарій не пройшов перевірку (сцени/тривалість)'));
  posts.push({
    platform: 'meta_ads',
    format: 'ad_video',
    date: context.adDate,
    audience: 'cold',
    structure: STRUCT[ad.angle],
    used_topic: context.adOfferName + (ad.pain ? ' · ' + ad.pain : ''),
    hook_type: ad.angle === 'pain' ? 'pain' : 'promise',
    intent: 'sell',
    content: '',
    funnel_slug: context.adRender && sceneOk ? 'content-short-video' : null,
    funnel_params: { ad: ad, scenes: scenes, style: ad.style, music: ad.music, aspect: '9:16', projectId: context.adProjectId },
  });
});
return { importPayload: { projectId: context.adProjectId, posts: posts }, adPostCount: posts.length, adSummary: lines.join('\n') };`;

// ── Рендер креатива (воронка ads-render-image): gpt-image-2 малює ЦІЛИЙ креатив ────────────────────────

const renderParamsCode = String.raw`// Промпт цілого креатива: плашка «для кого», заголовок, акцент/пункти, ілюстрація болю, нижня плашка з пропозицією.
// Розмір нативний (без обрізання, щоб текст не різало): 4:5 = 1088x1360, 9:16 = 1152x2048, 1:1 = 1024x1024.
var ASP = { '4:5': { sz: '1088x1360', zone: 'Keep ALL text inside the central 90% of the frame height.' }, '9:16': { sz: '1152x2048', zone: 'Keep ALL text between 15% and 80% of the frame height: the top 15% and the bottom 20% must stay empty (interface zones).' }, '1:1': { sz: '1024x1024', zone: 'Keep ALL text inside the central 90% of the frame.' } };
var asp = ASP[context.aspect] ? context.aspect : '4:5';
function q(t) { return String(t == null ? '' : t).replace(/["“”„]/g, '«').replace(/\\/g, ' ').replace(/\s+/g, ' ').trim(); }
var ad = context.ad || {};
var aud = q(ad.audience), title = q(ad.overlayTitle || context.title), acc = q(ad.accent), bar = q(ad.overlaySub || context.subtitle), scene = q(ad.visual || context.bgPrompt);
var pts = (Array.isArray(ad.points) ? ad.points : []).map(q).filter(Boolean).slice(0, 3);
if (!title) throw new Error('overlayTitle (заголовок на картинці) обовʼязковий');
var base = 'Vertical advertising creative for Instagram/Facebook, for Ukrainian business owners. Dark navy background (#0b1220) with a vivid blue (#3b82f6) accent and warm white text. Modern bold geometric sans-serif typography. ALL text must be in UKRAINIAN Cyrillic, written EXACTLY as quoted, spelled correctly (the abbreviation "ШІ" is two Cyrillic letters). Clean flat vector illustration style, strong contrast, large readable text for a phone screen, generous margins. ' + ASP[asp].zone + ' No logos, no watermarks, no other words or letters anywhere besides the quoted texts.';
var steps = [], n = 1;
if (aud) steps.push('(' + (n++) + ') a small rounded blue pill label at the top with text: "' + aud + '".');
steps.push('(' + (n++) + ') a big bold white headline: "' + title + '".');
if (acc) steps.push('(' + (n++) + ') directly under the headline a very large blue highlighted line: "' + acc + '".');
if (pts.length) steps.push('(' + (n++) + ') ' + pts.length + ' numbered rows with blue number circles and white text: ' + pts.map(function (p, i) { return '"' + (i + 1) + '  ' + p + '"'; }).join(', ') + '.');
if (scene) steps.push('(' + (n++) + ') ' + (pts.length ? 'optionally a small subtle supporting illustration: ' : 'a flat illustration that shows the pain: ') + scene + '.');
if (bar) steps.push('(' + (n++) + ') at the bottom a rounded white bar with dark text: "' + bar + '".');
var prompt = base + ' Layout from top to bottom: ' + steps.join(' ');
return { openaiSize: ASP[asp].sz, adAspect: asp, fullPrompt: prompt, callbackUrl: context.callbackUrl || '' };`;

// Перевірка відповіді генератора: має бути PNG (iVBOR…). Інакше повтор, потім status:error у content2.
const renderCheckCode = String.raw`var b = context.bgBase64;
var tries = (Number(context.renderTry) || 0) + 1;
var ok = typeof b === 'string' && b.length > 20000 && b.indexOf('iVBOR') === 0;
return { renderOk: ok, renderTry: tries, failMsg: ok ? '' : 'Генератор картинок не повернув креатив (спроба ' + tries + '): ліміт, фільтр безпеки, ключ або баланс OpenAI', finalImageBase64: ok ? b : '', bgBase64: ok ? b : '' };`;

const retryWaitCode = String.raw`var ms = 8000 + Math.floor(Math.random() * 12000);
await new Promise(function (r) { setTimeout(r, ms); });
return { retryWaitMs: ms };`;

const inj = (code) => code.replace('/*HELPERS*/', JSON_HELPERS);

module.exports = {
  withMode,
  paramsCode, prepareCode, parseCode: inj(parseCode), repairBriefCode, mergeCode: inj(mergeCode), assembleImageCode, assembleVideoCode,
  renderParamsCode, renderCheckCode, retryWaitCode,
};
