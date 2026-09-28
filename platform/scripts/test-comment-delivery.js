// Перевірка правила публічної відповіді на коментар залежно від результату приватного DM.
// Запуск на сервері: node scripts/test-comment-delivery.js
const assert = require('assert');
const { pickCommentPublicReply } = require('../apps/api/src/services/zernioHandler');

const withHint = 'Ольга, дякую за інтерес 💛 Ціну і всі деталі вже надсилаю в директ!. Якщо не бачите повідомлення — можливо, особисті закриті, тоді напишіть нам самі 🙏';

// DM дійшов → варіант «відписали в директ» без підказки про закриті особисті
let r = pickCommentPublicReply(withHint, 1, 0, 'Ольга');
assert(!/закриті|напишіть нам самі/i.test(r), 'DM дійшов: підказки бути не має, отримано: ' + r);
assert(/директ/.test(r), 'DM дійшов: відповідь має відсилати в директ, отримано: ' + r);

// DM не дійшов → просимо написати самим, імʼя підставлено, «дивіться директ» не обіцяємо
for (let i = 0; i < 20; i++) {
  r = pickCommentPublicReply(withHint, 0, 1, 'Ольга');
  assert(/^Ольга,/.test(r), 'DM не дійшов: має починатись з імені, отримано: ' + r);
  assert(/напишіть нам|черкніть нам/i.test(r), 'DM не дійшов: має просити написати самим, отримано: ' + r);
  assert(!/дивіться директ|перевірте директ|в директ 💌/i.test(r), 'DM не дійшов: не можна обіцяти повідомлення, отримано: ' + r);
}

// Спроби DM не було → текст без змін
assert.strictEqual(pickCommentPublicReply(withHint, 0, 0, 'Ольга'), withHint);

// Змішаний результат (щось дійшло) → вважаємо доставленим
r = pickCommentPublicReply(withHint, 1, 1, 'Ольга');
assert(!/закриті/i.test(r));

console.log('OK: pickCommentPublicReply');
process.exit(0);
