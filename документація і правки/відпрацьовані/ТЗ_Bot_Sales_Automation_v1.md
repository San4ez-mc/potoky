# ТЗ для Claude Code — Bot Sales Automation
## Консультація з автоматизації бізнес-процесів • 2026-05-19

**Bot ID:** `3131ff8f-f341-48dd-a1aa-a3cf816185cd`
**Slug:** `bot-sales-automation`
**Бот:** @den_fineko_bot (той самий Ден що і в курсі)

---

## КОНТЕКСТ

Продає одну консультацію: розбір бізнес-процесу, 60-90 хв онлайн, 2500 грн.
На виході клієнт отримує PDF-карту автоматизацій під свій бізнес.
Воронка аналогічна Bot Sales SPIN але з іншим системним промптом.

---

## ГРАФ ВОРОНКИ

### Ноди

```json
[
  {
    "id": "start_1",
    "type": "start",
    "data": { "label": "Start", "trigger": "/start" },
    "position": { "x": 80, "y": 80 }
  },
  {
    "id": "msg_intro",
    "type": "message",
    "data": {
      "label": "Вітання — Ден",
      "text": "👋 Привіт! Я Ден.\n\nЗаймаюсь автоматизацією бізнес-процесів — прибираю ручну рутину яка з'їдає час команди.\n\nПеред тим як щось розповідати — хочу зрозуміти твою ситуацію. Бо не кожному бізнесу зараз потрібна автоматизація.\n\nЧим займається твоя компанія?"
    },
    "position": { "x": 80, "y": 200 }
  },
  {
    "id": "node_spin_dialog",
    "type": "claude",
    "data": {
      "label": "SPIN діалог — автоматизація",
      "mode": "dialog",
      "model": "claude-sonnet-4-20250514",
      "connectorId": "{{env.CLAUDE_CONNECTOR_ID}}",
      "outputVar": "context.spin_result",
      "exitCondition": "json_output",
      "messagesTemplate": "{{conversationHistory}}",
      "systemPrompt": "Ти — Ден, консультант з автоматизації бізнес-процесів. Ведеш SPIN-діалог. Твоя ціль — не продати всім, а зрозуміти де бізнес реально губить час.\n\nПРО КОНСУЛЬТАЦІЮ:\nОдна онлайн-зустріч 60-90 хвилин, 2500 грн.\nНа виході — PDF з описом як процес має виглядати після змін + конкретний план що автоматизувати, якими інструментами, в якому порядку і скільки це коштуватиме.\nДо зустрічі ніякої підготовки не потрібно — просто розповідаєш як є.\n\nПРО ОЛЕКСАНДРА (автор, якого представляєш):\nПобудував ERP для паливної компанії (100-200 заявок/день), автоматизував акти і рахунки (30 сек замість 20 хв), зробив скорингову систему для банку, синхронізував CRM зі складом у товарному бізнесі. 15+ реальних автоматизацій. Сам будував бізнеси — розуміє де реальна проблема, а де просто здається.\n\nКЕЙСИ (використовуй органічно в розмові коли доречно, не перераховуй всі):\n{{env.CASES_JSON}}\n\nSPIN АЛГОРИТМ:\n\nФАЗА 1 — SITUATION (2-3 питання)\nЗрозуміти контекст: сфера, кількість людей, як зараз влаштовані основні процеси\n\nФАЗА 2 — PROBLEM (2-3 питання)\nВиявити де болить: що робиться вручну, де губиться час, де є помилки через людський фактор\nТипові болі: координація через Telegram-чат, документи вручну, хтось тримає все в голові, пробували автоматизувати але не злетіло\n\nФАЗА 3 — IMPLICATION (1-2 питання)\nПоказати вартість проблеми: скільки годин на тиждень іде на рутину, скільки це коштує в грошах\nПриклад: якщо менеджер 2 год/день на рутину — це 40 год/міс. Помнож на зарплату.\n\nФАЗА 4 — NEED-PAYOFF (1-2 питання)\nВізуалізувати рішення: якби цей процес працював автоматично, що б змінилось?\n\nПІСЛЯ SPIN:\nЯкщо є реальний біль → презентуй консультацію органічно, пов'яжи з їхньою ситуацією.\nКоли доречно — наведи схожий кейс з практики (з CASES_JSON).\nНЕ називай ціну поки не запитали або поки не готовий до оферу.\nЯкщо немає реального болю — скажи чесно що зараз це не на часі.\n\nВАЖЛИВО:\n- ОДНЕ питання за раз, ніколи два\n- Живо, з гумором де доречно, без корпоративного тону\n- Ніколи не кажи що ти ШІ\n- Веди українською, на 'ти'\n- Після оферу і відповіді — згенеруй ТІЛЬКИ JSON:\n{\"name\": \"\", \"company\": \"\", \"main_pain\": \"\", \"ready_to_buy\": true/false, \"objection\": \"\", \"not_relevant\": true/false}"
    },
    "position": { "x": 80, "y": 380 }
  },
  {
    "id": "cond_spin_result",
    "type": "condition",
    "data": {
      "label": "Розгалуження по результату",
      "conditions": [
        {
          "id": "cond_not_relevant",
          "label": "Не актуально",
          "expression": "context.spin_result.not_relevant === true"
        },
        {
          "id": "cond_objection",
          "label": "Є заперечення",
          "expression": "context.spin_result.ready_to_buy === false && context.spin_result.objection !== ''"
        },
        {
          "id": "cond_ready",
          "label": "Готовий купити",
          "expression": "context.spin_result.ready_to_buy === true"
        }
      ]
    },
    "position": { "x": 80, "y": 580 }
  },
  {
    "id": "msg_not_relevant",
    "type": "message",
    "data": {
      "label": "Не актуально",
      "text": "Зрозумів — якщо все налаштовано і команда не скаржиться, тоді справді не на часі. 👌\n\nЯкщо щось зміниться або з'явиться нова задача — пиши, завжди радий розібратись. 👋"
    },
    "position": { "x": 400, "y": 720 }
  },
  {
    "id": "msg_objection_handle",
    "type": "claude",
    "data": {
      "label": "Обробка заперечення",
      "mode": "dialog",
      "model": "claude-sonnet-4-20250514",
      "connectorId": "{{env.CLAUDE_CONNECTOR_ID}}",
      "outputVar": "context.objection_result",
      "exitCondition": "json_output",
      "messagesTemplate": "{{conversationHistory}}",
      "systemPrompt": "Ти — Ден. Клієнт має заперечення: {{context.spin_result.objection}}\n\nОброби заперечення щиро і коротко (1-2 повідомлення). Не тисни.\nТипові заперечення:\n- 'дорого' → порівняй з вартістю рутини яку виявили в діалозі\n- 'немає часу' → зустріч 60-90 хв, підготовки не потрібно\n- 'самі розберемось' → ок, але якщо захочуть погляд збоку — пиши\n- 'вже пробували' → уточни що не злетіло, можливо є конкретна причина\n\nПісля обробки — запитай чи є ще питання.\nЯкщо клієнт погоджується → JSON: {\"convinced\": true}\nЯкщо ні → JSON: {\"convinced\": false}"
    },
    "position": { "x": -240, "y": 720 }
  },
  {
    "id": "cond_objection_result",
    "type": "condition",
    "data": {
      "label": "Переконали?",
      "conditions": [
        {
          "id": "cond_convinced",
          "label": "Переконали",
          "expression": "context.objection_result.convinced === true"
        },
        {
          "id": "cond_not_convinced",
          "label": "Не переконали",
          "expression": "context.objection_result.convinced === false"
        }
      ]
    },
    "position": { "x": -240, "y": 900 }
  },
  {
    "id": "msg_not_convinced",
    "type": "message",
    "data": {
      "label": "Не переконали — м'який вихід",
      "text": "Все ок, без тиску. 🙂\n\nЯкщо надумаєш — я тут. Пиши в будь-який час. 👋"
    },
    "position": { "x": -400, "y": 1060 }
  },
  {
    "id": "msg_offer",
    "type": "message",
    "data": {
      "label": "Офер — консультація",
      "text": "Ось що відбувається на розборі:\n\n1️⃣ Вибираємо один процес — той що найбільше дратує або де найбільше часу\n2️⃣ Розбираємо як це зараз працює — хто що робить, де помилки\n3️⃣ Знаходимо що прибрати або автоматизувати — конкретно, без термінів\n4️⃣ Ти отримуєш PDF — як процес має виглядати після змін + план що робити першим\n\n📌 Ніякої підготовки. Просто розповідаєш як є — я розберу.\n📅 60-90 хвилин онлайн\n💳 {{env.CONSULT_PRICE}}\n\nГотовий записатись?"
    },
    "position": { "x": 80, "y": 720 }
  },
  {
    "id": "node_wayforpay",
    "type": "connector",
    "data": {
      "label": "WayForPay — консультація",
      "action": "create_invoice",
      "connectorId": "fe1f9e6e-5cfe-4a7d-aa30-5113dd80fd7a",
      "connectorType": "wayforpay",
      "connectorIcon": "💳",
      "amount": "{{env.CONSULT_PRICE_INT}}",
      "currency": "UAH",
      "description": "Розбір бізнес-процесу — консультація з автоматизації",
      "orderReference": "consult_{{context.spin_result.name}}_{{timestamp}}",
      "outputVar": "context.payment_url"
    },
    "position": { "x": 80, "y": 900 }
  },
  {
    "id": "msg_payment_link",
    "type": "message",
    "data": {
      "label": "Посилання на оплату",
      "text": "💳 Ось посилання для оплати:\n\n{{context.payment_url}}\n\nОплата через WayForPay — безпечно, картки України та міжнародні.\n\nПісля оплати я побачу платіж і напишу тобі в особисті — домовимось про час зустрічі. 📅"
    },
    "position": { "x": 80, "y": 1080 }
  },
  {
    "id": "msg_payment_success",
    "type": "message",
    "data": {
      "label": "Після оплати — студенту",
      "text": "✅ Оплату отримано!\n\nДякую — гарний крок. 💪\n\nОлександр напише тобі найближчим часом і домовиться про зручний час для зустрічі.\n\nДо зустрічі! 🙂"
    },
    "position": { "x": 80, "y": 1260 }
  },
  {
    "id": "msg_notify_admin",
    "type": "notifyAdmin",
    "data": {
      "label": "Сповіщення адміну",
      "targetKey": "ADMIN_TELEGRAM_ID",
      "message": "💰 Нова оплата — консультація автоматизація!\n\nІм'я: {{context.spin_result.name}}\nКомпанія: {{context.spin_result.company}}\nБіль: {{context.spin_result.main_pain}}\nСума: {{env.CONSULT_PRICE}}\nЧас: {{timestamp}}\n\nЗв'яжись і домовся про час!"
    },
    "position": { "x": 80, "y": 1440 }
  },
  {
    "id": "wait_remind_1",
    "type": "wait",
    "data": { "label": "24 год до нагадування 1", "duration": 24, "unit": "hours" },
    "position": { "x": 80, "y": 1200 }
  },
  {
    "id": "msg_remind_1",
    "type": "message",
    "data": {
      "label": "Нагадування 1",
      "text": "Привіт! Ще не встиг оплатити? 😊\n\nЯкщо є питання — запитай, відповім. Або просто коли буде зручно — посилання вище."
    },
    "position": { "x": 80, "y": 1380 }
  },
  {
    "id": "wait_remind_2",
    "type": "wait",
    "data": { "label": "48 год до нагадування 2", "duration": 48, "unit": "hours" },
    "position": { "x": 80, "y": 1520 }
  },
  {
    "id": "msg_remind_2",
    "type": "message",
    "data": {
      "label": "Нагадування 2 — останнє",
      "text": "Гей, востаннє нагадаю — без тиску. 🙂\n\nЯкщо надумаєш — посилання вище, або пиши напряму: t.me/olexandrmatsuk\n\nУдачі з бізнесом! 👋"
    },
    "position": { "x": 80, "y": 1660 }
  }
]
```

