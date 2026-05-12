'use strict';

/**
 * Combined tools export — includes both flows and debug tools
 * for backward compatibility with legacy /mcp endpoint.
 * 
 * New endpoints use specific imports:
 *  - /api/mcp → tools-flows.js (15 tools)
 *  - /api/mcp-debug → tools-debug.js (10 tools)
 * 
 * Legacy /mcp → tools.js (combined 25 tools)
 */

const { TOOLS: FLOWS_TOOLS, callTool: flowsCallTool, safeJsonStringify } = require('./tools-flows');
const { TOOLS: DEBUG_TOOLS, callTool: debugCallTool } = require('./tools-debug');

const PrismaClient = require('@prisma/client').PrismaClient;
const prisma = new PrismaClient();

function safeJsonStringify(value) {
    return JSON.stringify(value, (_, current) => (typeof current === 'bigint' ? current.toString() : current), 2);
}

// Combine both flows and debug tools for backward compatibility
const TOOLS = [...require('./tools-flows').TOOLS, ...DEBUG_TOOLS];

// Route to appropriate callTool function based on tool name
async function callTool(name, args = {}) {
    // Flows tools
    const flowsTools = ['list_funnels', 'get_funnel', 'update_node', 'add_node', 'delete_node', 'create_edge', 
                        'update_funnel_key', 'delete_funnel_key', 'list_connectors', 'get_connector', 
                        'create_connector', 'update_connector', 'delete_connector', 'get_node_stats', 'get_api_logs'];
    
    if (flowsTools.includes(name)) {
        return require('./tools-flows').callTool(name, args);
    }
    
    // Debug tools
    return debugCallTool(name, args);
}

async function disconnect() {
    await prisma.$disconnect();
}

module.exports = { TOOLS, callTool, disconnect, safeJsonStringify };
