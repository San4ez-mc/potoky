<?php

class BaseController
{
    protected $db;

    public function __construct($db)
    {
        $this->db = $db;
    }

    /**
     * Отримати список проектів поточного адміна
     */
    protected function getAdminProjects($adminId)
    {
        $stmt = $this->db->query(
            'SELECT p.id, p.name, p.is_active, ap.can_manage_settings
             FROM projects p
             INNER JOIN admin_projects ap ON ap.project_id = p.id
             WHERE ap.admin_id = ? AND p.is_active = 1
             ORDER BY p.name ASC',
            [$adminId]
        );
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * Встановити активний проект в сесію
     */
    protected function setActiveProject($projectId)
    {
        $_SESSION['active_project_id'] = (int) $projectId;
    }

    /**
     * Отримати активний проект з сесії
     */
    protected function getActiveProjectId()
    {
        return (int) ($_SESSION['active_project_id'] ?? 0);
    }

    /**
     * Перевірити доступ до проекту
     */
    protected function hasProjectAccess($projects, $projectId)
    {
        foreach ($projects as $project) {
            if ((int) $project['id'] === (int) $projectId) {
                return true;
            }
        }
        return false;
    }

    /**
     * Забезпечити вибір проекту (редірект якщо не обрано)
     */
    protected function ensureProjectSelected()
    {
        if (!isset($_SESSION['admin_id'])) {
            header('Location: /login');
            exit;
        }

        $adminId = (int) $_SESSION['admin_id'];
        $projects = $this->getAdminProjects($adminId);

        if (empty($projects)) {
            die('У вас немає доступу до жодного проекту. Зверніться до адміністратора.');
        }

        // Якщо project_id передано через GET - встановлюємо його
        if (isset($_GET['project_id'])) {
            $requestedProjectId = (int) $_GET['project_id'];
            if ($this->hasProjectAccess($projects, $requestedProjectId)) {
                $this->setActiveProject($requestedProjectId);
            }
        }

        // Якщо проект не обрано - обираємо перший доступний
        $activeProjectId = $this->getActiveProjectId();
        if ($activeProjectId === 0 || !$this->hasProjectAccess($projects, $activeProjectId)) {
            $this->setActiveProject($projects[0]['id']);
            $activeProjectId = $projects[0]['id'];
        }

        return [
            'projects' => $projects,
            'active_project_id' => $activeProjectId
        ];
    }

    protected function getProjectSettingsMap($projectId)
    {
        $projectId = (int) $projectId;
        if ($projectId <= 0) {
            return [];
        }

        $rows = $this->db->query(
            'SELECT setting_key, setting_value FROM settings WHERE project_id = ?',
            [$projectId]
        )->fetchAll(PDO::FETCH_ASSOC);

        $settings = [];
        foreach ($rows as $row) {
            $settings[(string) $row['setting_key']] = $row['setting_value'];
        }

        return $settings;
    }

    protected function getProjectSetting($projectId, $key, $default = '')
    {
        $settings = $this->getProjectSettingsMap($projectId);
        return array_key_exists($key, $settings) ? $settings[$key] : $default;
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

    protected function getProjectSourceFolderName($projectId)
    {
        $saved = (string) $this->getProjectSetting($projectId, 'source_images_folder', '');
        return $this->sanitizeSourceFolderName($saved, $projectId);
    }

    protected function getProjectSourceDirectory($projectId, $ensureExists = false)
    {
        $dir = __DIR__ . '/../../public/uploads/source_images/' . $this->getProjectSourceFolderName($projectId) . '/';
        if ($ensureExists && !is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        return $dir;
    }

    protected function getProjectGeneratedDirectory($projectId, $ensureExists = false)
    {
        $dir = __DIR__ . '/../../public/uploads/generated_images/' . $this->getProjectSourceFolderName($projectId) . '/';
        if ($ensureExists && !is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        return $dir;
    }
}
