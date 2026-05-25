<?php
// app/controllers/CronController.php

class CronController
{
    private $db;

    public function __construct($db)
    {
        $this->db = $db;
    }

    private function normalizeBotToken($token)
    {
        $token = trim((string) $token);
        $token = preg_replace('/\s+/', '', $token);

        if (stripos($token, 'bot') === 0) {
            $token = substr($token, 3);
        }

        $upper = strtoupper($token);
        if ($token === '' || $upper === 'YOUR_BOT_TOKEN_HERE' || $upper === 'BOT_TOKEN' || $upper === 'YOUR_TOKEN') {
            return '';
        }

        return $token;
    }

    private function normalizeChatId($chatId)
    {
        $chatId = trim((string) $chatId);
        $chatId = preg_replace('/\s+/', '', $chatId);
        return $chatId;
    }

    /**
     * Витягує настрій з тексту для більш персоналізованого промпту
     */
    private function extractMoodFromText($text)
    {
        $text = mb_strtolower($text, 'UTF-8');

        // Mapping of keywords to moods
        $moods = [
            'мотивація|мотив|енергія|сила|успіх|досяг' => 'inspiring, energetic, motivational',
            'спокій|мир|гармонія|баланс|рівновага' => 'serene, peaceful, balanced',
            'сум|біль|страх|тривога|залізна' => 'calm, supportive, compassionate',
            'радість|щастя|веселе|радісн' => 'bright, joyful, uplifting',
            'роздум|думк|усвідомлен|рефлекс' => 'thoughtful, introspective, meditative',
            'трансформ|змін|зростан|розвит' => 'transformative, uplifting, progressive',
            'взаємопіч|взаємодіяльн|спільн|підтримк' => 'warm, supportive, community-focused',
        ];

        foreach ($moods as $keywords => $mood) {
            if (preg_match('/' . $keywords . '/ui', $text)) {
                return $mood;
            }
        }

        // Default mood
        return 'serene, reflective, inspiring';
    }

