<?php

class MediaGenerationService
{
    private $db;
    private $config;
    private $columnsCache = [];

    public function __construct($db, array $config = [])
    {
        $this->db = $db;
        $this->config = $config;
    }

    public function startForPost($postId, $projectId = null, $avatarEngine = null)
    {
        $postId = (int) $postId;
        if ($postId <= 0) {
            throw new InvalidArgumentException('invalid_post_id');
        }

        $post = $this->findPost($postId, $projectId);
        if (!$post) {
            throw new RuntimeException('post_not_found');
        }

        $text = trim((string) ($post['text'] ?? ''));
        if ($text === '') {
            throw new RuntimeException('empty_post_text');
        }

        $currentStatus = trim((string) ($post['generation_status'] ?? 'not_generated'));
        if (in_array($currentStatus, ['queued', 'processing'], true)) {
            return [
                'ok'        => true,
                'idempotent' => true,
                'post_id'   => (int) $post['id'],
                'status'    => $currentStatus,
                'job_id'    => $post['generation_job_id'] ?? null,
                'flow'      => $post['generation_flow_key'] ?? null,
                'message'   => 'already_in_progress',
            ];
        }

        $engine   = $this->normalizeAvatarEngine($avatarEngine !== null ? $avatarEngine : ($post['avatar_engine'] ?? ''));
        $flow     = $this->resolveFlow($post, $engine);
        $callbackUrl = $this->buildWebhookUrl($postId);
        $payload  = $this->buildPayload($flow, $post, $engine, $callbackUrl);

        $response = $this->sendToFlow($flow, $payload);
        $jobId = (string) ($response['jobId'] ?? $response['job_id'] ?? $response['id'] ?? '');
        if ($jobId === '') {
            $jobId = 'pending-' . time() . '-' . $postId;
        }

        $parts  = [];
        $values = [];

        if ($this->hasColumn('posts', 'generation_status')) {
            $parts[]  = 'generation_status = ?';
            $values[] = 'processing';
        }
        if ($this->hasColumn('posts', 'generation_job_id')) {
            $parts[]  = 'generation_job_id = ?';
            $values[] = $jobId;
        }
        if ($this->hasColumn('posts', 'generation_flow_key')) {
            $parts[]  = 'generation_flow_key = ?';
            $values[] = $flow;
        }
        if ($this->hasColumn('posts', 'generation_error')) {
            $parts[] = 'generation_error = NULL';
        }
        if ($this->hasColumn('posts', 'generation_output_url')) {
            $parts[] = 'generation_output_url = NULL';
        }
        if ($this->hasColumn('posts', 'generation_requested_at')) {
            $parts[] = 'generation_requested_at = NOW()';
        }
        if ($this->hasColumn('posts', 'generation_finished_at')) {
            $parts[] = 'generation_finished_at = NULL';
        }
        if ($this->hasColumn('posts', 'avatar_engine')) {
            $parts[]  = 'avatar_engine = ?';
            $values[] = $engine !== '' ? $engine : null;
        }

        if (!empty($parts)) {
            $values[] = $postId;
            $this->db->query('UPDATE posts SET ' . implode(', ', $parts) . ' WHERE id = ?', $values);
        }

        return [
            'ok'       => true,
            'post_id'  => (int) $post['id'],
            'status'   => 'processing',
            'job_id'   => $jobId,
            'flow'     => $flow,
            'response' => $response,
        ];
    }

    public function updateAvatarEngine($postId, $projectId, $avatarEngine)
    {
        if (!$this->hasColumn('posts', 'avatar_engine')) {
            throw new RuntimeException('avatar_engine_column_missing');
        }

        $post = $this->findPost((int) $postId, (int) $projectId);
        if (!$post) {
            throw new RuntimeException('post_not_found');
        }

        $engine = $this->normalizeAvatarEngine($avatarEngine);
        $this->db->query('UPDATE posts SET avatar_engine = ? WHERE id = ?', [$engine !== '' ? $engine : null, (int) $postId]);

        return [
            'ok'           => true,
            'post_id'      => (int) $postId,
            'avatar_engine' => $engine,
        ];
    }

