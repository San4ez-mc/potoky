<?php
$config = require __DIR__ . '/config/database.php';
require_once __DIR__ . '/app/core/Database.php';

$db = new Database($config);

echo "Перевірка даних постів:\n\n";

$posts = $db->query("SELECT id, text, image_path, auto_generate_image, image_text FROM posts LIMIT 3")->fetchAll(PDO::FETCH_ASSOC);

foreach ($posts as $post) {
    echo "Post #{$post['id']}:\n";
    echo "  Text: " . substr($post['text'], 0, 50) . "...\n";
    echo "  Image: " . ($post['image_path'] ?: '(none)') . "\n";
    echo "  Auto-gen: " . ($post['auto_generate_image'] ? 'YES' : 'NO') . "\n";
    echo "  Image text: " . ($post['image_text'] ?: '(none)') . "\n";
    echo "\n";
}
