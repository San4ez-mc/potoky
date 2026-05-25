<?php
require __DIR__ . '/app/core/Database.php';
$config = require __DIR__ . '/config/database.php';
$db = new Database($config);

echo "Перевірка Instagram Posts категорій...\n\n";

// Отримуємо ID Instagram Posts
$network = $db->query(
    'SELECT id, name FROM social_networks WHERE name = ?',
    ['Instagram Posts']
)->fetch(PDO::FETCH_ASSOC);

if (!$network) {
    echo "❌ Соціальна мережа 'Instagram Posts' не знайдена!\n";
    exit(1);
}

echo "✅ Instagram Posts ID: {$network['id']}\n\n";

// Отримуємо категорії
$categories = $db->query(
    'SELECT id, name FROM categories WHERE social_network_id = ? ORDER BY id',
    [$network['id']]
)->fetchAll(PDO::FETCH_ASSOC);

echo "Категорії для Instagram Posts (всього: " . count($categories) . "):\n";
foreach ($categories as $cat) {
    echo "  {$cat['id']}. {$cat['name']}\n";
}

echo "\n📋 Категорії з JSON, які потрібні:\n";
$requiredCategories = [
    'Розгорнутий кейс',
    'Особиста історія автора',
    'Пояснення методу',
    'Глибокий експертний пост',
    'Продажний пост / анонс',
    'Відгук + розбір'
];

$categoriesByName = [];
foreach ($categories as $cat) {
    $categoriesByName[mb_strtolower(trim($cat['name']))] = $cat['id'];
}

foreach ($requiredCategories as $reqCat) {
    $key = mb_strtolower(trim($reqCat));
    if (isset($categoriesByName[$key])) {
        echo "  ✅ {$reqCat}\n";
    } else {
        echo "  ❌ {$reqCat} - ВІДСУТНЯ!\n";
    }
}
