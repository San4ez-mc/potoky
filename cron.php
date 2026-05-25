<?php
// cron.php - Файл для виконання крон-завдань
// Запускати через командний рядок: php cron.php daily-posts
// Або через веб: /cron.php?action=daily-posts

$config = require __DIR__ . '/php-mvc/config/database.php';
require_once __DIR__ . '/php-mvc/app/core/Database.php';
require_once __DIR__ . '/php-mvc/app/controllers/CronController.php';

// Перевіряємо чи це CLI або веб-запит
$isCLI = php_sapi_name() === 'cli';

$db = new Database($config);
$cronController = new CronController($db);

// Отримуємо дію
$action = $isCLI ? ($argv[1] ?? 'help') : ($_GET['action'] ?? 'help');

switch ($action) {
    case 'daily-posts':
        echo "Starting daily posts job...\n";
        $cronController->sendDailyPosts();
        echo "Job completed.\n";
        break;

    case 'test':
        echo "Running test...\n";
        $cronController->test();
        break;

    case 'help':
    default:
        echo "Available cron jobs:\n";
        echo "  daily-posts  - Send daily posts to Telegram\n";
        echo "  test         - Test Telegram connection\n";
        echo "\n";
        echo "Usage (CLI):\n";
        echo "  php cron.php daily-posts\n";
        echo "\n";
        echo "Usage (Web):\n";
        echo "  /cron.php?action=daily-posts\n";
        break;
}