    public function getStatus($postId, $projectId = null)
    {
        $post = $this->findPost((int) $postId, $projectId);
        if (!$post) {
            throw new RuntimeException('post_not_found');
        }

        return [
            'ok'                    => true,
            'post_id'               => (int) $post['id'],
            'generation_status'     => $post['generation_status'] ?? 'not_generated',
            'generation_output_url' => $post['generation_output_url'] ?? null,
            'generation_error'      => $post['generation_error'] ?? null,
            'generation_job_id'     => $post['generation_job_id'] ?? null,
            'generation_flow_key'   => $post['generation_flow_key'] ?? null,
        ];
    }

    public function handleWebhook($postId, array $payload)
    {
        $postId = (int) $postId;
        if ($postId <= 0) {
            throw new InvalidArgumentException('invalid_post_id');
        }

        $post = $this->findPost($postId, null);
        if (!$post) {
            throw new RuntimeException('post_not_found');
        }

        $incomingStatus = strtolower(trim((string) ($payload['status'] ?? 'completed')));
        $outputUrl      = trim((string) ($payload['output_url'] ?? $payload['outputUrl'] ?? $payload['videoUrl'] ?? $payload['mediaUrl'] ?? ''));
        $error          = trim((string) ($payload['error'] ?? ''));
        $jobId          = trim((string) ($payload['jobId'] ?? $payload['job_id'] ?? ''));

        // Handle base64 images from our content funnels
        $imageBase64  = trim((string) ($payload['imageBase64'] ?? ''));
        $slidesBase64 = $payload['slidesBase64'] ?? null;
        $videoPath    = trim((string) ($payload['videoPath'] ?? ''));

        if ($imageBase64 !== '') {
            $saved = $this->saveBase64Image($imageBase64, $postId, '');
            if ($saved !== null) {
                $outputUrl = $saved;
                $incomingStatus = 'success';
            }
        } elseif (is_array($slidesBase64) && !empty($slidesBase64)) {
            $savedUrls = [];
            foreach ($slidesBase64 as $i => $b64) {
                $saved = $this->saveBase64Image((string) $b64, $postId, 'slide' . $i);
                if ($saved !== null) {
                    $savedUrls[] = $saved;
                }
            }
            if (!empty($savedUrls)) {
                $outputUrl = json_encode($savedUrls);
                $incomingStatus = 'success';
            }
        } elseif ($videoPath !== '' && $outputUrl === '') {
            // Video is a local path on the VPS — expose via public URL
            $outputUrl = $this->publishLocalVideo($videoPath, $postId);
        }

        $finalStatus = 'processing';
        if (in_array($incomingStatus, ['completed', 'success', 'succeeded', 'ready'], true)) {
            $finalStatus = 'ready';
        } elseif (in_array($incomingStatus, ['failed', 'error', 'cancelled', 'canceled'], true)) {
            $finalStatus = 'failed';
        } elseif ($incomingStatus === 'queued') {
            $finalStatus = 'queued';
        }

        $parts  = [];
        $values = [];

        if ($this->hasColumn('posts', 'generation_status')) {
            $parts[]  = 'generation_status = ?';
            $values[] = $finalStatus;
        }
        if ($this->hasColumn('posts', 'generation_job_id') && $jobId !== '') {
            $parts[]  = 'generation_job_id = ?';
            $values[] = $jobId;
        }
        if ($this->hasColumn('posts', 'generation_output_url')) {
            $parts[]  = 'generation_output_url = ?';
            $values[] = $outputUrl !== '' ? $outputUrl : null;
        }
        if ($this->hasColumn('posts', 'generation_error')) {
            $parts[]  = 'generation_error = ?';
            $values[] = $error !== '' ? $error : null;
        }
        if ($this->hasColumn('posts', 'generation_finished_at') && in_array($finalStatus, ['ready', 'failed'], true)) {
            $parts[] = 'generation_finished_at = NOW()';
        }
        if ($outputUrl !== '' && $this->hasColumn('posts', 'image_path')) {
            $parts[]  = 'image_path = ?';
            $values[] = $outputUrl;
        }

        if (!empty($parts)) {
            $values[] = $postId;
            $this->db->query('UPDATE posts SET ' . implode(', ', $parts) . ' WHERE id = ?', $values);
        }

        return [
            'ok'        => true,
            'post_id'   => $postId,
            'status'    => $finalStatus,
            'output_url' => $outputUrl !== '' ? $outputUrl : null,
        ];
    }

