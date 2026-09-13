// n_signal_check — джерело істини (goverla CRM-клон fcdee415, патч patch-goverla-crm-audit-2026-09-04.js).
// Гейт ПЕРЕД n_signal_cond: якщо hasProductSignal=false, важкий n_lookup взагалі НЕ
// викликається (клієнт одразу йде в n_unknown_msg) — тому бажаний артикул тут ПОВИНЕН
// розпізнаватись так само надійно, як і в n_lookup-crm-code.js/extractArticles().
var msg = String(context.lastUserMessage || input || '');
var hasPost = !!(context.sharedPost || context.entryAd);
var hasPhoto = !!context.lastUserImageUrl;
// Аудит 2026-08-27: прибрано голий /\b\d{4,8}\b/ — хибно спрацьовував на поштовий
// індекс/ціну/номер відділення (будь-яке окреме 4-8-значне число), спричиняючи
// нескінченний цикл reset->ask на звичайних повідомленнях з адресою чи ціною.
// 2026-09-11 (2b54d51e: "А0182 - Вітровка Канада" з кириличною «А», без слова "артикул"
// перед нею — hasProductSignal лишався false, n_lookup з робочим latinizeLookalikes()
// НІКОЛИ не викликався): та сама кирилиця-латиниця нормалізація, що вже є в n_lookup,
// перенесена й сюди — інакше цей гейт-кіпер блокує шлях до вже виправленого коду.
function latinizeLookalikes(x) {
  var M = { 'А':'A','В':'B','С':'C','Е':'E','Н':'H','І':'I','К':'K','М':'M','О':'O','Р':'P','Т':'T','Х':'X','У':'Y','а':'a','в':'b','с':'c','е':'e','н':'h','і':'i','к':'k','м':'m','о':'o','р':'p','т':'t','х':'x','у':'y' };
  return String(x || '').replace(/[АВСЕНІКМОРТХУавсенікмортху]{1,4}(?=\d{2,8})/g, function (seq) { return seq.split('').map(function (ch) { return M[ch] || ch; }).join(''); });
}
var msgLatinized = latinizeLookalikes(msg);
var hasArticleLike = /(?:артикул|арт\.?|art|код|sku|#|№)\s*[:#№.\-]?\s*[A-Za-zА-Яа-яІЇЄҐіїєґ]{0,5}\d{2,8}/i.test(msg)
  || /\b[A-Za-z]\d{3,6}\b/.test(msgLatinized);
// 2026-09-13 (власник: "зібрати всі варіанти квитанцій/посилань про оплату, довести до 100%"):
// ГОЛЕ посилання на квитанцію (Monobank/Приват24/Portmone/check.gov.ua/ibanoplata) без жодного
// іншого сигналу товару раніше падало у n_catalog_hint/n_unknown_msg (загальне "який товар вас
// цікавить?") — n_lookup, де живе розпізнавання квитанцій (context.looksLikeReceipt), взагалі
// не викликався. Пускаємо такі повідомлення через n_lookup теж — там і стоїть детектор.
var hasReceiptLink = false;
var __rcLinkM = msg.match(/https?:\/\/[^\s]+/);
if (__rcLinkM) {
  try {
    var __rcHost = new URL(__rcLinkM[0]).hostname.toLowerCase();
    var __rcHosts = ['check.monobank.ua', 'send.monobank.ua', 'pay.mono.ua', 'pb.ua', 'privatbank.ua', 'next.privat24.ua', 'portmone.com.ua', 'check.gov.ua', 'ibanoplata.com'];
    hasReceiptLink = __rcHosts.some(function (d) { return __rcHost === d || __rcHost.endsWith('.' + d); });
  } catch (e) { /* невалідний URL */ }
}
return { hasProductSignal: hasPost || hasPhoto || hasArticleLike || hasReceiptLink };
