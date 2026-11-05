'use strict';
// Код js-нод воронок рекламних креативів. Джерело істини для нод у БД: build-ads-creatives-*.js відтворює їх звідси.
// Зовнішні HTTP-виклики тут НЕ робляться (правило 7a): content2, Claude, Vertex, slide-builder — окремі ноди.

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
var count = Math.min(video ? 5 : 8, Math.max(1, parseInt(context.count, 10) || (video ? 2 : 4)));
var aspects = arr(context.aspects).filter(function (a) { return ['4:5', '9:16', '1:1'].indexOf(a) >= 0; });
if (!aspects.length) aspects = ['4:5', '9:16'];
var d = context.date && /^\d{4}-\d{2}-\d{2}$/.test(String(context.date)) ? String(context.date) : new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
var useMagnet = context.leadMagnet === false || context.leadMagnet === 'false' ? 'no' : (context.leadMagnet === true || context.leadMagnet === 'true' ? 'yes' : (context.leadMagnet ? String(context.leadMagnet) : 'auto'));
return {
  adProjectId: projectId,
  adCount: count,
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

// Підготовка: перевірка контексту, вибір магніту/посилання, кутів, бриф для Claude.
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

var hasProof = (r.cases || []).some(function (c) { return c.allowedClaims && String(c.allowedClaims).trim(); });
var order = ['pain', 'outcome', 'objection', 'curiosity'];
if (hasProof) order.push('proof');
if (magnet) order.splice(1, 0, 'lead_magnet');
var wanted = (context.adAnglesWanted || []).filter(function (a) { return ['pain', 'outcome', 'objection', 'proof', 'curiosity', 'lead_magnet'].indexOf(a) >= 0; });
if (wanted.length) order = wanted;
var angles = [];
for (var i = 0; i < context.adCount; i++) angles.push(order[i % order.length]);


var prev = (r.previousAds || []).slice(0, 25).map(function (a) { return '- ' + a.headline + (a.angle ? ' [' + a.angle + ']' : ''); }).join('\n');
var brief = [
  'ЗАВДАННЯ: ' + context.adCount + ' рекламних креативів для пропозиції «' + offer.name + '». Кути по порядку: ' + angles.join(', ') + '.',
  'Усі креативи ведуть до ОДНІЄЇ дії. ' + (magnet ? 'Дія для кута lead_magnet: отримати «' + magnet.name + '». Для інших кутів дія: записатися / написати на пропозицію «' + offer.name + '».' : 'Дія: записатися / написати на пропозицію «' + offer.name + '».'),
  magnet ? 'ЛІД-МАГНІТ (використовуй лише в куті lead_magnet): «' + magnet.name + '». Що це: ' + (magnet.description || '(опису нема, не вигадуй, назви лише як є)') : 'ЛІД-МАГНІТ: не використовується, кут lead_magnet не робити.',
  context.adNote ? 'ДОДАТКОВА ВКАЗІВКА ВЛАСНИКА: ' + context.adNote : '',
  prev ? 'ВЖЕ Є В ПЛАНІ (не повторюй ні заголовки, ні ідеї):\n' + prev : '',
  '--- ДАНІ ПРО ЕКСПЕРТА, ПРОПОЗИЦІЮ І ЦА ---',
  r.text,
].filter(Boolean).join('\n\n');
return {
  adOffer: { id: offer.id, name: offer.name },
  adOfferName: offer.name,
  adMagnet: magnet,
  adAngles: angles,
  adRules: r.rules,
  adBrief: brief,
  adNetworkId: r.networkId,
};`;

// Розбір відповіді Claude → масив креативів + посилання/utm (посилання ставить КОД, не модель).
const parseCode = String.raw`function pickJson(v) {
  if (v && typeof v === 'object') return v;
  var s = String(v || '');
  var i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
}
var obj = pickJson(context.creativesRaw);
var list = obj && Array.isArray(obj.creatives) ? obj.creatives : (Array.isArray(obj) ? obj : []);
if (!list.length) return { adFatal: 'Claude не повернув креативів у JSON: ' + String(typeof context.creativesRaw === 'string' ? context.creativesRaw : JSON.stringify(context.creativesRaw || '')).slice(0, 200) };
var CTA = ['Дізнатися більше', "Зв'язатися з нами", 'Записатися', 'Надіслати повідомлення', 'Завантажити', 'Отримати пропозицію'];
function s(v, n) { return String(v == null ? '' : v).replace(/\s+\n/g, '\n').trim().slice(0, n); }
function slug(t) { return encodeURIComponent(String(t || '').toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/g, '-').replace(/^-+|-+$/g, '')); }
function linkFor(angle, idx) {
  // Посилання необовʼязкове (його часто додають у кабінеті Meta): лід-магніт має свій, інші кути — landingUrl, якщо передали.
  var base = angle === 'lead_magnet' && context.adMagnet ? context.adMagnet.link : (context.adLanding || '');
  if (!base) return '';
  if (/^https?:\/\/t\.me\//i.test(base)) return base; // Telegram-посилання без utm: відстеження дає посилання з start-параметром
  var sep = base.indexOf('?') >= 0 ? '&' : '?';
  return base + sep + 'utm_source=facebook&utm_medium=paid_social&utm_campaign=' + slug(context.adOfferName) + '&utm_content=' + slug(angle) + '-' + (idx + 1);
}
var video = context.__adMode === 'video';
var ads = list.slice(0, context.adCount).map(function (c, i) {
  c = c || {};
  var angle = ['pain', 'outcome', 'objection', 'proof', 'curiosity', 'lead_magnet'].indexOf(c.angle) >= 0 ? c.angle : (context.adAngles[i] || 'pain');
  var ad = {
    angle: angle,
    primary: s(c.primary, 600), headline: s(c.headline, 120), description: s(c.description, 80),
    cta: CTA.indexOf(c.cta) >= 0 ? c.cta : (angle === 'lead_magnet' ? 'Завантажити' : 'Дізнатися більше'),
    link: linkFor(angle, i),
    leadMagnet: angle === 'lead_magnet' && context.adMagnet ? context.adMagnet.name : null,
    aspect: video ? '9:16' : '4:5',
  };
  if (!video) { ad.overlayTitle = s(c.overlayTitle, 200); ad.overlaySub = s(c.overlaySub, 200); ad.visual = s(c.visual, 700); }
  else { ad.style = s(c.style, 900); ad.music = c.music && typeof c.music === 'object' ? c.music : { prompt: s(c.music, 200) }; ad.scenes = Array.isArray(c.scenes) ? c.scenes.slice(0, 6) : []; }
  return ad;
});
return { ads: ads };`;

// Бриф на виправлення лише для креативів із порушеннями.
const repairBriefCode = String.raw`var res = (context.gate1 && context.gate1.results) || [];
var bad = [];
res.forEach(function (r) { if (r.violations && r.violations.length) bad.push({ index: r.index, violations: r.violations, ad: context.ads[r.index] }); });
var brief = 'Ось креативи з порушеннями. Перепиши кожен так, щоб усі порушення зникли, збережи "index", кут і ідею. Посилання (link) не змінюй і не пиши.\n\n' + JSON.stringify(bad);
return { adBad: bad.map(function (b) { return b.index; }), adRepairBrief: brief };`;

// Підстановка виправлених креативів (за index); посилання лишаємо наші.
const mergeCode = String.raw`function pickJson(v) {
  if (v && typeof v === 'object') return v;
  var s = String(v || ''); var i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
}
var obj = pickJson(context.fixedRaw);
var list = obj && Array.isArray(obj.creatives) ? obj.creatives : [];
var ads = context.ads.slice();
var CTA = ['Дізнатися більше', "Зв'язатися з нами", 'Записатися', 'Надіслати повідомлення', 'Завантажити', 'Отримати пропозицію'];
var KEEP = ['link', 'leadMagnet', 'aspect', 'angle'];
list.forEach(function (f) {
  var i = Number(f && f.index);
  if (!(i >= 0 && i < ads.length)) return;
  var cur = ads[i];
  var next = Object.assign({}, cur);
  Object.keys(f).forEach(function (k) { if (k !== 'index' && KEEP.indexOf(k) < 0 && f[k] != null) next[k] = f[k]; });
  if (CTA.indexOf(next.cta) < 0) next.cta = cur.cta;
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
  lines.push((i + 1) + '. [' + ad.angle + '] ' + ad.headline + (bad.length ? '  ⚠ потребує правок: ' + bad.slice(0, 2).join('; ') : ''));
  context.adAspects.forEach(function (asp) {
    var a = Object.assign({}, ad, { aspect: asp });
    posts.push({
      platform: 'meta_ads',
      format: asp === '9:16' ? 'ad_story' : 'ad_image',
      date: context.adDate,
      audience: 'cold',
      structure: STRUCT[ad.angle] || null,
      used_topic: context.adOfferName,
      hook_type: ad.angle === 'pain' ? 'pain' : (ad.angle === 'curiosity' ? 'question' : 'promise'),
      intent: 'sell',
      content: '',
      funnel_slug: context.adRender ? 'ads-render-image' : null,
      funnel_params: context.adRender ? { ad: a, bgPrompt: a.visual, title: a.overlayTitle, subtitle: a.overlaySub, aspect: asp, projectId: context.adProjectId } : { ad: a },
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
  lines.push((i + 1) + '. [' + ad.angle + '] ' + ad.headline + ' (' + scenes.length + ' сцен, ' + total + ' с)' + (bad.length ? '  ⚠ ' + bad.slice(0, 2).join('; ') : '') + (sceneOk ? '' : '  ⚠ сценарій не пройшов перевірку (сцени/тривалість)'));
  posts.push({
    platform: 'meta_ads',
    format: 'ad_video',
    date: context.adDate,
    audience: 'cold',
    structure: STRUCT[ad.angle],
    used_topic: context.adOfferName,
    hook_type: ad.angle === 'pain' ? 'pain' : 'promise',
    intent: 'sell',
    content: '',
    funnel_slug: context.adRender && sceneOk ? 'content-short-video' : null,
    funnel_params: { ad: ad, scenes: scenes, style: ad.style, music: ad.music, aspect: '9:16', projectId: context.adProjectId },
  });
});
return { importPayload: { projectId: context.adProjectId, posts: posts }, adPostCount: posts.length, adSummary: lines.join('\n') };`;

// ── Рендер картинки (воронка ads-render-image) ──────────────────────────────────────────────────────────

const renderParamsCode = String.raw`// Параметри рендера одного рекламного креатива: розмір, співвідношення для Imagen, промпт фону.
var ASP = { '4:5': { w: 1080, h: 1350, im: '3:4' }, '9:16': { w: 1080, h: 1920, im: '9:16' }, '1:1': { w: 1080, h: 1080, im: '1:1' } };
var asp = ASP[context.aspect] ? context.aspect : '4:5';
var a = ASP[asp];
var base = String(context.bgPrompt || (context.ad && context.ad.visual) || '').trim();
if (!base) throw new Error('bgPrompt (опис картинки) обовʼязковий');
var safe = asp === '9:16' ? ' Keep the top 15% and the bottom 20% of the frame calm and uncluttered.' : ' Keep the lower 40% of the frame calm and uncluttered.';
var prompt = base.replace(/["\\\n\r]+/g, ' ').slice(0, 800) + '. Clean modern advertising visual, soft natural light, shallow depth of field, no text, no letters, no numbers, no logos, no watermark, no faces.' + safe;
return {
  width: a.w, height: a.h, imagenAspect: a.im, adAspect: asp,
  bgPromptFinal: prompt,
  title: String(context.title || (context.ad && context.ad.overlayTitle) || '').trim(),
  subtitle: String(context.subtitle || (context.ad && context.ad.overlaySub) || '').trim(),
  bgColor: context.bgColor || '#0f172a',
  accent: context.accent || '#3b82f6',
  template: context.template || 'default',
  bgStyle: context.bgStyle || 'flat',
  callbackUrl: context.callbackUrl || '',
};`;

const jwtCode = String.raw`// Підпис JWT для сервісного акаунта Google (Vertex AI). Мережевих викликів нема: обмін на токен робить наступна http-нода.
var raw = keys.GOOGLE_SA_KEY || '';
if (!raw) throw new Error('GOOGLE_SA_KEY не налаштовано (конектор Vertex: GOOGLE_VERTEX_CONNECTOR_ID)');
var sa;
try { sa = JSON.parse(raw); } catch (e) { sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
function b64u(b) { return Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
var now = Math.floor(Date.now() / 1000);
var head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
var pay = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 }));
var sign = crypto.createSign('RSA-SHA256');
sign.update(head + '.' + pay);
var sig = sign.sign(sa.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
return { gJwt: head + '.' + pay + '.' + sig };`;

const bgReadyCode = String.raw`// Фон від Imagen → data URL для slide-builder. Нема фону = чесна помилка (потім callback зі status:error).
var b = context.bgBase64;
if (!b || typeof b !== 'string' || b.length < 1000) return { bgOk: false, bgError: 'Imagen не повернув картинку (ліміт/фільтр безпеки/ключ). Токен: ' + (context.gToken ? 'є' : 'нема') };
return { bgOk: true, finalPhotoUrl: 'data:image/png;base64,' + b };`;

const renderFailCode = String.raw`return { failBody: JSON.stringify({ status: 'error', error: String(context.bgError || context.renderError || 'render failed').slice(0, 400), postItemId: context.postItemId || null }) };`;

const withMode = (code, mode) => code.split('context.__adMode').join("'" + mode + "'");

module.exports = {
  withMode,
  paramsCode, prepareCode, parseCode, repairBriefCode, mergeCode, assembleImageCode, assembleVideoCode,
  renderParamsCode, jwtCode, bgReadyCode, renderFailCode,
};
