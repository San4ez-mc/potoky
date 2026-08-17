# EasyDrop — інтеграція (Django-агрегатор офлайн-постачальників)

> Реверс-інжиніринг 2026-08-18. `easydrop.one` — Django-застосунок (сесійні cookie + CSRF,
> форми `x-www-form-urlencoded`, НЕ JSON). Це **агрегатор**: через нього замовляють у різних
> офлайн-постачальників (у списку є навіть «Brewdrop» id 31700, DropSpot, EA-Drop…).
> Лендинг `easydrop.one/` — окремий Webflow; застосунок під `/login`, `/offline-supplier-order` тощо.

## Авторизація (Django session + CSRF)
1. `GET /login` → cookie `csrftoken` + у формі `<input name="csrfmiddlewaretoken">`. Поля форми: `username`, `password`, `csrfmiddlewaretoken`. `<form method="post">` (action = сам /login).
2. `POST /login` (form-urlencoded) з `username`, `password`, `csrfmiddlewaretoken`; заголовки `Referer: https://easydrop.one/login`, `Origin: https://easydrop.one`; cookie jar.
   → `302 → /index?hash=<manager_hash>`, ставить cookie `sessionid` (+ `manager_hash`, `uid`).
3. Далі всі запити — з cookie `sessionid` + `csrftoken`. Захищені сторінки без сесії → `302 /login?next=…`.
4. Для кожного POST потрібен свіжий `csrfmiddlewaretoken` зі сторінки форми (`GET /offline-supplier-order`).

Ключі воронки: `EASYDROP_BASE=https://easydrop.one`, `EASYDROP_LOGIN`, `EASYDROP_PASS`, `EASYDROP_LOGIN_URL=/login`, `EASYDROP_SUPPLIER_ID` (id постачальника лоферів).

## Ендпоінти

### Пошук постачальника (за назвою)
`GET /autocomplete/offline-supplier/?q=dr` (заголовок `X-Requested-With: XMLHttpRequest`)
→ `[{ "value": 31700, "text": "Brewdrop (брев)" }, { "value": 44653, "text": "DropSpot" }, …]`.
`value` = `offline_supplier_select`.

### Пошук товару постачальника (за назвою/артикулом)
`GET /autocomplete/offline-supplier-item/?q={текст}&pk={supplier_id}`
→ `[{ "value": 244181, "text": "Футболка… L0056, 330 грн | Арт: L0056" }, { "value": 245115, "text": "…2 шт, 660 грн | Арт: L0056" }]`.
**Ярусна ціна нативна:** «1 шт» і «2 шт» — ОКРЕМІ товари (різні `value`). `value` = `item_select`.

### Створити замовлення
`POST /offline-supplier-order` (**form-urlencoded**), з cookie сесії + свіжим csrf:
```
date=2026-08-18
send_data=м. Київ, НП 2661        (місто + відділення одним рядком)
offline_supplier_select=31700      (id постачальника)
payment_type=1
person_first_name=Олександр
person_last_name=Мацук
person_phone=0966358365
ttn=                               (порожньо — генерується)
comment=Тест
partial_prepayment=200             (часткова передоплата)
sell=0                             (ціна продажу клієнту)
cost=0
item_select=245115                 (id товару; ярус за к-стю)
is_permanent_client=on
csrfmiddlewaretoken=<з форми>
```
→ редірект `302 → /pcorders/accepted/` (успіх). TTN зʼявляється у списку замовлень.

## Реалізація (план)
js-нода у воронці: логін (cookie jar) → `GET /offline-supplier-order` (csrf) → autocomplete постачальника/товару за артикулом+кількістю → `POST /offline-supplier-order` (**dry-run: показати форму у Telegram, СТОП перед POST**). Cookie/CSRF керуються вручну через `fetch` (`getSetCookie()` → заголовок `Cookie`).

## TODO / уточнити
- Назва **постачальника лоферів** у easydrop (щоб взяти `EASYDROP_SUPPLIER_ID`).
- Коди `payment_type` (1 = ? ), як передається місто/відділення точно (`send_data` рядком).
- Де взяти TTN після прийому (список `/pcorders/accepted/` або деталь замовлення).