### Edges

```json
[
  { "id": "e0", "source": "start_1", "target": "msg_intro", "animated": true },
  { "id": "e1", "source": "msg_intro", "target": "node_spin_dialog" },
  { "id": "e2", "source": "node_spin_dialog", "target": "cond_spin_result" },

  { "id": "e3", "source": "cond_spin_result", "target": "msg_not_relevant", "conditionId": "cond_not_relevant" },
  { "id": "e4", "source": "cond_spin_result", "target": "msg_objection_handle", "conditionId": "cond_objection" },
  { "id": "e5", "source": "cond_spin_result", "target": "msg_offer", "conditionId": "cond_ready" },

  { "id": "e6", "source": "msg_objection_handle", "target": "cond_objection_result" },
  { "id": "e7", "source": "cond_objection_result", "target": "msg_not_convinced", "conditionId": "cond_not_convinced" },
  { "id": "e8", "source": "cond_objection_result", "target": "msg_offer", "conditionId": "cond_convinced" },

  { "id": "e9", "source": "msg_offer", "target": "node_wayforpay" },
  { "id": "e10", "source": "node_wayforpay", "target": "msg_payment_link" },

  { "id": "e11", "source": "msg_payment_link", "target": "wait_remind_1" },
  { "id": "e12", "source": "wait_remind_1", "target": "msg_remind_1" },
  { "id": "e13", "source": "msg_remind_1", "target": "wait_remind_2" },
  { "id": "e14", "source": "wait_remind_2", "target": "msg_remind_2" },

  { "id": "e15", "source": "msg_payment_link", "target": "msg_payment_success", "conditionId": "payment_success" },
  { "id": "e16", "source": "msg_payment_success", "target": "msg_notify_admin" }
]
```

