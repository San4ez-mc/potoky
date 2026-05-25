<?php
$config = require __DIR__ . '/config/database.php';
require_once __DIR__ . '/app/core/Database.php';

$db = new Database($config);

echo "Додавання поля image_prompt в таблицю posts...\n\n";

try {
    $columns = $db->query('SHOW COLUMNS FROM posts')->fetchAll(PDO::FETCH_ASSOC);
    $columnNames = array_column($columns, 'Field');

    if (!in_array('image_prompt', $columnNames, true)) {
        if (in_array('image_text', $columnNames, true)) {
            $db->query('ALTER TABLE posts ADD COLUMN image_prompt TEXT NULL AFTER image_text');
        } else {
            $db->query('ALTER TABLE posts ADD COLUMN image_prompt TEXT NULL');
        }
        echo "✅ Поле image_prompt додано\n";
    } else {
        echo "⚠️ Поле image_prompt вже існує\n";
    }

    echo "\n✅ Готово!\n";
} catch (Exception $e) {
    echo "❌ Помилка: " . $e->getMessage() . "\n";
    exit(1);
}
