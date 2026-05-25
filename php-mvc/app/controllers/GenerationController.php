<?php

require_once __DIR__ . '/../core/BaseController.php';
require_once __DIR__ . '/../core/MediaGenerationService.php';

class GenerationController extends BaseController
{
    private $service;

    public function __construct($db)
    {
        parent::__construct($db);

        $configPath = __DIR__ . '/../../config/mcp.php';
        $config = [];
        if (is_file($configPath)) {
            $loaded = require $configPath;
            if (is_array($loaded)) {
                $config = $loaded;
            }
        }

        $this->service = new MediaGenerationService($db, $config);
    }

    public function run()
    {
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        header('Content-Type: application/json; charset=utf-8');

        $projectData = $this->ensureProjectSelected();
        $activeProjectId = (int) $projectData['active_project_id'];

        $payload = $this->readJsonBody();
        $postId = (int) ($payload['post_id'] ?? $_POST['post_id'] ?? 0);
        $avatarEngine = (string) ($payload['avatar_engine'] ?? $_POST['avatar_engine'] ?? '');

        try {
            $result = $this->service->startForPost($postId, $activeProjectId, $avatarEngine);
            echo json_encode($result, JSON_UNESCAPED_UNICODE);
        } catch (Throwable $e) {
            echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
        }
    }

    public function runBulk()
    {
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        header('Content-Type: application/json; charset=utf-8');

        $projectData = $this->ensureProjectSelected();
        $activeProjectId = (int) $projectData['active_project_id'];

        $payload = $this->readJsonBody();
        $postIds = $payload['post_ids'] ?? $_POST['post_ids'] ?? [];
        if (!is_array($postIds)) {
            $postIds = [];
        }

        $avatarEngine = (string) ($payload['avatar_engine'] ?? $_POST['avatar_engine'] ?? '');

        $started = 0;
        $failed = 0;
        $details = [];

        foreach ($postIds as $postId) {
            $pid = (int) $postId;
            if ($pid <= 0) {
                continue;
            }

            try {
                $result = $this->service->startForPost($pid, $activeProjectId, $avatarEngine);
                $started++;
                $details[] = [
                    'post_id' => $pid,
                    'ok' => true,
                    'status' => $result['status'] ?? 'processing',
                    'job_id' => $result['job_id'] ?? null,
                    'flow' => $result['flow'] ?? null,
                    'idempotent' => !empty($result['idempotent']),
                ];
            } catch (Throwable $e) {
                $failed++;
                $details[] = [
                    'post_id' => $pid,
                    'ok' => false,
                    'error' => $e->getMessage(),
                ];
            }
        }

        echo json_encode([
            'ok' => true,
            'started' => $started,
            'failed' => $failed,
            'details' => $details,
        ], JSON_UNESCAPED_UNICODE);
    }

    public function runDay()
    {
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        header('Content-Type: application/json; charset=utf-8');

        $projectData = $this->ensureProjectSelected();
        $activeProjectId = (int) $projectData['active_project_id'];

        $payload = $this->readJsonBody();
        $postDate = trim((string) ($payload['post_date'] ?? $_POST['post_date'] ?? ''));
        $avatarEngine = (string) ($payload['avatar_engine'] ?? $_POST['avatar_engine'] ?? '');

        $dt = DateTime::createFromFormat('Y-m-d', $postDate);
        if (!$dt || $dt->format('Y-m-d') !== $postDate) {
            echo json_encode(['ok' => false, 'error' => 'invalid_post_date'], JSON_UNESCAPED_UNICODE);
            return;
        }

        $rows = $this->db->query(
            'SELECT id FROM posts WHERE project_id = ? AND post_date = ? ORDER BY id ASC',
            [$activeProjectId, $postDate]
        )->fetchAll(PDO::FETCH_ASSOC);

        $started = 0;
        $failed = 0;
        $details = [];

        foreach ($rows as $row) {
            $postId = (int) ($row['id'] ?? 0);
            if ($postId <= 0) {
                continue;
            }

            try {
                $result = $this->service->startForPost($postId, $activeProjectId, $avatarEngine);
                $started++;
                $details[] = [
                    'post_id' => $postId,
                    'ok' => true,
                    'status' => $result['status'] ?? 'processing',
                    'idempotent' => !empty($result['idempotent']),
                ];
            } catch (Throwable $e) {
                $failed++;
                $details[] = [
                    'post_id' => $postId,
                    'ok' => false,
                    'error' => $e->getMessage(),
                ];
            }
        }

        echo json_encode([
            'ok' => true,
            'post_date' => $postDate,
            'started' => $started,
            'failed' => $failed,
            'details' => $details,
        ], JSON_UNESCAPED_UNICODE);
    }

    public function status()
    {
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        header('Content-Type: application/json; charset=utf-8');

        $projectData = $this->ensureProjectSelected();
        $activeProjectId = (int) $projectData['active_project_id'];

        $postId = (int) ($_GET['post_id'] ?? 0);

        try {
            $result = $this->service->getStatus($postId, $activeProjectId);
            echo json_encode($result, JSON_UNESCAPED_UNICODE);
        } catch (Throwable $e) {
            echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
        }
    }

    public function updateAvatarEngine()
    {
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        header('Content-Type: application/json; charset=utf-8');

        $projectData = $this->ensureProjectSelected();
        $activeProjectId = (int) $projectData['active_project_id'];

        $payload = $this->readJsonBody();
        $postId = (int) ($payload['post_id'] ?? $_POST['post_id'] ?? 0);
        $avatarEngine = (string) ($payload['avatar_engine'] ?? $_POST['avatar_engine'] ?? '');

        try {
            $result = $this->service->updateAvatarEngine($postId, $activeProjectId, $avatarEngine);
            echo json_encode($result, JSON_UNESCAPED_UNICODE);
        } catch (Throwable $e) {
            echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
        }
    }

    public function webhook()
    {
        header('Content-Type: application/json; charset=utf-8');

        $token = (string) ($_GET['token'] ?? '');
        if (!$this->service->isValidWebhookToken($token)) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => 'forbidden'], JSON_UNESCAPED_UNICODE);
            return;
        }

        $postId = (int) ($_GET['post_id'] ?? 0);
        $payload = $this->readJsonBody();

        try {
            $result = $this->service->handleWebhook($postId, $payload);
            echo json_encode($result, JSON_UNESCAPED_UNICODE);
        } catch (Throwable $e) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
        }
    }

    private function readJsonBody()
    {
        $raw = file_get_contents('php://input');
        if (!is_string($raw) || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
}
