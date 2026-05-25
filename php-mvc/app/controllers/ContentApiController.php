<?php
require_once __DIR__ . '/../core/BaseController.php';

class ContentApiController extends BaseController
{
    private $jobsDir = '/tmp/content_jobs';

    public function __construct($db)
    {
        parent::__construct($db);
        if (!is_dir($this->jobsDir)) {
            mkdir($this->jobsDir, 0755, true);
        }
    }

    // POST /api/content-generate — called by browser (requires auth)
    public function generate()
    {
        header('Content-Type: application/json');

        if (empty($_SESSION['admin_id'])) {
            http_response_code(401);
            echo json_encode(['error' => 'Unauthorized']);
            return;
        }

        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid JSON']);
            return;
        }

        $funnel = $body['funnel'] ?? '';
        $params = $body['params'] ?? [];

        $allowedFunnels = [
            'content-stories-generator',
            'content-carousel',
            'content-video-basic-subs',
            'content-video-remotion',
            'content-avatar-heygen',
            'content-avatar-budget',
            'content-image-template',
        ];

        if (!in_array($funnel, $allowedFunnels)) {
            http_response_code(400);
            echo json_encode(['error' => 'Unknown funnel: ' . htmlspecialchars($funnel)]);
            return;
        }

        $jobId = $this->generateUuid();
        $callbackUrl = 'https://content.fineko.space/api/content-callback';

        $job = [
            'jobId'     => $jobId,
            'status'    => 'pending',
            'funnel'    => $funnel,
            'createdAt' => time(),
            'updatedAt' => time(),
        ];
        file_put_contents($this->jobsDir . '/' . $jobId . '.json', json_encode($job));

        $webhookUrl = 'https://flows.fineko.space/webhook/bot/' . $funnel;
        $payload = array_merge($params, [
            'postId'      => $jobId,
            'callbackUrl' => $callbackUrl,
        ]);

        $ch = curl_init($webhookUrl);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($curlError || $httpCode >= 400) {
            $errMsg = $curlError ?: "Webhook HTTP $httpCode";
            $job['status'] = 'error';
            $job['error']  = $errMsg;
            $job['updatedAt'] = time();
            file_put_contents($this->jobsDir . '/' . $jobId . '.json', json_encode($job));
            http_response_code(502);
            echo json_encode(['error' => $errMsg]);
            return;
        }

        $job['status'] = 'processing';
        $job['updatedAt'] = time();
        file_put_contents($this->jobsDir . '/' . $jobId . '.json', json_encode($job));

        echo json_encode(['jobId' => $jobId, 'status' => 'processing']);
    }

    // POST /api/content-callback — called by funnel (no auth)
    public function callback()
    {
        header('Content-Type: application/json');

        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid JSON']);
            return;
        }

        $jobId = $body['postId'] ?? '';
        if (!$jobId || !preg_match('/^[a-f0-9\-]{36}$/', $jobId)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid postId']);
            return;
        }

        $jobFile = $this->jobsDir . '/' . $jobId . '.json';
        if (!file_exists($jobFile)) {
            http_response_code(404);
            echo json_encode(['error' => 'Job not found']);
            return;
        }

        $job = json_decode(file_get_contents($jobFile), true);

        $status = $body['status'] ?? 'error';
        $job['status']    = ($status === 'success') ? 'done' : 'error';
        $job['updatedAt'] = time();

        if ($status === 'success') {
            $mediaType = $body['mediaType'] ?? 'image';
            $job['mediaType'] = $mediaType;
            if ($mediaType === 'image') {
                $job['imageBase64']  = $body['imageBase64'] ?? '';
                $job['contentType']  = $body['contentType'] ?? 'image/png';
            } elseif ($mediaType === 'carousel') {
                $job['slidesBase64'] = $body['slidesBase64'] ?? [];
                $job['contentType']  = $body['contentType'] ?? 'image/png';
            } elseif ($mediaType === 'video') {
                $job['videoUrl'] = $body['videoUrl'] ?? '';
            }
        } else {
            $job['error'] = $body['error'] ?? 'Unknown error from funnel';
        }

        file_put_contents($jobFile, json_encode($job));
        echo json_encode(['ok' => true]);
    }

    // GET /api/content-status?jobId=xxx — called by browser polling
    public function status()
    {
        header('Content-Type: application/json');
        header('Cache-Control: no-cache');

        $jobId = $_GET['jobId'] ?? '';
        if (!$jobId || !preg_match('/^[a-f0-9\-]{36}$/', $jobId)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid jobId']);
            return;
        }

        $jobFile = $this->jobsDir . '/' . $jobId . '.json';
        if (!file_exists($jobFile)) {
            http_response_code(404);
            echo json_encode(['error' => 'Job not found']);
            return;
        }

        $job = json_decode(file_get_contents($jobFile), true);

        // Don't expose full base64 unless done
        if ($job['status'] !== 'done') {
            unset($job['imageBase64'], $job['slidesBase64'], $job['videoUrl']);
        }

        echo json_encode($job);
    }

    private function generateUuid()
    {
        return sprintf(
            '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
            mt_rand(0, 0xffff), mt_rand(0, 0xffff),
            mt_rand(0, 0xffff),
            mt_rand(0, 0x0fff) | 0x4000,
            mt_rand(0, 0x3fff) | 0x8000,
            mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
        );
    }
}
