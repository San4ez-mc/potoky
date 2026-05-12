/**
 * Setup script to add loadFile nodes to bots and fix edges
 * Run with: cd /var/www/flows.fineko.space && node setup_loadfile_nodes.js
 * 
 * This script:
 * 1. Adds loadFile nodes between start and message intro for specified bots
 * 2. Fixes Bot 2.1 edge routing: claude_main → save_result → pl_articles → msg_done
 */

const { PrismaClient } = require('./platform/packages/db/dist');
const prisma = new PrismaClient();

const FILE_TYPE_TO_CONTEXT_VAR = {
    'cashflow_articles': 'cashflowArticles',
    'pl_articles': 'plArticles',
    'business_process': 'businessProcess',
    'business_process_v2': 'businessProcessV2',
    'cashflow_table_url': 'sheetsUrl',
    'combined_table_url': 'combinedUrl',
    'financial_mechanics': 'financialMechanics',
    'salary_processes': 'salaryProcesses',
    'payment_processes': 'paymentProcesses',
    'balance_articles': 'balanceArticles',
    'balance_table_url': 'balanceUrl',
    'payment_calendar_url': 'calendarUrl',
    'team_instructions': 'teamInstructions',
};

async function fixBot21EdgeRouting() {
    console.log('\n🔧 Fixing Bot 2.1 edge routing...');
    try {
        const bot21 = await prisma.bot.findUnique({
            where: { slug: 'bot-2-1-articles' },
        });
        if (!bot21) {
            console.log('  ⚠️  Bot 2.1 not found');
            return;
        }

        const flow = await prisma.flowDefinition.findUnique({
            where: { botId: bot21.id },
        });
        if (!flow) {
            console.log('  ⚠️  Bot 2.1 flow not found');
            return;
        }

        // Backup current edges for display
        const originalEdges = [...(flow.edges || [])];

        // Find the nodes
        const claudeMainNode = flow.nodes.find(n => n.id === 'claude_main');
        const saveResultNode = flow.nodes.find(n => n.id === 'save_result');
        const plArticlesNode = flow.nodes.find(n => n.id === 'node_1778531261129');
        const msgDoneNode = flow.nodes.find(n => n.id === 'msg_done');

        if (!claudeMainNode || !saveResultNode || !plArticlesNode || !msgDoneNode) {
            console.log('  ⚠️  Could not find required nodes:');
            if (!claudeMainNode) console.log('    - claude_main not found');
            if (!saveResultNode) console.log('    - save_result not found');
            if (!plArticlesNode) console.log('    - node_1778531261129 not found');
            if (!msgDoneNode) console.log('    - msg_done not found');
            return;
        }

        // Remove old incorrect edges
        flow.edges = flow.edges.filter(e => {
            return !(
                (e.source === 'claude_main' && e.target === 'msg_done') ||
                (e.source === 'save_result' && e.target === 'msg_done')
            );
        });

        // Add correct routing
        flow.edges.push(
            {
                id: `edge_${Date.now()}_1`,
                source: 'claude_main',
                target: 'save_result',
                label: '✅ Fixed'
            },
            {
                id: `edge_${Date.now()}_2`,
                source: 'save_result',
                target: 'node_1778531261129',
                label: '✅ Fixed'
            },
            {
                id: `edge_${Date.now()}_3`,
                source: 'node_1778531261129',
                target: 'msg_done',
                label: '✅ Fixed'
            }
        );

        await prisma.flowDefinition.update({
            where: { botId: bot21.id },
            data: {
                edges: flow.edges,
                updatedAt: new Date(),
            },
        });

        console.log('  ✅ Edge routing fixed!');
        console.log('     claude_main → save_result → node_1778531261129 → msg_done');
    } catch (err) {
        console.error('  ❌ Error fixing Bot 2.1:', err.message);
    }
}

async function main() {
    console.log('🚀 Fixing Bot 2.1 edge routing and preparing loadFile node setup...\n');

    // Fix Bot 2.1 edge routing
    await fixBot21EdgeRouting();

    console.log('\n✨ Setup complete!');
    console.log('📝 To add loadFile nodes to other bots, use Claude MCP with add_node tool.');
    console.log('   Example: add_node(botId, "loadFile", { fileType: "cashflow_articles", onMissing: "skip" }, { x: 200, y: 200 })');

    await prisma.$disconnect();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