---

## ВАЖЛИВО: WayForPay webhook

Після оплати WayForPay має відправити webhook в систему — і бот має:
1. Зупинити ланцюжок нагадувань (wait_remind_1 → msg_remind_1 → wait_remind_2 → msg_remind_2)
2. Відправити msg_payment_success студенту
3. Відправити msg_notify_admin адміну

**Перевірити в конекторі WayForPay:**
- Чи є обробник події `payment_success` / `order_paid`
- Чи матчиться `orderReference` з тим що згенерував бот
- Якщо webhook не підтримується конектором — реалізувати через polling або окремий endpoint

---

## KEYS ДЛЯ БОТА

Вже проставлені через MCP:
- `CONSULT_PRICE` = "2500 грн"
- `CONSULT_PRICE_INT` = "2500"
- `ADMIN_TELEGRAM_ID` = "{{env.ADMIN_TELEGRAM_ID}}"
- `CASES_JSON` = масив кейсів (JSON)

Потрібно проставити вручну:
- `TELEGRAM_BOT_TOKEN` — токен бота @den_fineko_bot (той самий що Sales курс)
- `TELEGRAM_BOT_USERNAME` = "den_fineko_bot"
- `CLAUDE_CONNECTOR_ID` — той самий що в інших ботах
- `FUNNEL_CHANNELS` = `["telegram"]`