    public function isValidWebhookToken($incomingToken)
    {
        $expected = (string) ($this->config['generation_webhook_token'] ?? $this->config['token'] ?? '');
        if ($expected === '') {
            return false;
        }

        $incomingToken = trim((string) $incomingToken);
        if ($incomingToken === '') {
            return false;
        }

        return hash_equals($expected, $incomingToken);
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    private function findPost($postId, $projectId = null)
    {
        $statusSelect  = $this->hasColumn('posts', 'generation_status')     ? 'p.generation_status'     : '"not_generated" AS generation_status';
        $jobIdSelect   = $this->hasColumn('posts', 'generation_job_id')     ? 'p.generation_job_id'     : 'NULL AS generation_job_id';
        $flowSelect    = $this->hasColumn('posts', 'generation_flow_key')   ? 'p.generation_flow_key'   : 'NULL AS generation_flow_key';
        $outSelect     = $this->hasColumn('posts', 'generation_output_url') ? 'p.generation_output_url' : 'NULL AS generation_output_url';
        $errSelect     = $this->hasColumn('posts', 'generation_error')      ? 'p.generation_error'      : 'NULL AS generation_error';
        $avatarSelect  = $this->hasColumn('posts', 'avatar_engine')         ? 'p.avatar_engine'         : 'NULL AS avatar_engine';
        $imgPathSelect = $this->hasColumn('posts', 'image_path')            ? 'p.image_path'            : 'NULL AS image_path';
        $imgTextSelect = $this->hasColumn('posts', 'image_text')            ? 'p.image_text'            : 'NULL AS image_text';

        $sql = 'SELECT p.id, p.project_id, p.social_network_id, p.post_type, p.text, '
            . $statusSelect . ', '
            . $jobIdSelect . ', '
            . $flowSelect . ', '
            . $outSelect . ', '
            . $errSelect . ', '
            . $avatarSelect . ', '
            . $imgPathSelect . ', '
            . $imgTextSelect . ', '
            . 'sn.name AS network_name '
            . 'FROM posts p '
            . 'LEFT JOIN social_networks sn ON sn.id = p.social_network_id '
            . 'WHERE p.id = ?';

        $params = [(int) $postId];
        if ($projectId !== null) {
            $sql    .= ' AND p.project_id = ?';
            $params[] = (int) $projectId;
        }

        $sql .= ' LIMIT 1';

        return $this->db->query($sql, $params)->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    private function resolveFlow(array $post, $engine)
    {
        $network  = mb_strtolower(trim((string) ($post['network_name'] ?? '')), 'UTF-8');
        $postType = mb_strtolower(trim((string) ($post['post_type'] ?? '')), 'UTF-8');

        // Avatar flows override everything
        if ($engine === 'heygen') {
            return 'content-avatar-heygen';
        }
        if ($engine === 'liveportrait') {
            return 'content-avatar-budget';
        }

        // Video networks/types
        $isVideoNetwork = strpos($network, 'reels') !== false
            || strpos($network, 'shorts') !== false
            || strpos($network, 'tiktok') !== false;

        $isVideoType = in_array($postType, ['відео', 'video', 'reels', 'рілс', 'shorts'], true);

        if ($isVideoNetwork || $isVideoType) {
            if ($postType === 'karaoke' || $postType === 'reels_karaoke') {
                return 'content-video-remotion';
            }
            return 'content-video-basic-subs';
        }

        // Carousel
        if (in_array($postType, ['карусель', 'carousel'], true)) {
            return 'content-carousel';
        }

        // Stories / feed — default image generation
        return 'content-stories-generator';
    }

    private function buildPayload($flowKey, array $post, $engine, $callbackUrl)
    {
        $postId     = (int) $post['id'];
        $text       = trim((string) ($post['text'] ?? ''));
        $imageText  = trim((string) ($post['image_text'] ?? ''));
        $imagePath  = trim((string) ($post['image_path'] ?? ''));
        $projectId  = (int) $post['project_id'];
        $brandHandle = $this->getProjectSetting($projectId, 'brand_handle') ?: '';

        switch ($flowKey) {
            case 'content-stories-generator':
                return [
                    'postId'      => (string) $postId,
                    'photoUrl'    => $imagePath,
                    'text'        => $text,
                    'subText'     => $imageText,
                    'brandHandle' => $brandHandle,
                    'template'    => 'default',
                    'callbackUrl' => $callbackUrl,
                ];

            case 'content-carousel':
                // Each non-empty line in post text = one slide
                $lines  = array_values(array_filter(array_map('trim', explode("\n", $text))));
                if (empty($lines)) {
                    $lines = [$text];
                }
                $slides = array_map(function ($line) {
                    return ['text' => $line, 'subText' => ''];
                }, $lines);
                return [
                    'postId'      => (string) $postId,
                    'photoUrl'    => $imagePath,
                    'slides'      => $slides,
                    'brandHandle' => $brandHandle,
                    'template'    => 'default',
                    'callbackUrl' => $callbackUrl,
                ];

            case 'content-video-basic-subs':
            case 'content-video-remotion':
                return [
                    'postId'      => (string) $postId,
                    'videoUrl'    => $imagePath,
                    'callbackUrl' => $callbackUrl,
                ];

            case 'content-resizer':
                return [
                    'postId'        => (string) $postId,
                    'finalVideoUrl' => $imagePath,
                    'description'   => $text,
                    'platforms'     => ['instagram', 'tiktok', 'facebook', 'linkedin', 'threads'],
                    'callbackUrl'   => $callbackUrl,
                ];

            default:
                // Legacy format for avatar flows and any future custom keys
                return [
                    'projectId'  => $projectId,
                    'postId'     => $postId,
                    'scriptText' => $text,
                    'engine'     => $engine,
                    'voiceId'    => (string) ($this->config['flow_voice_id'] ?? ''),
                    'webhookUrl' => $callbackUrl,
                ];
        }
    }

    private function normalizeAvatarEngine($raw)
    {
        $value = mb_strtolower(trim((string) $raw), 'UTF-8');
        if ($value === '') {
            return '';
        }

        $aliases = [
            'replicate_liveportrait' => 'liveportrait',
            'live_portrait'          => 'liveportrait',
            'hey-gen'                => 'heygen',
        ];

        if (isset($aliases[$value])) {
            $value = $aliases[$value];
        }

        return in_array($value, ['heygen', 'liveportrait'], true) ? $value : '';
    }

    private function buildWebhookUrl($postId)
    {
        $base = trim((string) ($this->config['public_base_url'] ?? ''));
        if ($base === '') {
            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $host   = $_SERVER['HTTP_HOST'] ?? '';
            if ($host !== '') {
                $base = $scheme . '://' . $host;
            }
        }

        $base  = rtrim($base, '/');
        $token = urlencode((string) ($this->config['generation_webhook_token'] ?? $this->config['token'] ?? ''));

        return $base . '/api/generation/webhook?post_id=' . (int) $postId . '&token=' . $token;
    }

    private function sendToFlow($flowKey, array $payload)
    {
        $endpoints = isset($this->config['flows_endpoints']) && is_array($this->config['flows_endpoints'])
            ? $this->config['flows_endpoints']
            : [];

        $endpoint = trim((string) ($endpoints[$flowKey] ?? ''));
        if ($endpoint === '') {
            throw new RuntimeException('flow_endpoint_not_configured:' . $flowKey);
        }

        if (!function_exists('curl_init')) {
            throw new RuntimeException('curl_not_available');
        }

        $ch          = curl_init($endpoint);
        $jsonPayload = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $headers     = ['Content-Type: application/json'];

        $flowApiKey = trim((string) ($this->config['flows_api_key'] ?? ''));
        if ($flowApiKey !== '') {
            $headers[] = 'Authorization: Bearer ' . $flowApiKey;
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $jsonPayload,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_CONNECTTIMEOUT => 7,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
        ]);

        $raw      = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error    = curl_error($ch);
        curl_close($ch);

        if ($raw === false || $raw === null) {
            throw new RuntimeException('flow_request_failed:' . $error);
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            throw new RuntimeException('flow_http_' . $httpCode);
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return ['raw' => $raw];
        }

        return $decoded;
    }

    private function saveBase64Image($base64, $postId, $suffix)
    {
        if ($base64 === '') {
            return null;
        }

        // Strip data URI prefix if present
        if (strpos($base64, ',') !== false) {
            $base64 = substr($base64, strpos($base64, ',') + 1);
        }

        $decoded = base64_decode(str_replace(['-', '_'], ['+', '/'], $base64), true);
        if ($decoded === false || $decoded === '') {
            return null;
        }

        $dir = $this->getGeneratedDir();
        if ($dir === null) {
            return null;
        }

        $name = 'post_' . (int) $postId . ($suffix !== '' ? '_' . $suffix : '') . '.png';
        $path = $dir . DIRECTORY_SEPARATOR . $name;

        if (file_put_contents($path, $decoded) === false) {
            return null;
        }

        $baseUrl = rtrim((string) ($this->config['public_base_url'] ?? ''), '/');
        return $baseUrl . '/uploads/generated/' . $name;
    }

    private function publishLocalVideo($videoPath, $postId)
    {
        // When platform and video-processor are on the same VPS,
        // copy the file to our public directory and return a URL.
        $dir = $this->getGeneratedDir();
        if ($dir === null || !is_file($videoPath)) {
            // Fallback: just return the path as-is, let the platform handle it
            return $videoPath;
        }

        $ext  = pathinfo($videoPath, PATHINFO_EXTENSION) ?: 'mp4';
        $name = 'post_' . (int) $postId . '_video.' . $ext;
        $dest = $dir . DIRECTORY_SEPARATOR . $name;

        if (!copy($videoPath, $dest)) {
            return $videoPath;
        }

        $baseUrl = rtrim((string) ($this->config['public_base_url'] ?? ''), '/');
        return $baseUrl . '/uploads/generated/' . $name;
    }

    private function getGeneratedDir()
    {
        // php-mvc/app/core/ → php-mvc/public/uploads/generated/
        $dir = __DIR__ . '/../../public/uploads/generated';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        return is_dir($dir) ? realpath($dir) : null;
    }

    private function getProjectSetting($projectId, $key)
    {
        $row = $this->db->query(
            'SELECT setting_value FROM settings WHERE project_id = ? AND setting_key = ? LIMIT 1',
            [(int) $projectId, $key]
        )->fetch(PDO::FETCH_ASSOC);
        return $row ? (string) $row['setting_value'] : null;
    }

    private function hasColumn($tableName, $columnName)
    {
        $cacheKey = $tableName . ':' . $columnName;
        if (array_key_exists($cacheKey, $this->columnsCache)) {
            return $this->columnsCache[$cacheKey];
        }

        $row = $this->db->query('SHOW COLUMNS FROM ' . $tableName . ' LIKE ?', [$columnName])->fetch(PDO::FETCH_ASSOC);
        $this->columnsCache[$cacheKey] = (bool) $row;

        return $this->columnsCache[$cacheKey];
    }
}
