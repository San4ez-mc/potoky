<?php
$config = require __DIR__ . '/config/database.php';
require_once __DIR__ . '/app/core/Database.php';

$db = new Database($config);
$stmt = $db->query('SELECT id, text, image_path, auto_generate_image FROM posts WHERE id = 3');
$post = $stmt->fetch(PDO::FETCH_ASSOC);

if ($post) {
    echo "Post #3:\n";
    echo "Text: " . substr($post['text'], 0, 50) . "...\n";
    echo "Image: " . $post['image_path'] . "\n";
    echo "Auto-generate: " . $post['auto_generate_image'] . "\n\n";

    if ($post['image_path']) {
        $path = 'public/uploads/images/' . $post['image_path'];
        if (file_exists($path)) {
            echo "File exists: YES\n";
            echo "File size: " . filesize($path) . " bytes (" . round(filesize($path) / 1024, 2) . " KB)\n";

            $info = @getimagesize($path);
            if ($info) {
                echo "Dimensions: " . $info[0] . 'x' . $info[1] . "\n";
                echo "Type: " . $info[2] . "\n";
                echo "MIME: " . $info['mime'] . "\n";

                // Check if dimensions are reasonable
                if ($info[0] > 10000 || $info[1] > 10000) {
                    echo "WARNING: Image dimensions are too large!\n";
                }

                // Check file size (Telegram limit is 10MB)
                if (filesize($path) > 10 * 1024 * 1024) {
                    echo "WARNING: File size exceeds Telegram 10MB limit!\n";
                }
            } else {
                echo "getimagesize() FAILED\n";
            }

            // Read first 100 bytes to check for corruption
            $handle = fopen($path, 'rb');
            $header = fread($handle, 100);
            fclose($handle);

            echo "\nFirst 20 bytes (hex): " . bin2hex(substr($header, 0, 20)) . "\n";
        } else {
            echo "File exists: NO\n";
        }
    } else {
        echo "No image_path set\n";
    }
} else {
    echo "Post #3 not found\n";
}
