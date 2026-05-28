# ТЗ для Claude Code — Sales бот + Бот-курс
## Курс «Фінансова система малого бізнесу» • 2026-05-19

---

## ЗАВДАННЯ 1 — Bot Sales SPIN: фікс розгалуження після SPIN діалогу

**Bot ID:** `e7dd3dd2-3a5b-438a-bdd3-beda815f7681`
**Проблема:** Claude нода повертає JSON з полями `ready_to_buy` і `wants_presentation`, але граф не читає ці поля — завжди йде по одному шляху: spin → офер → оплата. Три гілки (купити / презентація / не зацікавлений) є в нодах але не підключені через edges.

### Поточний граф (edges):
```
start_1 → msg_intro → node_1778704382587 (SPIN) → node_1778704412955 (офер) → node_1778704423580 (WFP) → node_1778704438576 (посилання оплати)
```

### Що потрібно:

**1. Додати condition ноду після SPIN діалогу**

```json
{
  "id": "cond_spin_result",
  "type": "condition",
  "data": {
    "label": "Розгалуження по результату SPIN",
    "conditions": [
      {
        "id": "cond_not_interested",
        "label": "Не зацікавлений",
        "expression": "context.spin_result.ready_to_buy === false && context.spin_result.wants_presentation === false"
      },
      {
        "id": "cond_wants_presentation",
        "label": "Хоче презентацію",
        "expression": "context.spin_result.wants_presentation === true"
      },
      {
        "id": "cond_ready_to_buy",
        "label": "Готовий купити",
        "expression": "context.spin_result.ready_to_buy === true"
      }
    ]
  },
  "position": { "x": 80, "y": 580 }
}
```

**2. Перебудувати edges:**

```json
[
  { "id": "e_start_intro", "source": "start_1", "target": "msg_intro", "animated": true },
  { "id": "e_intro_spin", "source": "msg_intro", "target": "node_1778704382587" },
  { "id": "e_spin_cond", "source": "node_1778704382587", "target": "cond_spin_result" },

  // Гілка 1: не зацікавлений
  { "id": "e_cond_not_interested", "source": "cond_spin_result", "target": "node_1778765657506", "conditionId": "cond_not_interested" },

  // Гілка 2: хоче презентацію
  { "id": "e_cond_presentation", "source": "cond_spin_result", "target": "node_1778765671047", "conditionId": "cond_wants_presentation" },
  { "id": "e_pres_msg_doc", "source": "node_1778765671047", "target": "node_1778765679459" },
  { "id": "e_doc_wait24", "source": "node_1778765679459", "target": "node_1778765685126" },
  { "id": "e_wait24_remind1", "source": "node_1778765685126", "target": "node_1778765694802" },
  { "id": "e_remind1_wait48", "source": "node_1778765694802", "target": "node_1778765700485" },
  { "id": "e_wait48_remind2", "source": "node_1778765700485", "target": "node_1778765711080" },

  // Гілка 3: готовий купити → офер → WayForPay
  { "id": "e_cond_buy", "source": "cond_spin_result", "target": "node_1778704412955", "conditionId": "cond_ready_to_buy" },
  { "id": "e_offer_wfp", "source": "node_1778704412955", "target": "node_1778704423580" },
  { "id": "e_wfp_paylink", "source": "node_1778704423580", "target": "node_1778704438576" },

  // Після оплати
  { "id": "e_paylink_success", "source": "node_1778704438576", "target": "node_1778765724813" },
  { "id": "e_success_admin", "source": "node_1778765724813", "target": "node_1778765735087" }
]
```

**3. Оновити повідомлення після оплати** — зараз написано «зв'яжемось і надамо доступ» але треба щоб після оплати студент одразу отримував посилання на бота курсу. Замінити текст ноди `node_1778765724813`:

```
✅ Оплату отримано! Вітаємо! 🎉

Дякую, що обрав курс — це правда хороший крок. 💪

Ось твій бот для проходження курсу:
👉 t.me/[COURSE_BOT_USERNAME]

Натискай /start — і зустрінеш Майкла. Він вже чекає. 😊
```

Додати ключ `COURSE_BOT_USERNAME` в keys бота Sales.

---

