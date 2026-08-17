# BrewDrop — інтеграція через REST API (дропшип-постачальник одягу)

> Реверс-інжиніринг завершено 2026-08-17. brewdrop.in.ua — Vue SPA поверх REST API
> `https://api.brewdrop.in.ua`. Для розміщення замовлень **браузер НЕ потрібен** — усе через API.
> Інтеграція живе у воронці covercar (`cc03657f`), нода `n_supplier_order` (js).

## Авторизація
- Заголовки: `Authorization: Bearer <token>`, `crossdomain: true`, `Accept: application/json`, `Origin: https://brewdrop.in.ua`.
- Токен — Laravel Sanctum (напр. `18440|Vqrx…`), довгоживучий. Зберігається у ключі воронки `BREWDROP_TOKEN`.
- Rate-limit: `x-ratelimit-limit: 120` /хв.
- `GET /api/users/auth` → поточний юзер (id, роль «Продавец», balance) — перевірка токена.

## Ендпоінти

### Пошук товару за артикулом
`GET /api/guest/products/?search={артикул}&per_page=20`
→ `data[]`: `{ product_color_id, product_id, name, short_name, vendor_code, remains[] }`.
Матч за `vendor_code === артикул`.

### Деталь товару (розміри+кольори з product_color_size_id)
`GET /api/guest/products/{product_id}`
→ `data.remains[]` = БЛОКИ КОЛЬОРІВ: `{ color_id, color:{name}, sizes:[{ product_color_size_id, size:{name}, remains }] }`.
Резолв: знайти блок за `color.name`, у ньому розмір за `size.name` з `remains>0` → **`product_color_size_id`**.

### Кошик (серверний, per-user)
- `GET /api/carts` → `{count, items:[{product_color_size_id, vendor_code, size, color, retail_price, remains, size_variant[]}]}`.
- `POST /api/carts` body `{ "product_color_size_id": <int>, "qty": <int> }` — додати.
- Товари замовлення беруться з серверного кошика (не передаються в POST /orders).

### Нова Пошта
- `GET /api/cities?search={назва}&per_page=5` → `{data:[{id, name, name_ua, ref}]}`.
- `GET /api/branches?city_id={id}&search={№/текст}&per_page=25` → `{data:[{id, name, name_ua, ref}]}`.

### Відправники / доставки
- `GET /api/senders` → `data[]` профілі: `{id, delivery_id, city_id, branch_id, ПІБ, phone, api_key(NP)}`. Для замовлення — `sender_id` (ключ `BREWDROP_SENDER_ID`).
- `GET /api/deliveries` → `[{id:1,"Новая почта"},{id:2,"Самовывоз"},{id:3,"Своя ТТН"}]`.

### Створити замовлення
`POST /api/orders` (обовʼязкове `client_data`; товари — із серверного кошика):
```json
{
  "sender_id": 56,
  "client_data": {
    "first_name": "Петро", "last_name": "Іванов", "middle_name": null,
    "phone": "+38(097) 123-45-67", "delivery_id": 1,
    "city_id": 2504, "branch_id": 10073
  },
  "delivery_data": { "delivery_id": 1, "delivery_pay_person": 1 },
  "pay_type": 1, "pay_person": 1,
  "discount": { "type": "%", "value": 0 },
  "sell_price": 2000,
  "comment": "Замовлення GOV..."
}
```
- `pay_type`: `1` = Наложенный платеж (уточнити коди для повної передоплати).
- `pay_person`/`delivery_pay_person`: `1` = «Оплачивает клиент».
- Відповідь містить обʼєкт замовлення з **`ttn`** (номер накладної!), `status`, `total_final`, `total_drop`, `drop_profit`, `products[]` (з `product_color_size_id`, `purchase_price`, `retail_price`, `discount_price`).

### Список замовлень
`GET /api/orders?market=1&page=1&per_page=100&order_by=id&order_direction=desc` → повні обʼєкти замовлень (з `ttn`).

## Як зчитати ендпоінти самому (метод)
`curl https://brewdrop.in.ua/js/app.318c596a.0.2.2.js` → grep `"/api/…"` та `.post("/…"`/`.get("/…"`. Read-схеми — GET-запити з токеном. Обовʼязкові поля POST — надіслати `POST … {}` і прочитати 422-валідацію (нічого не створює).

## Наша інтеграція (воронка covercar)
Ключі воронки: `BREWDROP_API_BASE`, `BREWDROP_TOKEN`, `BREWDROP_SENDER_ID`, `BREWDROP_ARTICLE_MAP` (`{"<keycrm_product_id>":{"article":"A0001","color":"чёрный"}}`), `BREWDROP_DRY_RUN` (`1`=тест).
Нода `n_supplier_order` (js): testMode/dry-run гард → мапа артикулу → пошук → деталь → `product_color_size_id` → POST /carts → резолв НП місто/відділення → зібрати payload → **DRY-RUN: показати у Telegram, СТОП перед POST /orders**. Гілка: `n_create → n_supplier_cond(brewdrop?) → n_supplier_order → n_supplier_notify → n_confirm`.
Перехід у бій: `BREWDROP_DRY_RUN=0` → POST /orders → з відповіді взяти `ttn` → надіслати клієнту (пункт TTN→клієнт).

## TODO
- Уточнити `pay_type` для повної передоплати.
- Точний ключ ціни продажу (`sell_price` — перевірити на першому бойовому POST через 422).
- Мапінг наш товар→brewdrop артикул (заповнити `BREWDROP_ARTICLE_MAP`).
