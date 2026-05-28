# ТЗ для Claude Code — Розширення фінансової системи
## Курс «Фінансова система малого бізнесу» • Олександр Мацук • 2026
### Версія: v1.0 | Дата: 2026-05-19

> **Принцип:** Не переписуємо з нуля — розширюємо існуючий функціонал.
> Всі зміни є additive: нові actions, нові report_type, нові поля в payload.
> Існуючі боти і Apps Script продовжують працювати без змін.

---

## ЧАСТИНА 1 — ЗМІНИ В APPS SCRIPT

### 1.1 Новий action: `add_payment_calendar`

**Де:** в `update_table` → новий `change.type: "add_payment_calendar"`

**Задача:** додати вкладку `📅 Платіжний календар` в **існуючий** cashflow-файл (не будувати новий).

Функція `setupPaymentCalendar_()` вже існує в коді і повністю готова.
Потрібно лише підключити її виклик через `update_table`.

```javascript
// В функції updateTable(), в switch по change.type:
case 'add_payment_calendar':
  results.push(addPaymentCalendarTab_(ss, change));
  break;

function addPaymentCalendarTab_(ss, change) {
  // Перевірити чи вкладка вже є
  var existing = ss.getSheetByName('📅 Платіжний календар');
  if (existing) {
    return { type: 'add_payment_calendar', status: 'skipped', message: 'already exists',
             sheet_name: '📅 Платіжний календар', spreadsheet_url: ss.getUrl() };
  }
  // Викликати існуючу функцію
  var calSheet = ss.insertSheet('📅 Платіжний календар');
  setupPaymentCalendar_(calSheet, change.payload || {});
  return { type: 'add_payment_calendar', status: 'ok',
           sheet_name: '📅 Платіжний календар', spreadsheet_url: ss.getUrl() };
}
```

**Payload від бота:**
```json
{
  "action": "update_table",
  "spreadsheet_id": "існуючий cashflow spreadsheet_id",
  "telegram_id": "...",
  "changes": [{
    "type": "add_payment_calendar",
    "payload": {
      "articles": { "inflows": [...], "outflows": [...] }
    }
  }]
}
```

**Відповідь:**
```json
{
  "status": "ok",
  "changes_applied": [{ "type": "add_payment_calendar", "status": "ok", "spreadsheet_url": "..." }]
}
```

---

### 1.2 Новий report_type: `salary`

**Де:** новий case в `buildTable()` → `buildSalary_(context)`

**Задача:** побудувати зарплатну відомість. Якщо `access_mode: tab_in_main` — додати вкладки в існуючий файл. Якщо `access_mode: separate_file` — новий файл в папці клієнта.

```javascript
// В buildTable(), в switch по reportType:
case 'salary':
  buildSalary_(context);
  break;

function buildSalary_(ctx) {
  var ss = ctx.spreadsheet;
  var payload = ctx.payload;
  var employees = Array.isArray(payload.employees) ? payload.employees : [];
  var accessMode = payload.access_mode || 'separate_file';

  // Якщо tab_in_main — відкрити існуючий файл замість нового
  if (accessMode === 'tab_in_main' && payload.main_spreadsheet_id) {
    ss = SpreadsheetApp.openById(payload.main_spreadsheet_id);
    ctx.spreadsheet = ss;
  }

  renameDefaultSheet_(ss, '📋 Відомість');
  ctx.sheetsBuilt.push('📋 Відомість');

  // Аркуш введення: Відомість
  var sheet = ss.getSheetByName('📋 Відомість');
  setupSalaryInputSheet_(sheet, employees);

  // Аркуш формул: Зведення
  var summary = ensureSheet_(ss, '📊 Зведення зарплат');
  setupSalarySummary_(summary);
  protectSheet_(summary, 'Зведення зарплат');
  ctx.sheetsBuilt.push('📊 Зведення зарплат');

  // Довідник
  var dirs = ensureSheet_(ss, '📋 Довідник персоналу');
  setupSalaryDirectories_(dirs, employees);
  ctx.sheetsBuilt.push('📋 Довідник персоналу');

  autoResizeAllColumns(sheet);
  trimSheet(sheet, 200, 12);
}

function setupSalaryInputSheet_(sheet, employees) {
  sheet.clear();
  var headers = ['Місяць', 'ПІБ', 'Посада', 'Оклад', 'Бонус', 'Нараховано',
                 'ЄСВ (22%)', 'ПДФО (18%)', 'ВЗ (5%)', 'До виплати', 'Дата виплати', 'Коментар'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange('A:A').setNumberFormat('MMMM yyyy');
  sheet.getRange('D:J').setNumberFormat('# ##0.00');

  // Формули для нарахувань (рядки 2-200)
  for (var r = 2; r <= 10; r++) {
    sheet.getRange(r, 6).setFormula('=IF(D' + r + '="","",D' + r + '+E' + r + ')'); // Нараховано
    sheet.getRange(r, 7).setFormula('=IF(F' + r + '="","",ROUND(F' + r + '*0.22,2))'); // ЄСВ
    sheet.getRange(r, 8).setFormula('=IF(F' + r + '="","",ROUND(F' + r + '*0.18,2))'); // ПДФО
    sheet.getRange(r, 9).setFormula('=IF(F' + r + '="","",ROUND(F' + r + '*0.05,2))'); // ВЗ
    sheet.getRange(r, 10).setFormula('=IF(F' + r + '="","",F' + r + '-H' + r + '-I' + r + ')'); // До виплати
  }

  // Довідник по іменах
  if (employees.length) {
    var names = employees.map(function(e) { return e.name || ''; }).filter(Boolean);
    var validation = SpreadsheetApp.newDataValidation().requireValueInList(names, true).build();
    sheet.getRange(2, 2, 198, 1).setDataValidation(validation);
  }

  protectHeader_(sheet);
  applySheetBanding_(sheet, INPUT_THEME, 200, headers.length);
}

function setupSalarySummary_(sheet) {
  sheet.clear();
  var months = ['Місяць', 'Загальний ФОП', 'Нараховано', 'Сплачено податків', 'Чисті виплати'];
  sheet.getRange(1, 1, 1, months.length).setValues([months]);
  sheet.setFrozenRows(1);
  // Формули по місяцях — агрегація з аркушу Відомість
  // Приклад для рядка 2 (перший місяць):
  // =SUMIF('📋 Відомість'!A:A, A2, '📋 Відомість'!D:D) — ФОП
  // Залишити порожнім — заповниться даними
  sheet.getRange('B:E').setNumberFormat('# ##0.00');
}

function setupSalaryDirectories_(sheet, employees) {
  sheet.clear();
  sheet.getRange(1, 1, 1, 3).setValues([['ПІБ', 'Посада', 'Тип виплати']]);
  if (employees.length) {
    var rows = employees.map(function(e) {
      return [e.name || '', e.role || '', e.salary_type || 'оклад'];
    });
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
}
```

