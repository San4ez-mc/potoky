# 🚀 Інструкція з запуску міграцій на хостингу

## Помилка яку ви бачили:
```
SQLSTATE[42S02]: Base table or view not found: 1146 Table 'fineko_content.projects' doesn't exist
```

Це означає що таблиця `projects` не існує в базі даних на хостингу.

---

## Рішення 1: Через браузер (найпростіше)

1. Завантажте файл `run-migrations.php` на хостинг
2. Відкрийте в браузері:
   ```
   https://fineko.space/content/run-migrations.php?password=migrate2026
   ```
3. Дочекайтесь виконання міграцій (побачите зелені галочки ✅)
4. Оновіть основну сторінку

---

## Рішення 2: Через SSH (якщо є доступ)

```bash
cd /home/fineko/fineko.space/content/
php run-migrations.php
```

---

## Рішення 3: Через phpMyAdmin (ручний спосіб)

Якщо ні браузер, ні SSH не працюють:

1. Відкрийте phpMyAdmin на хостингу
2. Виберіть базу даних `fineko_content`
3. Перейдіть в розділ SQL
4. Виконайте такі запити по черзі:

```sql
-- 1. Створення таблиці projects
CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Створення таблиці admin_projects
CREATE TABLE IF NOT EXISTS admin_projects (
    admin_id INT NOT NULL,
    project_id INT NOT NULL,
    can_manage_settings TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (admin_id, project_id),
    CONSTRAINT fk_admin_projects_admin FOREIGN KEY (admin_id) REFERENCES admin(id) ON DELETE CASCADE,
    CONSTRAINT fk_admin_projects_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Додавання project_id в settings
ALTER TABLE settings ADD COLUMN project_id INT NULL AFTER id;

-- 4. Видалення старого індексу (якщо є)
ALTER TABLE settings DROP INDEX IF EXISTS setting_key;

-- 5. Створення нового унікального індексу
ALTER TABLE settings ADD UNIQUE KEY uniq_project_setting (project_id, setting_key);

-- 6. Додавання зовнішнього ключа
ALTER TABLE settings ADD CONSTRAINT fk_settings_project 
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- 7. Створення базового проєкту
INSERT INTO projects (name, is_active) VALUES ('Дім Душі', 1);

-- 8. Отримання ID створеного проєкту (запам'ятайте це число)
SELECT @project_id := id FROM projects ORDER BY id ASC LIMIT 1;

-- 9. Прив'язка адмінів до проєкту (замініть 1 на ваш admin_id)
INSERT IGNORE INTO admin_projects (admin_id, project_id, can_manage_settings) 
VALUES (1, @project_id, 1);

-- 10. Оновлення таблиці posts (нові колонки для зображень)
ALTER TABLE posts ADD COLUMN image_path VARCHAR(255) NULL AFTER text;
ALTER TABLE posts ADD COLUMN image_action VARCHAR(20) NOT NULL DEFAULT 'nothing' AFTER image_path;
ALTER TABLE posts ADD COLUMN image_text VARCHAR(255) NULL AFTER image_action;
```

---

## Перевірка успішності

Після міграцій перевірте:

1. Відкрийте головну сторінку - помилки немає ✅
2. Перейдіть в Налаштування - працює ✅
3. Перейдіть в Контент план - працює ✅

---

## Що робити якщо помилка залишилась?

1. Перевірте чи всі таблиці створилися:
   ```sql
   SHOW TABLES;
   ```
   Має бути: `projects`, `admin_projects`, `settings`, `posts`, `admin`, `social_networks`, `categories`

2. Перевірте структуру posts:
   ```sql
   SHOW COLUMNS FROM posts;
   ```
   Має бути колонки: `image_path`, `image_action`, `image_text`

3. Якщо щось не так - запустіть міграції повторно

---

## Примітки

- **Безпека**: Файл `run-migrations.php` захищений паролем `migrate2026`
- **Видалення**: Після успішної міграції можна видалити `run-migrations.php` з хостингу
- **Бекап**: Миграції безпечні (використовують IF NOT EXISTS), але бекап завжди корисний

---

## Контакти

Якщо виникли проблеми - напишіть в чат, допоможу!
