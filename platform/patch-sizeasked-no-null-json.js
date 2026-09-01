'use strict';
/*
 * Патч ДВОХ живих ботів (goverla_shop, covercar_ua) — ДОПОВНЕННЯ до
 * patch-sizeasked-shared-flag.js.
 *
 * Живий тест ВИЯВИВ реальну поведінку моделі: в сценарії "sizeAsked=true,
 * відповіді нема" модель, замість чесно порожнього ходу, іноді вигадувала
 * json_output {"height":null,"weight":null} — двигун (ДО цього патча)
 * приймав це як "завершено" і n_calc спокійно домальовував розмір "M" за
 * фолбеком, хоча клієнт ЖОДНОГО разу не назвав ні зросту, ні ваги.
 *
 * Захист двошаровий (той самий принцип, що й у Проблемі 4):
 *   1) Engine (testSession.js, окремий комміт): json_output, де ВСІ значення
 *      null/undefined/порожній рядок, більше НЕ вважається завершенням
 *      діалогу (узагальнення вже наявної перевірки для порожнього {}).
 *   2) ЦЕЙ патч (промпт): явна заборона вигадувати null-значення.
 *
 * ЗАПУСК:  node patch-sizeasked-no-null-json.js            (dry-run)
 *          node patch-sizeasked-no-null-json.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = {
    goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee',
};
const APPLY = process.argv.includes('--apply');

const OLD = 'НЕ пиши "Очікую", НЕ став питання ще раз, НЕ вигадуй проміжний коментар.';
const NEW = OLD + ' І НАЙГОЛОВНІШЕ: НІКОЛИ не став json_output із порожніми/вигаданими значеннями (напр. {"height":null,"weight":null}) замість чесного порожнього ходу — це так само заборонено, як і повторне питання; json_output ставиш ЛИШЕ коли маєш РЕАЛЬНІ цифри від клієнта.';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nSize = flow.nodes.find((n) => n.id === 'n_size');
    if (!nSize) { console.log(name, 'ERROR: n_size not found'); return; }

    const prompt = nSize.data.systemPrompt || '';
    if (prompt.includes('НАЙГОЛОВНІШЕ: НІКОЛИ не став json_output')) { console.log(name, 'ALREADY_APPLIED'); return; }
    if (!prompt.includes(OLD)) { console.log(name, 'WARNING: анкор не знайдено — n_size.systemPrompt міг змінитись (можливо, patch-sizeasked-shared-flag.js ще не застосовано). Пропускаю (перевір вручну).'); return; }

    console.log(name, 'n_size.systemPrompt: додається явна заборона null-json_output.');
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => (n.id === 'n_size' ? { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.split(OLD).join(NEW) } } : n));
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
