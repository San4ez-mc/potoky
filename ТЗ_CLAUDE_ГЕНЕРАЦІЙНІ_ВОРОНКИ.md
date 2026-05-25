# ТЗ для Claude
## Інтеграція генераційних воронок у Content Planner Bot (PHP/MVC)

Дата: 2026-05-20
Система: Content Planner Bot (PHP MVC)

## 1. Мета
Додати в систему асинхронний запуск медіа-генерацій через FINEKO Flows API для одного поста, для вибраних постів та для всіх постів конкретної дати, з авто-вибором воронки за типом соцмережі і метаполями поста.

## 2. Scope робіт
1. UI зміни у календарній сітці постів.
2. Backend endpoint-и для запуску генерації.
3. Webhook endpoint для приймання результатів генерації.
4. Сервіс мапінгу поста на воронку Flows.
5. Додавання MCP tool для запуску генерації агентом.
6. Міграція БД для статусів/метаданих генерації (за потреби).

## 3. Функціональні вимоги

### 3.1. Точковий запуск
У кожній картці поста додати кнопку:
- Текст: "⚡ Згенерувати медіа"
- Поведінка: AJAX POST запит на запуск генерації для конкретного post_id.

### 3.2. Масовий запуск
Додати bulk-механіку:
- чекбокс у кожній картці поста;
- кнопка "⚡ Згенерувати для вибраних (X)";
- кнопка "⚡ Згенерувати весь день" (для рядка дати).

### 3.3. Статус генерації
Потрібні стани:
- not_generated
- queued
- processing
- ready
- failed

У UI відображати ланцюг:
[Не згенеровано] -> [В черзі ШІ...] -> [Готово / Посилання]

### 3.4. Автовизначення воронки
На бекенді (GenerationController або ImagesController) визначати воронку за social network + полями поста.

Бізнес-матриця:
1. Instagram Stories + без ШІ аватара -> Воронка 1 (Stories Puppeteer)
2. Instagram Posts (карусель) + без ШІ аватара -> Воронка 6 (карусель з єдиним фоном)
3. TikTok або Instagram Posts + avatar engine heygen -> Воронка 4 (HeyGen)
4. TikTok або Instagram Posts + avatar engine liveportrait -> Воронка 5 (LivePortrait)

Якщо правило не знайдено:
- повертати зрозумілу помилку в API;
- ставити статус failed із текстом причини.

## 4. Зміни БД
Перевірити таблицю posts. Якщо колонок немає, додати:
- generation_status VARCHAR(20) NOT NULL DEFAULT 'not_generated'
- generation_job_id VARCHAR(120) NULL
- generation_flow_key VARCHAR(50) NULL
- generation_output_url TEXT NULL
- generation_error TEXT NULL
- generation_requested_at DATETIME NULL
- generation_finished_at DATETIME NULL
- avatar_engine VARCHAR(40) NULL

Рекомендований SQL:

ALTER TABLE posts
  ADD COLUMN generation_status VARCHAR(20) NOT NULL DEFAULT 'not_generated',
  ADD COLUMN generation_job_id VARCHAR(120) NULL,
  ADD COLUMN generation_flow_key VARCHAR(50) NULL,
  ADD COLUMN generation_output_url TEXT NULL,
  ADD COLUMN generation_error TEXT NULL,
  ADD COLUMN generation_requested_at DATETIME NULL,
  ADD COLUMN generation_finished_at DATETIME NULL,
  ADD COLUMN avatar_engine VARCHAR(40) NULL;

Примітка: якщо частина колонок уже існує, застосувати безпечні міграції поетапно.

## 5. Backend API контракти

### 5.1. Запуск для одного поста
Маршрут: POST /generation/run
Body JSON:
{
  "post_id": 123
}
Відповідь:
{
  "ok": true,
  "post_id": 123,
  "status": "queued",
  "job_id": "flow_job_abc",
  "flow": "avatar_heygen"
}

### 5.2. Запуск для кількох постів
Маршрут: POST /generation/run-bulk
Body JSON:
{
  "post_ids": [11, 12, 13]
}
Відповідь:
{
  "ok": true,
  "started": 3,
  "failed": 0,
  "details": []
}

### 5.3. Запуск для всієї дати
Маршрут: POST /generation/run-day
Body JSON:
{
  "post_date": "2026-05-20"
}
Відповідь:
{
  "ok": true,
  "started": 8,
  "failed": 1
}

### 5.4. Отримання статусу
Маршрут: GET /generation/status?post_id=123
Відповідь:
{
  "ok": true,
  "post_id": 123,
  "generation_status": "processing",
  "generation_output_url": null,
  "generation_error": null
}

### 5.5. Webhook від Flows
Маршрут: POST /api/generation/webhook?post_id=123&token=SECRET
Body JSON:
{
  "jobId": "flow_job_abc",
  "status": "completed",
  "output_url": "https://r2.example.com/path/file.mp4",
  "error": null
}

