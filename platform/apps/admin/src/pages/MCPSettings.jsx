import React, { useState } from 'react';

export default function MCPSettings() {
    const [copied, setCopied] = useState(null);

    const token = '120ea687b37a1527768c78b45c0885ea74563469bfb17bfdfbc308de6bc28f8a';
    const endpoints = [
        {
            id: 'flows',
            name: 'Flows MCP',
            description: 'Manage funnels, nodes, edges, connectors, and performance metrics',
            url: `https://flows.fineko.space/api/mcp?token=${token}`,
            tools: 15,
            toolsDesc: 'Funnel management, connectors, node stats, API logs',
        },
        {
            id: 'debug',
            name: 'Debug MCP',
            description: 'Session debugging, error logs, and test sessions',
            url: `https://flows.fineko.space/api/mcp-debug?token=${token}`,
            tools: 10,
            toolsDesc: 'Session logs, errors, test sessions, message history',
        },
    ];

    const handleCopy = (url, id) => {
        navigator.clipboard.writeText(url);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-12">
                    <h1 className="text-4xl font-bold text-gray-900 mb-2">MCP Servers</h1>
                    <p className="text-lg text-gray-600">
                        Connect Claude.ai to FINEKO flows platform via Model Context Protocol
                    </p>
                </div>

                {/* Endpoints Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
                    {endpoints.map((endpoint) => (
                        <div
                            key={endpoint.id}
                            className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-6"
                        >
                            {/* Title */}
                            <h2 className="text-2xl font-bold text-gray-900 mb-2">
                                {endpoint.name}
                            </h2>
                            <p className="text-gray-600 mb-4">{endpoint.description}</p>

                            {/* Tools Badge */}
                            <div className="mb-4 flex items-center gap-2">
                                <span className="inline-block bg-indigo-100 text-indigo-800 text-sm font-semibold px-3 py-1 rounded-full">
                                    {endpoint.tools} tools
                                </span>
                                <span className="text-sm text-gray-500">{endpoint.toolsDesc}</span>
                            </div>

                            {/* URL Box */}
                            <div className="bg-gray-50 rounded border border-gray-200 p-3 mb-4">
                                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">MCP URL</p>
                                <div className="flex gap-2 items-center">
                                    <code className="flex-1 text-xs break-all text-gray-700 font-mono">
                                        {endpoint.url}
                                    </code>
                                    <button
                                        onClick={() => handleCopy(endpoint.url, endpoint.id)}
                                        className={`px-3 py-1 rounded text-sm font-medium transition-all whitespace-nowrap ${
                                            copied === endpoint.id
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                                        }`}
                                    >
                                        {copied === endpoint.id ? '✓ Copied' : 'Copy'}
                                    </button>
                                </div>
                            </div>

                            {/* Instructions */}
                            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
                                <p className="text-blue-900 font-semibold mb-1">📌 How to connect:</p>
                                <ol className="text-blue-800 space-y-1 ml-4 list-decimal">
                                    <li>Open Claude.ai</li>
                                    <li>Go to Settings → MCP Servers</li>
                                    <li>Click "Add MCP Server"</li>
                                    <li>Paste the URL above</li>
                                </ol>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Combined Preview */}
                <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 p-8">
                    <h3 className="text-xl font-bold text-gray-900 mb-4">📋 All Available Tools</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Flows */}
                        <div>
                            <h4 className="font-semibold text-indigo-900 mb-3">Flows MCP (15 tools)</h4>
                            <ul className="space-y-1 text-sm text-gray-700">
                                <li>✓ list_funnels — List all bots</li>
                                <li>✓ get_funnel — Get funnel definition</li>
                                <li>✓ update_node — Modify node data</li>
                                <li>✓ add_node — Add node to canvas</li>
                                <li>✓ delete_node — Remove node</li>
                                <li>✓ create_edge — Connect nodes</li>
                                <li>✓ update_funnel_key — Manage environment variables</li>
                                <li>✓ delete_funnel_key — Remove key</li>
                                <li>✓ list_connectors — List connector definitions</li>
                                <li>✓ get_connector — Get connector details</li>
                                <li>✓ create_connector — Create new connector</li>
                                <li>✓ update_connector — Modify connector</li>
                                <li>✓ delete_connector — Remove connector</li>
                                <li>✓ get_node_stats — Node performance metrics</li>
                                <li>✓ get_api_logs — API call history</li>
                            </ul>
                        </div>

                        {/* Debug */}
                        <div>
                            <h4 className="font-semibold text-purple-900 mb-3">Debug MCP (10 tools)</h4>
                            <ul className="space-y-1 text-sm text-gray-700">
                                <li>✓ get_session_logs — List recent sessions</li>
                                <li>✓ get_session — Get session details</li>
                                <li>✓ get_session_messages — Message history</li>
                                <li>✓ get_session_api_calls — API calls in session</li>
                                <li>✓ get_session_context — Saved context variables</li>
                                <li>✓ get_errors — Error log with stack traces</li>
                                <li>✓ start_test_session — Start simulated session</li>
                                <li>✓ send_test_message — Send message to test</li>
                                <li>✓ get_test_session_state — Test session state</li>
                                <li>✓ end_test_session — Finish test session</li>
                            </ul>
                        </div>
                    </div>

                    <p className="text-xs text-gray-600 mt-6 pt-6 border-t border-indigo-200">
                        ℹ️ <strong>Why split into two servers?</strong> Claude.ai tool_search has a limit of ~12 tools per MCP server. By splitting into flows (management) and debug (diagnostics), all 25 tools are now discoverable.
                    </p>
                </div>

                {/* Footer */}
                <div className="mt-12 pt-8 border-t border-gray-200">
                    <p className="text-sm text-gray-600 text-center">
                        MCP Servers v2.0 • Last updated: {new Date().toLocaleDateString()}
                    </p>
                </div>
            </div>
        </div>
    );
}
