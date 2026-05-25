<?php
// app/controllers/HomeController.php
require_once __DIR__ . '/../core/BaseController.php';

class HomeController extends BaseController
{
    private $networkOrder = [
        'Threads Posts',
        'Instagram Posts',
        'Instagram Stories',
        'Instagram Reels',
        'YouTube Shorts',
        'TikTok'
    ];

    private $postsColumnMap = null;
    private $categoryColumnMap = null;

    public function __construct($db)
    {
        parent::__construct($db);
    }

    private function parseDateOrDefault($value, $default)
    {
        if (empty($value)) {
            return $default;
        }

        $parsed = DateTime::createFromFormat('Y-m-d', $value);
        if ($parsed && $parsed->format('Y-m-d') === $value) {
            return $value;
        }

        return $default;
    }

    private function redirectBackToRange($dateFrom, $dateTo)
    {
        header('Location: /?date_from=' . urlencode($dateFrom) . '&date_to=' . urlencode($dateTo));
        exit;
    }

    private function normalizeClientType($value)
    {
        $rawValue = trim((string) $value);
        if ($rawValue === '') {
            return null;
        }

        if (preg_match('/^ТИП\s*([123])\b/u', $rawValue, $matches)) {
            return 'ТИП ' . $matches[1];
        }

        return null;
    }

    public function index()
    {
        require_once __DIR__ . '/../controllers/AuthController.php';
        AuthController::check();

        // Забезпечуємо вибір проекту
        $projectData = $this->ensureProjectSelected();
        $projects = $projectData['projects'];
        $active_project_id = $projectData['active_project_id'];

        $today = new DateTime();
        $endOfMonth = (new DateTime())->modify('last day of this month');

        $dateFrom = $this->parseDateOrDefault($_GET['date_from'] ?? '', $today->format('Y-m-d'));
        $dateTo = $this->parseDateOrDefault($_GET['date_to'] ?? '', $endOfMonth->format('Y-m-d'));

        if ($dateFrom > $dateTo) {
            $tmp = $dateFrom;
            $dateFrom = $dateTo;
            $dateTo = $tmp;
        }

        $categoryRowsByNetwork = [];
        $supportsClientType = $this->hasCategoryColumn('client_type');
        $supportsAvatarName = $this->hasCategoryColumn('avatar_name');
        $supportsAvatarDescription = $this->hasCategoryColumn('avatar_description');
        $clientTypeSelect = $supportsClientType ? ', c.client_type' : ', NULL AS client_type';
        $avatarNameSelect = $supportsAvatarName ? ', c.avatar_name' : ', NULL AS avatar_name';
        $avatarDescriptionSelect = $supportsAvatarDescription ? ', c.avatar_description' : ', NULL AS avatar_description';
        $categoryRows = $this->db->query('
            SELECT c.id, c.name, c.social_network_id, sn.id AS network_id, sn.name AS network_name' . $clientTypeSelect . $avatarNameSelect . $avatarDescriptionSelect . ' 
            FROM categories c
            INNER JOIN social_networks sn ON sn.id = c.social_network_id
            WHERE c.project_id = ?
            ORDER BY sn.sort_order ASC, sn.id ASC, c.sort_order ASC, c.id ASC
        ', [$active_project_id])->fetchAll(PDO::FETCH_ASSOC);

        foreach ($categoryRows as $row) {
            $networkId = (int) $row['social_network_id'];
            if (!isset($categoryRowsByNetwork[$networkId])) {
                $categoryRowsByNetwork[$networkId] = [];
            }
            $categoryRowsByNetwork[$networkId][] = $row;
        }

        // Завантажуємо всі увімкнені мережі з БД у правильному порядку
        $enabledNetworks = [];
        $statusRows = $this->db->query(
            'SELECT id, name FROM social_networks WHERE is_enabled = 1 ORDER BY sort_order ASC, id ASC'
        )->fetchAll(PDO::FETCH_ASSOC);
        foreach ($statusRows as $row) {
            $enabledNetworks[] = ['id' => (int) $row['id'], 'name' => $row['name']];
        }

        // Отримуємо назву активного проекту
        $projectNameRow = $this->db->query(
            'SELECT COALESCE(NULLIF(s.setting_value, ""), p.name) AS project_name
             FROM projects p
             LEFT JOIN settings s ON s.project_id = p.id AND s.setting_key = "project_name"
             WHERE p.id = ?
             LIMIT 1',
            [$active_project_id]
        )->fetch(PDO::FETCH_ASSOC);
        $projectName = $projectNameRow['project_name'] ?? 'Проєкт';

        $postsByDateNetwork = [];
        if (!empty($enabledNetworks)) {
            $supportsImagePrompt = $this->hasPostsColumn('image_prompt');
            $supportsImageType = $this->hasPostsColumn('image_type');
            $supportsPostType = $this->hasPostsColumn('post_type');
            $supportsGenerationStatus = $this->hasPostsColumn('generation_status');
            $supportsGenerationOutputUrl = $this->hasPostsColumn('generation_output_url');
            $supportsGenerationError = $this->hasPostsColumn('generation_error');
            $supportsAvatarEngine = $this->hasPostsColumn('avatar_engine');
            $networkIds = array_column($enabledNetworks, 'id');
            $placeholders = implode(',', array_fill(0, count($networkIds), '?'));
            $params = array_merge([$active_project_id, $dateFrom, $dateTo], $networkIds);

            $imagePromptSelect = $supportsImagePrompt ? ', p.image_prompt' : ', NULL AS image_prompt';
            $imageTypeSelect = $supportsImageType ? ', p.image_type' : ', NULL AS image_type';
            $postTypeSelect = $supportsPostType ? ', p.post_type' : ', NULL AS post_type';
            $generationStatusSelect = $supportsGenerationStatus ? ', p.generation_status' : ', "not_generated" AS generation_status';
            $generationOutputSelect = $supportsGenerationOutputUrl ? ', p.generation_output_url' : ', NULL AS generation_output_url';
            $generationErrorSelect = $supportsGenerationError ? ', p.generation_error' : ', NULL AS generation_error';
            $avatarEngineSelect = $supportsAvatarEngine ? ', p.avatar_engine' : ', NULL AS avatar_engine';

            $postsStmt = $this->db->query(
                'SELECT p.id, p.post_date, p.social_network_id, p.text, p.category_id, p.image_path, p.image_action, p.image_text' . $imagePromptSelect . $imageTypeSelect . $postTypeSelect . $generationStatusSelect . $generationOutputSelect . $generationErrorSelect . $avatarEngineSelect . ', c.name AS category_name
                 FROM posts p
                 LEFT JOIN categories c ON c.id = p.category_id
                 WHERE p.project_id = ? AND p.post_date BETWEEN ? AND ? AND p.social_network_id IN (' . $placeholders . ')
                 ORDER BY p.post_date ASC, p.id ASC',
                $params
            );

            $postRows = $postsStmt->fetchAll(PDO::FETCH_ASSOC);
            foreach ($postRows as $post) {
                $date = $post['post_date'];
                $networkId = $post['social_network_id'];
                if (!isset($postsByDateNetwork[$date])) {
                    $postsByDateNetwork[$date] = [];
                }
                if (!isset($postsByDateNetwork[$date][$networkId])) {
                    $postsByDateNetwork[$date][$networkId] = [];
                }
                $postsByDateNetwork[$date][$networkId][] = $post;
            }
        }

        $dates = [];
        $cursor = new DateTime($dateFrom);
        $end = new DateTime($dateTo);
        while ($cursor <= $end) {
            $dates[] = $cursor->format('Y-m-d');
            $cursor->modify('+1 day');
        }

        require __DIR__ . '/../views/home.php';
    }

    public function addCategoryToDate()
    {
        require_once __DIR__ . '/../controllers/AuthController.php';
        AuthController::check();

        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];

        $networkId = (int) ($_POST['network_id'] ?? 0);
        $postDate = trim($_POST['post_date'] ?? '');
        $categoryId = (int) ($_POST['category_id'] ?? 0);
        $dateFrom = trim($_POST['date_from'] ?? '');
        $dateTo = trim($_POST['date_to'] ?? '');

        if ($networkId <= 0 || $postDate === '' || $categoryId <= 0) {
            $this->redirectBackToRange($dateFrom, $dateTo);
        }

        $this->db->query(
            'INSERT INTO posts (project_id, category_id, post_date, social_network_id, text) VALUES (?, ?, ?, ?, ?)',
            [$active_project_id, $categoryId, $postDate, $networkId, '']
        );

        $this->redirectBackToRange($dateFrom, $dateTo);
    }