---

## ПРИМІТКИ

**Той самий бот @den_fineko_bot** — обидві воронки (курс і консультація) живуть в різних ботах FINEKO але підключені до одного Telegram бота. Розрізняються по тригеру `/start` або deep link.

**Кейси в CASES_JSON** — зберігаються як ключ воронки. Системний промпт читає їх через `{{env.CASES_JSON}}` і використовує органічно в діалозі.

**Нагадування** — максимум 2, не нав'язливо. Після другого — тиша.

---

*ТЗ v1.0 | 2026-05-19*

---

## ДОПОВНЕННЯ 1 — Fallback /start для Майкла (@michael_fineko_bot)

**Bot ID:** `7675fc52-2057-44e2-b0dd-fffa15f99ee9` (Bot 1.1 Onboarding — той самий бот)

**Проблема:** якщо людина знайде @michael_fineko_bot в пошуку Telegram і натисне /start без deep link — вона не потрапить в жодну навчальну воронку і нічого не отримає.

**Рішення:** додати окрему гілку для /start без параметрів — пояснити що це, запитати звідки людина, переслати адміну.

### Нові ноди (додати в Bot 1.1)

```json
[
  {
    "id": "start_fallback",
    "type": "start",
    "data": {
      "label": "Start без параметрів",
      "trigger": "/start",
      "condition": "no_params"
    },
    "position": { "x": 600, "y": 80 }
  },
  {
    "id": "msg_fallback_intro",
    "type": "message",
    "data": {
      "label": "Привітання Майкла — fallback",
      "text": "👋 Привіт! Я Майкл — AI-асистент курсу «Фінансова система малого бізнесу».\n\nДопомагаю власникам малого бізнесу побудувати Cashflow, P&L і Баланс в Google Sheets — під їхній конкретний бізнес, а не по шаблону.\n\nЯкщо ти проходиш курс — переходь за посиланням з урока, там я тебе впізнаю 🙂\n\nЯкщо ще не на курсі — звідки дізнався про мене?"
    },
    "position": { "x": 600, "y": 240 }
  },
  {
    "id": "node_fallback_collect",
    "type": "claude",
    "data": {
      "label": "Збір повідомлення від людини",
      "mode": "single",
      "model": "claude-haiku-4-5",
      "connectorId": "{{env.CLAUDE_CONNECTOR_ID}}",
      "outputVar": "context.fallback_message",
      "exitCondition": "first_response",
      "systemPrompt": "Людина написала щось після привітання Майкла. Збережи її повідомлення дослівно в JSON:\n{\"message\": \"...\", \"seems_interested\": true/false}\n\nseems_interested = true якщо людина запитує про курс, автоматизацію, ціни або хоче дізнатись більше.\nВідповідай ТІЛЬКИ JSON, без тексту."
    },
    "position": { "x": 600, "y": 420 }
  },
  {
    "id": "msg_fallback_reply",
    "type": "message",
    "data": {
      "label": "Відповідь і напрям",
      "text": "Зрозумів, дякую! 🙂\n\nПередам Олександру — він напише тобі особисто і розкаже детальніше про курс.\n\nАбо якщо хочеш дізнатись вже зараз — ось бот де можна поговорити:\n👉 t.me/den_fineko_bot"
    },
    "position": { "x": 600, "y": 600 }
  },
  {
    "id": "msg_fallback_notify_admin",
    "type": "notifyAdmin",
    "data": {
      "label": "Сповіщення адміну — новий лід",
      "targetKey": "ADMIN_TELEGRAM_ID",
      "message": "👤 Новий лід через Майкла (без deep link)!\n\nПовідомлення: {{context.fallback_message.message}}\nЗацікавлений: {{context.fallback_message.seems_interested}}\nЧас: {{timestamp}}\n\nВарто написати особисто! 👆"
    },
    "position": { "x": 600, "y": 780 }
  }
]
```

