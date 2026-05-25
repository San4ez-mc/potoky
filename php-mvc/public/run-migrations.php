<?php
/**
 * Web-based migration runner for production
 * URL: https://fineko.space/content/run-migrations.php
 */

// Базова авторизація для безпеки
$auth_password = 'migrate2026'; // ⚠️ Змініть на свій пароль!

if (!isset($_GET['password']) || $_GET['password'] !== $auth_password) {
    http_response_code(403);
    die('<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <title>Access Denied</title>
    <style>
        body { font-family: Arial, sans-serif; background: #1a1a1a; color: #fff; padding: 40px; text-align: center; }
        .box { background: #2a2a2a; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto; border: 2px solid #e63946; }
        h1 { color: #e63946; }
        code { background: #1a1a1a; padding: 4px 8px; border-radius: 4px; color: #0af; }
    </style>
</head>
<body>
    <div class="box">
        <h1>🔒 Access Denied</h1>
        <p>Для запуску міграцій використовуйте:</p>
        <p><code>?password=migrate2026</code></p>
    </div>
</body>
</html>');
}

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../app/core/Database.php';

$config = require __DIR__ . '/../config/database.php';

header('Content-Type: text/html; charset=utf-8');

echo "<!DOCTYPE html>
<html lang='uk'>
<head>
    <meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <title>Database Migration - Content Planner</title>
    <style>
        body { 
            font-family: 'Courier New', monospace; 
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); 
            color: #0f0; 
            padding: 20px; 
            line-height: 1.6;
        }
        .container { max-width: 1000px; margin: 0 auto; background: #0f0f0f; padding: 30px; border-radius: 10px; box-shadow: 0 0 30px rgba(0,255,0,0.2); }
        h1 { color: #0af; text-align: center; border-bottom: 2px solid #0af; padding-bottom: 10px; }
        .success { color: #0f0; }
        .error { color: #f00; }
        .info { color: #0af; }
        .warning { color: #ff0; }
        pre { background: #000; padding: 15px; border-radius: 5px; border-left: 4px solid #0f0; overflow-x: auto; }
        .step { margin: 20px 0; padding: 15px; background: #1a1a1a; border-radius: 5px; }
        .back-link { display: block; text-align: center; margin-top: 30px; }
        .back-link a { color: #0af; text-decoration: none; padding: 10px 20px; background: #1a1a2e; border-radius: 5px; }
        .back-link a:hover { background: #16213e; }
    </style>
</head>
<body>
<div class='container'>
<h1>🚀 Database Migration Runner</h1>
<pre>";

try {
    $db = new Database($config);
    $host = $config['host'];
    $dbname = $config['database'];

    echo "<span class='info'>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>\n";
    echo "<span class='info'>   Content Planner Bot - Database Migration</span>\n";
    echo "<span class='info'>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>\n\n";
    echo "<span class='info'>📡 Server: {$host}</span>\n";
    echo "<span class='info'>🗄️  Database: {$dbname}</span>\n\n";

    // Перевірка підключення
    echo "<span class='info'>🔌 Checking database connection...</span>\n";
    $version = $db->query('SELECT VERSION() as version')->fetch(PDO::FETCH_ASSOC);
    echo "<span class='success'>✅ Connected! MySQL version: {$version['version']}</span>\n\n";

    echo "<span class='info'>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>\n";
    echo "<span class='info'>   Starting migrations...</span>\n";
    echo "<span class='info'>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>\n\n";

    // Міграція 1: Таблиця projects
    echo "<div class='step'>";
    echo "<span class='info'>📝 STEP 1: Creating table 'projects'</span>\n";
    $db->query('
        CREATE TABLE IF NOT EXISTS projects (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(120) NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ');
    echo "<span class='success'>✅ Table 'projects' ready</span>\n";
    echo "</div>";

    // Міграція 2: Таблиця admin_projects
    echo "<div class='step'>";
    echo "<span class='info'>📝 STEP 2: Creating table 'admin_projects'</span>\n";

    // Перевіряємо чи таблиця вже існує
    $tableExists = $db->query("SHOW TABLES LIKE 'admin_projects'")->fetch();

    if (!$tableExists) {
        $db->query('
            CREATE TABLE admin_projects (
                admin_id INT NOT NULL,
                project_id INT NOT NULL,
                can_manage_settings TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (admin_id, project_id),
                CONSTRAINT fk_admin_projects_admin FOREIGN KEY (admin_id) REFERENCES admin(id) ON DELETE CASCADE,
                CONSTRAINT fk_admin_projects_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ');
        echo "<span class='success'>✅ Table 'admin_projects' created</span>\n";
    } else {
        echo "<span class='warning'>⚠️  Table 'admin_projects' already exists, skipping</span>\n";
    }
    echo "</div>";

    // Міграція 3: Оновлення таблиці settings
    echo "<div class='step'>";
    echo "<span class='info'>📝 STEP 3: Updating table 'settings'</span>\n";

    $columns = $db->query("SHOW COLUMNS FROM settings")->fetchAll(PDO::FETCH_ASSOC);
    $columnNames = array_column($columns, 'Field');

    if (!in_array('project_id', $columnNames)) {
        echo "<span class='info'>  → Adding column 'project_id'...</span>\n";
        $db->query('ALTER TABLE settings ADD COLUMN project_id INT NULL AFTER id');
        echo "<span class='success'>  ✅ Column added</span>\n";
    } else {
        echo "<span class='warning'>  ⚠️  Column 'project_id' exists</span>\n";
    }

    // Видалення старого унікального індексу
    $indexes = $db->query('SHOW INDEX FROM settings')->fetchAll(PDO::FETCH_ASSOC);
    $needsIndexUpdate = false;

    foreach ($indexes as $index) {
        if (($index['Key_name'] ?? '') === 'setting_key' && ($index['Non_unique'] ?? 1) == 0) {
            echo "<span class='info'>  → Removing old unique index...</span>\n";
            $db->query('ALTER TABLE settings DROP INDEX setting_key');
            echo "<span class='success'>  ✅ Old index removed</span>\n";
            $needsIndexUpdate = true;
            break;
        }
    }

    // Додавання нового індексу
    $uniqIndexExists = false;
    foreach ($indexes as $index) {
        if (($index['Key_name'] ?? '') === 'uniq_project_setting') {
            $uniqIndexExists = true;
            break;
        }
    }

    if (!$uniqIndexExists) {
        echo "<span class='info'>  → Adding unique index (project_id, setting_key)...</span>\n";
        $db->query('ALTER TABLE settings ADD UNIQUE KEY uniq_project_setting (project_id, setting_key)');
        echo "<span class='success'>  ✅ Unique index added</span>\n";
    } else {
        echo "<span class='warning'>  ⚠️  Unique index exists</span>\n";
    }

    // Додавання FK
    $fkExists = $db->query("
        SELECT CONSTRAINT_NAME 
        FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'settings' 
        AND COLUMN_NAME = 'project_id' 
        AND REFERENCED_TABLE_NAME = 'projects'
        LIMIT 1
    ")->fetch();

    if (!$fkExists) {
        echo "<span class='info'>  → Adding foreign key for project_id...</span>\n";
        $db->query('ALTER TABLE settings ADD CONSTRAINT fk_settings_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE');
        echo "<span class='success'>  ✅ Foreign key added</span>\n";
    } else {
        echo "<span class='warning'>  ⚠️  Foreign key exists</span>\n";
    }

    echo "<span class='success'>✅ Table 'settings' updated</span>\n";
    echo "</div>";

    // Міграція 4: Базовий проєкт
    echo "<div class='step'>";
    echo "<span class='info'>📝 STEP 4: Creating default project</span>\n";

    $projectRow = $db->query('SELECT id, name FROM projects ORDER BY id ASC LIMIT 1')->fetch(PDO::FETCH_ASSOC);

    if (!$projectRow) {
        $db->query('INSERT INTO projects (name, is_active) VALUES (?, ?)', ['Дім Душі', 1]);
        $defaultProjectId = (int) $db->lastInsertId();
        echo "<span class='success'>✅ Created default project (ID: {$defaultProjectId})</span>\n";
    } else {
        $defaultProjectId = (int) $projectRow['id'];
        $projectName = $projectRow['name'];
        echo "<span class='warning'>⚠️  Project already exists: '{$projectName}' (ID: {$defaultProjectId})</span>\n";
    }
    echo "</div>";

    // Міграція 5: Прив'язка адмінів
    echo "<div class='step'>";
    echo "<span class='info'>📝 STEP 5: Linking admins to project</span>\n";

    $admins = $db->query('SELECT id, username FROM admin')->fetchAll(PDO::FETCH_ASSOC);
    $linkedCount = 0;

    foreach ($admins as $admin) {
        $existing = $db->query(
            'SELECT 1 FROM admin_projects WHERE admin_id = ? AND project_id = ?',
            [(int) $admin['id'], $defaultProjectId]
        )->fetch();

        if (!$existing) {
            $db->query(
                'INSERT INTO admin_projects (admin_id, project_id, can_manage_settings) VALUES (?, ?, 1)',
                [(int) $admin['id'], $defaultProjectId]
            );
            echo "<span class='success'>  ✅ Linked admin '{$admin['username']}' (ID: {$admin['id']})</span>\n";
            $linkedCount++;
        } else {
            echo "<span class='warning'>  ⚠️  Admin '{$admin['username']}' already linked</span>\n";
        }
    }

    echo "<span class='success'>✅ Linked {$linkedCount} new admin(s)</span>\n";
    echo "</div>";

    // Міграція 6: Оновлення таблиці posts
    echo "<div class='step'>";
    echo "<span class='info'>📝 STEP 6: Updating table 'posts'</span>\n";

    $postsColumns = $db->query("SHOW COLUMNS FROM posts")->fetchAll(PDO::FETCH_ASSOC);
    $postsColumnNames = array_column($postsColumns, 'Field');

    if (!in_array('image_path', $postsColumnNames)) {
        $db->query('ALTER TABLE posts ADD COLUMN image_path VARCHAR(255) NULL AFTER text');
        echo "<span class='success'>  ✅ Added 'image_path'</span>\n";
    } else {
        echo "<span class='warning'>  ⚠️  Column 'image_path' exists</span>\n";
    }

    // Перевірка чи треба мігрувати зі старої колонки
    if (in_array('auto_generate_image', $postsColumnNames) && !in_array('image_action', $postsColumnNames)) {
        $db->query('ALTER TABLE posts CHANGE COLUMN auto_generate_image image_action VARCHAR(20) NOT NULL DEFAULT "nothing"');
        echo "<span class='success'>  ✅ Migrated 'auto_generate_image' → 'image_action'</span>\n";
    } elseif (!in_array('image_action', $postsColumnNames)) {
        $db->query('ALTER TABLE posts ADD COLUMN image_action VARCHAR(20) NOT NULL DEFAULT "nothing" AFTER image_path');
        echo "<span class='success'>  ✅ Added 'image_action'</span>\n";
    } else {
        echo "<span class='warning'>  ⚠️  Column 'image_action' exists</span>\n";
    }

    if (!in_array('image_text', $postsColumnNames)) {
        $db->query('ALTER TABLE posts ADD COLUMN image_text VARCHAR(255) NULL AFTER image_action');
        echo "<span class='success'>  ✅ Added 'image_text'</span>\n";
    } else {
        echo "<span class='warning'>  ⚠️  Column 'image_text' exists</span>\n";
    }

    if (!in_array('image_type', $postsColumnNames)) {
        if (in_array('image_prompt', $postsColumnNames)) {
            $db->query('ALTER TABLE posts ADD COLUMN image_type VARCHAR(50) NULL AFTER image_prompt');
        } else {
            $db->query('ALTER TABLE posts ADD COLUMN image_type VARCHAR(50) NULL AFTER image_text');
        }
        echo "<span class='success'>  ✅ Added 'image_type'</span>\n";
    } else {
        echo "<span class='warning'>  ⚠️  Column 'image_type' exists</span>\n";
    }

    if (!in_array('post_type', $postsColumnNames)) {
        $db->query('ALTER TABLE posts ADD COLUMN post_type VARCHAR(50) NULL AFTER image_type');
        echo "<span class='success'>  ✅ Added 'post_type'</span>\n";
    } else {
        echo "<span class='warning'>  ⚠️  Column 'post_type' exists</span>\n";
    }

    echo "<span class='success'>✅ Table 'posts' updated</span>\n";
    echo "</div>";

    // Міграція 7: Оновлення таблиці categories
    echo "<div class='step'>";
    echo "<span class='info'>📝 STEP 7: Updating table 'categories'</span>\n";

    $categoriesColumns = $db->query("SHOW COLUMNS FROM categories")->fetchAll(PDO::FETCH_ASSOC);
    $categoriesColumnNames = array_column($categoriesColumns, 'Field');

    if (!in_array('client_type', $categoriesColumnNames, true)) {
        $db->query('ALTER TABLE categories ADD COLUMN client_type VARCHAR(20) NULL AFTER description');
        echo "<span class='success'>  ✅ Added 'client_type'</span>\n";
    } else {
        echo "<span class='warning'>  ⚠️  Column 'client_type' exists</span>\n";
    }

    if (!in_array('avatar_name', $categoriesColumnNames, true)) {
        $db->query('ALTER TABLE categories ADD COLUMN avatar_name VARCHAR(120) NULL AFTER client_type');
        echo "<span class='success'>  ✅ Added 'avatar_name'</span>\n";
    } else {
        echo "<span class='warning'>  ⚠️  Column 'avatar_name' exists</span>\n";
    }

    if (!in_array('avatar_description', $categoriesColumnNames, true)) {
        $db->query('ALTER TABLE categories ADD COLUMN avatar_description VARCHAR(255) NULL AFTER avatar_name');
        echo "<span class='success'>  ✅ Added 'avatar_description'</span>\n";
    } else {
        echo "<span class='warning'>  ⚠️  Column 'avatar_description' exists</span>\n";
    }

    echo "<span class='success'>✅ Table 'categories' updated</span>\n";
    echo "</div>";

    // Підсумок
    echo "\n<span class='info'>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>\n";
    echo "<span class='info'>   Migration Summary</span>\n";
    echo "<span class='info'>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>\n\n";

    $tables = $db->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    echo "<span class='success'>📊 Total tables in database: " . count($tables) . "</span>\n\n";

    foreach ($tables as $table) {
        $count = $db->query("SELECT COUNT(*) as cnt FROM `{$table}`")->fetch(PDO::FETCH_ASSOC);
        echo "  <span class='info'>• {$table}</span> <span class='success'>({$count['cnt']} rows)</span>\n";
    }

    echo "\n<span class='success'>🎉 ALL MIGRATIONS COMPLETED SUCCESSFULLY!</span>\n";
    echo "\n<span class='info'>ℹ️  You can now use the system. This file can be deleted for security.</span>\n";

} catch (Exception $e) {
    echo "\n<span class='error'>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>\n";
    echo "<span class='error'>   ERROR OCCURRED</span>\n";
    echo "<span class='error'>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>\n\n";
    echo "<span class='error'>❌ " . htmlspecialchars($e->getMessage()) . "</span>\n\n";
    echo "<span class='error'>Stack trace:</span>\n";
    echo "<span class='error'>" . nl2br(htmlspecialchars($e->getTraceAsString())) . "</span>\n";
    http_response_code(500);
}

echo "</pre>
<div class='back-link'>
    <a href='/'>← Back to Home Page</a>
</div>
</div>
</body>
</html>";
