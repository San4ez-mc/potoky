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

const { TOOLS: FLOWS_TOOLS, callTool: flowsCallTool, safeJsonStringify, disconnect } = require('./tools-flows');
const { TOOLS: DEBUG_TOOLS, callTool: debugCallTool } = require('./tools-debug');

// Combine both flows and debug tools for backward compatibility
const TOOLS = [...FLOWS_TOOLS, ...DEBUG_TOOLS];

const flowsToolNames = ['list_funnels', 'get_funnel', 'new_bot', 'create_funnel', 'update_node', 'add_node', 'delete_node', 'create_edge',
    'update_funnel_key', 'delete_funnel_key', 'list_connectors', 'get_connector',
    'create_connector', 'update_connector', 'delete_connector', 'get_node_stats', 'get_api_logs'];

async function callTool(name, args = {}) {
    if (flowsToolNames.includes(name)) return flowsCallTool(name, args);
    return debugCallTool(name, args);
}

module.exports = { TOOLS, callTool, disconnect, safeJsonStringify };
