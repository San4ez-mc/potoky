# MCP Connector Setup (Claude Browser)

This project now includes an MCP HTTP endpoint for core entities:

- projects (read)
- social networks (create, edit, delete, list)
- categories (create, edit, delete, list)
- posts/content plan (create, edit, delete, list by date range)

Content-plan helpers (explicit tool names for Claude prompts):

- `add_content_plan`
- `update_content_plan`

## 1) Create secure MCP config

Create `config/mcp.php` from `config/mcp.php.example` and set a strong token.

Example:

```php
<?php
return [
    'token' => 'YOUR_LONG_RANDOM_TOKEN',
    'allowed_origins' => ['https://claude.ai'],
    'default_limit' => 200,
];
```

## 2) Expose endpoint

Endpoint URL:

- `https://YOUR_DOMAIN/mcp`

For local testing:

- `http://localhost:8000/mcp`

## 3) Add connector in Claude

In Claude MCP Connector, add an HTTP MCP server:

- URL: your `/mcp` URL with token in query, for example:
  - `https://YOUR_DOMAIN/mcp?token=YOUR_LONG_RANDOM_TOKEN`

If your connector UI supports custom header names, `X-MCP-Token` also works.

## 4) Quick connectivity test

Initialize:

```bash
curl -X POST "https://YOUR_DOMAIN/mcp" \
  -H "Content-Type: application/json" \
  \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2025-03-26",
      "capabilities":{},
      "clientInfo":{"name":"curl","version":"1.0"}
    }
  }'
```

Use URL token variant:

```bash
curl -X POST "https://YOUR_DOMAIN/mcp?token=YOUR_LONG_RANDOM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2025-03-26",
      "capabilities":{},
      "clientInfo":{"name":"curl","version":"1.0"}
    }
  }'
```

List tools:

```bash
curl -X POST "https://YOUR_DOMAIN/mcp?token=YOUR_LONG_RANDOM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

## Notes

- Keep MCP token secret.
- Endpoint uses JSON-RPC and MCP tool methods (`initialize`, `tools/list`, `tools/call`).
- If token is not configured, endpoint is open; do not expose it publicly without token.
