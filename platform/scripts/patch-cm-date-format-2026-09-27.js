'use strict';
// Patch (source of truth): дати, які бачить клієнт у чаті Content Manager,
// переводимо з ISO (YYYY-MM-DD) у звичний формат DD.MM.YY (напр. 27.09.26).
// Внутрішні дати для LLM (batchProgressText, breakdownInline) лишаються ISO —
// їх читає модель, а не людина, і ISO там однозначніший.
// Idempotent. Run on the server:  node scripts/patch-cm-date-format-2026-09-27.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const CM = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const MARK = 'function toUkDate(';

async function main() {
    const f = await callTool('get_funnel', { botId: CM });

    // 1) Parse Intent — confirmLines (текст підтвердження клієнту)
    const parseIntent = f.nodes.find((x) => x.id === 'node_1780590874133');
    let piCode = String(parseIntent.data.code);
    if (piCode.includes(MARK)) {
        console.log('Parse Intent: already patched');
    } else {
        piCode = piCode.replace(
            "var raw = context.intentRaw;",
            "var raw = context.intentRaw;\n" +
            "function toUkDate(iso){ var m=String(iso||'').match(/^(\\d{4})-(\\d{2})-(\\d{2})/); return m?(m[3]+'.'+m[2]+'.'+m[1].slice(2)):String(iso||''); }"
        );
        const before = piCode;
        piCode = piCode
            .split("confirmLines.push('• '+c2+'× '+label+' на '+dk2+(topic?(' — тема: '+topic):''));")
            .join("confirmLines.push('• '+c2+'× '+label+' на '+toUkDate(dk2)+(topic?(' — тема: '+topic):''));");
        piCode = piCode
            .split("confirmLines.push('• '+cnt+'× '+label+' на '+dISO+(topic?(' — тема: '+topic):''));")
            .join("confirmLines.push('• '+cnt+'× '+label+' на '+toUkDate(dISO)+(topic?(' — тема: '+topic):''));");
        piCode = piCode
            .split("confirmLines.push('• '+r.count+'× '+(FMT[r.format]||r.format)+' на '+r.date);")
            .join("confirmLines.push('• '+r.count+'× '+(FMT[r.format]||r.format)+' на '+toUkDate(r.date));");
        if (piCode === before) throw new Error('Parse Intent: жоден confirmLines.push не знайдено — код змінився, патч треба оновити вручну');
        await callTool('update_node', { botId: CM, nodeId: 'node_1780590874133', data: { code: piCode } });
        console.log('Parse Intent: patched');
    }

    // 2) ST: Chat text (з номерами) — дата в списку постів, що йде клієнту
    const chatText = f.nodes.find((x) => x.id === 'node_1781269102711');
    let ctCode = String(chatText.data.code);
    if (ctCode.includes(MARK)) {
        console.log('ST: Chat text: already patched');
    } else {
        const before = ctCode;
        ctCode = ctCode.replace(
            "var audienceEmoji = {cold:'🔴',warm1:'🟠',warm2:'🟡',hot1:'🟢',hot2:'🔵'};",
            "var audienceEmoji = {cold:'🔴',warm1:'🟠',warm2:'🟡',hot1:'🟢',hot2:'🔵'};\n" +
            "function toUkDate(iso){ var m=String(iso||'').match(/^(\\d{4})-(\\d{2})-(\\d{2})/); return m?(m[3]+'.'+m[2]+'.'+m[1].slice(2)):String(iso||''); }"
        );
        ctCode = ctCode
            .split("lines.push(num + '📅 ' + p.date + ' · '")
            .join("lines.push(num + '📅 ' + toUkDate(p.date) + ' · '");
        if (ctCode === before) throw new Error('ST: Chat text: маркер не знайдено — код змінився, патч треба оновити вручну');
        await callTool('update_node', { botId: CM, nodeId: 'node_1781269102711', data: { code: ctCode } });
        console.log('ST: Chat text: patched');
    }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
