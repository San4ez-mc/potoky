<?php
$config = require __DIR__ . '/config/database.php';
require_once __DIR__ . '/app/core/Database.php';
require_once __DIR__ . '/app/controllers/CronController.php';

$db = new Database($config);
$cron = new CronController($db);

echo "Testing image generation for post #3...\n\n";

// Get post #3
$stmt = $db->query('SELECT p.id, p.text, p.image_path, p.auto_generate_image, c.name AS category_name, sn.name AS network_name FROM posts p LEFT JOIN categories c ON c.id = p.category_id INNER JOIN social_networks sn ON sn.id = p.social_network_id WHERE p.id = 3');
$post = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$post) {
    echo "Post #3 not found!\n";
    exit(1);
}

echo "Post data:\n";
echo "  ID: {$post['id']}\n";
echo "  Text: " . substr($post['text'], 0, 100) . "...\n";
echo "  Category: {$post['category_name']}\n";
echo "  Network: {$post['network_name']}\n";
echo "  Current image: " . ($post['image_path'] ?: '(none)') . "\n";
echo "  Auto-generate: " . ($post['auto_generate_image'] ? 'YES' : 'NO') . "\n\n";

if ($post['auto_generate_image'] != 1) {
    echo "Auto-generate is disabled for this post.\n";
    exit(0);
}

echo "Checking Pollinations.ai availability...\n";
$testUrl = 'https://image.pollinations.ai/prompt/test?width=100&height=100&nologo=true';
$testContext = stream_context_create(['http' => ['method' => 'GET', 'timeout' => 10]]);
$testResult = @file_get_contents($testUrl, false, $testContext);
if ($testResult === false) {
    echo "ERROR: Cannot connect to Pollinations.ai\n";
    echo "This might be a network issue. Check your internet connection.\n";
    exit(1);
}
echo "✓ Pollinations.ai is reachable\n\n";

echo "Generating image using reflection to call private method...\n";
$reflection = new ReflectionClass($cron);
$method = $reflection->getMethod('generateImageByPost');
$method->setAccessible(true);

try {
    $filename = $method->invoke($cron, $post);

    if ($filename) {
        echo "✓ Image generated successfully!\n";
        echo "  Filename: {$filename}\n";

        $filepath = __DIR__ . '/public/uploads/images/' . $filename;
        if (file_exists($filepath)) {
            echo "  File size: " . filesize($filepath) . " bytes\n";
            $info = getimagesize($filepath);
            if ($info) {
                echo "  Dimensions: {$info[0]}x{$info[1]}\n";
                echo "  MIME: {$info['mime']}\n";
            }
        }

        echo "\nUpdating database...\n";
        $db->query('UPDATE posts SET image_path = ? WHERE id = ?', [$filename, $post['id']]);
        echo "✓ Database updated\n";
    } else {
        echo "✗ Image generation failed\n";
        echo "Check the generation logic and validation rules.\n";
    }
} catch (Exception $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
    exit(1);
}
