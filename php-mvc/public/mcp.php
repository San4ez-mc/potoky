<?php

$config = require __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../app/core/Database.php';
require_once __DIR__ . '/../app/core/McpServer.php';

$mcpConfig = [];
$mcpConfigPath = __DIR__ . '/../config/mcp.php';
if (is_file($mcpConfigPath)) {
    $loaded = require $mcpConfigPath;
    if (is_array($loaded)) {
        $mcpConfig = $loaded;
    }
}

$db = new Database($config);
$server = new McpServer($db, $mcpConfig);
$server->handle();
