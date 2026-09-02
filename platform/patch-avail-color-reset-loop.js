'use strict';
/*
 * Регресійний прогін 2026-09-03 (фінальна перевірка перед свапом трафіку на нову CRM)
 * знайшов серйозний баг — САМОЗАЦИКЛЕННЯ в межах ОДНОГО ходу двигуна:
 *
 *   n_avail_no --> n_has_colors --> n_avail --> n_avail_cond --> n_avail_no --> ...
 *
 * n_has_colors пропускає повторний вибір кольору, якщо context.colorChoice.color вже
 * ЩОСЬ містить — незалежно від того, чи цей колір насправді Є в наявності. Коли обраний
 * (або авто-підставлений через offer-SKU preColor) колір недоступний — n_avail_no каже
 * клієнту "напишіть інший колір", але граф ЖОДНОГО РАЗУ не чекає цю відповідь: він одразу
 * повертається в n_has_colors, бачить старий colorChoice і йде НАЗАД у n_avail з ТИМ САМИМ
 * недоступним кольором — до безкінечності (зупиняється лише "тихим" guard-лімітом двигуна
 * 100 нод/крок, testSession.js). Живий приклад: питання про товар з preColor "Світло-сірий"
 * (сірий немає в наявності) дало ~20 повторів n_avail_no за ОДИН хід, а НАСТУПНЕ повідомлення
 * клієнта (навіть "мене цікавить інший артикул") просто ще раз попадало на ту саму
 * заглушку — фактичний вибір кольору чи зміна товару НІКОЛИ не читались, поки клієнт
 * сидів на n_avail_no.
 *
 * Фікс: n_avail, коли визначає available:false для ОБРАНОГО кольору, ОБОВ'ЯЗКОВО скидає
 * context.colorChoice → null (і накопичує unavailableColors[], щоб n_color надалі чесно
 * НЕ пропонував той самий недоступний колір повторно). Це вмикає n_has_colors на
 * наступному проході → маршрут іде в n_color (claude-нода, РЕАЛЬНО чекає відповідь
 * клієнта) — цикл ламається природно, замість зациклення в межах ходу.
 *
 * Зачіпає n_avail (js) + n_color (claude systemPrompt, одна строка контексту
 * unavailableColors) на ОБОХ клонах (goverla_shop, covercar_ua) — та ж сама графова
 * структура на обох.
 *
 * Ідемпотентний (точна рівність фрагмента коду/промпту). ЗАПУСК:
 *   node patch-avail-color-reset-loop.js            (dry-run)
 *   node patch-avail-color-reset-loop.js --apply    (записує у БД)
 */
const { db } = require('@platform/db');

const APPLY = process.argv.includes('--apply');

const BOTS = {
    goverlaClone: 'fcdee415-bef2-4a74-a650-e6e4b5a12322',
    covercarClone: 'a2d5ba79-f87b-48f2-8301-56292cdf3972',
};

const AVAIL_OLD = "return { available: avail };";
const AVAIL_NEW = `if (!avail && chosenColor) {
  var _unavail = Array.isArray(context.unavailableColors) ? context.unavailableColors.slice() : [];
  if (_unavail.indexOf(chosenColor) < 0) _unavail.push(chosenColor);
  return { available: avail, colorChoice: null, unavailableColors: _unavail };
}
return { available: avail };`;

const COLOR_PROMPT_OLD = 'КЛІЄНТ ОБИРАЄ КОЛІР. Доступні кольори: {{context.product.colors}}.';
const COLOR_PROMPT_NEW = COLOR_PROMPT_OLD + ' Кольори, яких ТОЧНО НЕМАЄ в наявності (клієнт уже питав, НЕ пропонуй їх знову): {{context.unavailableColors}}.';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }
    const nAvail = flow.nodes.find((n) => n.id === 'n_avail');
    const nColor = flow.nodes.find((n) => n.id === 'n_color');
    if (!nAvail || !nColor) { console.log(name, 'ERROR: n_avail/n_color not found'); return; }

    const availCode = nAvail.data.code || '';
    const colorPrompt = nColor.data.systemPrompt || '';

    const availDone = availCode.includes('unavailableColors');
    const colorDone = colorPrompt.includes('unavailableColors');
    const availHasAnchor = availCode.includes(AVAIL_OLD);
    const colorHasAnchor = colorPrompt.includes(COLOR_PROMPT_OLD);

    console.log(name, botId, {
        n_avail: availDone ? 'ALREADY_APPLIED' : (availHasAnchor ? 'WILL_PATCH' : 'WARNING_NO_ANCHOR'),
        n_color: colorDone ? 'ALREADY_APPLIED' : (colorHasAnchor ? 'WILL_PATCH' : 'WARNING_NO_ANCHOR'),
    });
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_avail' && !availDone && availHasAnchor) {
            return { ...n, data: { ...n.data, code: availCode.split(AVAIL_OLD).join(AVAIL_NEW) } };
        }
        if (n.id === 'n_color' && !colorDone && colorHasAnchor) {
            return { ...n, data: { ...n.data, systemPrompt: colorPrompt.split(COLOR_PROMPT_OLD).join(COLOR_PROMPT_NEW) } };
        }
        return n;
    });
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
