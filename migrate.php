<?php
// migrate.php
$config = require __DIR__ . '/php-mvc/config/database.php';
require_once __DIR__ . '/php-mvc/app/core/Database.php';
$db = new Database($config);

$db->query('SET FOREIGN_KEY_CHECKS=0');

// Видаляємо застарілі сутності
$db->query('DROP TABLE IF EXISTS stories');
$db->query('DROP TABLE IF EXISTS logs');
$db->query('DROP TABLE IF EXISTS content_plan');
$db->query('DROP TABLE IF EXISTS content_types');
$db->query('DROP TABLE IF EXISTS user_project_access');
$db->query('DROP TABLE IF EXISTS projects');
$db->query('DROP TABLE IF EXISTS rubrics');
$db->query('DROP TABLE IF EXISTS accounts');

// Пересоздаємо доменні таблиці
$db->query('DROP TABLE IF EXISTS posts');
$db->query('DROP TABLE IF EXISTS categories');
$db->query('DROP TABLE IF EXISTS social_networks');

$db->query('SET FOREIGN_KEY_CHECKS=1');

// Таблиця авторизації
$db->query('CREATE TABLE IF NOT EXISTS admin (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL
)');

// Соц.мережі (спочатку створюємо їх, бо categories і posts посилаються на них)
$db->query('CREATE TABLE IF NOT EXISTS social_networks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    prompt TEXT NOT NULL,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)');

// Категорії (з FK на social_networks)
$db->query('CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    social_network_id INT NOT NULL,
    name VARCHAR(80) NOT NULL,
    color VARCHAR(10) NOT NULL DEFAULT "#5a6c7d",
    description VARCHAR(255),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (social_network_id) REFERENCES social_networks(id) ON DELETE CASCADE
)');

// Пости (включно для Stories/Reels/Threads як єдина сутність "post")
$db->query('CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT,
    post_date DATE NOT NULL,
    social_network_id INT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (social_network_id) REFERENCES social_networks(id) ON DELETE CASCADE
)');

$networkSeeds = [
    'Threads Posts' => [
        'prompt' => 'Напишіть 2-3 пости для Threads на тему "{category}" про "{topic}".',
        'categories' => ['Жива історія', 'Дзеркало болю', 'Архітектура розуму']
    ],
    'Instagram Posts' => [
        'prompt' => 'Напишіть структурований пост для Instagram про "{category}".',
        'categories' => ['Дзеркало болю', 'Жива історія', 'Архітектура розуму']
    ],
    'Instagram Stories' => [
        'prompt' => 'Напишіть 5-7 коротких сценаріїв для Stories про "{topic}".',
        'categories' => ['Жива історія', 'Дзеркало болю']
    ],
    'Instagram Reels' => [
        'prompt' => 'Напишіть ідею Reels про "{category}" з коротким сценарієм.',
        'categories' => ['Архітектура розуму']
    ]
];

foreach ($networkSeeds as $network => $seed) {
    $enabled = in_array($network, ['Threads Posts', 'Instagram Posts', 'Instagram Stories'], true) ? 1 : 0;
    $db->query(
        'INSERT INTO social_networks (name, prompt, is_enabled, sort_order) VALUES (?, ?, ?, ?)',
        [$network, $seed['prompt'], $enabled, array_search($network, array_keys($networkSeeds), true)]
    );

    $socialNetworkId = (int) $db->lastInsertId();

    foreach ($seed['categories'] as $index => $categoryName) {
        $db->query(
            'INSERT INTO categories (social_network_id, name, color, description, sort_order) VALUES (?, ?, ?, ?, ?)',
            [$socialNetworkId, $categoryName, '#5a6c7d', null, $index]
        );
    }
}

// Адмін користувач
$username = 'mariel';
$password = 'Mariel2026!';
$hash = password_hash($password, PASSWORD_DEFAULT);
$db->query('INSERT INTO admin (username, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)', [$username, $hash]);

echo "Міграції виконано успішно!\n";
echo "Користувач mariel створений з паролем: Mariel2026!\n";
echo "Оновлена схема: admin, social_networks, categories, posts\n";