**Payload:**
```json
{
  "action": "build_table",
  "report_type": "salary",
  "business_name": "...",
  "telegram_id": "...",
  "telegram_username": "...",
  "access_mode": "separate_file",
  "main_spreadsheet_id": "ID основного файлу (якщо tab_in_main)",
  "employees": [
    { "name": "Марина", "role": "Менеджер", "salary_type": "оклад", "base_amount": 25000 },
    { "name": "Дмитро", "role": "Підрядник", "salary_type": "підрядник", "base_amount": 0 }
  ]
}
```

---

### 1.3 Новий report_type: `accountable`

**Де:** новий case в `buildTable()` → `buildAccountable_(context)`

**Задача:** окремий файл підзвітних для конкретної людини. По одному файлу на людину.

```javascript
case 'accountable':
  buildAccountable_(context);
  break;

function buildAccountable_(ctx) {
  var ss = ctx.spreadsheet;
  var payload = ctx.payload;
  var personName = payload.person_name || 'Співробітник';

  renameDefaultSheet_(ss, '📝 Витрати');
  ctx.sheetsBuilt.push('📝 Витрати');

  var expSheet = ss.getSheetByName('📝 Витрати');
  setupAccountableExpenseSheet_(expSheet, payload.articles_outflows || []);

  var summary = ensureSheet_(ss, '📊 Підсумок');
  setupAccountableSummary_(summary, personName);
  protectSheet_(summary, 'Підсумок підзвітних');
  ctx.sheetsBuilt.push('📊 Підсумок');

  autoResizeAllColumns(expSheet);
  trimSheet(expSheet, 200, 6);
}

function setupAccountableExpenseSheet_(sheet, articles) {
  sheet.clear();
  var headers = ['Дата', 'Що куплено / Опис', 'Стаття', 'Сума', 'Чек/Коментар', 'Статус'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange('A:A').setNumberFormat('dd.mm.yyyy');
  sheet.getRange('D:D').setNumberFormat('# ##0.00');

  // Dropdown для статей
  if (articles.length) {
    var validation = SpreadsheetApp.newDataValidation().requireValueInList(articles, true).build();
    sheet.getRange(2, 3, 198, 1).setDataValidation(validation);
  }

  // Dropdown для статусу
  var statusValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(['очікує', 'компенсовано'], true).build();
  sheet.getRange(2, 6, 198, 1).setDataValidation(statusValidation);

  protectHeader_(sheet);
  applySheetBanding_(sheet, INPUT_THEME, 200, 6);
}

function setupAccountableSummary_(sheet, personName) {
  sheet.clear();
  sheet.getRange('A1').setValue(personName + ' — підзвітні витрати');
  sheet.getRange(3, 1, 4, 2).setValues([
    ['Всього витрачено', "=SUM('📝 Витрати'!D:D)"],
    ['Компенсовано', "=SUMIF('📝 Витрати'!F:F,\"компенсовано\",'📝 Витрати'!D:D)"],
    ['Очікує компенсації', '=B3-B4'],
    ['Аванс отриманий', 0]
  ]);
  sheet.getRange('B3:B6').setNumberFormat('# ##0.00');
}
```

