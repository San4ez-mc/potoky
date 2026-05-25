<?php

class ProjectAccessController
{
    private $db;

    public function __construct($db)
    {
        $this->db = $db;
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();
    }

    public function index()
    {
        $admins = $this->db->query('SELECT id, username FROM admin ORDER BY id ASC')->fetchAll(PDO::FETCH_ASSOC);
        $projects = $this->db->query('SELECT id, name, is_active FROM projects ORDER BY id ASC')->fetchAll(PDO::FETCH_ASSOC);

        $links = $this->db->query('SELECT admin_id, project_id FROM admin_projects')->fetchAll(PDO::FETCH_ASSOC);
        $accessMap = [];
        foreach ($links as $link) {
            $accessMap[(int) $link['admin_id']][(int) $link['project_id']] = true;
        }

        require __DIR__ . '/../views/project-access.php';
    }

    public function save()
    {
        $submitted = $_POST['access'] ?? [];

        $this->db->query('DELETE FROM admin_projects');

        foreach ($submitted as $adminId => $projectIds) {
            if (!is_array($projectIds)) {
                continue;
            }

            foreach ($projectIds as $projectId) {
                $this->db->query(
                    'INSERT INTO admin_projects (admin_id, project_id, can_manage_settings) VALUES (?, ?, 1)',
                    [(int) $adminId, (int) $projectId]
                );
            }
        }

        header('Location: /project-access?saved=1');
        exit;
    }

    public function create()
    {
        $adminId = (int) ($_SESSION['admin_id'] ?? 0);
        if ($adminId <= 0) {
            header('Location: /login');
            exit;
        }

        $projectName = $this->normalizeProjectName((string) ($_POST['project_name'] ?? ''));
        $safeReturnTo = $this->normalizeReturnUrl((string) ($_POST['return_to'] ?? '/'));

        $projectId = 0;
        try {
            $this->db->query('INSERT INTO projects (name, is_active) VALUES (?, 1)', [$projectName]);
            $projectId = (int) $this->db->lastInsertId();

            $this->db->query(
                'INSERT INTO admin_projects (admin_id, project_id, can_manage_settings) VALUES (?, ?, 1)',
                [$adminId, $projectId]
            );

            $_SESSION['active_project_id'] = $projectId;
            header('Location: ' . $this->buildReturnUrl($safeReturnTo, $projectId, 'project_created=1'));
            exit;
        } catch (Throwable $e) {
            if ($projectId > 0) {
                $this->db->query('DELETE FROM projects WHERE id = ?', [$projectId]);
            }
            error_log('Project create failed: ' . $e->getMessage());
            header('Location: ' . $this->buildReturnUrl($safeReturnTo, 0, 'project_create_error=1'));
            exit;
        }
    }

    private function normalizeProjectName($rawName)
    {
        $name = trim((string) $rawName);
        if ($name === '') {
            return 'Новий проєкт';
        }

        if (function_exists('mb_strlen') && function_exists('mb_substr')) {
            if (mb_strlen($name, 'UTF-8') > 120) {
                $name = mb_substr($name, 0, 120, 'UTF-8');
            }
            return trim($name);
        }

        if (strlen($name) > 120) {
            $name = substr($name, 0, 120);
        }

        return trim($name);
    }

    private function normalizeReturnUrl($rawReturnTo)
    {
        $returnTo = trim((string) $rawReturnTo);
        if ($returnTo === '' || strpos($returnTo, '/') !== 0 || strpos($returnTo, '//') === 0 || strpos($returnTo, '/login') === 0) {
            return '/';
        }
        return $returnTo;
    }

    private function buildReturnUrl($returnTo, $projectId, $statusFlag)
    {
        $parts = parse_url($returnTo);
        $path = $parts['path'] ?? '/';
        $queryParams = [];

        if (!empty($parts['query'])) {
            parse_str($parts['query'], $queryParams);
        }

        unset($queryParams['project_created'], $queryParams['project_create_error']);

        if ($projectId > 0) {
            $queryParams['project_id'] = $projectId;
        }

        $statusParts = explode('=', $statusFlag, 2);
        if (count($statusParts) === 2) {
            $queryParams[$statusParts[0]] = $statusParts[1];
        }

        $query = http_build_query($queryParams);
        if ($query === '') {
            return $path;
        }

        return $path . '?' . $query;
    }
}
