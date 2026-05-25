<?php
$config = require __DIR__ . '/config/database.php';
require_once __DIR__ . '/app/core/Database.php';

$db = new Database($config);
$today = date('Y-m-d');

echo "Today's date: $today\n\n";

$stmt = $db->query('SELECT id, text, image_path, auto_generate_image FROM posts WHERE post_date = ?', [$today]);
$posts = $stmt->fetchAll(PDO::FETCH_ASSOC);

if (empty($posts)) {
    echo "No posts for today.\n";
} else {
    echo "Posts for today:\n";
    foreach ($posts as $post) {
        echo "\nPost #{$post['id']}:\n";
        echo "  Text: " . substr($post['text'], 0, 50) . "...\n";
        echo "  Image: " . ($post['image_path'] ?: '(none)') . "\n";
        echo "  Auto-generate: " . ($post['auto_generate_image'] ? 'YES' : 'NO') . "\n";
    }
}