**Payload:**
```json
{
  "action": "build_table",
  "report_type": "accountable",
  "business_name": "...",
  "telegram_id": "...",
  "telegram_username": "...",
  "person_name": "Дмитро",
  "articles_outflows": ["Офісні витрати", "Транспорт", "Представницькі"]
}
```

---

### 1.4 Повна реалізація `buildBalance_()` — КРИТИЧНО

**Де:** замінити існуючу заглушку `buildBalance_()` повноцінною реалізацією.

**Поточний стан:** будує майже порожній аркуш, без формул і вкладок.

```javascript
function buildBalance_(ctx) {
  var ss = ctx.spreadsheet;
  var payload = ctx.payload;
  var balanceArticles = payload.balance_articles || {};
  var auxSheets = Array.isArray(payload.aux_sheets) ? payload.aux_sheets : [];
  var cashflowSpreadsheetId = payload.cashflow_spreadsheet_id || '';

  renameDefaultSheet_(ss, '📊 Баланс');
  ctx.sheetsBuilt = ['📊 Баланс'];

  // Допоміжні вкладки (умовно)
  if (auxSheets.indexOf('warehouse') >= 0) {
    var warehouse = ensureSheet_(ss, '📦 Склад');
    setupWarehouseSheet_(warehouse);
    ctx.sheetsBuilt.push('📦 Склад');
  }

  if (auxSheets.indexOf('fixed_assets') >= 0) {
    var fa = ensureSheet_(ss, '🏢 Основні засоби');
    setupFixedAssetsSheet_(fa);
    ctx.sheetsBuilt.push('🏢 Основні засоби');
  }

  if (auxSheets.indexOf('receivables') >= 0) {
    var rec = ensureSheet_(ss, '👤 Дебіторська заборгованість');
    setupReceivablesSheet_(rec);
    ctx.sheetsBuilt.push('👤 Дебіторська заборгованість');
  }

  if (auxSheets.indexOf('payables') >= 0) {
    var pay = ensureSheet_(ss, '💳 Кредиторська заборгованість');
    setupPayablesSheet_(pay);
    ctx.sheetsBuilt.push('💳 Кредиторська заборгованість');
  }

  var dirs = ensureSheet_(ss, '📋 Довідники');
  ctx.sheetsBuilt.push('📋 Довідники');

  var settings = ensureSheet_(ss, '⚙️ Налаштування');
  setupSettingsSheet_(settings, payload.business_name);
  ctx.sheetsBuilt.push('⚙️ Налаштування');

  var refs = ensureSheet_(ss, '🔗 References');
  setupReferencesSheet_(refs, '', '', ss.getUrl());
  if (cashflowSpreadsheetId) {
    refs.getRange('A4').setValue('cashflow_spreadsheet_id');
    refs.getRange('B4').setValue(cashflowSpreadsheetId);
  }
  ctx.sheetsBuilt.push('🔗 References');

  // Основний аркуш балансу
  var balance = ss.getSheetByName('📊 Баланс');
  setupBalanceSummary_(balance, balanceArticles, auxSheets, cashflowSpreadsheetId);
  protectSheet_(balance, 'Зведений аркуш Балансу');
  balance.setFrozenColumns(1);
  balance.setFrozenRows(2);
}

function setupBalanceSummary_(sheet, articles, auxSheets, cashflowId) {
  sheet.clear();
  var months = ['Стаття', 'Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер',
                'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
  sheet.getRange(1, 1, 1, months.length).setValues([months]);

  var row = 2;
  var assets = Array.isArray(articles.assets) ? articles.assets : [];
  var liabilities = Array.isArray(articles.liabilities) ? articles.liabilities : [];
  var equity = Array.isArray(articles.equity) ? articles.equity : [];

  // СЕКЦІЯ АКТИВИ
  sheet.getRange(row, 1).setValue('АКТИВИ').setFontWeight('bold')
    .setBackground(THEME.HEADER_BG).setFontColor(THEME.HEADER_TEXT);
  row++;

  var assetStartRow = row;
  assets.forEach(function(article) {
    sheet.getRange(row, 1).setValue(article);
    // Якщо стаття пов'язана з допоміжною вкладкою — формула, інакше — 0
    if (article.indexOf('Запаси') >= 0 && auxSheets.indexOf('warehouse') >= 0) {
      for (var m = 2; m <= 13; m++) {
        sheet.getRange(row, m).setFormula("=SUMIF('📦 Склад'!C:C,\"прихід\",'📦 Склад'!E:E)-SUMIF('📦 Склад'!C:C,\"списання\",'📦 Склад'!E:E)");
      }
    } else if (article.indexOf('Основні засоби') >= 0 && auxSheets.indexOf('fixed_assets') >= 0) {
      for (var m = 2; m <= 13; m++) {
        sheet.getRange(row, m).setFormula("=SUM('🏢 Основні засоби'!D:D)");
      }
    } else if (article.indexOf('Дебіторська') >= 0 && auxSheets.indexOf('receivables') >= 0) {
      for (var m = 2; m <= 13; m++) {
        sheet.getRange(row, m).setFormula("=SUM('👤 Дебіторська заборгованість'!E:E)");
      }
    } else if ((article.indexOf('Гроші') >= 0 || article.indexOf('Рахунок') >= 0) && cashflowId) {
      for (var m = 2; m <= 13; m++) {
        sheet.getRange(row, m).setFormula('=IFERROR(IMPORTRANGE("' + cashflowId + '","⚙️ Налаштування!B4"),0)');
      }
    } else {
      for (var m = 2; m <= 13; m++) {
        sheet.getRange(row, m).setValue(0);
      }
    }
    row++;
  });

  // Разом активи
  sheet.getRange(row, 1).setValue('РАЗОМ АКТИВІВ').setFontWeight('bold').setBackground(THEME.TOTAL_BG).setFontColor(THEME.TOTAL_TEXT);
  for (var m = 2; m <= 13; m++) {
    sheet.getRange(row, m).setFormula('=SUM(' + columnToLetter_(m) + assetStartRow + ':' + columnToLetter_(m) + (row - 1) + ')');
  }
  var assetTotalRow = row;
  row += 2;

  // СЕКЦІЯ ЗОБОВ'ЯЗАННЯ
  sheet.getRange(row, 1).setValue("ЗОБОВ'ЯЗАННЯ").setFontWeight('bold')
    .setBackground(THEME.HEADER_BG).setFontColor(THEME.HEADER_TEXT);
  row++;

  var liabStartRow = row;
  liabilities.forEach(function(article) {
    sheet.getRange(row, 1).setValue(article);
    if (article.indexOf('Кредиторська') >= 0 && auxSheets.indexOf('payables') >= 0) {
      for (var m = 2; m <= 13; m++) {
        sheet.getRange(row, m).setFormula("=SUM('💳 Кредиторська заборгованість'!E:E)");
      }
    } else {
      for (var m = 2; m <= 13; m++) { sheet.getRange(row, m).setValue(0); }
    }
    row++;
  });

  sheet.getRange(row, 1).setValue('РАЗОМ ЗОБОВ\'ЯЗАНЬ').setFontWeight('bold').setBackground(THEME.TOTAL_BG).setFontColor(THEME.TOTAL_TEXT);
  for (var m = 2; m <= 13; m++) {
    sheet.getRange(row, m).setFormula('=SUM(' + columnToLetter_(m) + liabStartRow + ':' + columnToLetter_(m) + (row - 1) + ')');
  }
  var liabTotalRow = row;
  row += 2;

  // СЕКЦІЯ ВЛАСНИЙ КАПІТАЛ
  sheet.getRange(row, 1).setValue('ВЛАСНИЙ КАПІТАЛ').setFontWeight('bold')
    .setBackground(THEME.HEADER_BG).setFontColor(THEME.HEADER_TEXT);
  row++;

  var eqStartRow = row;
  equity.forEach(function(article) {
    sheet.getRange(row, 1).setValue(article);
    for (var m = 2; m <= 13; m++) { sheet.getRange(row, m).setValue(0); }
    row++;
  });

  sheet.getRange(row, 1).setValue('РАЗОМ КАПІТАЛУ').setFontWeight('bold').setBackground(THEME.TOTAL_BG).setFontColor(THEME.TOTAL_TEXT);
  for (var m = 2; m <= 13; m++) {
    sheet.getRange(row, m).setFormula('=SUM(' + columnToLetter_(m) + eqStartRow + ':' + columnToLetter_(m) + (row - 1) + ')');
  }
  var eqTotalRow = row;
  row += 2;

  // КОНТРОЛЬНИЙ РЯДОК (має бути 0)
  sheet.getRange(row, 1).setValue('БАЛАНС (контроль, має бути 0)').setFontWeight('bold');
  for (var m = 2; m <= 13; m++) {
    sheet.getRange(row, m).setFormula('=' + columnToLetter_(m) + assetTotalRow + '-' + columnToLetter_(m) + liabTotalRow + '-' + columnToLetter_(m) + eqTotalRow);
  }
  var rules = sheet.getConditionalFormatRules();
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=ABS(B' + row + ')>1')
    .setBackground(THEME.WARN_BG).setFontColor(THEME.WARN_TEXT)
    .setRanges([sheet.getRange(row, 2, 1, 12)]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=ABS(B' + row + ')<=1')
    .setBackground(THEME.TOTAL_BG).setFontColor(THEME.TOTAL_TEXT)
    .setRanges([sheet.getRange(row, 2, 1, 12)]).build());
  sheet.setConditionalFormatRules(rules);

  sheet.getRange(2, 2, row - 1, 12).setNumberFormat('# ##0.00');
  sheet.setFrozenRows(1);
}

// Вкладка Склад
function setupWarehouseSheet_(sheet) {
  sheet.clear();
  var headers = ['Дата', 'Назва товару/матеріалу', 'Тип (прихід/списання)', 'Кількість', 'Сума', 'Коментар'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange('A:A').setNumberFormat('dd.mm.yyyy');
  sheet.getRange('E:E').setNumberFormat('# ##0.00');
  var typeValidation = SpreadsheetApp.newDataValidation().requireValueInList(['прихід', 'списання'], true).build();
  sheet.getRange(2, 3, 198, 1).setDataValidation(typeValidation);
  protectHeader_(sheet);
  applySheetBanding_(sheet, INPUT_THEME, 200, 6);
  trimSheet(sheet, 200, 6);
}

// Вкладка Основні засоби
function setupFixedAssetsSheet_(sheet) {
  sheet.clear();
  var headers = ['Назва', 'Дата придбання', 'Початкова вартість', 'Амортизація/міс', 'Залишкова вартість', 'Коментар'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange('B:B').setNumberFormat('dd.mm.yyyy');
  sheet.getRange('C:E').setNumberFormat('# ##0.00');
  // Залишкова вартість = формула
  for (var r = 2; r <= 50; r++) {
    sheet.getRange(r, 5).setFormula('=IF(C' + r + '="","",C' + r + '-D' + r + '*DATEDIF(B' + r + ',TODAY(),"M"))');
  }
  protectHeader_(sheet);
  applySheetBanding_(sheet, INPUT_THEME, 50, 6);
  trimSheet(sheet, 50, 6);
}

// Вкладка Дебіторська заборгованість
function setupReceivablesSheet_(sheet) {
  sheet.clear();
  var headers = ['Контрагент', 'Дата виникнення', 'Сума', 'Оплачено', 'Залишок', 'Термін оплати', 'Статус'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange('B:B').setNumberFormat('dd.mm.yyyy');
  sheet.getRange('F:F').setNumberFormat('dd.mm.yyyy');
  sheet.getRange('C:E').setNumberFormat('# ##0.00');
  for (var r = 2; r <= 100; r++) {
    sheet.getRange(r, 5).setFormula('=IF(C' + r + '="","",C' + r + '-D' + r + ')');
  }
  var statusValidation = SpreadsheetApp.newDataValidation().requireValueInList(['активна', 'прострочена', 'закрита'], true).build();
  sheet.getRange(2, 7, 98, 1).setDataValidation(statusValidation);
  protectHeader_(sheet);
  trimSheet(sheet, 100, 7);
}

// Вкладка Кредиторська заборгованість
function setupPayablesSheet_(sheet) {
  sheet.clear();
  var headers = ['Контрагент', 'Дата виникнення', 'Сума', 'Сплачено', 'Залишок', 'Термін оплати', 'Статус'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange('B:B').setNumberFormat('dd.mm.yyyy');
  sheet.getRange('F:F').setNumberFormat('dd.mm.yyyy');
  sheet.getRange('C:E').setNumberFormat('# ##0.00');
  for (var r = 2; r <= 100; r++) {
    sheet.getRange(r, 5).setFormula('=IF(C' + r + '="","",C' + r + '-D' + r + ')');
  }
  var statusValidation = SpreadsheetApp.newDataValidation().requireValueInList(['активна', 'прострочена', 'закрита'], true).build();
  sheet.getRange(2, 7, 98, 1).setDataValidation(statusValidation);
  protectHeader_(sheet);
  trimSheet(sheet, 100, 7);
}
```