    /**
     * Отримує активні проєкти з telegram-налаштуваннями
     */
    private function getActiveProjectsWithTelegram($projectId = null)
    {
        $query = "SELECT
                p.id AS project_id,
                COALESCE(NULLIF(TRIM(pname.setting_value), ''), p.name) AS project_name,
                bot.setting_value AS bot_token,
                chat.setting_value AS chat_id
             FROM projects p
             LEFT JOIN settings pname ON pname.project_id = p.id AND pname.setting_key = 'project_name'
             LEFT JOIN settings bot ON bot.project_id = p.id AND bot.setting_key = 'telegram_bot_token'
             LEFT JOIN settings chat ON chat.project_id = p.id AND chat.setting_key = 'telegram_chat_id'
             WHERE p.is_active = 1
               AND bot.setting_value IS NOT NULL AND bot.setting_value <> ''
               AND chat.setting_value IS NOT NULL AND chat.setting_value <> ''
        ";

        $params = [];
        if ($projectId !== null && $projectId > 0) {
            $query .= ' AND p.id = ?';
            $params[] = (int) $projectId;
        }

        $query .= ' ORDER BY p.id ASC';

        $stmt = $this->db->query($query, $params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function getPostsForDateByProject($date, $projectId)
    {
        $query = '
            SELECT
                p.id,
                p.text,
                p.post_date,
                p.image_path,
                p.image_action,
                p.image_text,
                c.name AS category_name,
                sn.id AS network_id,
                sn.name AS network_name,
                sn.is_enabled
            FROM posts p
            LEFT JOIN categories c ON c.id = p.category_id
            INNER JOIN social_networks sn ON sn.id = p.social_network_id
            WHERE p.post_date = ?
              AND p.project_id = ?
              AND sn.is_enabled = 1
            ORDER BY sn.sort_order ASC, sn.id ASC, p.id ASC
        ';

        $stmt = $this->db->query($query, [$date, (int) $projectId]);
        $posts = $stmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($posts as &$post) {
            $postId = (int) ($post['id'] ?? 0);
            $photoSource = trim((string) ($post['image_path'] ?? ''));
            $imageAction = trim((string) ($post['image_action'] ?? 'nothing'));
            $hasValidExistingImage = $this->isValidPostImageSource($photoSource);

            $needsAutoImage = ($imageAction === 'auto_generate') && !$hasValidExistingImage;
            if ($needsAutoImage) {
                $generatedFilename = $this->generateImageByPost($post);
                if (!empty($generatedFilename)) {
                    $post['image_path'] = $generatedFilename;
                    $this->db->query('UPDATE posts SET image_path = ? WHERE id = ?', [$generatedFilename, $postId]);
                } else {
                    $post['image_path'] = null;
                    $this->db->query('UPDATE posts SET image_path = NULL WHERE id = ?', [$postId]);
                }
            }
        }
        unset($post);

        return $posts;
    }

    /**
     * Відправляє щоденні пости в Telegram
     * Викликається через cron щоранку
     */
    public function sendDailyPosts()
    {
        $today = date('Y-m-d');
        $requestedProjectId = (int) ($_GET['project_id'] ?? 0);
        $projectFilterId = $requestedProjectId > 0 ? $requestedProjectId : null;

        $projects = $this->getActiveProjectsWithTelegram($projectFilterId);
        if (empty($projects)) {
            if ($projectFilterId !== null) {
                echo "Project #{$projectFilterId} is inactive or has no Telegram credentials.\n";
            } else {
                echo "No active projects with Telegram credentials.\n";
            }
            return;
        }

        $sentCount = 0;
        $projectsWithPosts = 0;
        foreach ($projects as $project) {
            $projectId = (int) ($project['project_id'] ?? 0);
            $posts = $this->getPostsForDateByProject($today, $projectId);

            if (empty($posts)) {
                $sentCount += $this->sendTelegramMessageToProjects([$project], "📅 На сьогодні ({$today}) немає запланованих постів.");
                continue;
            }

            $projectsWithPosts++;

            // Групуємо пости по мережах
            $postsByNetwork = [];
            foreach ($posts as $post) {
                $networkName = $post['network_name'];
                if (!isset($postsByNetwork[$networkName])) {
                    $postsByNetwork[$networkName] = [];
                }
                $postsByNetwork[$networkName][] = $post;
            }

            $message = "📅 *Ваші пости на сьогодні* (" . date('d.m.Y', strtotime($today)) . "):\n\n";
            foreach ($postsByNetwork as $networkName => $networkPosts) {
                $networkIcon = $this->getNetworkIcon($networkName);
                $message .= "{$networkIcon} *{$networkName}*\n";
            }

            $sentCount += $this->sendTelegramMessageToProjects([$project], $message, $posts);
        }

        if ($projectFilterId !== null) {
            echo "Daily posts processed for project #{$projectFilterId}. Sent to {$sentCount}/" . count($projects) . " project(s).\n";
            return;
        }

        echo "Daily posts sent to {$sentCount}/" . count($projects) . " projects. Projects with posts: {$projectsWithPosts}.\n";
    }

    private function generateImageByPost($post)
    {
        $postText = trim((string) ($post['text'] ?? ''));
        if ($postText === '') {
            $postText = 'Пост для соцмереж про саморефлексію, підтримку і внутрішню силу.';
        }

        $postTextShort = mb_substr($postText, 0, 220, 'UTF-8');
        $category = trim((string) ($post['category_name'] ?? ''));
        $network = trim((string) ($post['network_name'] ?? 'Соцмережа'));

        // Generate mood/emotion from post text
        $mood = $this->extractMoodFromText($postTextShort);

        $prompt = "Aesthetic social media illustration for personal development and psychology, "
            . "calm warm tones, {$mood}, modern minimal composition, "
            . "emotional self-reflection theme, no text on image, cinematic light, high quality, "
            . "professional design, inspiring atmosphere. "
            . "Category: {$category}. Network: {$network}. "
            . "Post context: {$postTextShort}";

        $postId = (int) ($post['id'] ?? 0);

        // Try multiple image sources
        $imageSources = [
            'Pollinations.ai' => fn() => $this->fetchImageFromPollinations($prompt),
            'Unsplash' => fn() => $this->fetchImageFromUnsplash($prompt),
            'Pixabay' => fn() => $this->fetchImageFromPixabay($prompt),
            'Picsum (Placeholder)' => fn() => $this->fetchImageFromPicsum(),
        ];

        foreach ($imageSources as $sourceName => $sourceFunc) {
            $imageBinary = $sourceFunc();
            if ($imageBinary !== null) {
                $result = $this->saveAndValidateImage($imageBinary, $postId);
                if ($result !== null) {
                    error_log("Image for post {$postId} generated from {$sourceName}");
                    return $result;
                }
            }
            error_log("{$sourceName} failed for post {$postId}, trying next source...");
        }

        error_log("All image sources exhausted for post {$postId}");
        return null;
    }

    private function fetchImageFromPollinations($prompt)
    {
        $seed = random_int(10000, 99999999);
        $imageUrl = 'https://image.pollinations.ai/prompt/' . rawurlencode($prompt) . '?width=1024&height=1024&seed=' . $seed . '&nologo=true';

        return $this->fetchImageFromUrl($imageUrl, 'Pollinations.ai');
    }

    private function fetchImageFromDuckDuckGo($prompt)
    {
        // Legacy method - redirect to Unsplash
        return $this->fetchImageFromUnsplash($prompt);
    }

    private function fetchImageFromUnsplash($prompt)
    {
        // Unsplash - completely free, high quality, no API key needed
        $searchQuery = str_replace(' ', '+', substr($prompt, 0, 50));
        $imageUrl = 'https://source.unsplash.com/1024x1024/?aesthetic,' . urlencode($searchQuery);

        return $this->fetchImageFromUrl($imageUrl, 'Unsplash');
    }

    private function fetchImageFromPixabay($prompt)
    {
        // Pixabay - free images, no API key needed via URL
        $searchQuery = str_replace(' ', '+', substr(str_replace('aesthetic', 'nature', $prompt), 0, 50));
        // Using Pixabay HTML search (no API required)
        $imageUrl = 'https://pixabay.com/api/?q=' . urlencode($searchQuery) . '&image_type=photo&orientation=horizontal&safesearch=true&per_page=1';

        // This returns JSON, so we need to parse it
        $jsonData = $this->fetchImageFromUrl($imageUrl, 'Pixabay-API');
        if ($jsonData !== null) {
            $data = json_decode($jsonData, true);
            if (!empty($data['hits']) && !empty($data['hits'][0]['webformatURL'])) {
                $imageUrl = $data['hits'][0]['webformatURL'];
                return $this->fetchImageFromUrl($imageUrl, 'Pixabay-Image');
            }
        }

        // Fallback to direct Pixabay image search
        $imageUrl = 'https://pixabay.com/en/photos/?q=' . urlencode($searchQuery) . '&image_type=photo&orientation=horizontal&per_page=1';
        return $this->fetchImageFromUrl($imageUrl, 'Pixabay-Fallback');
    }

    private function fetchImageFromPicsum()
    {
        // Lorem Picsum - reliable placeholder images
        $seed = random_int(1, 1000);
        $imageUrl = 'https://picsum.photos/1024/1024?random=' . $seed;

        return $this->fetchImageFromUrl($imageUrl, 'Picsum');
    }

    private function fetchImageFromUrl($imageUrl, $sourceName)
    {
        // Try cURL first
        if (function_exists('curl_init')) {
            $ch = curl_init($imageUrl);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS => 10,
                CURLOPT_TIMEOUT => 30,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => 0,
                CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                CURLOPT_HTTPHEADER => [
                    'Accept: image/*,application/json',
                ],
            ]);

            $data = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($data !== false && $httpCode >= 200 && $httpCode < 300) {
                // If it's JSON, return as-is for parsing
                if (strpos($data, '{') === 0) {
                    return $data;
                }
                // Otherwise assume it's image binary
                if ($this->isValidImageBinary($data)) {
                    return $data;
                }
            }
        }

        // Fallback to file_get_contents
        $checkContext = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 25,
                'ignore_errors' => true,
                'user_agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            ],
            'ssl' => [
                'verify_peer' => false,
                'verify_peer_name' => false,
            ]
        ]);

        $data = @file_get_contents($imageUrl, false, $checkContext);
        if ($data !== false) {
            // If it's JSON, return as-is for parsing
            if (strpos($data, '{') === 0) {
                return $data;
            }
            // Otherwise assume it's image binary
            if ($this->isValidImageBinary($data)) {
                return $data;
            }
        }

        return null;
    }

    private function saveAndValidateImage($imageBinary, $postId)
    {
        $uploadDir = __DIR__ . '/../../public/uploads/images/';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        $filename = 'generated_post_' . $postId . '_' . time() . '.jpg';
        $filepath = $uploadDir . $filename;

        // Re-encode the image to ensure it's clean and Telegram-compatible
        $reEncodedImage = $this->reEncodeImageForTelegram($imageBinary);
        if ($reEncodedImage === null) {
            error_log("Failed to re-encode image for post {$postId}");
            return null;
        }

        $written = @file_put_contents($filepath, $reEncodedImage);
        if ($written === false) {
            error_log("Failed to write image file for post {$postId}");
            return null;
        }

        if (!$this->isValidPostImageSource($filename)) {
            @unlink($filepath);
            error_log("Generated image failed validation for post {$postId}");
            return null;
        }

        return $filename;
    }

    /**
     * Re-encodes image to ensure Telegram compatibility
     */
    private function reEncodeImageForTelegram($imageBinary)
    {
        if (!function_exists('imagecreatefromstring')) {
            // GD library not available, return original
            return $imageBinary;
        }

        $image = @imagecreatefromstring($imageBinary);
        if ($image === false) {
            return null;
        }

        $width = imagesx($image);
        $height = imagesy($image);

        // Resize if too large (Telegram recommends max 2560px on longest side)
        $maxDimension = 2048;
        if ($width > $maxDimension || $height > $maxDimension) {
            if ($width > $height) {
                $newWidth = $maxDimension;
                $newHeight = (int) ($height * ($maxDimension / $width));
            } else {
                $newHeight = $maxDimension;
                $newWidth = (int) ($width * ($maxDimension / $height));
            }

            $resized = imagecreatetruecolor($newWidth, $newHeight);
            imagecopyresampled($resized, $image, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);
            imagedestroy($image);
            $image = $resized;
        }

        // Save as high-quality JPEG
        ob_start();
        $success = imagejpeg($image, null, 90);
        $output = ob_get_clean();
        imagedestroy($image);

        if (!$success || empty($output)) {
            return null;
        }

        return $output;
    }

    private function isValidImageBinary($imageBinary)
    {
        if ($imageBinary === null || $imageBinary === false || strlen($imageBinary) < 1024) {
            return false;
        }

        // Telegram photo size limit is 10MB
        if (strlen($imageBinary) > 10 * 1024 * 1024) {
            return false;
        }

        $imageInfo = @getimagesizefromstring($imageBinary);
        if (empty($imageInfo)) {
            return false;
        }

        // Check dimensions are reasonable (Telegram recommends reasonable dimensions)
        $width = $imageInfo[0] ?? 0;
        $height = $imageInfo[1] ?? 0;

        if ($width < 1 || $height < 1 || $width > 10000 || $height > 10000) {
            return false;
        }

        return true;
    }

    private function isValidPostImageSource($photoSource)
    {
        $photoSource = trim((string) $photoSource);
        if ($photoSource === '') {
            return false;
        }

        if (preg_match('/^https?:\/\//i', $photoSource)) {
            return true;
        }

        $localPath = __DIR__ . '/../../public/uploads/images/' . basename($photoSource);
        if (!file_exists($localPath)) {
            return false;
        }

        // Check file size
        $fileSize = @filesize($localPath);
        if ($fileSize === false || $fileSize < 1024 || $fileSize > 10 * 1024 * 1024) {
            return false;
        }

        $imageInfo = @getimagesize($localPath);
        if (empty($imageInfo)) {
            return false;
        }

        // Check dimensions
        $width = $imageInfo[0] ?? 0;
        $height = $imageInfo[1] ?? 0;

        if ($width < 1 || $height < 1 || $width > 10000 || $height > 10000) {
            return false;
        }

        // Check if it's a supported image type (JPEG, PNG, GIF, WebP)
        $mimeType = $imageInfo['mime'] ?? '';
        $supportedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

        if (!in_array($mimeType, $supportedTypes)) {
            return false;
        }

        return true;
    }

    /**
     * Відправляє повідомлення в Telegram через Bot API
     */
    private function sendTelegramMessage($botToken, $chatId, $message)
    {
        $botToken = $this->normalizeBotToken($botToken);
        $chatId = $this->normalizeChatId($chatId);

        if (empty($botToken) || empty($chatId)) {
            return ['ok' => false, 'error' => 'Empty or placeholder bot token/chat id'];
        }

        $url = "https://api.telegram.org/bot{$botToken}/sendMessage";

        $data = [
            'chat_id' => $chatId,
            'text' => $message,
            'parse_mode' => 'Markdown',
            'disable_web_page_preview' => true
        ];

        $result = $this->callTelegramApi($url, $data);
        if ($result['ok']) {
            return $result;
        }

        // Fallback: без parse_mode, щоб уникнути помилок форматування Markdown
        $fallbackData = [
            'chat_id' => $chatId,
            'text' => $message,
            'disable_web_page_preview' => true
        ];

        $fallbackResult = $this->callTelegramApi($url, $fallbackData);
        if ($fallbackResult['ok']) {
            return $fallbackResult;
        }

        return [
            'ok' => false,
            'error' => $result['error'] . '; fallback: ' . $fallbackResult['error']
        ];
    }

    private function callTelegramApi($url, $data)
    {

        $options = [
            'http' => [
                'header' => "Content-type: application/x-www-form-urlencoded\r\n",
                'method' => 'POST',
                'content' => http_build_query($data),
                'ignore_errors' => true
            ]
        ];

        $context = stream_context_create($options);
        $result = @file_get_contents($url, false, $context);

        $statusCode = 0;
        if (!empty($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $matches)) {
            $statusCode = (int) $matches[1];
        }

        if ($result !== false) {
            $response = json_decode($result, true);
            if (!empty($response['ok'])) {
                return ['ok' => true, 'error' => ''];
            }

            $description = $response['description'] ?? '';
            if ($description !== '') {
                return ['ok' => false, 'error' => $description];
            }

            if ($statusCode >= 400) {
                return ['ok' => false, 'error' => 'Telegram API HTTP ' . $statusCode . ' error'];
            }

            return ['ok' => false, 'error' => 'Unknown Telegram API error'];
        }

        $httpError = error_get_last();
        return [
            'ok' => false,
            'error' => 'HTTP request failed' . (!empty($httpError['message']) ? ': ' . $httpError['message'] : '')
        ];
    }

    private function sendTelegramPhoto($botToken, $chatId, $photoSource, $caption = '')
    {
        $botToken = $this->normalizeBotToken($botToken);
        $chatId = $this->normalizeChatId($chatId);

        if (empty($botToken) || empty($chatId) || empty($photoSource)) {
            return ['ok' => false, 'error' => 'Empty or placeholder bot token/chat id/photo source'];
        }

        $url = "https://api.telegram.org/bot{$botToken}/sendPhoto";

        if (preg_match('/^https?:\/\//i', $photoSource)) {
            $data = [
                'chat_id' => $chatId,
                'photo' => $photoSource,
                'caption' => $caption
            ];

            return $this->callTelegramApi($url, $data);
        }

        $localPath = __DIR__ . '/../../public/uploads/images/' . basename((string) $photoSource);
        if (!file_exists($localPath)) {
            return ['ok' => false, 'error' => 'Local image not found: ' . $localPath];
        }

        if (!function_exists('curl_init')) {
            return ['ok' => false, 'error' => 'cURL extension is not available for local photo upload'];
        }

        $ch = curl_init();
        $data = [
            'chat_id' => $chatId,
            'photo' => new CURLFile($localPath),
            'caption' => $caption
        ];

        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POSTFIELDS => $data,
            CURLOPT_TIMEOUT => 30,
        ]);

        $responseBody = curl_exec($ch);
        $curlError = curl_error($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($responseBody === false) {
            return ['ok' => false, 'error' => 'cURL upload failed: ' . $curlError];
        }

        $response = json_decode($responseBody, true);
        if (!empty($response['ok'])) {
            return ['ok' => true, 'error' => ''];
        }

        $description = $response['description'] ?? '';
        if ($description !== '') {
            return ['ok' => false, 'error' => $description];
        }

        return ['ok' => false, 'error' => 'Telegram sendPhoto failed (HTTP ' . $httpCode . ')'];
    }

    /**
     * Відправляє одне повідомлення у всі активні проєкти
     */
    private function sendTelegramMessageToProjects($projects, $message, $posts = [])
    {
        $sentCount = 0;
        foreach ($projects as $project) {
            // Send header message about the project
            $projectMessage = "🏷 Проєкт #" . (int) $project['project_id'] . ": *" . $project['project_name'] . "*\n\n" . $message;
            $sendResult = $this->sendTelegramMessage($project['bot_token'], $project['chat_id'], $projectMessage);

            if (!empty($sendResult['ok'])) {
                $sentCount++;
                echo "Sent to project #{$project['project_id']} ({$project['project_name']}).\n";

                // Send each post with its image (if available) or as text
                foreach ($posts as $post) {
                    $postId = (int) ($post['id'] ?? 0);
                    $photoSource = trim((string) ($post['image_path'] ?? ''));
                    $networkName = $post['network_name'] ?? 'Соцмережа';
                    $categoryName = $post['category_name'] ?: 'Без категорії';
                    $postText = trim((string) ($post['text'] ?? ''));
                    $networkIcon = $this->getNetworkIcon($networkName);

                    // Check if we have a valid image
                    $hasValidImage = !empty($photoSource) && $this->isValidPostImageSource($photoSource);

                    if ($hasValidImage) {
                        // Send text with formatting first
                        $textMessage = "{$networkIcon} *{$networkName}* | _{$categoryName}_\n\n";
                        $textMessage .= "```\n{$postText}\n```";

                        $textResult = $this->sendTelegramMessage($project['bot_token'], $project['chat_id'], $textMessage);

                        if (!empty($textResult['ok'])) {
                            echo "📝 Text sent for project #{$project['project_id']} post #{$postId}.\n";
                        }

                        // Then send photo as separate message (without caption with code formatting)
                        $photoCaption = "{$networkIcon} {$networkName}";
                        $photoResult = $this->sendTelegramPhoto(
                            $project['bot_token'],
                            $project['chat_id'],
                            $photoSource,
                            $photoCaption
                        );

                        if (!empty($photoResult['ok'])) {
                            echo "📸 Photo sent for project #{$project['project_id']} post #{$postId}.\n";
                        } else {
                            $photoError = $photoResult['error'] ?? 'unknown error';
                            echo "Photo failed for project #{$project['project_id']} post #{$postId}: {$photoError}.\n";

                            // Clean up invalid image
                            if ($postId > 0 && !preg_match('/^https?:\/\//i', $photoSource)) {
                                $this->db->query('UPDATE posts SET image_path = NULL WHERE id = ?', [$postId]);
                                echo "Cleaned invalid image for post #{$postId}.\n";
                            }
                        }
                    } else {
                        // No image: send as text message with formatting
                        $textMessage = "{$networkIcon} *{$networkName}* | _{$categoryName}_\n\n";
                        $textMessage .= "```\n{$postText}\n```";

                        $textResult = $this->sendTelegramMessage($project['bot_token'], $project['chat_id'], $textMessage);
                        if (!empty($textResult['ok'])) {
                            echo "📝 Text sent for project #{$project['project_id']} post #{$postId}.\n";
                        } else {
                            echo "Text send failed for project #{$project['project_id']} post #{$postId}.\n";
                        }
                    }

                    // Small delay between posts to avoid Telegram rate limiting
                    usleep(500000); // 0.5 seconds
                }
            } else {
                $error = $sendResult['error'] ?? 'unknown error';
                echo "Failed for project #{$project['project_id']} ({$project['project_name']}): {$error}.\n";
            }
        }

        return $sentCount;
    }

    /**
     * Повертає іконку для соц.мережі
     */
    private function getNetworkIcon($networkName)
    {
        $icons = [
            'Threads Posts' => '🔗',
            'Instagram Posts' => '📸',
            'Instagram Stories' => '🎬',
            'Instagram Reels' => '🎥',
            'YouTube Shorts' => '▶️',
            'TikTok' => '🎵'
        ];

        return $icons[$networkName] ?? '📱';
    }

    /**
     * Тестовий метод для перевірки роботи
     */
    public function test()
    {
        echo "Cron controller is working!\n";
        echo "Current date: " . date('Y-m-d H:i:s') . "\n";

        $projects = $this->getActiveProjectsWithTelegram();
        if (empty($projects)) {
            echo "No active projects with Telegram credentials.\n";
            return;
        }

        $testMessage = "🧪 *Тестове повідомлення*\n\nБот працює коректно!";
        $sentCount = $this->sendTelegramMessageToProjects($projects, $testMessage);
        echo "Test message sent to {$sentCount}/" . count($projects) . " projects.\n";
    }
}