## ЗАВДАННЯ 2 — Новий бот: «Фінансова система — Курс»

**Bot ID:** `fa96e74b-d66e-4968-bc34-bcda1146f8bb` (вже створений через MCP, порожній)
**Задача:** побудувати повний граф воронки — надсилає 16 уроків, після кожного через 10 хв — повідомлення з описом і кнопкою на відповідного бота.

### Структура воронки

#### Загальний патерн на кожен урок (повторюється 16 разів):

```
[msg_lesson_N] → [wait_10min_N] → [msg_bot_N]
```

- `msg_lesson_N` — повідомлення з описом уроку + кнопка YouTube
- `wait_10min_N` — затримка 10 хвилин
- `msg_bot_N` — повідомлення з описом бота + кнопка на бота (InlineKeyboard з URL)

Уроки без бота (3.1 і 5.3) — тільки `msg_lesson_N`, без wait і msg_bot.

---

### Повний список нод

#### START
```json
{ "id": "start_1", "type": "start", "data": { "label": "Start", "trigger": "/start" }, "position": { "x": 80, "y": 80 } }
```

#### ВІТАННЯ
```json
{
  "id": "msg_welcome",
  "type": "message",
  "data": {
    "label": "Вітання",
    "text": "👋 Привіт! Ти в курсі «Фінансова система малого бізнесу».\n\nЯ буду надсилати тобі уроки по порядку. Після кожного уроку — посилання на бота, який допоможе виконати практичне завдання.\n\nПоїхали 🚀",
    "buttons": []
  },
  "position": { "x": 80, "y": 200 }
}
```

---

#### БЛОК 1

**Урок 1.1**
```json
{
  "id": "msg_lesson_1_1",
  "type": "message",
  "data": {
    "label": "Урок 1.1",
    "text": "📚 *Урок 1.1 — Вступ і карта старту*\n\nПознайомимось з курсом, з Майклом і зрозуміємо що ти отримаєш на виході. Карта курсу, логіка блоків і перший крок — опис свого бізнесу.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/IfPmPjEoh1o" }]]
  },
  "position": { "x": 80, "y": 360 }
}
```
```json
{ "id": "wait_1_1", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 480 } }
```
```json
{
  "id": "msg_bot_1_1",
  "type": "message",
  "data": {
    "label": "Бот після 1.1",
    "text": "🤖 *Практика до уроку 1.1*\n\nМайкл познайомиться з тобою і зберіг інформацію про твій бізнес — вона буде використовуватись у всіх наступних ботах.\n\n👇 Натискай і знайомся:",
    "buttons": [[{ "text": "🚀 Запустити Майкла", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_1_1" }]]
  },
  "position": { "x": 80, "y": 560 }
}
```

**Урок 1.2**
```json
{
  "id": "msg_lesson_1_2",
  "type": "message",
  "data": {
    "label": "Урок 1.2",
    "text": "📚 *Урок 1.2 — Бізнес-процес і swimlane-схема*\n\nБудуємо схему твого бізнесу з нуля. Хто що робить, де гроші входять і виходять, хто за що відповідає. Майкл побудує твій бізнес-процес у вигляді swimlane-схеми.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/ciVPZMotTz4" }]]
  },
  "position": { "x": 80, "y": 680 }
}
```
```json
{ "id": "wait_1_2", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 800 } }
```
```json
{
  "id": "msg_bot_1_2",
  "type": "message",
  "data": {
    "label": "Бот після 1.2",
    "text": "🤖 *Практика до уроку 1.2*\n\nМайкл поставить тобі кілька запитань про твій бізнес і побудує swimlane-схему з ролями та відповідальними. Це основа для всієї фінансової системи.",
    "buttons": [[{ "text": "🏗️ Будуємо процес", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_1_2" }]]
  },
  "position": { "x": 80, "y": 880 }
}
```

---

#### БЛОК 2