    public function createPost()
    {
        require_once __DIR__ . '/../controllers/AuthController.php';
        AuthController::check();

        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];

        $networkId = (int) ($_POST['network_id'] ?? 0);
        $postDate = trim($_POST['post_date'] ?? '');
        $categoryId = (int) ($_POST['category_id'] ?? 0);
        $postText = trim($_POST['post_text'] ?? '');
        $dateFrom = trim($_POST['date_from'] ?? '');
        $dateTo = trim($_POST['date_to'] ?? '');

        $isAjax = strtolower((string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '')) === 'xmlhttprequest';

        if ($networkId <= 0 || $postDate === '' || ($categoryId <= 0 && $postText === '')) {
            if ($isAjax) {
                header('Content-Type: application/json; charset=utf-8');
                echo json_encode(['ok' => false, 'error' => 'invalid_payload']);
                exit;
            }
            $this->redirectBackToRange($dateFrom, $dateTo);
        }

        $this->db->query(
            'INSERT INTO posts (project_id, category_id, post_date, social_network_id, text) VALUES (?, ?, ?, ?, ?)',
            [$active_project_id, $categoryId > 0 ? $categoryId : null, $postDate, $networkId, $postText]
        );

        if ($isAjax) {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['ok' => true, 'post_id' => (int) $this->db->lastInsertId()]);
            exit;
        }

        $this->redirectBackToRange($dateFrom, $dateTo);
    }

    public function deletePost()
    {
        require_once __DIR__ . '/../controllers/AuthController.php';
        AuthController::check();

        $postId = (int) ($_POST['post_id'] ?? 0);
        $dateFrom = trim($_POST['date_from'] ?? '');
        $dateTo = trim($_POST['date_to'] ?? '');

        if ($postId > 0) {
            $this->db->query('DELETE FROM posts WHERE id = ?', [$postId]);
        }

        $this->redirectBackToRange($dateFrom, $dateTo);
    }

    public function savePost()
    {
        require_once __DIR__ . '/../controllers/AuthController.php';
        AuthController::check();

        $postId = (int) ($_POST['post_id'] ?? 0);
        $postText = trim($_POST['post_text'] ?? '');
        $dateFrom = trim($_POST['date_from'] ?? '');
        $dateTo = trim($_POST['date_to'] ?? '');

        if ($postId > 0) {
            $this->db->query('UPDATE posts SET text = ? WHERE id = ?', [$postText, $postId]);
        }

        $this->redirectBackToRange($dateFrom, $dateTo);
    }

    public function updatePostCategory()
    {
        require_once __DIR__ . '/../controllers/AuthController.php';
        AuthController::check();

        $postId = (int) ($_POST['post_id'] ?? 0);
        $categoryId = (int) ($_POST['category_id'] ?? 0);
        $dateFrom = trim($_POST['date_from'] ?? '');
        $dateTo = trim($_POST['date_to'] ?? '');

        if ($postId > 0) {
            // Дозволяємо NULL для category_id (коли вибирається пустий option)
            $this->db->query('UPDATE posts SET category_id = ? WHERE id = ?', [$categoryId > 0 ? $categoryId : null, $postId]);
        }

        $this->redirectBackToRange($dateFrom, $dateTo);
    }

    public function updateCategoryMeta()
    {
        require_once __DIR__ . '/../controllers/AuthController.php';
        AuthController::check();

        header('Content-Type: application/json; charset=utf-8');

        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            echo json_encode(['ok' => false, 'error' => 'method_not_allowed']);
            return;
        }

        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];
        $categoryId = (int) ($_POST['category_id'] ?? 0);

        if ($categoryId <= 0) {
            echo json_encode(['ok' => false, 'error' => 'invalid_category_id']);
            return;
        }

        $category = $this->db->query(
            'SELECT id FROM categories WHERE id = ? AND project_id = ? LIMIT 1',
            [$categoryId, $active_project_id]
        )->fetch(PDO::FETCH_ASSOC);

        if (!$category) {
            echo json_encode(['ok' => false, 'error' => 'category_not_found']);
            return;
        }

        $updateParts = [];
        $updateValues = [];

        if ($this->hasCategoryColumn('client_type')) {
            $updateParts[] = 'client_type = ?';
            $updateValues[] = $this->normalizeClientType($_POST['client_type'] ?? null);
        }

        if ($this->hasCategoryColumn('avatar_name')) {
            $avatarName = trim((string) ($_POST['avatar_name'] ?? ''));
            $updateParts[] = 'avatar_name = ?';
            $updateValues[] = $avatarName !== '' ? $avatarName : null;
        }

        if ($this->hasCategoryColumn('avatar_description')) {
            $avatarDescription = trim((string) ($_POST['avatar_description'] ?? ''));
            $updateParts[] = 'avatar_description = ?';
            $updateValues[] = $avatarDescription !== '' ? $avatarDescription : null;
        }

        if (empty($updateParts)) {
            echo json_encode(['ok' => false, 'error' => 'category_columns_missing']);
            return;
        }

        $updateValues[] = $categoryId;
        $this->db->query(
            'UPDATE categories SET ' . implode(', ', $updateParts) . ' WHERE id = ?',
            $updateValues
        );

        echo json_encode(['ok' => true]);
    }

    public function updatePostImage()
    {
        require_once __DIR__ . '/../controllers/AuthController.php';
        AuthController::check();

        $postId = (int) ($_POST['post_id'] ?? 0);
        $dateFrom = trim($_POST['date_from'] ?? '');
        $dateTo = trim($_POST['date_to'] ?? '');
        $isAjax = strtolower((string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '')) === 'xmlhttprequest';

        $respondJson = function ($ok, $error = null, $imagePath = null) {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode([
                'ok' => (bool) $ok,
                'error' => $error,
                'image_path' => $imagePath,
                'image_url' => $imagePath ? '/uploads/images/' . rawurlencode((string) $imagePath) : null,
            ]);
            exit;
        };

        $maxUploadBytes = 15 * 1024 * 1024; // 15MB

        if ($postId <= 0) {
            if ($isAjax) {
                $respondJson(false, 'invalid_post_id');
            }
            $this->redirectBackToRange($dateFrom, $dateTo);
        }

        // Обробляємо завантаження файлу
        if (!isset($_FILES['image']) || !is_array($_FILES['image'])) {
            if ($isAjax) {
                $respondJson(false, 'no_file');
            }
            $this->redirectBackToRange($dateFrom, $dateTo);
        }

        $file = $_FILES['image'];
        $uploadError = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($uploadError !== UPLOAD_ERR_OK) {
            $uploadErrorMap = [
                UPLOAD_ERR_INI_SIZE => 'file_too_large_ini',
                UPLOAD_ERR_FORM_SIZE => 'file_too_large_form',
                UPLOAD_ERR_PARTIAL => 'upload_partial',
                UPLOAD_ERR_NO_FILE => 'no_file',
                UPLOAD_ERR_NO_TMP_DIR => 'server_no_tmp_dir',
                UPLOAD_ERR_CANT_WRITE => 'server_cant_write',
                UPLOAD_ERR_EXTENSION => 'upload_blocked_extension',
            ];
            $errorCode = $uploadErrorMap[$uploadError] ?? 'upload_failed';
            if ($isAjax) {
                $respondJson(false, $errorCode);
            }
            $this->redirectBackToRange($dateFrom, $dateTo);
        }

        if (!empty($file['name'])) {
            $uploadDir = __DIR__ . '/../../public/uploads/images/';
            if (!is_dir($uploadDir)) {
                mkdir($uploadDir, 0755, true);
            }

            $allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
            $extension = strtolower((string) pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION));

            if (!in_array($extension, $allowedExtensions, true)) {
                if ($isAjax) {
                    $respondJson(false, 'unsupported_file_type');
                }
                $this->redirectBackToRange($dateFrom, $dateTo);
            }

            if ((int) ($file['size'] ?? 0) > $maxUploadBytes) {
                if ($isAjax) {
                    $respondJson(false, 'file_too_large');
                }
                $this->redirectBackToRange($dateFrom, $dateTo);
            }

            $filename = 'post_' . $postId . '_' . time() . '.' . $extension;
            $filepath = $uploadDir . $filename;

            if (move_uploaded_file($file['tmp_name'], $filepath)) {
                $this->db->query('UPDATE posts SET image_path = ?, image_action = "nothing" WHERE id = ?', [$filename, $postId]);
                if ($isAjax) {
                    $respondJson(true, null, $filename);
                }
            } else {
                if ($isAjax) {
                    $respondJson(false, 'upload_failed');
                }
            }
        } elseif ($isAjax) {
            $respondJson(false, 'no_file');
        }

        $this->redirectBackToRange($dateFrom, $dateTo);
    }

    public function updateImageAction()
    {
        require_once __DIR__ . '/../controllers/AuthController.php';
        AuthController::check();

        $postId = (int) ($_POST['post_id'] ?? 0);
        $imageAction = $this->normalizeImageAction($_POST['image_action'] ?? 'nothing');
        $dateFrom = trim($_POST['date_from'] ?? '');
        $dateTo = trim($_POST['date_to'] ?? '');

        if ($postId > 0) {
            $this->db->query('UPDATE posts SET image_action = ? WHERE id = ?', [$imageAction, $postId]);
        }

        $this->redirectBackToRange($dateFrom, $dateTo);
    }

    public function deletePostImage()
    {
        require_once __DIR__ . '/../controllers/AuthController.php';
        AuthController::check();

        $postId = (int) ($_POST['post_id'] ?? 0);
        $dateFrom = trim($_POST['date_from'] ?? '');
        $dateTo = trim($_POST['date_to'] ?? '');

        if ($postId > 0) {
            $post = $this->db->query('SELECT image_path FROM posts WHERE id = ?', [$postId])->fetch(PDO::FETCH_ASSOC);
            if ($post && !empty($post['image_path'])) {
                $imagePath = trim((string) $post['image_path']);
                if ($imagePath !== '' && !preg_match('/^https?:\/\//i', $imagePath)) {
                    $filepath = __DIR__ . '/../../public/uploads/images/' . basename($imagePath);
                    if (file_exists($filepath)) {
                        unlink($filepath);
                    }
                }
                $this->db->query('UPDATE posts SET image_path = NULL, image_action = "nothing" WHERE id = ?', [$postId]);
            }
        }

        $this->redirectBackToRange($dateFrom, $dateTo);
    }

    public function updateImageText()
    {
        header('Content-Type: application/json');

        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
            return;
        }

        $postId = (int) ($_POST['post_id'] ?? 0);
        $imageText = trim((string) ($_POST['image_text'] ?? ''));

        if ($postId <= 0) {
            echo json_encode(['ok' => false, 'error' => 'Invalid post ID']);
            return;
        }

        $this->db->query('UPDATE posts SET image_text = ? WHERE id = ?', [$imageText ?: null, $postId]);

        echo json_encode(['ok' => true]);
    }

    public function updateImagePrompt()
    {
        header('Content-Type: application/json');

        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
            return;
        }

        if (!$this->hasPostsColumn('image_prompt')) {
            echo json_encode(['ok' => false, 'error' => 'image_prompt column missing']);
            return;
        }

        $postId = (int) ($_POST['post_id'] ?? 0);
        $imagePrompt = trim((string) ($_POST['image_prompt'] ?? ''));

        if ($postId <= 0) {
            echo json_encode(['ok' => false, 'error' => 'Invalid post ID']);
            return;
        }

        $this->db->query('UPDATE posts SET image_prompt = ? WHERE id = ?', [$imagePrompt !== '' ? $imagePrompt : null, $postId]);

        echo json_encode(['ok' => true]);
    }

    public function updateImageType()
    {
        header('Content-Type: application/json');

        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
            return;
        }

        if (!$this->hasPostsColumn('image_type')) {
            echo json_encode(['ok' => false, 'error' => 'image_type column missing']);
            return;
        }

        $postId = (int) ($_POST['post_id'] ?? 0);
        $imageType = trim((string) ($_POST['image_type'] ?? ''));

        if ($postId <= 0) {
            echo json_encode(['ok' => false, 'error' => 'Invalid post ID']);
            return;
        }

        if (function_exists('mb_substr')) {
            $imageType = mb_substr($imageType, 0, 50, 'UTF-8');
        } else {
            $imageType = substr($imageType, 0, 50);
        }

        $this->db->query('UPDATE posts SET image_type = ? WHERE id = ?', [$imageType !== '' ? $imageType : null, $postId]);

        echo json_encode(['ok' => true]);
    }

    public function updatePostType()
    {
        header('Content-Type: application/json');

        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
            return;
        }

        if (!$this->hasPostsColumn('post_type')) {
            echo json_encode(['ok' => false, 'error' => 'post_type column missing']);
            return;
        }

        $postId = (int) ($_POST['post_id'] ?? 0);
        $postType = trim((string) ($_POST['post_type'] ?? ''));

        if ($postId <= 0) {
            echo json_encode(['ok' => false, 'error' => 'Invalid post ID']);
            return;
        }

        $allowed = ['', 'Карусель', 'Сторіз', 'Reels', 'Shorts', 'Thread'];
        if (!in_array($postType, $allowed, true)) {
            $postType = '';
        }

        $this->db->query('UPDATE posts SET post_type = ? WHERE id = ?', [$postType !== '' ? $postType : null, $postId]);

        echo json_encode(['ok' => true]);
    }

    public function runImageAction()
    {
        require_once __DIR__ . '/../controllers/AuthController.php';
        AuthController::check();

        header('Content-Type: application/json; charset=utf-8');

        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];
        $postId = (int) ($_POST['post_id'] ?? 0);

        if ($postId <= 0) {
            echo json_encode(['ok' => false, 'error' => 'invalid_post']);
            return;
        }

        $post = $this->db->query(
            'SELECT p.*, c.name AS category_name, sn.name AS network_name
             FROM posts p
             LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN social_networks sn ON sn.id = p.social_network_id
             WHERE p.id = ? AND p.project_id = ?
             LIMIT 1',
            [$postId, $active_project_id]
        )->fetch(PDO::FETCH_ASSOC);

        if (!$post) {
            echo json_encode(['ok' => false, 'error' => 'post_not_found']);
            return;
        }

        $requestedAction = $_POST['image_action'] ?? '';
        $action = $requestedAction !== ''
            ? $this->normalizeImageAction($requestedAction)
            : $this->normalizeImageAction((string) ($post['image_action'] ?? 'nothing'));

        if ($requestedAction !== '') {
            $this->db->query('UPDATE posts SET image_action = ? WHERE id = ?', [$action, $postId]);
        }

        $sourceFilename = null;
        try {
            switch ($action) {
                case 'auto_generate':
                    $filename = $this->generateAutomaticImageForPost($post);
                    $message = 'Зображення згенеровано';
                    break;

                case 'generate_from_source_folder':
                    $generationResult = $this->generateImageFromProjectSourceFolder($post, $active_project_id);
                    $filename = $generationResult['filename'];
                    $sourceFilename = $generationResult['source_filename'] ?? null;
                    $message = !empty($generationResult['fallback'])
                        ? 'Зображення створено локально на основі файлу з папки (Gemini quota exceeded)'
                        : 'Зображення створено на основі випадкового файлу з папки';
                    break;

                case 'overlay_text':
                    $generationResult = $this->generateOverlayImageForPost($post, $active_project_id);
                    $filename = $generationResult['filename'];
                    $sourceFilename = $generationResult['source_filename'] ?? null;
                    $message = 'Текст накладено на зображення';
                    break;

                default:
                    echo json_encode(['ok' => false, 'error' => 'unsupported_action']);
                    return;
            }
        } catch (RuntimeException $e) {
            echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
            return;
        } catch (Throwable $e) {
            error_log('runImageAction failed for post #' . $postId . ': ' . $e->getMessage());
            echo json_encode(['ok' => false, 'error' => 'generation_failed']);
            return;
        }

        $this->db->query('UPDATE posts SET image_path = ? WHERE id = ?', [$filename, $postId]);

        echo json_encode([
            'ok' => true,
            'message' => $message,
            'image_path' => $filename,
            'image_url' => '/uploads/images/' . rawurlencode($filename),
            'action' => $action,
            'source_filename' => $sourceFilename
        ]);
    }

    private function normalizeImageAction($rawAction)
    {
        $action = trim((string) $rawAction);

        $aliases = [
            'generate_from_source' => 'generate_from_source_folder',
            'from_source_folder' => 'generate_from_source_folder',
            'source_folder_generate' => 'generate_from_source_folder',
            'auto' => 'auto_generate',
            'generate_auto' => 'auto_generate',
            'overlay' => 'overlay_text',
        ];

        if (isset($aliases[$action])) {
            $action = $aliases[$action];
        }

        $allowedActions = ['nothing', 'auto_generate', 'overlay_text', 'generate_from_source_folder'];
        if (!in_array($action, $allowedActions, true)) {
            return 'nothing';
        }

        return $action;
    }

    private function generateAutomaticImageForPost($post)
    {
        $prompt = $this->buildImagePromptFromPost($post, false);
        $seed = random_int(1000, 9999999);
        $url = 'https://image.pollinations.ai/prompt/' . rawurlencode($prompt)
            . '?width=1024&height=1024&model=flux&nologo=true&enhance=true&seed=' . $seed;

        $imageBinary = $this->fetchRemoteBinary($url);
        if (!$this->isValidImageBinary($imageBinary)) {
            throw new RuntimeException('Не вдалося згенерувати зображення');
        }

        return $this->saveGeneratedPostImage((int) $post['id'], $imageBinary, 'auto');
    }

    private function generateImageFromProjectSourceFolder($post, $projectId)
    {
        $apiKey = trim((string) $this->getProjectSetting($projectId, 'gemini_api_key', ''));
        if ($apiKey === '') {
            throw new RuntimeException('Не вказано GEMINI API Key у налаштуваннях проєкту');
        }

        $sourceFile = $this->pickRandomSourceImage($projectId);
        if ($sourceFile === null) {
            $folder = $this->getProjectSourceFolderName($projectId);
            throw new RuntimeException('У папці source_images/' . $folder . ' немає зображень');
        }

        $imageBinary = @file_get_contents($sourceFile['path']);
        if ($imageBinary === false || $imageBinary === '') {
            throw new RuntimeException('Не вдалося прочитати вихідне зображення');
        }

        $prompt = $this->buildImagePromptFromPost($post, true);
        $fallbackUsed = false;
        try {
            $generatedBinary = $this->generateWithGeminiImageEditing($apiKey, $prompt, $imageBinary, $sourceFile['mime']);
        } catch (RuntimeException $e) {
            $errorMessage = $e->getMessage();
            if (!$this->isGeminiQuotaError($errorMessage)) {
                throw $e;
            }

            $generatedBinary = $this->generateLocalSourceVariation($imageBinary, $prompt);
            $fallbackUsed = true;
        }

        if (!$this->isValidImageBinary($generatedBinary)) {
            throw new RuntimeException('Gemini не повернув валідне зображення');
        }

        return [
            'filename' => $this->saveGeneratedPostImage((int) $post['id'], $generatedBinary, $fallbackUsed ? 'source_local' : 'gemini'),
            'source_filename' => $sourceFile['filename'] ?? null,
            'fallback' => $fallbackUsed,
        ];
    }

    private function isGeminiQuotaError($errorMessage)
    {
        $error = mb_strtolower((string) $errorMessage, 'UTF-8');
        return strpos($error, 'quota') !== false
            || strpos($error, 'rate limit') !== false
            || strpos($error, 'exceeded') !== false
            || strpos($error, '429') !== false;
    }

    private function generateLocalSourceVariation($imageBinary, $prompt)
    {
        if (!function_exists('imagecreatefromstring')) {
            throw new RuntimeException('Gemini quota exceeded, а GD fallback недоступний на сервері');
        }

        $image = @imagecreatefromstring($imageBinary);
        if ($image === false) {
            throw new RuntimeException('Gemini quota exceeded і не вдалося обробити source зображення локально');
        }

        $seed = crc32((string) $prompt . '|' . microtime(true));
        mt_srand($seed);

        $brightness = mt_rand(-18, 18);
        $contrast = mt_rand(-12, 10);
        $red = mt_rand(-12, 12);
        $green = mt_rand(-8, 10);
        $blue = mt_rand(-14, 8);

        imagefilter($image, IMG_FILTER_BRIGHTNESS, $brightness);
        imagefilter($image, IMG_FILTER_CONTRAST, $contrast);
        imagefilter($image, IMG_FILTER_COLORIZE, $red, $green, $blue);

        if (mt_rand(0, 1) === 1) {
            imagefilter($image, IMG_FILTER_SMOOTH, mt_rand(2, 7));
        }

        $width = imagesx($image);
        $height = imagesy($image);
        $target = imagecreatetruecolor($width, $height);

        $cropMarginX = (int) floor($width * 0.04);
        $cropMarginY = (int) floor($height * 0.04);
        $srcX = mt_rand(0, max(0, $cropMarginX));
        $srcY = mt_rand(0, max(0, $cropMarginY));
        $srcW = max(1, $width - $cropMarginX);
        $srcH = max(1, $height - $cropMarginY);

        imagecopyresampled($target, $image, 0, 0, $srcX, $srcY, $width, $height, $srcW, $srcH);

        imagedestroy($image);

        ob_start();
        imagejpeg($target, null, 92);
        $outputBinary = ob_get_clean();
        imagedestroy($target);

        if (!$this->isValidImageBinary($outputBinary)) {
            throw new RuntimeException('Gemini quota exceeded і локальний fallback не створив валідне зображення');
        }

        return $outputBinary;
    }

    private function generateOverlayImageForPost($post, $projectId)
    {
        if (!function_exists('imagecreatefromstring')) {
            throw new RuntimeException('Для накладання тексту потрібна GD бібліотека');
        }

        $overlayText = trim((string) ($post['image_text'] ?? ''));
        if ($overlayText === '') {
            throw new RuntimeException('Спочатку заповніть поле "Текст на фото"');
        }

        $baseBinary = null;
        $sourceFilename = null;
        $imagePath = trim((string) ($post['image_path'] ?? ''));
        if ($imagePath !== '') {
            if (preg_match('/^https?:\/\//i', $imagePath)) {
                $baseBinary = $this->fetchRemoteBinary($imagePath);
            } else {
                $localPath = __DIR__ . '/../../public/uploads/images/' . basename($imagePath);
                if (file_exists($localPath)) {
                    $baseBinary = @file_get_contents($localPath);
                }
            }
        }

        if (!$this->isValidImageBinary($baseBinary)) {
            $sourceFile = $this->pickRandomSourceImage($projectId);
            if ($sourceFile !== null) {
                $baseBinary = @file_get_contents($sourceFile['path']);
                $sourceFilename = $sourceFile['filename'] ?? null;
            }
        }

        if (!$this->isValidImageBinary($baseBinary)) {
            throw new RuntimeException('Немає базового зображення для накладання тексту');
        }

        $image = @imagecreatefromstring($baseBinary);
        if ($image === false) {
            throw new RuntimeException('Не вдалося відкрити базове зображення');
        }

        $width = imagesx($image);
        $height = imagesy($image);
        $font = 5;
        $maxChars = max(12, (int) floor(($width - 40) / imagefontwidth($font)));
        $lines = $this->wrapTextLines($overlayText, $maxChars);
        $lineHeight = imagefontheight($font) + 6;
        $padding = 14;
        $blockHeight = ($lineHeight * count($lines)) + ($padding * 2);
        $blockTop = max(0, $height - $blockHeight - 18);

        imagealphablending($image, true);
        imagesavealpha($image, true);

        $bgColor = imagecolorallocatealpha($image, 15, 23, 42, 45);
        $textColor = imagecolorallocate($image, 255, 255, 255);

        imagefilledrectangle($image, 12, $blockTop, $width - 12, $height - 12, $bgColor);

        foreach ($lines as $index => $line) {
            $y = $blockTop + $padding + ($index * $lineHeight);
            imagestring($image, $font, 24, $y, $line, $textColor);
        }

        ob_start();
        imagejpeg($image, null, 90);
        $outputBinary = ob_get_clean();
        imagedestroy($image);

        if (!$this->isValidImageBinary($outputBinary)) {
            throw new RuntimeException('Не вдалося сформувати зображення з текстом');
        }

        return [
            'filename' => $this->saveGeneratedPostImage((int) $post['id'], $outputBinary, 'overlay'),
            'source_filename' => $sourceFilename,
        ];
    }

    private function wrapTextLines($text, $maxChars)
    {
        $words = preg_split('/\s+/u', trim((string) $text)) ?: [];
        $lines = [];
        $current = '';

        foreach ($words as $word) {
            $candidate = $current === '' ? $word : $current . ' ' . $word;
            $length = function_exists('mb_strlen') ? mb_strlen($candidate, 'UTF-8') : strlen($candidate);
            if ($length <= $maxChars) {
                $current = $candidate;
                continue;
            }

            if ($current !== '') {
                $lines[] = $current;
            }
            $current = $word;
        }

        if ($current !== '') {
            $lines[] = $current;
        }

        return empty($lines) ? [' '] : array_slice($lines, 0, 6);
    }

    private function buildImagePromptFromPost($post, $useSourceImage)
    {
        $customPrompt = trim((string) ($post['image_prompt'] ?? ''));

        if ($customPrompt !== '') {
            $basePrompt = $customPrompt;
            if (function_exists('mb_strlen') && mb_strlen($basePrompt, 'UTF-8') > 900) {
                $basePrompt = mb_substr($basePrompt, 0, 900, 'UTF-8');
            } elseif (strlen($basePrompt) > 900) {
                $basePrompt = substr($basePrompt, 0, 900);
            }

            if ($useSourceImage) {
                return $basePrompt . ' Use the attached image as source reference and produce a fresh result that preserves mood/style.';
            }

            return $basePrompt;
        }

        $postText = trim((string) ($post['text'] ?? ''));
        if ($postText === '') {
            $postText = 'Соціальний пост про підтримку, глибину, довіру та внутрішню силу.';
        }

        if (function_exists('mb_substr')) {
            $postText = mb_substr($postText, 0, 400, 'UTF-8');
        } else {
            $postText = substr($postText, 0, 400);
        }

        $category = trim((string) ($post['category_name'] ?? 'Без категорії'));
        $network = trim((string) ($post['network_name'] ?? 'Соцмережа'));
        $imageText = trim((string) ($post['image_text'] ?? ''));

        $prompt = 'Create one premium, photorealistic social media visual for ' . $network . '. '
            . 'Category: ' . $category . '. '
            . 'Post context: ' . $postText . '. '
            . 'Style: modern, elegant, emotionally warm, high-end, clean composition, strong focal point, no watermarks, no logos.';

        if ($useSourceImage) {
            $prompt .= ' Use the attached image as the visual base and inspiration, but create a fresh new composition suitable for the post.';
        } else {
            $prompt .= ' Generate the scene from scratch.';
        }

        if ($imageText !== '') {
            $prompt .= ' The intended message on the image is: ' . $imageText . '. Do not render typography into the image unless it is naturally integrated and minimal.';
        } else {
            $prompt .= ' Do not place any visible text in the image.';
        }

        return $prompt;
    }

    private function hasPostsColumn($columnName)
    {
        if ($this->postsColumnMap === null) {
            $columns = $this->db->query('SHOW COLUMNS FROM posts')->fetchAll(PDO::FETCH_ASSOC);
            $this->postsColumnMap = [];
            foreach ($columns as $column) {
                $field = (string) ($column['Field'] ?? '');
                if ($field !== '') {
                    $this->postsColumnMap[$field] = true;
                }
            }
        }

        return !empty($this->postsColumnMap[$columnName]);
    }

    private function hasCategoryColumn($columnName)
    {
        if ($this->categoryColumnMap === null) {
            $columns = $this->db->query('SHOW COLUMNS FROM categories')->fetchAll(PDO::FETCH_ASSOC);
            $this->categoryColumnMap = [];
            foreach ($columns as $column) {
                $field = (string) ($column['Field'] ?? '');
                if ($field !== '') {
                    $this->categoryColumnMap[$field] = true;
                }
            }
        }

        return !empty($this->categoryColumnMap[$columnName]);
    }

    private function pickRandomSourceImage($projectId)
    {
        $sourceDir = $this->getProjectSourceDirectory($projectId, true);
        if (!is_dir($sourceDir)) {
            return null;
        }

        $files = scandir($sourceDir);
        $candidates = [];
        foreach ($files as $file) {
            if ($file === '.' || $file === '..') {
                continue;
            }

            $path = $sourceDir . $file;
            if (!is_file($path)) {
                continue;
            }

            $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
            if (!in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'], true)) {
                continue;
            }

            $mime = @mime_content_type($path);
            if ($mime === false || $mime === '') {
                $mime = 'image/' . ($ext === 'jpg' ? 'jpeg' : $ext);
            }

            $candidates[] = [
                'filename' => $file,
                'path' => $path,
                'mime' => $mime,
            ];
        }

        if (empty($candidates)) {
            return null;
        }

        return $candidates[array_rand($candidates)];
    }

    private function generateWithGeminiImageEditing($apiKey, $prompt, $imageBinary, $mimeType)
    {
        $models = [
            'gemini-2.0-flash-preview-image-generation',
            'gemini-2.0-flash-exp-image-generation'
        ];

        $lastError = 'Gemini request failed';

        foreach ($models as $model) {
            $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent?key=' . urlencode($apiKey);
            $payload = [
                'contents' => [
                    [
                        'parts' => [
                            ['text' => $prompt],
                            [
                                'inline_data' => [
                                    'mime_type' => $mimeType,
                                    'data' => base64_encode($imageBinary)
                                ]
                            ]
                        ]
                    ]
                ],
                'generationConfig' => [
                    'responseModalities' => ['TEXT', 'IMAGE']
                ]
            ];

            $responseBody = null;
            if (function_exists('curl_init')) {
                $ch = curl_init($url);
                curl_setopt_array($ch, [
                    CURLOPT_POST => true,
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    CURLOPT_TIMEOUT => 120,
                    CURLOPT_SSL_VERIFYPEER => false,
                    CURLOPT_SSL_VERIFYHOST => 0,
                ]);
                $responseBody = curl_exec($ch);
                $curlError = curl_error($ch);
                $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);

                if ($responseBody === false) {
                    $lastError = $curlError !== '' ? $curlError : 'cURL request failed';
                    continue;
                }

                if ($httpCode < 200 || $httpCode >= 300) {
                    $lastError = 'HTTP ' . $httpCode . ' from model ' . $model;
                }
            } else {
                $context = stream_context_create([
                    'http' => [
                        'method' => 'POST',
                        'header' => "Content-Type: application/json\r\n",
                        'content' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                        'ignore_errors' => true,
                        'timeout' => 120,
                    ],
                    'ssl' => [
                        'verify_peer' => false,
                        'verify_peer_name' => false,
                    ]
                ]);
                $responseBody = @file_get_contents($url, false, $context);
                if ($responseBody === false) {
                    $lastError = 'HTTP request failed for model ' . $model;
                    continue;
                }
            }

            $response = json_decode($responseBody, true);
            if (isset($response['error']['message'])) {
                $lastError = (string) $response['error']['message'];
                continue;
            }

            $inlineBinary = $this->extractInlineImageBinaryFromGeminiResponse($response);
            if ($this->isValidImageBinary($inlineBinary)) {
                return $inlineBinary;
            }
        }

        throw new RuntimeException(
            'Gemini image model недоступна. Спробувано: ' . implode(', ', $models) . '. Деталі: ' . $lastError
        );
    }

    private function extractInlineImageBinaryFromGeminiResponse($response)
    {
        $candidates = $response['candidates'] ?? [];
        foreach ($candidates as $candidate) {
            $parts = $candidate['content']['parts'] ?? [];
            foreach ($parts as $part) {
                $inline = $part['inlineData'] ?? ($part['inline_data'] ?? null);
                if (!is_array($inline) || empty($inline['data'])) {
                    continue;
                }

                $decoded = base64_decode((string) $inline['data'], true);
                if ($decoded !== false && $decoded !== '') {
                    return $decoded;
                }
            }
        }

        return null;
    }

    private function fetchRemoteBinary($url)
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS => 5,
                CURLOPT_TIMEOUT => 60,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => 0,
                CURLOPT_USERAGENT => 'Mozilla/5.0',
            ]);
            $data = curl_exec($ch);
            $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($data !== false && $httpCode >= 200 && $httpCode < 300) {
                return $data;
            }
        }

        $context = stream_context_create([
            'http' => [
                'timeout' => 60,
                'ignore_errors' => true,
                'user_agent' => 'Mozilla/5.0',
            ],
            'ssl' => [
                'verify_peer' => false,
                'verify_peer_name' => false,
            ]
        ]);

        $data = @file_get_contents($url, false, $context);
        return $data !== false ? $data : null;
    }

    private function isValidImageBinary($imageBinary)
    {
        if ($imageBinary === null || $imageBinary === false || strlen($imageBinary) < 1024) {
            return false;
        }

        $info = @getimagesizefromstring($imageBinary);
        return !empty($info);
    }

    private function saveGeneratedPostImage($postId, $imageBinary, $prefix)
    {
        $uploadDir = __DIR__ . '/../../public/uploads/images/';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        $filename = $prefix . '_post_' . (int) $postId . '_' . time() . '_' . random_int(1000, 9999) . '.jpg';
        $filepath = $uploadDir . $filename;
        file_put_contents($filepath, $imageBinary);

        return $filename;
    }
}

