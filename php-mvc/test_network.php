<?php
// Test network connectivity
echo "Testing network connectivity...\n\n";

$services = [
    'Google' => 'https://www.google.com',
    'Pollinations.ai' => 'https://image.pollinations.ai/prompt/test?width=100&height=100',
    'Telegram API' => 'https://api.telegram.org',
];

foreach ($services as $name => $url) {
    echo "Testing {$name}... ";
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 5,
            'ignore_errors' => true
        ]
    ]);

    $start = microtime(true);
    $result = @file_get_contents($url, false, $context);
    $time = round((microtime(true) - $start) * 1000, 2);

    if ($result !== false) {
        echo "✓ OK ({$time}ms)\n";
    } else {
        echo "✗ FAILED ({$time}ms)\n";
        $error = error_get_last();
        if ($error) {
            echo "  Error: {$error['message']}\n";
        }
    }
}

echo "\n";
echo "If all services fail, check your firewall or internet connection.\n";
echo "If only Pollinations.ai fails, the service might be down temporarily.\n";