**Урок 2.1**
```json
{
  "id": "msg_lesson_2_1",
  "type": "message",
  "data": {
    "label": "Урок 2.1",
    "text": "📚 *Урок 2.1 — Cashflow: що це, навіщо і статті під твій бізнес*\n\nЧому прибуток є, а грошей нема? Що таке Cashflow і чим він відрізняється від P&L. Визначимо всі статті надходжень і витрат під твій конкретний бізнес.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/u7Q7mi_WJWg" }]]
  },
  "position": { "x": 80, "y": 1000 }
}
```
```json
{ "id": "wait_2_1", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 1120 } }
```
```json
{
  "id": "msg_bot_2_1",
  "type": "message",
  "data": {
    "label": "Бот після 2.1",
    "text": "🤖 *Практика до уроку 2.1*\n\nМайкл визначить всі статті Cashflow і P&L під твій бізнес. Ці статті стануть основою для таблиць у наступних уроках.",
    "buttons": [[{ "text": "📋 Визначаємо статті", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_2_1" }]]
  },
  "position": { "x": 80, "y": 1200 }
}
```

**Урок 2.2**
```json
{
  "id": "msg_lesson_2_2",
  "type": "message",
  "data": {
    "label": "Урок 2.2",
    "text": "📚 *Урок 2.2 — Як читати Cashflow і будуємо таблицю*\n\nЯк читати звіт і що він показує. Майкл побудує твою таблицю Cashflow в Google Sheets — зі статтями, формулами і захистом від випадкових змін.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/ZuXeg68eTO8" }]]
  },
  "position": { "x": 80, "y": 1320 }
}
```
```json
{ "id": "wait_2_2", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 1440 } }
```
```json
{
  "id": "msg_bot_2_2",
  "type": "message",
  "data": {
    "label": "Бот після 2.2",
    "text": "🤖 *Практика до уроку 2.2*\n\nМайкл побудує таблицю Cashflow в Google Sheets. Через 2 хвилини отримаєш готову таблицю зі своїми статтями — посилання прийде прямо в бот.",
    "buttons": [[{ "text": "📊 Будуємо Cashflow", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_2_2" }]]
  },
  "position": { "x": 80, "y": 1520 }
}
```

**Урок 2.3**
```json
{
  "id": "msg_lesson_2_3",
  "type": "message",
  "data": {
    "label": "Урок 2.3",
    "text": "📚 *Урок 2.3 — Платіжний календар і касові розриви*\n\nЯк побачити касовий розрив за 2-4 тижні до того як він стане проблемою. Будуємо платіжний календар прямо в таблиці Cashflow.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/7R1PiRIC9V0" }]]
  },
  "position": { "x": 80, "y": 1640 }
}
```
```json
{ "id": "wait_2_3", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 1760 } }
```
```json
{
  "id": "msg_bot_2_3",
  "type": "message",
  "data": {
    "label": "Бот після 2.3",
    "text": "🤖 *Практика до уроку 2.3*\n\nМайкл додасть вкладку платіжного календаря в твою таблицю Cashflow. Побачиш рух грошей по тижнях і де можливий розрив.",
    "buttons": [[{ "text": "📅 Будуємо календар", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_2_3" }]]
  },
  "position": { "x": 80, "y": 1840 }
}
```

---

#### БЛОК 3

**Урок 3.1** (концептуальний — без бота)
```json
{
  "id": "msg_lesson_3_1",
  "type": "message",
  "data": {
    "label": "Урок 3.1",
    "text": "📚 *Урок 3.1 — P&L: концепція і як рахувати прибуток*\n\nЧим P&L відрізняється від Cashflow. Що таке виручка, собівартість, валовий і чистий прибуток. Чому дата оплати і дата визнання — різні речі.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/9TJQ2EbuFOE" }]]
  },
  "position": { "x": 80, "y": 1960 }
}
```
*(немає wait і msg_bot — концептуальний урок)*

**Урок 3.2**
```json
{
  "id": "msg_lesson_3_2",
  "type": "message",
  "data": {
    "label": "Урок 3.2",
    "text": "📚 *Урок 3.2 — Як читати P&L і будуємо таблицю*\n\nРівні прибутку: валовий, операційний, чистий. Типові помилки при читанні звіту. Майкл додасть P&L в твій файл — поруч з Cashflow.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/dk5FcU4-cdU" }]]
  },
  "position": { "x": 80, "y": 2080 }
}
```
```json
{ "id": "wait_3_2", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 2200 } }
```
```json
{
  "id": "msg_bot_3_2",
  "type": "message",
  "data": {
    "label": "Бот після 3.2",
    "text": "🤖 *Практика до уроку 3.2*\n\nМайкл додасть лист P&L в твій файл Cashflow. Один файл — два звіти. Дані вносяться один раз, формули рахують самі.",
    "buttons": [[{ "text": "📈 Будуємо P&L", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_3_2" }]]
  },
  "position": { "x": 80, "y": 2280 }
}
```