**Розширений payload для balance:**
```json
{
  "action": "build_table",
  "report_type": "balance",
  "business_name": "...",
  "telegram_id": "...",
  "telegram_username": "...",
  "balance_articles": {
    "assets": ["Гроші на рахунках", "Дебіторська заборгованість", "Запаси", "Основні засоби"],
    "liabilities": ["Кредиторська заборгованість", "Аванси від клієнтів"],
    "equity": ["Статутний капітал", "Нерозподілений прибуток"]
  },
  "aux_sheets": ["warehouse", "fixed_assets", "receivables", "payables"],
  "cashflow_spreadsheet_id": "ID cashflow-файлу для IMPORTRANGE грошей"
}
```

---

### 1.5 Новий action: `add_row`

**Де:** новий case в `switch (payload.action)` в `doPost()`

**Задача:** вставити рядок даних в конкретний аркуш. Використовується ботом-тренером Майклом.

```javascript
case 'add_row':
  output = addRow(payload);
  break;

function addRow(payload) {
  if (!payload.spreadsheet_id) {
    return respond({ status: 'error', message: 'spreadsheet_id is required' });
  }
  if (!payload.sheet_name) {
    return respond({ status: 'error', message: 'sheet_name is required' });
  }

  logInfo_('add_row.start', 'Adding row to sheet', {
    spreadsheet_id: payload.spreadsheet_id,
    sheet_name: payload.sheet_name
  });

  var ss = SpreadsheetApp.openById(payload.spreadsheet_id);
  var sheet = ss.getSheetByName(payload.sheet_name);

  if (!sheet) {
    return respond({ status: 'error', message: 'Sheet not found: ' + payload.sheet_name });
  }

  var row = payload.row || {};
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var rowData = headers.map(function(header) {
    // Маппінг заголовків на поля payload.row
    var key = headerToKey_(header);
    return row[key] !== undefined ? row[key] : '';
  });

  sheet.appendRow(rowData);
  var lastRow = sheet.getLastRow();

  logInfo_('add_row.done', 'Row added', { row: lastRow, sheet: payload.sheet_name });

  return respond({
    status: 'ok',
    row_number: lastRow,
    sheet_name: payload.sheet_name,
    spreadsheet_url: ss.getUrl(),
    trace_id: CURRENT_TRACE_ID || ''
  });
}

function headerToKey_(header) {
  // Маппінг українських заголовків → ключі payload.row
  var map = {
    'Дата': 'date', 'Дата оплати': 'date', 'Дата визнання': 'recognition_date',
    'Контрагент': 'counterparty', 'Стаття': 'article', 'cost_type': 'cost_type',
    'Сума': 'amount', 'Коментар': 'comment', 'Проєкт': 'project',
    'ПІБ': 'name', 'Що куплено': 'description', 'Що куплено / Опис': 'description',
    'Чек/Коментар': 'comment', 'Статус': 'status'
  };
  return map[header] || header.toLowerCase().replace(/\s+/g, '_');
}
```

