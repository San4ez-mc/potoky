# Підключення MCP до Claude Desktop

Щоб Claude міг редагувати воронки прямо з чату, додайте MCP сервер у конфіг Claude Desktop.

## Конфігурація Claude Desktop

Відкрийте файл конфігурації:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Додайте:

```json
{
  "mcpServers": {
    "platform-funnel": {
      "command": "node",
      "args": ["D:/програмування/система для воронок/platform/apps/mcp/src/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost:5432/platform"
      }
    }
  }
}
```

> **Примітка**: Вкажіть правильний `DATABASE_URL` з вашого `.env`.

## Доступні команди для Клода

Після підключення Claude може:

```
Покажи всі воронки → list_funnels
Відкрий воронку бота → get_funnel(botId: "...")
Онови системний промпт ноди → update_node(botId, nodeId, {systemPrompt: "..."})
Додай нову ноду → add_node(botId, type: "message", data: {...}, position: {x:0,y:0})
Видали ноду → delete_node(botId, nodeId)
Додай ключ → update_funnel_key(botId, key: "TOKEN", value: "...", isSecret: true)
Видали ключ → delete_funnel_key(botId, key: "TOKEN")
```