**Урок 3.3**
```json
{
  "id": "msg_lesson_3_3",
  "type": "message",
  "data": {
    "label": "Урок 3.3",
    "text": "📚 *Урок 3.3 — Типи нарахувань і фінансова механіка бізнесу*\n\nЯк правильно рахувати зарплати, дивіденди, аванси і підрядників у P&L. Де проводити межу між COGS і OPEX.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/75WSCEGf3HI" }]]
  },
  "position": { "x": 80, "y": 2400 }
}
```
```json
{ "id": "wait_3_3", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 2520 } }
```
```json
{
  "id": "msg_bot_3_3",
  "type": "message",
  "data": {
    "label": "Бот після 3.3",
    "text": "🤖 *Практика до уроку 3.3*\n\nМайкл проведе діагностику фінансової механіки твого бізнесу: зарплати, дивіденди, аванси, підрядники. І визначить чи потрібен попроєктний P&L.",
    "buttons": [[{ "text": "🔍 Діагностика механіки", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_3_3" }]]
  },
  "position": { "x": 80, "y": 2600 }
}
```

---

#### БЛОК 4

**Урок 4.1**
```json
{
  "id": "msg_lesson_4_1",
  "type": "message",
  "data": {
    "label": "Урок 4.1",
    "text": "📚 *Урок 4.1 — Впроваджуємо систему збору даних*\n\nЯк зробити щоб команда вносила дані без нагадувань. Бухгалтер, рахунки, правило «вносиш одразу після операції». Оновлюємо схему бізнес-процесу.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/9-y5hgKt8Ik" }]]
  },
  "position": { "x": 80, "y": 2720 }
}
```
```json
{ "id": "wait_4_1", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 2840 } }
```
```json
{
  "id": "msg_bot_4_1",
  "type": "message",
  "data": {
    "label": "Бот після 4.1",
    "text": "🤖 *Практика до уроку 4.1*\n\nМайкл оновить схему бізнес-процесу — додасть точки збору фінансових даних: хто, коли і як вносить кожну операцію.",
    "buttons": [[{ "text": "🔄 Оновлюємо процес", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_4_1" }]]
  },
  "position": { "x": 80, "y": 2920 }
}
```

**Урок 4.2**
```json
{
  "id": "msg_lesson_4_2",
  "type": "message",
  "data": {
    "label": "Урок 4.2",
    "text": "📚 *Урок 4.2 — Зарплати: оклад, бонуси, підрядники*\n\nЯк правильно відображати різні типи виплат у фінансових звітах. ФОП, підрядники, оклад + бонуси — кожне по-своєму в Cashflow і P&L.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/bs-VA95XeHI" }]]
  },
  "position": { "x": 80, "y": 3040 }
}
```
```json
{ "id": "wait_4_2", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 3160 } }
```
```json
{
  "id": "msg_bot_4_2",
  "type": "message",
  "data": {
    "label": "Бот після 4.2",
    "text": "🤖 *Практика до уроку 4.2*\n\nМайкл домовиться як вести зарплатну відомість і побудує її під твою команду. Окремий файл або вкладка — залежить від того хто має доступ.",
    "buttons": [[{ "text": "💰 Налаштовуємо зарплати", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_4_2" }]]
  },
  "position": { "x": 80, "y": 3240 }
}
```