**Payload:**
```json
{
  "action": "add_row",
  "spreadsheet_id": "...",
  "sheet_name": "⬆️ Витрати",
  "telegram_id": "...",
  "row": {
    "date": "2026-05-19",
    "counterparty": "Rozetka",
    "article": "Офісні витрати",
    "cost_type": "opex",
    "amount": 3000,
    "comment": "Чайник в офіс"
  }
}
```

---

### 1.6 Новий action: `get_articles`

**Де:** новий case в `switch (payload.action)`

**Задача:** повернути всі статті студента зі spreadsheet — щоб бот-тренер знав точні назви.

```javascript
case 'get_articles':
  output = getArticles(payload);
  break;

function getArticles(payload) {
  if (!payload.spreadsheet_id) {
    return respond({ status: 'error', message: 'spreadsheet_id is required' });
  }

  var ss = SpreadsheetApp.openById(payload.spreadsheet_id);
  var namedRanges = ss.getNamedRanges();
  var result = { inflows: [], outflows: [] };

  namedRanges.forEach(function(nr) {
    var name = nr.getName();
    var values = nr.getRange().getDisplayValues().reduce(function(acc, row) {
      return acc.concat(row.filter(function(v) { return v !== ''; }));
    }, []);

    if (name === 'articles_inflows') result.inflows = values;
    if (name === 'articles_outflows') result.outflows = values;
  });

  // Також витягти cost_type з Довідників
  var dirs = ss.getSheetByName('📋 Довідники');
  var costTypeMap = {};
  if (dirs) {
    var headers = dirs.getRange(1, 1, 1, dirs.getLastColumn()).getDisplayValues()[0];
    var articleCol = headers.indexOf('Статті витрат') + 1;
    var costTypeCol = headers.indexOf('cost_type') + 1;
    if (articleCol > 0 && costTypeCol > 0 && dirs.getLastRow() > 1) {
      var data = dirs.getRange(2, articleCol, dirs.getLastRow() - 1, 1).getDisplayValues();
      var types = dirs.getRange(2, costTypeCol, dirs.getLastRow() - 1, 1).getDisplayValues();
      data.forEach(function(row, i) {
        if (row[0]) costTypeMap[row[0]] = types[i][0] || 'opex';
      });
    }
  }

  return respond({
    status: 'ok',
    articles: result,
    cost_type_map: costTypeMap,
    spreadsheet_id: payload.spreadsheet_id,
    trace_id: CURRENT_TRACE_ID || ''
  });
}
```

