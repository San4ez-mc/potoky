'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Виявлено живим QA тест-прогоном (2026-08-28): не всі описи товарів у KeyCRM
 *   ще переписані під нову конвенцію "перший рядок = назва для клієнта". Для
 *   товарів зі СТАРИМ описом (напр. "Подушка під спину": перший рядок —
 *   "В наявності 8 кольорів:", а не назва) customerName ставав службовим
 *   заголовком — і це РЕАЛЬНО збивало консультант-ноди (n_size/n_color/
 *   n_order_intent/n_set_choice) з пантелику, підживлюючи хибне "вибачте,
 *   артикул не знайдено", хоча n_lookup товар знайшов правильно. n_welcome НЕ
 *   постраждав (завжди слав desc дослівно, не customerName).
 *
 *   Фікс: якщо перший рядок опису схожий на заголовок/список ("В наявності...",
 *   закінчується на ":", закороткий тощо) — відкат на found.name (реальна
 *   назва товару з CRM), а не вигадка.
 *
 * ЗАЛЕЖНІСТЬ: після patch-verbatim-desc-customername.js (цей патч ДОПОВНЮЄ
 *             ту саму customerName-логіку, не замінює її дизайн).
 *
 * ЗАПУСК:  node patch-customername-heading-fallback.js            (dry-run)
 *          node patch-customername-heading-fallback.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const NEW_LOOKUP_CODE_GOVERLA = fs.readFileSync(path.join(__dirname, 'n_lookup-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

const CC_OLD = `  // Аудит 2026-08-28: опис у KeyCRM тепер — готова презентація (з ціною/акцією
  // всередині), надсилаємо ДОСЛІВНО (n_welcome). Перше речення = ім'я товару
  // для клієнта; found.name лишається лише для внутрішнього використання.
  var __customerName=(__descClean.split('\\n')[0]||'').trim() || found.name || 'Товар';`;
const CC_NEW = `  // Аудит 2026-08-28: опис у KeyCRM тепер — готова презентація (з ціною/акцією
  // всередині), надсилаємо ДОСЛІВНО (n_welcome). Перше речення = ім'я товару
  // для клієнта; found.name лишається лише для внутрішнього використання.
  // Аудит 2026-08-28 (QA тест-прогін): не всі описи ще переписані під конвенцію —
  // якщо перший рядок схожий на службовий заголовок ("В наявності...", закінчується
  // на ":"), а не на назву — відкат на found.name (реальна назва з CRM).
  var __rawFirstLine=(__descClean.split('\\n')[0]||'').trim();
  var __looksLikeHeading = /:$/.test(__rawFirstLine) || /^(в\\s*наявност|наявніст|кольор|розмір|ціна\\b|акці)/i.test(__rawFirstLine) || __rawFirstLine.length < 4;
  var __customerName=(!__looksLikeHeading && __rawFirstLine) || found.name || 'Товар';`;

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    if (!nLookup) { console.log(name, 'ERROR: n_lookup not found'); return; }

    const done = nLookup.data.code.includes('__looksLikeHeading');
    if (done) { console.log(name, 'ALREADY_APPLIED'); return; }

    if (name === 'covercar' && !nLookup.data.code.includes(CC_OLD)) {
        console.log(name, 'WARNING: анкор CC_OLD не знайдено — лишаю без змін, перевір вручну.');
        return;
    }

    console.log(name, 'буде додано heading-fallback для customerName.');
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id !== 'n_lookup') return n;
        if (name === 'goverla') return { ...n, data: { ...n.data, code: NEW_LOOKUP_CODE_GOVERLA } };
        return { ...n, data: { ...n.data, code: n.data.code.split(CC_OLD).join(CC_NEW) } };
    });
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto',
        'return (async function(){"use strict";\n' + NEW_LOOKUP_CODE_GOVERLA + '\n})();');
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
