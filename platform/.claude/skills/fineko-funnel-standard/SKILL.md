---
name: fineko-funnel-standard
description: Загальний стандарт створення й редагування воронок FINEKO flows (БУДЬ-ЯКИЙ проєкт — продажі, онбординг, RAG тощо, окрім специфіки фінансового курсу). Використовуй ЗАВЖДИ коли будуєш/редагуєш/тестуєш воронку, що не є частиною курсу «Фінансова система». Для курсу — окремий skill funnel-writing-fineko.
---

# FINEKO Flows — загальний стандарт воронок

> Це **загальний стандарт** для всіх воронок платформи. Специфіка фінансового курсу
> (структура уроків, файли між ботами, тон курсу) — в окремому skill `funnel-writing-fineko`.
> Тут — залізні правила архітектури + граматика нод + тестування, спільні для всіх воронок.
> Читай разом із `platform/CLAUDE.md` (інфраструктура, уроки з помилок).

---

## 0. Шість залізних правил (порушувати не можна)

### Правило 1 — весь функціонал у нодах, редаговано з канваса
Усе, що робить воронка, має бути **в нодах flow-визначення** й **редагуватися/відтворюватися з фронтенду** (канвас). Заборонено «частина в ноді, частина захардкоджена у файлі/скрипті». Виняток — лише **внутрішня реалізація типу ноди** в `testSession.js` (це двигун, не конфіг воронки). Якщо ти поклав логіку/тексти/умови в окремий js-файл замість ноди — це помилка.

### Правило 2 — ключі тільки у ключах воронки, перевага збереженим конекторам
- **Жодних ключів у `.env`** (env — лише системне: `PORT`, `DATABASE_URL`, `MCP_SECRET`).
- Перевага — **збережені конектори** (instance UUID зі списку `list_connectors`). У ноду вставляй `connectorId: "<instance-uuid>"`, а не сирий ключ.
- Сирий ключ у `funnelKey` ноди/воронки — **лише як виняток**, якщо ключ використовується в ОДНІЙ воронці й ніде більше.
- **Мета:** заміна ключа = один раз у збережених конекторах, а не в кожній воронці.
- `TELEGRAM_CONNECTOR_ID` — виняток: лишається per-bot funnelKey (у кожного бота свій токен).

### Правило 3 — нема ноди для функції → додай ноду в код + на фронт (не білий квадрат)
Якщо потрібного функціоналу нема серед нод — можна додати **новий тип ноди**, але ОБОВ'ЯЗКОВО у **всіх трьох місцях одночасно** (див. `CLAUDE.md §4`):
1. **Двигун:** обробник у `apps/api/src/services/testSession.js` (`if (node.type === '...')`).
2. **MCP:** тип у `NODE_TYPES` в `apps/mcp/src/tools-flows.js`.
3. **Фронт-палітра:** `apps/admin/src/components/funnel/NodeTypes.jsx` — і в мапу компонентів (щоб рендерився, **не білим квадратом**), і в `NODE_PALETTE` з `icon`, `label`, `color`, `description`, `defaultData`.
Продумай вигляд ноди на канвасі (іконка + що показує) — не лишай дефолтний порожній рендер.

### Правило 4 — заповнити ОБИДВА описи воронки
При створенні бота заповнюй:
- `description` — **людський** опис (що воронка робить, для кого).
- `goal` — **для AI/системи** (ціль воронки одним рядком, як її розуміє агент).
Обидва обов'язкові. Порожній опис = воронка не готова.

### Правило 5 — кожна нода у відловлювачі помилок + логування API
- Кожен обробник ноди в двигуні має бути в `try/catch` — падіння однієї ноди **не валить сесію** (лог помилки + людяне повідомлення, не сирий stack у чат користувача).
- **Усі зовнішні API-виклики** (Claude, Vertex, HTTP, Telegram, платежі) логувати в `api_calls` (`db.apiCall.create`): запит, відповідь, статус, тривалість, помилка. Це видно в **Сесії → вкладка API**. Якщо додаєш ноду з зовнішнім викликом — додай і логування.