---

### 1.7 Оновлення `validatePayload()` і `getRequiredSheets_()`

Додати нові типи в список допустимих:

```javascript
// В validatePayload():
var validTypes = ['cashflow', 'pl', 'balance', 'cashflow_and_pl', 'dashboard', 'salary', 'accountable'];

// В getRequiredSheets_():
if (reportType === 'salary') {
  return ['📋 Відомість', '📊 Зведення зарплат', '📋 Довідник персоналу'];
}
if (reportType === 'accountable') {
  return ['📝 Витрати', '📊 Підсумок'];
}
```

---

## ЧАСТИНА 2 — ЗМІНИ В БОТАХ

### 2.1 Bot 2.3 Payment Calendar — розширення

**Поточний стан:** бот є, але не будує таблицю.

**Що змінити в системному промпті:**

```
Після пояснення концепції платіжного календаря:
1. Завантаж context.sheetsUrl (spreadsheet_id з spreadsheet_registry.main_file)
2. Виклич Apps Script: action="update_table", changes=[{type:"add_payment_calendar", 
   payload:{articles: context.cashflowArticles}}], spreadsheet_id=main_file.spreadsheet_id
3. Отримай підтвердження що вкладка створена
4. Надішли студенту повідомлення з посиланням на файл
5. Збережи оновлений spreadsheet_registry (додай "📅 Платіжний календар" до main_file.sheets)
```

**Додати loadFile ноди:**
- `user_onboarding_data` → `context.onboarding_result`
- `articles` → `context.cashflowArticles`
- `spreadsheet_registry` → `context.registry`

---

