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
Створи зв'язок між нодами → create_edge(botId, source, target)
Додай ключ → update_funnel_key(botId, key: "TOKEN", value: "...", isSecret: true)
Видали ключ → delete_funnel_key(botId, key: "TOKEN")
Покажи логи сесій → get_session_logs(botId?, userId?, limit?)
Покажи одну сесію → get_session(sessionId)
Покажи повідомлення сесії → get_session_messages(sessionId)
Покажи API-виклики сесії → get_session_api_calls(sessionId)
Покажи контекст сесії → get_session_context(sessionId)
Покажи API логи платформи → get_api_logs(service?, limit?)
Покажи помилки → get_errors(botId?, resolved?, limit?)
Покажи статистику ноди → get_node_stats(botId, nodeId, period?)
Запусти тестову сесію → start_test_session(botId або botSlug, userId?)
Надішли повідомлення в тест-сесію → send_test_message(sessionId, message)
Отримай стан тест-сесії → get_test_session_state(sessionId)
Заверши тест-сесію → end_test_session(sessionId)
```
