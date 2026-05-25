<?php
require __DIR__ . '/app/core/Database.php';
$config = require __DIR__ . '/config/database.php';
$db = new Database($config);

echo "Створення відсутніх категорій для Threads Posts...\n\n";

$networkId = 1; // Threads Posts

$categories = [
    'Дзеркало болю',
    'Жива історія',
    'Непопулярна думка',
    'Мікро-сцена',
    'Мікро-інсайт',
    'Ситуативка',
    'Пряма пропозиція',
    'Запитання: легке особисте',
    'Запитання: провокаційне',
    'Запитання: саморефлексія',
    'Запитання: ситуаційне',
    'Спостереження з практики',
    'Гумор з болем'
];

$sortOrder = 1;

try {
    foreach ($categories as $catName) {
        $existing = $db->query(
            'SELECT id FROM categories WHERE social_network_id = ? AND LOWER(name) = LOWER(?)',
            [$networkId, $catName]
        )->fetch(PDO::FETCH_ASSOC);
        
        if (!$existing) {
            $db->query(
                'INSERT INTO categories (social_network_id, name, color, sort_order) VALUES (?, ?, ?, ?)',
                [$networkId, $catName, '#5a6c7d', $sortOrder]
            );
            echo "✅ Додано: {$catName}\n";
        } else {
            echo "⚠️  Вже існує: {$catName}\n";
        }
        $sortOrder++;
    }
    
    echo "\n✅ Готово! Категорії створено.\n";
    
    // Показуємо всі категорії
    echo "\nВсі категорії для Threads Posts:\n";
    $allCats = $db->query(
        'SELECT id, name FROM categories WHERE social_network_id = ? ORDER BY sort_order, id',
        [$networkId]
    )->fetchAll(PDO::FETCH_ASSOC);
    
    foreach ($allCats as $cat) {
        echo "  {$cat['id']}. {$cat['name']}\n";
    }
    
} catch (Exception $e) {
    echo "❌ Помилка: " . $e->getMessage() . "\n";
    exit(1);
}
