<?php
/**
 * Web-based migration runner
 * Запустіть цей файл через браузер: https://fineko.space/content/run-migrations.php
 * Або через SSH: php run-migrations.php
 */

// Базова авторизація для безпеки
$auth_password = 'migrate2026'; // Змініть на свій пароль!

if (!isset($_GET['password']) || $_GET['password'] !== $auth_password) {
    die('❌ Access denied. Use: ?password=migrate2026');
}

require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/app/core/Database.php';

$config = require __DIR__ . '/config/database.php';

echo "<!DOCTYPE html>
<html lang='uk'>
<head>
    <meta charset='UTF-8'>
    <title>Database Migration</title>
    <style>
        body { font-family: monospace; background: #1a1a1a; color: #0f0; padding: 20px; }
        .success { color: #0f0; }
        .error { color: #f00; }
        .info { color: #0af; }
        pre { background: #000; padding: 10px; border-radius: 5px; }
    </style>
</head>
<body>
<pre>";

try {
    $db = new Database($config);
    echo "<span class='info'>🚀 Запуск міграцій на " . $config['host'] . "...</span>\n\n";

    // Перевірка підключення
    echo "<span class='info'>📡 Перевірка підключення до БД...</span>\n";
    $version = $db->query('SELECT VERSION() as version')->fetch(PDO::FETCH_ASSOC);
    echo "<span class='success'>✅ MySQL версія: {$version['version']}</span>\n\n";

    // 1. Таблиця projects
    echo "<span class='info'>📝 Створення таблиці projects...</span>\n";
    $db->query('
        CREATE TABLE IF NOT EXISTS projects (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(120) NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ');
    echo "<span class='success'>✅ Таблиця projects готова!</span>\n\n";

    // 2. Таблиця admin_projects
    echo "<span class='info'>📝 Створення таблиці admin_projects...</span>\n";

    // Спочатку перевіряємо чи існують FK
    $fkExists = $db->query("
        SELECT CONSTRAINT_NAME 
        FROM information_schema.TABLE_CONSTRAINTS 
        WHERE CONSTRAINT_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'admin_projects' 
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    ")->fetchAll(PDO::FETCH_ASSOC);

    if (empty($fkExists)) {
        $db->query('
            CREATE TABLE IF NOT EXISTS admin_projects (
                admin_id INT NOT NULL,
                project_id INT NOT NULL,
                can_manage_settings TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (admin_id, project_id),
                CONSTRAINT fk_admin_projects_admin FOREIGN KEY (admin_id) REFERENCES admin(id) ON DELETE CASCADE,
                CONSTRAINT fk_admin_projects_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ');
    } else {
        echo "<span class='info'>  ⚠️  Таблиця вже існує, пропускаємо...</span>\n";
    }
    echo "<span class='success'>✅ Таблиця admin_projects готова!</span>\n\n";

    // 3. Оновлення таблиці settings
    echo "<span class='info'>📝 Оновлення таблиці settings...</span>\n";

    // Перевіряємо чи існує колонка project_id
    $columns = $db->query("SHOW COLUMNS FROM settings")->fetchAll(PDO::FETCH_ASSOC);
    $columnNames = array_column($columns, 'Field');

    if (!in_array('project_id', $columnNames)) {
        echo "<span class='info'>  → Додавання колонки project_id...</span>\n";
        $db->query('ALTER TABLE settings ADD COLUMN project_id INT NULL AFTER id');
        echo "<span class='success'>  ✅ Колонка project_id додана</span>\n";
    }

    // Видаляємо старий унікальний індекс якщо є
    $indexes = $db->query('SHOW INDEX FROM settings')->fetchAll(PDO::FETCH_ASSOC);
    foreach ($indexes as $index) {
        if (($index['Key_name'] ?? '') === 'setting_key' && ($index['Non_unique'] ?? 1) == 0) {
            echo "<span class='info'>  → Видалення старого унікального індексу...</span>\n";
            $db->query('ALTER TABLE settings DROP INDEX setting_key');
            echo "<span class='success'>  ✅ Старий індекс видалено</span>\n";
            break;
        }
    }

    // Додаємо правильний унікальний індекс
    $uniqIndexExists = false;
    foreach ($indexes as $index) {
        if (($index['Key_name'] ?? '') === 'uniq_project_setting') {
            $uniqIndexExists = true;
            break;
        }
    }
    if (!$uniqIndexExists) {
        echo "<span class='info'>  → Додавання унікального індексу (project_id, setting_key)...</span>\n";
        $db->query('ALTER TABLE settings ADD UNIQUE KEY uniq_project_setting (project_id, setting_key)');
        echo "<span class='success'>  ✅ Унікальний індекс додано</span>\n";
    }

    // Додаємо FK для settings.project_id
    $fkExists = $db->query("
        SELECT CONSTRAINT_NAME 
        FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'settings' 
        AND COLUMN_NAME = 'project_id' 
        AND REFERENCED_TABLE_NAME = 'projects'
    ")->fetch(PDO::FETCH_ASSOC);

    if (!$fkExists) {
        echo "<span class='info'>  → Додавання зовнішнього ключа для project_id...</span>\n";
        $db->query('ALTER TABLE settings ADD CONSTRAINT fk_settings_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE');
        echo "<span class='success'>  ✅ Зовнішній ключ додано</span>\n";
    }

    echo "<span class='success'>✅ Таблиця settings оновлена!</span>\n\n";

    // 4. Створення базового проекту
    echo "<span class='info'>📝 Створення базового проєкту...</span>\n";
    $projectRow = $db->query('SELECT id FROM projects ORDER BY id ASC LIMIT 1')->fetch(PDO::FETCH_ASSOC);

    if (!$projectRow) {
        $db->query('INSERT INTO projects (name, is_active) VALUES (?, ?)', ['Дім Душі', 1]);
        $defaultProjectId = (int) $db->lastInsertId();
        echo "<span class='success'>✅ Створено базовий проєкт #{$defaultProjectId}</span>\n\n";
    } else {
        $defaultProjectId = (int) $projectRow['id'];
        echo "<span class='info'>  ⚠️  Проєкт вже існує (ID: {$defaultProjectId})</span>\n\n";
    }

    // 5. Прив'язка адмінів до проєкту
    echo "<span class='info'>📝 Прив'язка адмінів до проєкту...</span>\n";
    $admins = $db->query('SELECT id FROM admin')->fetchAll(PDO::FETCH_ASSOC);
    $linkedCount = 0;
    foreach ($admins as $admin) {
        $db->query(
            'INSERT IGNORE INTO admin_projects (admin_id, project_id, can_manage_settings) VALUES (?, ?, 1)',
            [(int) $admin['id'], $defaultProjectId]
        );
        $linkedCount++;
    }
    echo "<span class='success'>✅ Прив'язано {$linkedCount} адмінів до проєкту</span>\n\n";

    // 6. Оновлення таблиці posts (нові колонки)
    echo "<span class='info'>📝 Оновлення таблиці posts...</span>\n";
    $postsColumns = $db->query("SHOW COLUMNS FROM posts")->fetchAll(PDO::FETCH_ASSOC);
    $postsColumnNames = array_column($postsColumns, 'Field');

    if (!in_array('image_path', $postsColumnNames)) {
        $db->query('ALTER TABLE posts ADD COLUMN image_path VARCHAR(255) NULL AFTER text');
        echo "<span class='success'>  ✅ Додано image_path</span>\n";
    }

    if (!in_array('image_action', $postsColumnNames)) {
        $db->query('ALTER TABLE posts ADD COLUMN image_action VARCHAR(20) NOT NULL DEFAULT "nothing" AFTER image_path');
        echo "<span class='success'>  ✅ Додано image_action</span>\n";
    } elseif (in_array('auto_generate_image', $postsColumnNames)) {
        // Міграція зі старого поля
        $db->query('ALTER TABLE posts CHANGE COLUMN auto_generate_image image_action VARCHAR(20) NOT NULL DEFAULT "nothing"');
        echo "<span class='success'>  ✅ Конвертовано auto_generate_image → image_action</span>\n";
    }

    if (!in_array('image_text', $postsColumnNames)) {
        $db->query('ALTER TABLE posts ADD COLUMN image_text VARCHAR(255) NULL AFTER image_action');
        echo "<span class='success'>  ✅ Додано image_text</span>\n";
    }

    if (!in_array('image_type', $postsColumnNames)) {
        if (in_array('image_prompt', $postsColumnNames)) {
            $db->query('ALTER TABLE posts ADD COLUMN image_type VARCHAR(50) NULL AFTER image_prompt');
        } else {
            $db->query('ALTER TABLE posts ADD COLUMN image_type VARCHAR(50) NULL AFTER image_text');
        }
        echo "<span class='success'>  ✅ Додано image_type</span>\n";
    }

    if (!in_array('post_type', $postsColumnNames)) {
        $db->query('ALTER TABLE posts ADD COLUMN post_type VARCHAR(50) NULL AFTER image_type');
        echo "<span class='success'>  ✅ Додано post_type</span>\n";
    }

    echo "<span class='success'>✅ Таблиця posts оновлена!</span>\n\n";

    // 7. Оновлення таблиці categories (аватар + тип клієнта)
    echo "<span class='info'>📝 Оновлення таблиці categories...</span>\n";
    $categoriesColumns = $db->query("SHOW COLUMNS FROM categories")->fetchAll(PDO::FETCH_ASSOC);
    $categoriesColumnNames = array_column($categoriesColumns, 'Field');

    if (!in_array('client_type', $categoriesColumnNames, true)) {
        $db->query('ALTER TABLE categories ADD COLUMN client_type VARCHAR(20) NULL AFTER description');
        echo "<span class='success'>  ✅ Додано client_type</span>\n";
    }

    if (!in_array('avatar_name', $categoriesColumnNames, true)) {
        $db->query('ALTER TABLE categories ADD COLUMN avatar_name VARCHAR(120) NULL AFTER client_type');
        echo "<span class='success'>  ✅ Додано avatar_name</span>\n";
    }

    if (!in_array('avatar_description', $categoriesColumnNames, true)) {
        $db->query('ALTER TABLE categories ADD COLUMN avatar_description VARCHAR(255) NULL AFTER avatar_name');
        echo "<span class='success'>  ✅ Додано avatar_description</span>\n";
    }

    echo "<span class='success'>✅ Таблиця categories оновлена!</span>\n\n";

    // 8. Підсумок
    echo "<span class='info'>📊 Перевірка створених таблиць...</span>\n";
    $tables = $db->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    echo "<span class='success'>Всього таблиць: " . count($tables) . "</span>\n";
    foreach ($tables as $table) {
        echo "  • {$table}\n";
    }

    echo "\n<span class='success'>🎉 Міграції виконано успішно!</span>\n";
    echo "\n<span class='info'>Тепер можна використовувати систему: <a href='/' style='color:#0af;'>Перейти на головну</a></span>\n";

} catch (Exception $e) {
    echo "\n<span class='error'>❌ ПОМИЛКА: " . htmlspecialchars($e->getMessage()) . "</span>\n";
    echo "<span class='error'>Trace: " . htmlspecialchars($e->getTraceAsString()) . "</span>\n";
    exit(1);
}

echo "</pre></body></html>";
