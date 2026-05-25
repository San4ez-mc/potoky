<?php
echo "Testing Pollinations.ai with cURL...\n\n";

$testUrl = 'https://image.pollinations.ai/prompt/beautiful%20sunset?width=256&height=256&nologo=true';

if (!function_exists('curl_init')) {
    echo "ERROR: cURL is not available\n";
    exit(1);
}

echo "URL: {$testUrl}\n";
echo "Fetching...\n";

$ch = curl_init($testUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => 0,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    CURLOPT_HTTPHEADER => [
        'Accept: image/*',
    ],
    CURLOPT_VERBOSE => true,
]);

$start = microtime(true);
$result = curl_exec($ch);
$time = round((microtime(true) - $start) * 1000, 2);

$curlError = curl_error($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

echo "\nResults:\n";
echo "  HTTP Code: {$httpCode}\n";
echo "  Content-Type: {$contentType}\n";
echo "  Time: {$time}ms\n";
echo "  Data size: " . strlen($result) . " bytes\n";

if ($result === false || empty($result)) {
    echo "  Status: ✗ FAILED\n";
    echo "  Error: {$curlError}\n";
} else {
    echo "  Status: ✓ SUCCESS\n";

    // Check if it's a valid image
    $imageInfo = @getimagesizefromstring($result);
    if ($imageInfo) {
        echo "  Image dimensions: {$imageInfo[0]}x{$imageInfo[1]}\n";
        echo "  Image MIME: {$imageInfo['mime']}\n";

        // Save test image
        $testFile = __DIR__ . '/test_image.jpg';
        file_put_contents($testFile, $result);
        echo "  Saved to: test_image.jpg\n";
    } else {
        echo "  WARNING: Data is not a valid image\n";
        echo "  First 200 chars: " . substr($result, 0, 200) . "\n";
    }
}
