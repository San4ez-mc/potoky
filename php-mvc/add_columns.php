<?php
$config = require __DIR__ . '/config/database.php';
require_once __DIR__ . '/app/core/Database.php';

$db = new Database($config);

echo "Додавання полів до таблиці posts...\n\n";

try {
    // Check if columns exist
    $columns = $db->query("SHOW COLUMNS FROM posts")->fetchAll(PDO::FETCH_ASSOC);
    $columnNames = array_column($columns, 'Field');

    if (!in_array('image_path', $columnNames)) {
        echo "Додавання image_path...\n";
        $db->query('ALTER TABLE posts ADD COLUMN image_path VARCHAR(255) NULL AFTER text');
        echo "✅ image_path додано\n";
    } else {
        echo "⚠️ image_path вже існує\n";
    }

    if (!in_array('auto_generate_image', $columnNames)) {
        echo "Додавання auto_generate_image...\n";
        $db->query('ALTER TABLE posts ADD COLUMN auto_generate_image TINYINT(1) NOT NULL DEFAULT 0 AFTER image_path');
        echo "✅ auto_generate_image додано\n";
    } else {
        echo "⚠️ auto_generate_image вже існує\n";
    }

    if (!in_array('image_text', $columnNames)) {
        echo "Додавання image_text...\n";
        $db->query('ALTER TABLE posts ADD COLUMN image_text VARCHAR(255) NULL AFTER auto_generate_image');
        echo "✅ image_text додано\n";
    } else {
        echo "⚠️ image_text вже існує\n";
    }

    // Show final structure
    echo "\n📋 Фінальна структура таблиці posts:\n";
    $columns = $db->query("SHOW COLUMNS FROM posts")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($columns as $col) {
        echo "  - {$col['Field']}: {$col['Type']}\n";
    }

    echo "\n✅ Успішно!\n";
} catch (Exception $e) {
    echo "❌ Помилка: " . $e->getMessage() . "\n";
    exit(1);
}