### 2.2 Bot 3.3 Diagnostics — додати питання про проєкти

**Що додати в кінці діалогу** (після основних питань по механіці):

```
НОВИЙ БЛОК ПИТАНЬ (тільки якщо тип бізнесу не очевидно без проєктний):

Питання: "Твій бізнес виконує окремі проєкти, замовлення або контракти — 
де важливо знати прибуток по кожному окремо?"

Якщо так:
  "Наведи 2-3 приклади поточних проєктів або типів замовлень"
  → зберегти projects: [...]
  → pl_mode: "by_project"

Якщо ні:
  → pl_mode: "total"

НЕ ПИТАТИ якщо з business_process/swimlane очевидно що проєктів нема:
  - роздрібна торгівля (багато дрібних продажів)
  - стандартне виробництво типового продукту
  - підписочна модель з однотипними клієнтами
```

**Оновити збережений файл financial_mechanics:**
```yaml
pl_mode: "total" | "by_project"
projects: ["Проєкт А", "Проєкт Б"]  # якщо by_project
```

---

### 2.3 Bot 4.2 Salaries — розширення до побудови таблиці

**Додати в кінець діалогу** (після збору salary_processes):

```
НОВИЙ БЛОК:

1. "Хто буде вести зарплатну відомість у вашій компанії?"
   (ім'я / роль людини)

2. "Ця людина має доступ до основної фінансової таблиці з Cashflow і P&L?"
   Так → access_mode: "tab_in_main"
   Ні  → access_mode: "separate_file"

3. Виклик Apps Script: build_table, report_type="salary"
   Передати employees (зібрані раніше в діалозі) + access_mode

4. Якщо separate_file → пояснити студенту що це окремий файл і дати посилання
   Якщо tab_in_main → пояснити що вкладки додані в основний файл

5. Зберегти посилання в spreadsheet_registry: aux_files → {type:"salary", ...}
```

**Форматування employees для Apps Script:**
```json
"employees": [
  {"name": "Марина", "role": "Менеджер", "salary_type": "оклад"},
  {"name": "Дмитро", "role": "Підрядник", "salary_type": "підрядник"}
]
```

---

### 2.4 Bot 4.3 Payments — розширення до побудови таблиць підзвітних

**Додати в діалог** при виявленні підзвітних витрат:

```
Якщо в діалозі з'ясувалось що є люди які вносять підзвітні витрати:

Для кожної такої людини:
1. "Ця людина має доступ до основної таблиці з Cashflow і P&L?"
   Так → не потрібен окремий файл (вносить напряму в ⬆️ Витрати)
   Ні  → потрібен окремий файл підзвітних

2. Для кожної людини без доступу:
   Виклик Apps Script: build_table, report_type="accountable"
   Передати: person_name, articles_outflows (список статей витрат)

3. Зберегти посилання в spreadsheet_registry:
   aux_files → {type:"accountable", person:"...", spreadsheet_id:"...", url:"..."}

4. Надіслати студенту посилання на файл підзвітних для кожної людини
```

---

### 2.5 Bot 5.1a Balance Articles — розширення (визначення допоміжних вкладок)

**Додати питання по кожній категорії активів:**

```
При зборі статей активів:

Якщо студент підтверджує наявність:
- Товарів, матеріалів, запасів → aux_sheets.push("warehouse")
  + питання: "Хто веде облік складу?"
  
- Обладнання, транспорту, меблів → aux_sheets.push("fixed_assets")
  + питання: "Скільки приблизно позицій ОЗ?"
  
- Клієнтів що платять після послуги → aux_sheets.push("receivables")
  
- Боргів перед постачальниками → aux_sheets.push("payables")

Зберегти в balance_articles:
{
  assets: [...],
  liabilities: [...],
  equity: [...],
  aux_sheets: ["warehouse", "fixed_assets"]  // ← НОВЕ ПОЛЕ
}
```

---

### 2.6 Bot 5.1b Balance Table — розширення payload

**Оновити виклик Apps Script** — передати нові поля:

```json
{
  "action": "build_table",
  "report_type": "balance",
  "balance_articles": { "assets": [...], "liabilities": [...], "equity": [...] },
  "aux_sheets": ["warehouse", "fixed_assets"],
  "cashflow_spreadsheet_id": "← з context.registry.main_file.spreadsheet_id"
}
```

---

## ЧАСТИНА 3 — НОВИЙ БОТ: Michael Trainer

### 3.1 Загальна інформація

| Параметр | Значення |
|----------|----------|
| Назва | Michael Trainer |
| Slug | `bot-michael-trainer` |
| Модель | Claude Sonnet |
| Тригер | `/start michael_trainer` |
| Монетизація | Перший тиждень безкоштовно, далі — WayForPay |

### 3.2 Логіка монетизації