Логіка:
1. Валідувати token із конфігу.
2. Перевірити існування post_id.
3. Оновити generation_status, generation_output_url, generation_error, generation_finished_at.
4. За потреби синхронізувати image_path або зберегти пряме R2 URL.

## 6. Інтеграція з FINEKO Flows API

### 6.1. Загальний payload
{
  "projectId": <active_project_id>,
  "postId": <post_id>,
  "scriptText": "<post_text>",
  "engine": "heygen | liveportrait | none",
  "voiceId": "<voice_id>",
  "webhookUrl": "https://content.fineko.space/api/generation/webhook?post_id=<id>&token=<secret>"
}

### 6.2. Поведінка при запуску
1. Перед відправкою ставити status = processing або queued.
2. Виконувати короткий неблокуючий HTTP запит у Flows API.
3. Зберігати job_id.
4. UI оновлювати без перезавантаження сторінки.

## 7. UI/Frontend вимоги

### 7.1. У картці поста
Додати блок генерації під текстом поста:
- кнопка запуску;
- dropdown ракурсу/типу аватара;
- бейдж статусу;
- якщо ready: кнопка "Відкрити медіа".

### 7.2. Bulk-панель
Додати панель дій біля фільтрів мереж:
- "⚡ Згенерувати для вибраних (X)"
- "⚡ Згенерувати весь день"

### 7.3. JS поведінка
1. Використовувати fetch/AJAX.
2. Оптимістичне оновлення статусу на queued/processing.
3. Періодичний polling статусів (наприклад, кожні 5-10 секунд для постів processing).
4. Відображати помилки конкретно по post_id.

## 8. MCP зміни
Файл: McpServer

### 8.1. tools/list
Додати tool:
- name: generate_post_media
- description: Запускає автоматичну ШІ генерацію медіа для одного або кількох постів.

Schema:
{
  "type": "object",
  "properties": {
    "post_ids": {
      "type": "array",
      "items": { "type": "integer" },
      "description": "Масив ID постів для запуску генерації"
    }
  },
  "required": ["post_ids"],
  "additionalProperties": false
}

### 8.2. tools/call
Обробка generate_post_media:
1. Пройти по post_ids.
2. Для кожного поста перевірити належність до проєкту та валідність даних.
3. Запустити внутрішню функцію генерації.
4. Повернути агрегований JSON:
{
  "success": true,
  "message": "Запущено генерацію для X постів. Процес асинхронний.",
  "started": X,
  "failed": Y
}

## 9. Безпека
1. Webhook endpoint має працювати без сесії, але з токен-перевіркою.
2. Токен брати з конфігу (новий ключ generation_webhook_token).
3. Логувати всі webhook виклики і помилки інтеграції.
4. Не виводити секрети у відповіді API або UI.

## 10. Нефункціональні вимоги
1. Запуск генерації не блокує HTTP відповідь користувачу.
2. UI не потребує повного reload сторінки для оновлення статусів.
3. Масовий запуск підтримує щонайменше 50 post_id за один виклик.
4. Помилка одного поста не валить весь bulk процес.

## 11. Критерії приймання
1. У кожній картці поста є робоча кнопка генерації та індикатор статусу.
2. Bulk-генерація працює для вибраних постів.
3. Bulk-генерація працює для всієї дати.
4. Автовибір воронки відповідає матриці правил.
5. Webhook успішно переводить статус у ready і додає output URL.
6. MCP tool generate_post_media доступний у tools/list і реально запускає процес.

## 12. Чек-лист перед стартом розробки
- Перевірити схему posts і додати відсутні generation колонки.
- Додати маршрути generation у router.
- Додати webhook маршрут без сесії з токеном.
- Реалізувати backend service для мапінгу поста у flow.
- Реалізувати AJAX на фронті для точкового і масового запуску.
- Реалізувати MCP tool generate_post_media.
- Додати мінімальні логи та базові інтеграційні перевірки.

## 13. План реалізації (рекомендований порядок)
1. Міграція БД.
2. Сервіс визначення flow + інтеграція з Flows API.
3. Endpoint-и run/run-bulk/run-day/status.
4. Webhook endpoint.
5. UI кнопки + bulk + JS polling.
6. MCP tool.
7. Тестування сценаріїв і edge cases.

## 14. Edge cases
1. Порожній текст поста -> не запускати генерацію, повертати валідаційну помилку.
2. Невідомий тип мережі -> failed з причиною unsupported_network.
3. Відсутній avatar_engine при аватарній воронці -> failed з причиною missing_avatar_engine.
4. Дублікат запуску для processing поста -> повертати idempotent відповідь без повторного старту.
5. Webhook на неіснуючий post_id -> 404/ignored з логом.

## 15. Очікуваний результат
Після впровадження користувач може запускати генерацію медіа прямо з календаря, масово по вибраних постах або по даті, бачити live-статуси, а також запускати ті ж дії через MCP інструменти агентів.