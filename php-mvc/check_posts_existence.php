<?php
$config = require __DIR__ . '/config/database.php';
require_once __DIR__ . '/app/core/Database.php';

$db = new Database($config);

echo "Перевірка постів у базі:\n\n";

$count = $db->query("SELECT COUNT(*) as cnt FROM posts")->fetch(PDO::FETCH_ASSOC);
echo "Всього постів: {$count['cnt']}\n\n";

if ($count['cnt'] > 0) {
    echo "Останні 5 постів:\n";
    $posts = $db->query("SELECT id, post_date, social_network_id, LEFT(text, 50) as text_preview FROM posts ORDER BY post_date DESC, id DESC LIMIT 5")->fetchAll(PDO::FETCH_ASSOC);

    foreach ($posts as $post) {
        echo "  Post #{$post['id']} - {$post['post_date']} - Network #{$post['social_network_id']}\n";
        echo "    Text: {$post['text_preview']}...\n";
    }

    echo "\nПости в діапазоні 03-05 березня 2026:\n";
    $posts = $db->query("SELECT id, post_date, social_network_id FROM posts WHERE post_date BETWEEN '2026-03-03' AND '2026-03-05' ORDER BY post_date, id")->fetchAll(PDO::FETCH_ASSOC);

    if (empty($posts)) {
        echo "  ⚠️ Немає постів у цьому діапазоні!\n";
    } else {
        foreach ($posts as $post) {
            echo "  Post #{$post['id']} - {$post['post_date']} - Network #{$post['social_network_id']}\n";
        }
    }
} else {
    echo "⚠️ База порожня!\n";
}
