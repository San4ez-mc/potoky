# FINEKO Bug Report v4
_Дата: 13.05.2026 | Правки після останнього "зміни внесені"_

---

## BUG-004 (оновлено) — `create_funnel` є в коді але недосяжний через MCP

**Статус:** ✅ Вирішено (інструмент перейменовано на `new_bot`, legacy alias збережено)  
**Пріоритет:** P1

**Підтверджено по вихідному коду `tools-flows.js`:**

Реалізація **є і правильна**:
- `create_funnel` присутній в масиві `TOOLS[]` з повним `inputSchema`
- `case 'create_funnel': return createFunnel(args)` є в `callTool()` switch
- Функція `createFunnel()` реалізована коректно — `prisma.$transaction`, створює `Bot` + `FlowDefinition`, повертає `{ created, bot, flow }`

Проблема **виключно в MCP інтеграції Claude.ai** — `tool_search` використовує векторні embeddings і повертає максимум 20 результатів. `create_funnel` стабільно витісняється іншими інструментами FINEKO flows з схожими словами в описах.

**Перевірено вичерпно — жоден запит не підтягує `create_funnel`:**
| Запит | Результат |
|---|---|
| `"create funnel"` | Не підтягує |
| `"create funnel new bot project slug"` | Не підтягує |
| `"create_funnel register new funnel projectSlug"` | Не підтягує |
| Прямий виклик без `tool_search` | `Tool 'FINEKO flows:create_funnel' not found` |

**Причина:** назва `create_funnel` семантично конкурує з `create_edge`, `create_connector`, `list_funnels`, `get_funnel` — і програє за векторним рейтингом.

**Рішення — перейменувати інструмент** на щось унікальне без семантичного перетину:

```javascript
// tools-flows.js — змінити в TOOLS[]:
{
  name: 'new_bot',  // було: 'create_funnel'
  description: 'Instantiates a new bot record with an empty FlowDefinition in PostgreSQL for the finance-course project',
  inputSchema: { ... }  // без змін
}

// і в callTool() switch:
case 'new_bot': return createFunnel(args);  // було: case 'create_funnel'
```

Функцію `createFunnel()` — не чіпати, вона правильна.

**Зроблено (13.05.2026):**
- `TOOLS[]`: `name: "new_bot"` з унікальним description
- `callTool()`: `case "new_bot": return createFunnel(args)`
- Для сумісності залишено alias: `case "create_funnel": return createFunnel(args)`
- В `tools.js` додано `new_bot` у `flowsToolNames`

---

## BUG-005 — `tool_search` витісняє інструменти при 16+ tools в одному MCP сервері

**Статус:** ⚠️ Системне обмеження Claude.ai — не фіксується на стороні сервера  
**Пріоритет:** P2 (враховувати при додаванні нових інструментів)

**Спостереження:**
- При підключенні FINEKO flows (16 інструментів) `tool_search` ніколи не повертає всі 16 одночасно
- Інструменти з унікальними назвами (`update_node`, `add_node`, `get_node_stats`) підтягуються надійно
- Інструменти з назвами що семантично перетинаються (`create_funnel` vs `create_edge` vs `create_connector`) конкурують і частина завжди витісняється

**Рекомендація для нових інструментів:**
- Давати унікальні назви без спільного префікса з іншими (`new_bot` замість `create_funnel`)
- В `description` використовувати технічні терміни специфічні для інструменту (`FlowDefinition`, `PostgreSQL`, `projectSlug`) — це підвищує унікальність вектора
- Уникати загальних слів (`create`, `get`, `list`, `update`) як єдиного розрізнювача між інструментами

