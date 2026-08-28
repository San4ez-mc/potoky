'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Ф1.9  Zernio-автоматизація (comment-automation) підтверджено робочою для
 *   приватної відповіді — Meta Private Reply API через Zernio ПРАЦЮЄ навіть
 *   для standalone "Instagram API with Instagram Login" (без Facebook Сторінки),
 *   де наші прямі виклики falls (HTTP 500). Перевірено живим коментарем:
 *   triggered:1, dmsSent:1, error:null.
 *
 *   Корінь проблеми, яку це виправляє: n_comment_entry раніше одразу вів у
 *   n_route → n_lookup → n_welcome/n_size/... — але СЬОГОДНІ клієнт ще НЕ МАЄ
 *   відкритого вікна повідомлень (щойно лишив коментар, ще не писав у директ) —
 *   тож ЖОДНЕ повідомлення цього каскаду фізично не могло дійти (той самий
 *   "outside of allowed window", що вже підтверджено). Гірше: currentNodeId
 *   ВСЕ ОДНО просувався далі (напр. до n_size, "чекаю зріст/вагу"), хоча клієнт
 *   ніколи не бачив ЖОДНОГО з цих повідомлень — коли він пізніше відповідав на
 *   generic opener від Zernio-автоматизації, його відповідь трактувалась як
 *   "відповідь на питання про зріст", хоча він те питання не бачив.
 *
 *   Фікс: n_comment_entry більше НЕ веде в n_route. Коментар отримує ЛИШЕ
 *   публічну відповідь (n_comment_entry сам постить її) — і на цьому крок
 *   ЗАВЕРШУЄТЬСЯ (немає вихідного ребра → рушій сам зупиняється, guard у
 *   testSession.js це підтримує: `while (runtime.currentNodeId && ...)`).
 *   context.entryAd / context.sharedPost.caption (з підпису допису, вже
 *   тягнеться окремим фіксом) ЛИШАЮТЬСЯ в сесії — коли клієнт РЕАЛЬНО напише
 *   (сам, або у відповідь на opener від Zernio-автоматизації), він потрапить у
 *   ЗВИЧАЙНИЙ DM-шлях (start_1 → n_route → n_lookup) з УЖЕ готовим товаром і
 *   СПРАВЖНІМ conversationId — жодного дублювання логіки, 100% те саме, що й
 *   пересилання поста в DM.
 *
 * ЗАПУСК:  node patch-comment-stop-after-entry.js            (dry-run)
 *          node patch-comment-stop-after-entry.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const hasEdge = flow.edges.some((e) => e.source === 'n_comment_entry' && e.target === 'n_route');
    if (!hasEdge) { console.log(name, 'ALREADY_APPLIED'); return; }

    console.log(name, 'буде видалено ребро n_comment_entry -> n_route.');
    if (!APPLY) return;

    const edges = flow.edges.filter((e) => !(e.source === 'n_comment_entry' && e.target === 'n_route'));
    await db.flowDefinition.update({ where: { botId }, data: { edges } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