**Урок 4.3**
```json
{
  "id": "msg_lesson_4_3",
  "type": "message",
  "data": {
    "label": "Урок 4.3",
    "text": "📚 *Урок 4.3 — Платіжні процеси: підзвітні, сервіси, дивіденди*\n\nЯк організувати облік підзвітних витрат, комуналки, сервісів і дивідендів власника. Хто що вносить і куди.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/qQqi05neymE" }]]
  },
  "position": { "x": 80, "y": 3360 }
}
```
```json
{ "id": "wait_4_3", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 3480 } }
```
```json
{
  "id": "msg_bot_4_3",
  "type": "message",
  "data": {
    "label": "Бот після 4.3",
    "text": "🤖 *Практика до уроку 4.3*\n\nМайкл побудує таблиці підзвітних витрат для всіх хто їх вносить. Кожен отримає свій файл — без доступу до основних звітів компанії.",
    "buttons": [[{ "text": "🧾 Налаштовуємо платежі", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_4_3" }]]
  },
  "position": { "x": 80, "y": 3560 }
}
```

**Урок 4.4**
```json
{
  "id": "msg_lesson_4_4",
  "type": "message",
  "data": {
    "label": "Урок 4.4",
    "text": "📚 *Урок 4.4 — Зміни без саботажу і combined таблиця*\n\nЯк впровадити зміни в команді без опору. І головний артефакт — Cashflow + P&L в одному файлі: дані вносяться один раз.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/zirR4Y4h400" }]]
  },
  "position": { "x": 80, "y": 3680 }
}
```
```json
{ "id": "wait_4_4", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 3800 } }
```
```json
{
  "id": "msg_bot_4_4",
  "type": "message",
  "data": {
    "label": "Бот після 4.4",
    "text": "🤖 *Практика до уроку 4.4*\n\nМайкл побудує combined таблицю Cashflow + P&L в Google Sheets. Один файл, два звіти, дані вносяться один раз.",
    "buttons": [[{ "text": "🔗 Будуємо combined", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_4_4" }]]
  },
  "position": { "x": 80, "y": 3880 }
}
```

**Урок 4.5**
```json
{
  "id": "msg_lesson_4_5",
  "type": "message",
  "data": {
    "label": "Урок 4.5",
    "text": "📚 *Урок 4.5 — Персональні інструкції для команди*\n\nЯк зробити щоб кожен член команди точно знав що і коли він вносить. Майкл згенерує персональні інструкції для кожної ролі.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/0i5gZIeTU_o" }]]
  },
  "position": { "x": 80, "y": 4000 }
}
```
```json
{ "id": "wait_4_5", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 4120 } }
```
```json
{
  "id": "msg_bot_4_5",
  "type": "message",
  "data": {
    "label": "Бот після 4.5",
    "text": "🤖 *Практика до уроку 4.5*\n\nМайкл створить персональні інструкції для кожного члена команди: хто що робить, коли і в яку таблицю вносить.",
    "buttons": [[{ "text": "📋 Інструкції команді", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_4_5" }]]
  },
  "position": { "x": 80, "y": 4200 }
}
```

---

#### БЛОК 5

**Урок 5.1**
```json
{
  "id": "msg_lesson_5_1",
  "type": "message",
  "data": {
    "label": "Урок 5.1",
    "text": "📚 *Урок 5.1 — Баланс: структура і будуємо таблицю*\n\nТретій звіт який показує стан бізнесу — не рух, не прибуток, а стан. Активи, зобов'язання, власний капітал. Балансове рівняння. Майкл побудує таблицю балансу.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/t0KVRqyci10" }]]
  },
  "position": { "x": 80, "y": 4320 }
}
```
```json
{ "id": "wait_5_1", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 4440 } }
```
```json
{
  "id": "msg_bot_5_1",
  "type": "message",
  "data": {
    "label": "Бот після 5.1",
    "text": "🤖 *Практика до уроку 5.1*\n\nДва кроки: спочатку Майкл визначить статті балансу під твій бізнес, потім побудує таблицю в Google Sheets — з усіма допоміжними вкладками (склад, ОЗ, дебіторка якщо є).",
    "buttons": [[{ "text": "⚖️ Будуємо баланс", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_5_1" }]]
  },
  "position": { "x": 80, "y": 4520 }
}
```

