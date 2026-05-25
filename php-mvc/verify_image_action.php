<?php
$config = require __DIR__ . '/config/database.php';
require_once __DIR__ . '/app/core/Database.php';

$db = new Database($config);

echo "Перевірка структури поля image_action:\n\n";

$columns = $db->query("SHOW COLUMNS FROM posts WHERE Field IN ('image_path', 'image_action', 'image_text')")->fetchAll(PDO::FETCH_ASSOC);

foreach ($columns as $col) {
    echo "✅ {$col['Field']}: {$col['Type']} | Default: {$col['Default']} | Null: {$col['Null']}\n";
}

echo "\n📋 Можливі значення image_action:\n";
echo "  • nothing - Нічого не робити (за замовчуванням)\n";
echo "  • auto_generate - Згенерувати автоматично\n";
echo "  • overlay_text - Накласти текст на зображення\n";
