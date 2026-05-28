/**
 * fix-edges-all.js
 * Fixes flow edges for:
 *  1. content-ai-bg   — inserts vision-check nodes between slide-builder and callback
 *  2. content-manager — routes false branch through save_plan condition; adds loadFile before agent
 *  3. content-scheduler — replaces dummy start→msg_intro with real flow path
 *
 * Run: node fix-edges-all.js
 * Requires DATABASE_URL env var (loaded from /var/www/flows.fineko.space/.env)
 */

require('dotenv').config({ path: '/var/www/flows.fineko.space/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {

    // ──────────────────────────────────────────────────────────────────────────
    // 1. content-ai-bg (84992218-0c09-4985-a1fe-6f7f3bf35d99)
    //    slide-builder(node_1779737602247) → vision_check(node_1779939999953)
    //    vision_check → vision_cond(node_1779940055751)
    //    vision_cond[true] → callback(node_1779737614054)
    //    vision_cond[false] → fal.ai(node_1779737587717) [retry loop]
    // ──────────────────────────────────────────────────────────────────────────
    {
        const botId = '84992218-0c09-4985-a1fe-6f7f3bf35d99';
        const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
        const edges = flow.edges;

        // Patch: change slide-builder → callback to slide-builder → vision_check
        const patched = edges.map(e => {
            if (e.id === 'edge_1779737713547') {
                return { ...e, target: 'node_1779939999953' };
            }
            return e;
        });

        // Add new edges
        patched.push(
            { id: 'edge_vision_to_cond',    source: 'node_1779939999953', target: 'node_1779940055751' },
            { id: 'edge_vision_cond_ok',    source: 'node_1779940055751', target: 'node_1779737614054', sourceHandle: 'true' },
            { id: 'edge_vision_cond_retry', source: 'node_1779940055751', target: 'node_1779737587717', sourceHandle: 'false' },
        );

        await prisma.flowDefinition.update({ where: { botId }, data: { edges: patched } });
        console.log('✅ content-ai-bg edges updated');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. content-manager (bd48bae3-d35b-45f9-bcdd-3e74884b61bf)
    //    msg_intro → loadFile(node_1779940144463) [was → agent]
    //    loadFile  → agent(node_1779938202837)
    //    cond_gen[false] → save_plan_cond(node_1779940110787) [was → agent]
    //    save_plan_cond[true]  → saveFile(node_1779940124617)
    //    save_plan_cond[false] → agent [loop back]
    //    saveFile  → after_action(node_1779938284774)
    // ──────────────────────────────────────────────────────────────────────────
    {
        const botId = 'bd48bae3-d35b-45f9-bcdd-3e74884b61bf';
        const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
        const edges = flow.edges;

        const patched = edges.map(e => {
            // msg_intro → agent  →  msg_intro → loadFile
            if (e.id === 'edge_1779938307479') {
                return { ...e, target: 'node_1779940144463' };
            }
            // condition_gen[false] → agent  →  condition_gen[false] → save_plan_cond
            if (e.id === 'edge_1779938415738') {
                return { ...e, target: 'node_1779940110787' };
            }
            return e;
        });

        // New edges
        patched.push(
            // loadFile → main agent
            { id: 'edge_loadfile_to_agent',   source: 'node_1779940144463', target: 'node_1779938202837' },
            // save_plan_cond true/false
            { id: 'edge_save_plan_true',  source: 'node_1779940110787', target: 'node_1779940124617', sourceHandle: 'true' },
            { id: 'edge_save_plan_false', source: 'node_1779940110787', target: 'node_1779938202837', sourceHandle: 'false' },
            // saveFile → after_action
            { id: 'edge_savefile_to_after', source: 'node_1779940124617', target: 'node_1779938284774' },
        );

        await prisma.flowDefinition.update({ where: { botId }, data: { edges: patched } });
        console.log('✅ content-manager edges updated');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3. content-scheduler (0283616c-45e7-43c1-a699-d2dab43f3534)
    //    start_1 → loadFile(node_1779940211161) [was → msg_intro]
    //    loadFile → findDueJS(node_1779940231106)
    //    findDueJS → hasDueCond(node_1779940246873)
    //    hasDueCond[true]  → sendHttp(node_1779940265225)
    //    sendHttp → markSentJS(node_1779940281870)
    //    markSentJS → saveFile(node_1779940304106)
    //    hasDueCond[false] → (no edge, flow ends)
    // ──────────────────────────────────────────────────────────────────────────
    {
        const botId = '0283616c-45e7-43c1-a699-d2dab43f3534';
        const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
        const edges = flow.edges;

        const patched = edges.map(e => {
            // start → msg_intro  →  start → loadFile
            if (e.id === 'e_start_intro') {
                return { ...e, target: 'node_1779940211161' };
            }
            return e;
        });

        patched.push(
            { id: 'edge_sch_load_to_find',   source: 'node_1779940211161', target: 'node_1779940231106' },
            { id: 'edge_sch_find_to_cond',   source: 'node_1779940231106', target: 'node_1779940246873' },
            { id: 'edge_sch_cond_true',      source: 'node_1779940246873', target: 'node_1779940265225', sourceHandle: 'true' },
            { id: 'edge_sch_send_to_mark',   source: 'node_1779940265225', target: 'node_1779940281870' },
            { id: 'edge_sch_mark_to_save',   source: 'node_1779940281870', target: 'node_1779940304106' },
        );

        await prisma.flowDefinition.update({ where: { botId }, data: { edges: patched } });
        console.log('✅ content-scheduler edges updated');
    }

    console.log('\n🎉 All edge fixes applied successfully!');
}

main()
    .catch(err => { console.error('❌ Error:', err.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