**Урок 5.2**
```json
{
  "id": "msg_lesson_5_2",
  "type": "message",
  "data": {
    "label": "Урок 5.2",
    "text": "📚 *Урок 5.2 — Баланс у процесі: хто і коли вносить дані*\n\nЯк вбудувати баланс в бізнес-процес. Хто відповідає за кожну статтю, коли проводити інвентаризацію, як команда веде це без тебе.",
    "buttons": [[{ "text": "▶️ Дивитись урок", "url": "https://youtu.be/IbBX3e39epc" }]]
  },
  "position": { "x": 80, "y": 4640 }
}
```
```json
{ "id": "wait_5_2", "type": "wait", "data": { "label": "10 хв", "duration": 10, "unit": "minutes" }, "position": { "x": 80, "y": 4760 } }
```
```json
{
  "id": "msg_bot_5_2",
  "type": "message",
  "data": {
    "label": "Бот після 5.2",
    "text": "🤖 *Практика до уроку 5.2*\n\nМайкл визначить хто і як вносить балансові дані у твоїй компанії і збереже інструкції для команди.",
    "buttons": [[{ "text": "📌 Баланс у процесі", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}?start=lesson_5_2" }]]
  },
  "position": { "x": 80, "y": 4840 }
}
```

**Урок 5.3** (фінал — без бота)
```json
{
  "id": "msg_lesson_5_3",
  "type": "message",
  "data": {
    "label": "Урок 5.3 — Фінал",
    "text": "🎉 *Урок 5.3 — Фінал: три звіти пов'язані, система готова*\n\nОстанній урок. Дивимось на повну систему: Cashflow, P&L і Баланс пов'язані між собою. Команда знає свої ролі. Власник бачить цифри.\n\nВітаємо — ти побудував фінансову систему свого бізнесу 🏆",
    "buttons": [[{ "text": "▶️ Дивитись фінальний урок", "url": "https://youtu.be/kpzYHdxLLuw" }]]
  },
  "position": { "x": 80, "y": 4960 }
}
```

**Фінальне повідомлення після 5.3**
```json
{
  "id": "msg_finale",
  "type": "message",
  "data": {
    "label": "Фінал курсу",
    "text": "✅ *Курс завершено!*\n\nТи пройшов весь курс «Фінансова система малого бізнесу».\n\nТвої таблиці в Google Sheets:\n📊 Cashflow + P&L — рух грошей і прибуток\n⚖️ Баланс — стан бізнесу\n📅 Платіжний календар — плануєш наперед\n\nМайкл залишається з тобою — тепер він може допомагати вносити будь-які операції в таблиці і пояснювати куди що відноситься.\n\n👇 Продовжуй працювати з Майклом:",
    "buttons": [[{ "text": "🤖 Відкрити Майкла", "url": "https://t.me/{{env.MICHAEL_BOT_USERNAME}}" }]]
  },
  "position": { "x": 80, "y": 5120 }
}
```

---

### Повний список edges (лінійний ланцюжок)

