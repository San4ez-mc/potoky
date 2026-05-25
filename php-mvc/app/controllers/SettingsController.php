<?php
// app/controllers/SettingsController.php

require_once __DIR__ . '/../core/BaseController.php';

class SettingsController extends BaseController
{
    public function __construct($db)
    {
        parent::__construct($db);
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        // Перевіряємо чи існують необхідні таблиці
        if (!$this->checkRequiredTables()) {
            $this->redirectToMigrations();
        }
    }

    private function checkRequiredTables()
    {
        try {
            $tables = $this->db->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
            $requiredTables = ['projects', 'admin_projects', 'settings'];

            foreach ($requiredTables as $required) {
                if (!in_array($required, $tables)) {
                    return false;
                }
            }
            return true;
        } catch (Exception $e) {
            return false;
        }
    }

    private function redirectToMigrations()
    {
        echo '<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <title>Потрібна міграція БД</title>
    <style>
        body { font-family: Arial, sans-serif; background: #f0f2f5; padding: 40px; text-align: center; }
        .box { background: white; padding: 40px; border-radius: 12px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        h1 { color: #e63946; margin-bottom: 20px; }
        p { color: #555; line-height: 1.6; margin-bottom: 20px; }
        .btn { display: inline-block; padding: 12px 24px; background: #52c77a; color: white; text-decoration: none; border-radius: 8px; font-weight: 500; transition: all 0.2s; }
        .btn:hover { background: #42b76a; transform: translateY(-2px); }
        code { background: #f8f9fa; padding: 2px 6px; border-radius: 4px; color: #e63946; }
    </style>
</head>
<body>
    <div class="box">
        <h1>⚠️ Потрібна міграція бази даних</h1>
        <p>Система виявила, що необхідні таблиці відсутні в базі даних.</p>
        <p>Це нормально при першому запуску або після оновлення.</p>
        <p><strong>Необхідні таблиці:</strong> <code>projects</code>, <code>admin_projects</code>, <code>settings</code></p>
        <br>
        <a href="/run-migrations.php?password=migrate2026" class="btn">🚀 Запустити міграції</a>
        <br><br>
        <p style="font-size:12px;color:#999;">Після міграції ця сторінка автоматично працюватиме</p>
    </div>
</body>
</html>';
        exit;
    }

    public function index()
    {
        $adminId = (int) ($_SESSION['admin_id'] ?? 0);
        $projects = $this->getAdminProjects($adminId);

        if (empty($projects)) {
            http_response_code(403);
            echo 'Немає доступних проєктів для налаштування.';
            exit;
        }

        $selectedProjectId = (int) ($_GET['project_id'] ?? $projects[0]['id']);
        if (!$this->hasProjectAccess($projects, $selectedProjectId)) {
            $selectedProjectId = (int) $projects[0]['id'];
        }

        $settings = $this->getSettings($selectedProjectId);
        $active_project_id = $selectedProjectId;
        $selectedProject = null;
        foreach ($projects as $project) {
            if ((int) $project['id'] === $selectedProjectId) {
                $selectedProject = $project;
                break;
            }
        }

        require __DIR__ . '/../views/settings.php';
    }

    public function save()
    {
        $adminId = (int) ($_SESSION['admin_id'] ?? 0);
        $projects = $this->getAdminProjects($adminId);
        if (empty($projects)) {
            http_response_code(403);
            echo 'Немає доступних проєктів для збереження налаштувань.';
            exit;
        }

        $projectId = (int) ($_POST['project_id'] ?? 0);
        if (!$this->hasProjectAccess($projects, $projectId)) {
            http_response_code(403);
            echo 'Немає доступу до цього проєкту.';
            exit;
        }

        $projectName = trim($_POST['project_name'] ?? 'Дім Душі');
        $telegramBotToken = trim($_POST['telegram_bot_token'] ?? '');
        $telegramChatId = trim($_POST['telegram_chat_id'] ?? '');
        $sourceImagesFolder = $this->sanitizeSourceFolderName($_POST['source_images_folder'] ?? '', $projectId);
        $geminiApiKey = trim($_POST['gemini_api_key'] ?? '');

        // Зберігаємо назву проєкту + налаштування
        $this->db->query('UPDATE projects SET name = ? WHERE id = ?', [$projectName, $projectId]);
        $this->setSetting($projectId, 'project_name', $projectName);
        $this->setSetting($projectId, 'telegram_bot_token', $telegramBotToken);
        $this->setSetting($projectId, 'telegram_chat_id', $telegramChatId);
        $this->setSetting($projectId, 'source_images_folder', $sourceImagesFolder);
        $this->setSetting($projectId, 'gemini_api_key', $geminiApiKey);

        $sourceDir = __DIR__ . '/../../public/uploads/source_images/' . $sourceImagesFolder . '/';
        if (!is_dir($sourceDir)) {
            mkdir($sourceDir, 0755, true);
        }

        $generatedDir = __DIR__ . '/../../public/uploads/generated_images/' . $sourceImagesFolder . '/';
        if (!is_dir($generatedDir)) {
            mkdir($generatedDir, 0755, true);
        }

        header('Location: /settings?project_id=' . $projectId . '&saved=1');
        exit;
    }

    protected function getAdminProjects($adminId)
    {
        $stmt = $this->db->query(
            'SELECT p.id, p.name
             FROM projects p
             INNER JOIN admin_projects ap ON ap.project_id = p.id
             WHERE ap.admin_id = ? AND p.is_active = 1
             ORDER BY p.id ASC',
            [$adminId]
        );
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    protected function hasProjectAccess($projects, $projectId)
    {
        foreach ($projects as $project) {
            if ((int) $project['id'] === (int) $projectId) {
                return true;
            }
        }
        return false;
    }

    private function getSettings($projectId)
    {
        $stmt = $this->db->query('SELECT setting_key, setting_value FROM settings WHERE project_id = ?', [$projectId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $settings = [
            'project_name' => 'Дім Душі',
            'telegram_bot_token' => '',
            'telegram_chat_id' => '',
            'source_images_folder' => $this->getDefaultSourceFolderName($projectId),
            'gemini_api_key' => ''
        ];

        foreach ($rows as $row) {
            $settings[$row['setting_key']] = $row['setting_value'];
        }

        return $settings;
    }

    protected function getDefaultSourceFolderName($projectId)
    {
        return 'project-' . (int) $projectId;
    }

    protected function sanitizeSourceFolderName($folderName, $projectId)
    {
        $folderName = trim((string) $folderName);
        $folderName = preg_replace('/[^a-zA-Z0-9_-]+/u', '-', $folderName);
        $folderName = preg_replace('/-+/', '-', $folderName);
        $folderName = trim((string) $folderName, '-_');

        if ($folderName === '') {
            $folderName = $this->getDefaultSourceFolderName($projectId);
        }

        return substr($folderName, 0, 80);
    }

    private function setSetting($projectId, $key, $value)
    {
        $this->db->query(
            'INSERT INTO settings (project_id, setting_key, setting_value) VALUES (?, ?, ?) 
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP',
            [$projectId, $key, $value]
        );
    }
}