```
При кожному зверненні до бота:

1. Перевірити trainer_first_used_at в базі
   - Якщо немає → записати поточний час, продовжити
   - Якщо є → перейти до кроку 2

2. Якщо (now - trainer_first_used_at) <= 7 днів:
   → Продовжити нормально

3. Якщо (now - trainer_first_used_at) > 7 днів:
   - Перевірити trainer_paid в базі
   - Якщо true → продовжити нормально
   - Якщо false → відповісти:
     "Майкл: Ваш безкоштовний тиждень завершився. 
      Щоб я продовжував допомагати вести ваші таблиці — 
      оформіть підписку: [посилання WayForPay]
      Після оплати просто напишіть мені — і я одразу до ваших послуг 🙂"
     → зупинити обробку запиту
```

### 3.3 Системний промпт бота

```
Ти — Майкл, AI-асистент курсу «Фінансова система малого бізнесу».

Твоє завдання: допомагати студенту вносити фінансові операції в таблиці.

Студент описує операцію вільним текстом — ти:
1. Визначаєш куди це відноситься (Cashflow, P&L, Баланс, підзвітні, ОЗ тощо)
2. Визначаєш точну статтю з списку статей студента
3. Пояснюєш своє рішення простою мовою
4. Запитуєш підтвердження
5. Після підтвердження — вносиш в таблиці через Apps Script

КОНТЕКСТ СТУДЕНТА (підвантажується при старті):
- Ім'я: {{context.onboarding_result.name}}
- Бізнес: {{context.onboarding_result.company_description}}
- Статті Cashflow (надходження): {{context.articles.cashflow_inflows}}
- Статті Cashflow (витрати): {{context.articles.cashflow_outflows}}
- Статті P&L: {{context.articles.pl_outflows}} з cost_type
- Таблиці: {{context.registry}}

АЛГОРИТМ КЛАСИФІКАЦІЇ:
1. Отримай cost_type_map через get_articles (якщо ще не завантажений)
2. Знайди статтю за ключовими словами або задай уточнювальне питання
3. Визнач в яку таблицю (Cashflow → ⬆️ Витрати або ⬇️ Надходження, Balance → допоміжні вкладки)
4. Сформуй row об'єкт з усіма потрібними полями

ПІДТВЕРДЖЕННЯ (завжди перед внесенням):
"Ось як я класифікую цю операцію:
📊 Cashflow → ⬆️ Витрати → стаття «{article}»
📈 P&L → витрати → {cost_type} → стаття «{article}»
💰 Сума: {amount} грн | Дата: {date}

Вносимо?"

Якщо підтверджено → виклик add_row для кожної потрібної таблиці.
```

### 3.4 loadFile ноди

```
- user_onboarding_data → context.onboarding_result
- articles → context.articles
- spreadsheet_registry → context.registry
- balance_articles → context.balanceArticles (якщо є)
```

### 3.5 Apps Script виклики

**Крок 1 — отримати статті:**
```json
{ "action": "get_articles", "spreadsheet_id": "context.registry.main_file.spreadsheet_id" }
```

**Крок 2 — внести в Cashflow:**
```json
{
  "action": "add_row",
  "spreadsheet_id": "context.registry.main_file.spreadsheet_id",
  "sheet_name": "⬆️ Витрати",
  "row": { "date": "...", "counterparty": "...", "article": "...", "cost_type": "...", "amount": 3000, "comment": "..." }
}
```

**Крок 3 (якщо є баланс і операція балансова) — внести в допоміжну вкладку:**
```json
{
  "action": "add_row",
  "spreadsheet_id": "context.registry.balance_file.spreadsheet_id",
  "sheet_name": "🏢 Основні засоби",
  "row": { "name": "Чайник", "date": "...", "amount": 3000, "comment": "Офісне обладнання" }
}
```

---

## ЧАСТИНА 4 — ПРІОРИТЕТИ І ПОРЯДОК ВИКОНАННЯ

| # | Завдання | Де | Пріоритет |
|---|----------|----|-----------|
| 1 | `buildBalance_()` повна реалізація | Apps Script | 🔴 КРИТИЧНО |
| 2 | `add_payment_calendar` в update_table | Apps Script | 🔴 КРИТИЧНО |
| 3 | `add_row` і `get_articles` actions | Apps Script | 🟠 ВИСОКИЙ |
| 4 | `salary` і `accountable` report_type | Apps Script | 🟠 ВИСОКИЙ |
| 5 | Bot 2.3 — виклик add_payment_calendar | Бот | 🟠 ВИСОКИЙ |
| 6 | Bot 3.3 — питання про проєкти | Бот | 🟡 СЕРЕДНІЙ |
| 7 | Bot 4.2 — побудова зарплатної відомості | Бот | 🟡 СЕРЕДНІЙ |
| 8 | Bot 4.3 — побудова файлів підзвітних | Бот | 🟡 СЕРЕДНІЙ |
| 9 | Bot 5.1a — визначення aux_sheets | Бот | 🟡 СЕРЕДНІЙ |
| 10 | Bot 5.1b — передача aux_sheets і cashflow_id | Бот | 🟡 СЕРЕДНІЙ |
| 11 | Michael Trainer — новий бот | Бот | 🟢 НАСТУПНА ІТЕРАЦІЯ |

**Рекомендований порядок:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

---

*ТЗ v1.0 | Олександр Мацук | @matsukoleksandr | 2026*
