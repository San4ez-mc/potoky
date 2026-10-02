'use strict';
// Patch (джерело істини): воронка «KIRO: дайджест подій» мала ЗАХАРДКОДЖЕНИЙ статус додатка в промпті
// («ЗАРАЗ на перевірці в Google Play, перших 15 тестувальників») — після оновлення фактів у content2
// дайджест далі писав би застаріле. Тепер статус береться з блоку АКТУАЛЬНІ ФАКТИ (content2 get_rules
// з withFacts=1), промпт містить лише правило, як ним користуватись.
// Зміни: (1) URL ноди з правилами → &withFacts=1; (2) JS «Відбір подій» віддає context.factsText;
// (3) промпт «Написати пост» — {{context.factsText}} замість жорсткого тексту.
// Idempotent. Run on the server:  node scripts/patch-kiro-digest-dated-facts-2026-10-02.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const BOT_ID = '49309e59-a64d-4f02-bd82-8d6c4ca4dd8b';
const PICK = 'node_1790887860199';
const WRITE = 'node_1790887860206';

async function main() {
    const f = await callTool('get_funnel', { botId: BOT_ID });
    const node = (id) => f.nodes.find((x) => x.id === id);

    // 1) нода з правилами (httpRequest на get_rules)
    const rulesNode = f.nodes.find((n) => n.type === 'httpRequest' && String(n.data && n.data.url).includes('action=get_rules'));
    if (!rulesNode) throw new Error('нода get_rules не знайдена');
    if (String(rulesNode.data.url).includes('withFacts=1')) console.log('rules url: already patched');
    else {
        await callTool('update_node', { botId: BOT_ID, nodeId: rulesNode.id, data: { url: rulesNode.data.url + '&withFacts=1' } });
        console.log('rules url: + withFacts=1');
    }

    // 2) відбір подій: читає rp.facts
    {
        let code = String(node(PICK).data.code);
        if (code.includes('factsText')) console.log('pick: already patched');
        else {
            const a = "try { var rp = typeof context.rulesRaw === 'string' ? JSON.parse(context.rulesRaw) : context.rulesRaw; rulesText = (rp && rp.rules) || ''; } catch(e) {}";
            const b = '  rulesCleanText: rulesText.slice(0, 1500),';
            if (!code.includes(a) || !code.includes(b)) throw new Error('pick: маркери не знайдено');
            code = code.replace(a, "var factsText = '';\n" + a.replace("rulesText = (rp && rp.rules) || '';", "rulesText = (rp && rp.rules) || ''; factsText = (rp && rp.facts) || '';"))
                .replace(b, b + '\n  factsText: factsText.slice(0, 2500),');
            new Function('context', code);
            await callTool('update_node', { botId: BOT_ID, nodeId: PICK, data: { code } });
            console.log('pick: patched (context.factsText)');
        }
    }

    // 3) промпт
    {
        const sp = String(node(WRITE).data.systemPrompt);
        if (sp.includes('{{context.factsText}}')) { console.log('write prompt: already patched'); return; }
        const i = sp.indexOf('ВАЖЛИВО: додаток KIRO ЗАРАЗ');
        if (i < 0) throw new Error('write: рядок ВАЖЛИВО не знайдено');
        const j = sp.indexOf('\n', i);
        const neu =
            'АКТУАЛЬНИЙ СТАН ДОДАТКА (єдина правда; усе, що тут не сказано, про стан додатка не стверджуй):\n{{context.factsText}}\n' +
            'Якщо за цим станом додаток ще не доступний для публічного завантаження — НЕ пиши «скачай» і не давай посилань на стор; CTA — за актуальним станом (напр. запрошення долучитись до тестування). Коли стане доступним усім — тоді й тільки тоді можна кликати завантажувати. Не вигадуй чисел і дат, яких немає в блоці.';
        await callTool('update_node', { botId: BOT_ID, nodeId: WRITE, data: { systemPrompt: sp.slice(0, i) + neu + sp.slice(j) } });
        console.log('write prompt: patched (жорсткий статус → блок фактів)');
    }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
