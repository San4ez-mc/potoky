<?php
/**
 * Міграція: додаємо project_id до categories та posts
 * Дата: 2026-03-04
 */

$config = require __DIR__ . '/config/database.php';
require __DIR__ . '/app/core/Database.php';

$db = new Database($config);

echo "=== Міграція: додаємо project_id ===\n\n";

try {
    // Перевіряємо чи існує хоч один проект
    $projects = $db->query('SELECT id, name FROM projects WHERE is_active = 1')->fetchAll(PDO::FETCH_ASSOC);
    
    if (empty($projects)) {
        echo "❌ Немає активних проектів! Створюю дефолтний проект...\n";
        $db->query('INSERT INTO projects (name, is_active) VALUES (?, 1)', ['Дім Душі']);
        $defaultProjectId = (int) $db->lastInsertId();
        echo "✅ Створено проект: Дім Душі (ID: {$defaultProjectId})\n\n";
        
        // Прив'язуємо всіх адмінів до цього проекту
        $admins = $db->query('SELECT id, username FROM admin')->fetchAll(PDO::FETCH_ASSOC);
        foreach ($admins as $admin) {
            $db->query(
                'INSERT INTO admin_projects (admin_id, project_id, can_manage_settings) VALUES (?, ?, 1)',
                [$admin['id'], $defaultProjectId]
            );
            echo "  → Додано доступ для {$admin['username']}\n";
        }
        echo "\n";
    } else {
        $defaultProjectId = (int) $projects[0]['id'];
        echo "✅ Використовується проект: {$projects[0]['name']} (ID: {$defaultProjectId})\n\n";
    }
    
    // Додаємо project_id до categories
    $cols = $db->query('SHOW COLUMNS FROM categories')->fetchAll(PDO::FETCH_ASSOC);
    $hasProjectId = false;
    foreach ($cols as $col) {
        if ($col['Field'] === 'project_id') {
            $hasProjectId = true;
            break;
        }
    }
    
    if (!$hasProjectId) {
        echo "📋 Додаю project_id до categories...\n";
        $db->query('
            ALTER TABLE categories 
            ADD COLUMN project_id INT NOT NULL DEFAULT ' . $defaultProjectId . ' AFTER id,
            ADD KEY idx_project (project_id),
            ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        ');
        echo "✅ Поле project_id додано до categories\n\n";
    } else {
        echo "⚠️  Поле project_id вже існує в categories\n\n";
    }
    
    // Додаємо project_id до posts
    $cols = $db->query('SHOW COLUMNS FROM posts')->fetchAll(PDO::FETCH_ASSOC);
    $hasProjectId = false;
    foreach ($cols as $col) {
        if ($col['Field'] === 'project_id') {
            $hasProjectId = true;
            break;
        }
    }
    
    if (!$hasProjectId) {
        echo "📋 Додаю project_id до posts...\n";
        $db->query('
            ALTER TABLE posts 
            ADD COLUMN project_id INT NOT NULL DEFAULT ' . $defaultProjectId . ' AFTER id,
            ADD KEY idx_project (project_id),
            ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        ');
        echo "✅ Поле project_id додано до posts\n\n";
    } else {
        echo "⚠️  Поле project_id вже існує в posts\n\n";
    }
    
    echo "✅ Міграція завершена успішно!\n";
    
} catch (Exception $e) {
    echo "❌ Помилка: " . $e->getMessage() . "\n";
    exit(1);
}