### Нові edges для fallback гілки

```json
[
  { "id": "ef0", "source": "start_fallback", "target": "msg_fallback_intro", "animated": true },
  { "id": "ef1", "source": "msg_fallback_intro", "target": "node_fallback_collect" },
  { "id": "ef2", "source": "node_fallback_collect", "target": "msg_fallback_reply" },
  { "id": "ef3", "source": "msg_fallback_reply", "target": "msg_fallback_notify_admin" }
]
```

**Примітка:** якщо платформа FINEKO flows не підтримує два різних start-тригери в одній воронці (з параметром і без) — реалізувати через condition ноду одразу після start_1 що перевіряє наявність `startParam`.

---

## ДОПОВНЕННЯ 2 — Оновлення CASES_JSON

Кейс додано через MCP в ключ `CASES_JSON` бота `3131ff8f`:

```json
{
  "title": "AI-система навчального курсу з ботами",
  "problem": "Онлайн-курс з фінансів потребував персоналізованого досвіду для кожного студента — не шаблони, а реальні таблиці під кожен бізнес",
  "solution": "16 Telegram-ботів на FINEKO flows + Claude API (Sonnet/Haiku). Боти ведуть діалог, збирають дані про бізнес, будують персоналізовані Google Sheets таблиці через Apps Script Web App. Cashflow, P&L, Баланс, платіжний календар, зарплатна відомість — все автоматично під конкретний бізнес. Окремий Sales бот з SPIN-продажем і WayForPay оплатою",
  "result": "Студент виходить з курсу з трьома готовими фінансовими звітами в Google Sheets, побудованими AI під його конкретний бізнес — без участі автора курсу"
}
```

CASES_JSON вже оновлено в системі через MCP — перезавантажувати не потрібно.

---

*ТЗ v1.1 | 2026-05-19*