### Правило 6 — після створення обов'язково тест-прогін
- **Telegram-воронка:** `/start <slug>` реальному боту АБО тест-сесія через UI («Тест»), АБО POST на вебхук `POST /webhook/telegram/:botId`.
- **Пост/webhook-воронка:** реальний `POST`-запит на її endpoint.
- Перевір: повідомлення йдуть, кнопки показуються, claude-нода відпрацьовує, `notifyAdmin` доходить, **немає помилок у `pm2 logs platform-api --lines 50`**, вкладка API показує виклики.
- Воронка без успішного тест-прогону = не готова.

---

## 1. Граматика нод (перевірено на `bot-karta-sales`, `bot-sales-spin`, воронках продажу)

- **start** — `{ label, trigger: "/start <slug>" }`. Роутинг кількох воронок на одному боті — через `/start <slug>`.
- **message** — `{ text, label, buttons?: [[{text,url|callback_data}]], attachmentUrl?, attachmentFileName? }`. Інтерполяція: `{{env.KEY}}`, `{{context.var}}`, `{{user.firstName|telegramId|username}}`, `{{timestamp}}`.
- **claude** (діалог) — `{ mode:'dialog', model:'claude-sonnet-4-6'|'claude-haiku-4-5', connectorId:'{{env.CLAUDE_CONNECTOR_ID}}', systemPrompt, exitCondition:'json_output', outputVar:'context.X', messagesTemplate:'{{conversationHistory}}' }`. У `messagesTemplate` — ТІЛЬКИ прості рядки (об'єкти ламають JSON, урок §15.11). Бюджет системного промпту ≤3000 токенів.
- **claude** (одноразова генерація) — `{ mode:'single', exitCondition:'none', messagesTemplate:'<дані>', outputVar:'context.result' }` (json_output сховає текст — тому `'none'`).
- **condition** — `{ conditions:[{id,label,expression}] }`. **Порядок вихідних ребер від condition = порядок умов** у масиві. Вирази: `context.X.field === true`.
- **wait** — `{ unit:'hours', duration:24 }`.
- **notifyAdmin** — `{ message, targetKey:'ADMIN_TELEGRAM_ID' }`.
- **httpRequest** — `{ method, url, headers, body|bodyFields, outputVar, outputPath, ignoreErrors }`.
- **sendDocument** — `{ fileKey:'<ENV_KEY з file_id/URL>', caption }`.
- **connector** (WayForPay) — `{ action:'create_invoice', amount, currency, connectorId:'<uuid>', outputVar, orderReference }` + `wait_payment { timeoutHours }`.
- **fbEvent** — `{ eventName:'Lead'|'Purchase', value?, currency? }` (CAPI, ключі `FB_PIXEL_ID`+`FB_CAPI_TOKEN`, best-effort).

**Кожна нода має ОДИН вихідний ланцюжок** (або явне гілкування через `condition`) — паралельного fan-out нема (урок §15.8). `context` — лише root-рівень (§15.1).

---

## 2. Збережені конектори (використовуй instance UUID, не raw-ключ)

Перед вставкою — звір `list_connectors`. Актуальні (станом на CLAUDE.md §16):
Claude Sonnet `2ec53ba5-…`, Haiku `4a8000aa-…`, Opus `6a438f34-…`, Gemini `e94f5f54-…`, GPT-4 `54a9dabc-…`, **Vertex `ba9ef333-…`** (embeddings+Gemini, EU), Telegram Den `1cd281cb-…`, WayForPay `350490a6-…`.
Якщо потрібного нема — спитати власника й додати у `/connectors` (UI), не хардкодити.

---

## 3. Деплой воронки/ноди

Все через git (`CLAUDE.md §2, §13`): локально → `git push` → на сервері `git pull` → `pm2 restart platform-api platform-worker` (+`platform-mcp` якщо MCP змінився) + `yarn build:admin` якщо чіпав фронт. **Ніколи не редагувати файли на сервері.** Провіженинг воронок (build-скрипти на Prisma) — ок запускати на сервері, вони пишуть у БД, не в код.

---

## 4. Чекліст готовності воронки
- [ ] Весь функціонал у нодах (нічого захардкодженого поза двигуном).
- [ ] Ключі — збережені конектори / funnelKey, не env.
- [ ] Нові типи нод — у 3 місцях + нормальний рендер на канвасі.
- [ ] Заповнені `description` (людям) і `goal` (AI).
- [ ] Ноди в try/catch, зовнішні виклики логуються в api_calls.
- [ ] Тест-прогін пройдено (Telegram-вебхук / POST), pm2 logs чисті, вкладка API показує виклики.