```json
[
  { "id": "e0", "source": "start_1", "target": "msg_welcome", "animated": true },
  { "id": "e1", "source": "msg_welcome", "target": "msg_lesson_1_1" },
  { "id": "e2", "source": "msg_lesson_1_1", "target": "wait_1_1" },
  { "id": "e3", "source": "wait_1_1", "target": "msg_bot_1_1" },
  { "id": "e4", "source": "msg_bot_1_1", "target": "msg_lesson_1_2" },
  { "id": "e5", "source": "msg_lesson_1_2", "target": "wait_1_2" },
  { "id": "e6", "source": "wait_1_2", "target": "msg_bot_1_2" },
  { "id": "e7", "source": "msg_bot_1_2", "target": "msg_lesson_2_1" },
  { "id": "e8", "source": "msg_lesson_2_1", "target": "wait_2_1" },
  { "id": "e9", "source": "wait_2_1", "target": "msg_bot_2_1" },
  { "id": "e10", "source": "msg_bot_2_1", "target": "msg_lesson_2_2" },
  { "id": "e11", "source": "msg_lesson_2_2", "target": "wait_2_2" },
  { "id": "e12", "source": "wait_2_2", "target": "msg_bot_2_2" },
  { "id": "e13", "source": "msg_bot_2_2", "target": "msg_lesson_2_3" },
  { "id": "e14", "source": "msg_lesson_2_3", "target": "wait_2_3" },
  { "id": "e15", "source": "wait_2_3", "target": "msg_bot_2_3" },
  { "id": "e16", "source": "msg_bot_2_3", "target": "msg_lesson_3_1" },
  { "id": "e17", "source": "msg_lesson_3_1", "target": "msg_lesson_3_2" },
  { "id": "e18", "source": "msg_lesson_3_2", "target": "wait_3_2" },
  { "id": "e19", "source": "wait_3_2", "target": "msg_bot_3_2" },
  { "id": "e20", "source": "msg_bot_3_2", "target": "msg_lesson_3_3" },
  { "id": "e21", "source": "msg_lesson_3_3", "target": "wait_3_3" },
  { "id": "e22", "source": "wait_3_3", "target": "msg_bot_3_3" },
  { "id": "e23", "source": "msg_bot_3_3", "target": "msg_lesson_4_1" },
  { "id": "e24", "source": "msg_lesson_4_1", "target": "wait_4_1" },
  { "id": "e25", "source": "wait_4_1", "target": "msg_bot_4_1" },
  { "id": "e26", "source": "msg_bot_4_1", "target": "msg_lesson_4_2" },
  { "id": "e27", "source": "msg_lesson_4_2", "target": "wait_4_2" },
  { "id": "e28", "source": "wait_4_2", "target": "msg_bot_4_2" },
  { "id": "e29", "source": "msg_bot_4_2", "target": "msg_lesson_4_3" },
  { "id": "e30", "source": "msg_lesson_4_3", "target": "wait_4_3" },
  { "id": "e31", "source": "wait_4_3", "target": "msg_bot_4_3" },
  { "id": "e32", "source": "msg_bot_4_3", "target": "msg_lesson_4_4" },
  { "id": "e33", "source": "msg_lesson_4_4", "target": "wait_4_4" },
  { "id": "e34", "source": "wait_4_4", "target": "msg_bot_4_4" },
  { "id": "e35", "source": "msg_bot_4_4", "target": "msg_lesson_4_5" },
  { "id": "e36", "source": "msg_lesson_4_5", "target": "wait_4_5" },
  { "id": "e37", "source": "wait_4_5", "target": "msg_bot_4_5" },
  { "id": "e38", "source": "msg_bot_4_5", "target": "msg_lesson_5_1" },
  { "id": "e39", "source": "msg_lesson_5_1", "target": "wait_5_1" },
  { "id": "e40", "source": "wait_5_1", "target": "msg_bot_5_1" },
  { "id": "e41", "source": "msg_bot_5_1", "target": "msg_lesson_5_2" },
  { "id": "e42", "source": "msg_lesson_5_2", "target": "wait_5_2" },
  { "id": "e43", "source": "wait_5_2", "target": "msg_bot_5_2" },
  { "id": "e44", "source": "msg_bot_5_2", "target": "msg_lesson_5_3" },
  { "id": "e45", "source": "msg_lesson_5_3", "target": "msg_finale" }
]
```

---

### Keys для бота курсу

```json
[
  { "key": "TELEGRAM_BOT_TOKEN", "label": "Telegram Bot Token", "isSecret": true, "value": "REPLACE" },
  { "key": "TELEGRAM_BOT_USERNAME", "label": "Telegram Bot Username", "isSecret": false, "value": "" },
  { "key": "MICHAEL_BOT_USERNAME", "label": "Username бота Майкла (без @)", "isSecret": false, "value": "REPLACE_WITH_MICHAEL_BOT_USERNAME" },
  { "key": "FUNNEL_CHANNELS", "label": "Канали", "isSecret": false, "value": "[\"telegram\"]" }
]
```

---

## ПРІОРИТЕТИ

| # | Завдання | Пріоритет |
|---|----------|-----------|
| 1 | Sales бот: condition нода + перебудова edges | 🔴 КРИТИЧНО — без цього бот завжди йде на оплату |
| 2 | Sales бот: оновити текст після оплати (додати посилання на бота курсу) | 🔴 КРИТИЧНО |
| 3 | Бот-курс: побудувати повний граф | 🟠 ВИСОКИЙ |
| 4 | Бот-курс: проставити MICHAEL_BOT_USERNAME після того як відомий username | 🟡 ПІСЛЯ deploy |

---

*ТЗ v1.0 | 2026-05-19*
