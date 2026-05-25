<?php
$config = require __DIR__ . '/config/database.php';
require_once __DIR__ . '/app/core/Database.php';

$db = new Database($config);

echo "Оновлення поля auto_generate_image -> image_action...\n\n";

try {
    // Перевіряємо чи існує auto_generate_image
    $columns = $db->query("SHOW COLUMNS FROM posts")->fetchAll(PDO::FETCH_ASSOC);
    $columnNames = array_column($columns, 'Field');

    if (in_array('auto_generate_image', $columnNames)) {
        echo "Змінюємо auto_generate_image на image_action...\n";
        $db->query('ALTER TABLE posts CHANGE COLUMN auto_generate_image image_action VARCHAR(20) NOT NULL DEFAULT "nothing" COMMENT "nothing|auto_generate|overlay_text"');
        echo "✅ Поле змінено на image_action\n";
    } else if (!in_array('image_action', $columnNames)) {
        echo "Додаємо нове поле image_action...\n";
        $db->query('ALTER TABLE posts ADD COLUMN image_action VARCHAR(20) NOT NULL DEFAULT "nothing" AFTER image_path');
        echo "✅ Поле image_action додано\n";
    } else {
        echo "⚠️ Поле image_action вже існує\n";
    }

    echo "\n✅ Готово!\n";

} catch (Exception $e) {
    echo "❌ Помилка: " . $e->getMessage() . "\n";
    exit(1);
}
