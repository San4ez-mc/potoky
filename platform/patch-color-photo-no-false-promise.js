'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *
 * ПРОБЛЕМА 4 (живий кейс, скрін власника, 2026-09-01): клієнт просить фото
 * графітової кофти → бот "Зараз надішлю фото графітової кофти та футболки 📦" →
 * фото так ніколи й не приходить, і жодного сповіщення менеджеру не йде.
 *
 * КОРІНЬ (перевірено): у KeyCRM зараз ФІЗИЧНО немає окремих фото по кожному
 * кольору товару — є лише загальні photoUrl/imageUrls товару в цілому (це та
 * сама прогалина, що вже задокументована в ТЗ на нову CRM: "в кожному кольорі
 * має бути можливість додавати до 10 фото" — поля просто нема). Модель (n_color)
 * інструктована обіцяти фото на ЗАГАЛЬНИЙ запит "покажіть фото", але коли клієнт
 * просить фото КОНКРЕТНОГО КОЛЬОРУ — вона іноді (не завжди) обіцяє те саме
 * текстом, не усвідомлюючи, що даних САМЕ по цьому кольору просто не існує —
 * і тому не завжди навіть виставляє wantsPhoto (бо "формально" це не зовсім
 * "покажіть фото товару", а прохання по кольору).
 *
 * ФІКС — ДВОШАРОВИЙ (не ще один точковий "якщо бачиш слово X — постав флаг"):
 *   1) ЦЕЙ патч (дані воронки): промпт n_color тепер ЯВНО каже — фото по
 *      кольорах окремо в системі НЕМАЄ, НЕ обіцяй "надішлю фото [колір]",
 *      чесно скажи що немає, запропонуй загальне фото товару (wantsPhoto) або
 *      менеджера.
 *   2) Engine-рівень (testSession.js, уже задеплоєно окремим комітом):
 *      централізований текстовий safety-net — якщо МОДЕЛЬ все ж десь пообіцяє
 *      фото словами без wantsPhoto/wantsUpsellPhoto — це ЗАВЖДИ падає в
 *      notifyAdminPhotoMissing, для БУДЬ-ЯКОЇ claude dialog-ноди, не лише
 *      n_color. Це і є системне покриття: навіть якщо ЦЕЙ промпт колись не
 *      спрацює на нову формулу питання клієнта — інженерний рівень все одно
 *      зловить порожню обіцянку й сповістить людину.
 *
 * ЗАПУСК:  node patch-color-photo-no-false-promise.js            (dry-run)
 *          node patch-color-photo-no-false-promise.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const OLD = 'ЯКЩО клієнт просить фото товару ("покажіть фото", "скиньте фото", "як виглядає наживо") — у json_output ДОДАЙ поле "wantsPhoto":true (окремо або разом з іншими полями), і в тексті напиши, що зараз надішлеш фото.';
const NEW = OLD + '\n'
    + '⚠️ ФОТО ПО ОКРЕМИХ КОЛЬОРАХ у системі НЕМАЄ (лише загальні фото товару) — якщо клієнт просить фото КОНКРЕТНОГО кольору ("покажіть графітову", "фото в чорному") — НІКОЛИ не пиши "зараз надішлю фото [колір]" (це порожня обіцянка, такого фото не існує). Чесно скажи, що окремого фото саме цього кольору немає, і одразу запропонуй або загальне фото товару (тоді додай wantsPhoto:true у json_output), або покликати менеджера, якщо клієнту принципово важливо побачити саме цей колір.';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nColor = flow.nodes.find((n) => n.id === 'n_color');
    if (!nColor) { console.log(name, 'ERROR: n_color not found'); return; }

    const prompt = nColor.data.systemPrompt || '';
    if (prompt.includes('ФОТО ПО ОКРЕМИХ КОЛЬОРАХ')) { console.log(name, 'ALREADY_APPLIED'); return; }
    if (!prompt.includes(OLD)) { console.log(name, 'WARNING: анкор не знайдено — n_color.systemPrompt міг змінитись. Пропускаю (перевір вручну).'); return; }

    console.log(name, 'n_color.systemPrompt: додається заборона хибної обіцянки фото по кольору.');
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => (n.id === 'n_color' ? { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.split(OLD).join(NEW) } } : n));
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
