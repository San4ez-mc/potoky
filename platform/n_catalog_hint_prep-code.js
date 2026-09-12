// n_catalog_hint_prep — джерело істини (CRM-клони, патч patch-goverla-crm-audit-2026-09-04.js).
// 2026-09-12 (власник: "поправ по всій воронці, щоб ці запити витягнуті були в окремі ноди — щоб я
// дивлячись на граф зразу бачив відправки, не занурюючись у код"): раніше n_catalog_hint робила
// ВСЕ в одній js-ноді — msg-нормалізацію, HTTP-запити до CRM (products+categories) і фільтрацію.
// Тепер: ЦЯ нода — лише текстова підготовка (без жодного зовнішнього виклику), яка вирішує чи
// взагалі потрібен запит до CRM (n_catalog_hint_needs_fetch_cond) і рахує STEM-и/кольорові слова
// наперед — щоб нода обробки (n_catalog_hint_process) не парсила msg вдруге.
var msg = String(context.lastUserMessage || input || '').toLowerCase();
// 2026-09-08 (_valery_pechorin_): назва реклами/поста — джерело категорії, коли в самому повідомленні її нема.
var __adHint = String(context.adTitle || (context.sharedPost && context.sharedPost.caption) || '').toLowerCase().replace(/^допис в instagram:\s*/i, '').replace(/_group_\d+$/i, '').replace(/\.{3,}/g, ' ');
var __msgHasCat = /(кофт|светр|худ|бомбер|куртк|вітровк|джинс|штан|футболк|лофер|взутт|кросів|черевик|костюм|комплект|накидк|подушк|органайзер|підголівник|шкірян|кожан)/.test(msg);
if (!__msgHasCat && __adHint) msg = (msg + ' ' + __adHint).trim();
// 2026-09-08 (andriy.symoniuk): підпис рілса обрізаний до 80 симв в lastUserMessage — повний підпис завжди.
if (context.sharedPost && context.sharedPost.caption && msg.indexOf(String(context.sharedPost.caption).toLowerCase().slice(0, 40)) < 0) msg = (msg + ' ' + String(context.sharedPost.caption).toLowerCase()).trim();
var unknownTurns = (Number(context.unknownTurns) || 0) + 1;
var apiKey = (keys.CRM_API_KEY || '').trim();
// Гейт: товар вже відомий, або немає ключа CRM — жодного сенсу йти в HTTP-виклики взагалі.
if (context.product || !apiKey) {
  return { catalogHintMsg: msg, catalogHintNeedsFetch: false, catalogHint: '', catalogHintCount: 0, catalogHintSkus: '', catalogHintPick: '', catalogCategories: '', unknownTurns: unknownTurns };
}
// Підказка від n_lookup (реклама комплекту, кілька однакових компонентів) — теж не потребує HTTP, вона вже готова.
if (context.setComponentHint) {
  var __scn = String(context.setComponentHint).split('\n').length;
  return { catalogHintMsg: msg, catalogHintNeedsFetch: false, catalogHint: context.setComponentHint, catalogHintCount: __scn, catalogHintTotal: __scn, unknownTurns: unknownTurns };
}
// стем → корені для пошуку в назві товару/категорії (статичний список, CRM не потрібен для цього кроку).
var STEMS = [
  ['кофт', ['кофт']], ['светр', ['светр', 'кофт']], ['худ', ['худ']], ['бомбер', ['бомбер']], ['куртк', ['куртк', 'бомбер', 'вітровк']],
  ['вітровк', ['вітровк', 'куртк']], ['джинс', ['джинс']], ['штан', ['штан', 'джинс']], ['футболк', ['футболк']],
  ['лофер', ['лофер']], ['взутт', ['лофер', 'кросів', 'черевик', 'взутт']], ['кросів', ['кросів']], ['черевик', ['черевик']],
  ['костюм', ['костюм']], ['комплект', ['комплект']], ['накидк', ['накидк']], ['подушк', ['подушк']], ['органайзер', ['органайзер']],
  ['підголівник', ['підголівник']], ['шкірян', ['шкір', 'кожан']], ['кожан', ['кожан', 'шкір']],
];
var wants = [];
for (var i = 0; i < STEMS.length; i++) { if (msg.indexOf(STEMS[i][0]) >= 0) { for (var j2 = 0; j2 < STEMS[i][1].length; j2++) { if (wants.indexOf(STEMS[i][1][j2]) < 0) wants.push(STEMS[i][1][j2]); } } }
// 2026-09-08 (mykola): три і більше категорій в одному повідомленні/підписі — це комплект.
var __catStems = ['кофт', 'джинс', 'футболк', 'лофер', 'бомбер', 'куртк', 'костюм', 'кросів', 'черевик', 'штан'].filter(function (st) { return msg.indexOf(st) >= 0; });
if (__catStems.length >= 3 && wants.indexOf('комплект') < 0) wants.push('комплект');
var __hintColorWords = msg.match(/(чорн\w*|сір\w*|біл\w*|син\w*|графіт\w*|бордов\w*|беж\w*|коричнев\w*|зелен\w*|червон\w*|хакі|олив\w*|молочн\w*|блакитн\w*)/gi) || [];
var __stemM = msg.match(/(кофт|футболк|джинс|бомбер|куртк|вітровк|костюм|штан|лофер|кросівк|худі|светр|черевик|накидк)/i); var __stem = __stemM ? __stemM[1] : '';
// НЕ вирішуємо тут "чи взагалі буде щось знайдено" (для цього треба каталог) — лише "чи є взагалі
// сенс питати CRM": порожнє повідомлення БЕЗ жодного стему/кольору — сенсу нема, категорії магазину
// (catList) далі все одно рахує n_catalog_hint_process окремим шляхом, якщо знадобиться.
if (!msg) { return { catalogHintMsg: msg, catalogHintNeedsFetch: false, catalogHint: '', catalogHintCount: 0, catalogCategories: '', unknownTurns: unknownTurns }; }
return {
  catalogHintMsg: msg,
  catalogHintWants: wants,
  catalogHintColorWords: __hintColorWords,
  catalogHintStem: __stem,
  catalogHintNeedsFetch: true,
  unknownTurns: unknownTurns,
};
