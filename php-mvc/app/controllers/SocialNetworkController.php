<?php
require_once __DIR__ . '/../core/BaseController.php';

class SocialNetworkController extends BaseController
{
    private $postColumnsCache = [];
    private $categoryColumnsCache = [];

    private $defaultNetworks = [
        'Threads Posts' => 'Напишіть 2-3 пости для Threads на тему "{category}" про "{topic}".',
        'Instagram Posts' => 'Напишіть структурований пост для Instagram про "{category}".',
        'Instagram Stories' => 'Напишіть 5-7 коротких сценаріїв для Stories про "{topic}".',
        'Instagram Reels' => 'Напишіть ідею Reels про "{category}" з коротким сценарієм.',
        'YouTube Shorts' => 'Напишіть сценарій для Shorts (15-60 сек) про "{category}".',
        'TikTok' => 'Напишіть короткий сценарій для TikTok про "{category}".'
    ];

    public function __construct($db)
    {
        parent::__construct($db);
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();
        $this->ensureNetworksSeed();
    }

    private function hasPostColumn($columnName)
    {
        if (array_key_exists($columnName, $this->postColumnsCache)) {
            return $this->postColumnsCache[$columnName];
        }

        $column = $this->db->query('SHOW COLUMNS FROM posts LIKE ?', [$columnName])->fetch(PDO::FETCH_ASSOC);
        $this->postColumnsCache[$columnName] = (bool) $column;
        return $this->postColumnsCache[$columnName];
    }

    private function hasCategoryColumn($columnName)
    {
        if (array_key_exists($columnName, $this->categoryColumnsCache)) {
            return $this->categoryColumnsCache[$columnName];
        }

        $column = $this->db->query('SHOW COLUMNS FROM categories LIKE ?', [$columnName])->fetch(PDO::FETCH_ASSOC);
        $this->categoryColumnsCache[$columnName] = (bool) $column;
        return $this->categoryColumnsCache[$columnName];
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

    private function ensureNetworksSeed()
    {
        // Отримуємо всі існуючі мережі одним запитом
        $existingRows = $this->db->query('SELECT name FROM social_networks')->fetchAll(PDO::FETCH_COLUMN);
        $existingNames = array_flip($existingRows); // для швидкого пошуку

        // Визначаємо поточний максимальний sort_order
        $maxSort = 0;
        if (!empty($existingRows)) {
            $maxSortRow = $this->db->query('SELECT MAX(sort_order) AS max_sort FROM social_networks')->fetch(PDO::FETCH_ASSOC);
            $maxSort = (int) ($maxSortRow['max_sort'] ?? 0) + 1;
        }

        $sort = $maxSort;
        foreach ($this->defaultNetworks as $name => $prompt) {
            if (isset($existingNames[$name])) {
                $sort++;
                continue; // вже є — пропускаємо
            }
            $isEnabled = in_array($name, ['Threads Posts', 'Instagram Posts', 'Instagram Stories'], true) ? 1 : 0;
            $this->db->query(
                'INSERT INTO social_networks (name, prompt, is_enabled, sort_order) VALUES (?, ?, ?, ?)',
                [$name, $prompt, $isEnabled, $sort]
            );
            $sort++;
        }
    }

    public function index()
    {
        $projectData = $this->ensureProjectSelected();
        $projects = $projectData['projects'];
        $active_project_id = $projectData['active_project_id'];

        $stmt = $this->db->query('
            SELECT sn.id AS network_id, sn.name AS network_name, COUNT(c.id) AS categories_count 
            FROM social_networks sn
            LEFT JOIN categories c ON c.social_network_id = sn.id AND c.project_id = ?
            GROUP BY sn.id, sn.name
        ', [$active_project_id]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $counts = [];
        foreach ($rows as $row) {
            $counts[$row['network_name']] = (int) $row['categories_count'];
        }

        $networkRows = $this->db->query('SELECT id, name, prompt, is_enabled FROM social_networks ORDER BY sort_order ASC, id ASC')->fetchAll(PDO::FETCH_ASSOC);

        $networksData = [];
        foreach ($networkRows as $row) {
            $name = $row['name'];
            $networksData[$name] = [
                'id' => $row['id'],
                'prompt' => $row['prompt'] ?: ($this->defaultNetworks[$name] ?? ''),
                'is_enabled' => (int) $row['is_enabled'] === 1,
                'categories_count' => $counts[$name] ?? 0
            ];
        }

        $defaultNetworkNames = array_keys($this->defaultNetworks);

        require __DIR__ . '/../views/social-networks.php';
    }

    public function editForm()
    {
        $projectData = $this->ensureProjectSelected();
        $projects = $projectData['projects'];
        $active_project_id = $projectData['active_project_id'];

        $networkId = (int) ($_GET['id'] ?? 0);

        $networkRow = $this->db->query('SELECT id, name, prompt FROM social_networks WHERE id = ? LIMIT 1', [$networkId])->fetch(PDO::FETCH_ASSOC);
        if (!$networkRow) {
            header('Location: /social-networks?project_id=' . $active_project_id);
            exit;
        }

        $networkId = $networkRow['id'];
        $networkName = $networkRow['name'];
        $networkPrompt = $networkRow['prompt'] ?? ($this->defaultNetworks[$networkName] ?? '');

        $clientTypeSelect = $this->hasCategoryColumn('client_type') ? 'client_type' : 'NULL AS client_type';
        $avatarNameSelect = $this->hasCategoryColumn('avatar_name') ? 'avatar_name' : 'NULL AS avatar_name';
        $avatarDescriptionSelect = $this->hasCategoryColumn('avatar_description') ? 'avatar_description' : 'NULL AS avatar_description';

        $stmt = $this->db->query(
            'SELECT id, name, color, description, ' . $clientTypeSelect . ', ' . $avatarNameSelect . ', ' . $avatarDescriptionSelect . '
             FROM categories
             WHERE social_network_id = ? AND project_id = ?
             ORDER BY sort_order ASC, id ASC',
            [$networkId, $active_project_id]
        );
        $categories = $stmt->fetchAll(PDO::FETCH_ASSOC);

        require __DIR__ . '/../views/social-network-edit.php';
    }

    public function save()
    {
        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];

        $networkId = (int) ($_POST['id'] ?? 0);

        $networkRow = $this->db->query('SELECT id, name FROM social_networks WHERE id = ? LIMIT 1', [$networkId])->fetch(PDO::FETCH_ASSOC);
        if (!$networkRow) {
            header('Location: /social-networks?project_id=' . $active_project_id);
            exit;
        }

        $networkName = $networkRow['name'];
        $networkPrompt = trim($_POST['network_prompt'] ?? ($this->defaultNetworks[$networkName] ?? ''));
        $rawCategories = $_POST['categories'] ?? [];

        if (!is_array($rawCategories)) {
            $rawCategories = [];
        }

        $categories = [];
        foreach ($rawCategories as $value) {
            $name = '';
            $clientType = null;
            $avatarName = null;
            $avatarDescription = null;

            if (is_array($value)) {
                $name = trim((string) ($value['name'] ?? ''));
                $clientType = $this->normalizeClientType($value['client_type'] ?? null);

                $rawAvatarName = trim((string) ($value['avatar_name'] ?? ''));
                $avatarName = $rawAvatarName !== '' ? $rawAvatarName : null;

                $rawAvatarDescription = trim((string) ($value['avatar_description'] ?? ''));
                $avatarDescription = $rawAvatarDescription !== '' ? $rawAvatarDescription : null;
            } else {
                $name = trim((string) $value);
            }

            if ($name !== '') {
                $categories[] = [
                    'name' => $name,
                    'client_type' => $clientType,
                    'avatar_name' => $avatarName,
                    'avatar_description' => $avatarDescription,
                ];
            }
        }

        // Прибираємо дублікати, зберігаючи порядок
        $uniqueCategories = [];
        $seenCategories = [];
        foreach ($categories as $categoryData) {
            $categoryNameKey = mb_strtolower($categoryData['name']);
            if (isset($seenCategories[$categoryNameKey])) {
                continue;
            }

            $seenCategories[$categoryNameKey] = true;
            $uniqueCategories[] = $categoryData;
        }
        $categories = $uniqueCategories;

        $supportsClientType = $this->hasCategoryColumn('client_type');
        $supportsAvatarName = $this->hasCategoryColumn('avatar_name');
        $supportsAvatarDescription = $this->hasCategoryColumn('avatar_description');

        $this->db->query('UPDATE social_networks SET prompt = ? WHERE id = ?', [$networkPrompt, $networkId]);

        // Синхронізуємо категорії без масового видалення, щоб не скидати posts.category_id в NULL
        $existingRows = $this->db->query(
            'SELECT id, name, color, description FROM categories WHERE social_network_id = ? AND project_id = ?',
            [$networkId, $active_project_id]
        )->fetchAll(PDO::FETCH_ASSOC);

        $existingByName = [];
        foreach ($existingRows as $row) {
            $existingByName[mb_strtolower(trim($row['name']))] = $row;
        }

        $keptIds = [];
        foreach ($categories as $index => $categoryData) {
            $categoryName = $categoryData['name'];
            $categoryKey = mb_strtolower(trim($categoryName));
            if (isset($existingByName[$categoryKey])) {
                $existing = $existingByName[$categoryKey];
                $keptIds[] = (int) $existing['id'];

                $updateParts = ['sort_order = ?'];
                $updateParams = [$index];

                if ($supportsClientType) {
                    $updateParts[] = 'client_type = ?';
                    $updateParams[] = $categoryData['client_type'];
                }

                if ($supportsAvatarName) {
                    $updateParts[] = 'avatar_name = ?';
                    $updateParams[] = $categoryData['avatar_name'];
                }

                if ($supportsAvatarDescription) {
                    $updateParts[] = 'avatar_description = ?';
                    $updateParams[] = $categoryData['avatar_description'];
                }

                $updateParams[] = (int) $existing['id'];
                $this->db->query(
                    'UPDATE categories SET ' . implode(', ', $updateParts) . ' WHERE id = ?',
                    $updateParams
                );
                continue;
            }

            $insertColumns = ['project_id', 'name', 'color', 'description', 'social_network_id', 'sort_order'];
            $insertValues = [$active_project_id, $categoryName, '#5a6c7d', null, $networkId, $index];

            if ($supportsClientType) {
                $insertColumns[] = 'client_type';
                $insertValues[] = $categoryData['client_type'];
            }

            if ($supportsAvatarName) {
                $insertColumns[] = 'avatar_name';
                $insertValues[] = $categoryData['avatar_name'];
            }

            if ($supportsAvatarDescription) {
                $insertColumns[] = 'avatar_description';
                $insertValues[] = $categoryData['avatar_description'];
            }

            $this->db->query(
                'INSERT INTO categories (' . implode(', ', $insertColumns) . ') VALUES (' . implode(', ', array_fill(0, count($insertColumns), '?')) . ')',
                $insertValues
            );
            $keptIds[] = (int) $this->db->lastInsertId();
        }

        // Видаляємо лише ті категорії, яких більше немає у списку
        if (empty($keptIds)) {
            $this->db->query('DELETE FROM categories WHERE social_network_id = ? AND project_id = ?', [$networkId, $active_project_id]);
        } else {
            $placeholders = implode(',', array_fill(0, count($keptIds), '?'));
            $params = array_merge([$networkId, $active_project_id], $keptIds);
            $this->db->query(
                "DELETE FROM categories WHERE social_network_id = ? AND project_id = ? AND id NOT IN ($placeholders)",
                $params
            );
        }

        header('Location: /social-networks/edit?id=' . $networkId . '&project_id=' . $active_project_id . '&saved=1');
        exit;
    }

    public function updateStatus()
    {
        $isAjax = strtolower((string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '')) === 'xmlhttprequest';
        header('Content-Type: application/json; charset=utf-8');

        $enabled = isset($_POST['is_enabled']) ? 1 : 0;
        $networkId = (int) ($_POST['network_id'] ?? 0);

        if ($networkId <= 0) {
            echo json_encode(['ok' => false, 'error' => 'invalid_network_id']);
            exit;
        }

        $networkExists = $this->db->query('SELECT id FROM social_networks WHERE id = ? LIMIT 1', [$networkId])->fetch(PDO::FETCH_ASSOC);
        if (!$networkExists) {
            echo json_encode(['ok' => false, 'error' => 'network_not_found']);
            exit;
        }

        $this->db->query('UPDATE social_networks SET is_enabled = ? WHERE id = ?', [$enabled, $networkId]);

        echo json_encode(['ok' => true, 'network_id' => $networkId, 'is_enabled' => $enabled]);
        exit;
    }

    public function importContent()
    {
        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];

        $networkId = (int) ($_POST['id'] ?? 0);

        $networkRow = $this->db->query('SELECT id, name FROM social_networks WHERE id = ? LIMIT 1', [$networkId])->fetch(PDO::FETCH_ASSOC);
        if (!$networkRow) {
            header('Location: /social-networks?project_id=' . $active_project_id);
            exit;
        }

        $socialNetworkId = $networkRow['id'];

        $contentJson = trim($_POST['content_json'] ?? '');
        if ($contentJson === '') {
            header('Location: /social-networks/edit?id=' . $networkId . '&project_id=' . $active_project_id . '&error=empty');
            exit;
        }

        $contentData = json_decode($contentJson, true);
        if (!is_array($contentData)) {
            header('Location: /social-networks/edit?id=' . $networkId . '&project_id=' . $active_project_id . '&error=invalid_json');
            exit;
        }

        // Перевіряємо структуру
        if (!isset($contentData['categories']) || !isset($contentData['posts'])) {
            header('Location: /social-networks/edit?id=' . $networkId . '&project_id=' . $active_project_id . '&error=invalid_structure');
            exit;
        }

        // Отримуємо існуючі категорії цієї мережі для поточного проекту
        $categoriesStmt = $this->db->query('SELECT id, name FROM categories WHERE social_network_id = ? AND project_id = ?', [$socialNetworkId, $active_project_id]);
        $categoriesRows = $categoriesStmt->fetchAll(PDO::FETCH_ASSOC);

        $categoriesById = [];
        $categoriesByName = [];
        foreach ($categoriesRows as $row) {
            $categoriesById[$row['id']] = $row['name'];
            $categoriesByName[mb_strtolower(trim($row['name']))] = $row['id'];
        }

        $supportsClientType = $this->hasCategoryColumn('client_type');
        $supportsAvatarName = $this->hasCategoryColumn('avatar_name');
        $supportsAvatarDescription = $this->hasCategoryColumn('avatar_description');

        // Обробляємо категорії - створюємо нові, якщо потрібно
        $newCategoriesCount = 0;
        foreach ($contentData['categories'] as $catData) {
            if (!is_array($catData)) {
                continue;
            }

            $catName = trim($catData['name'] ?? '');
            $catClientType = $this->normalizeClientType($catData['client_type'] ?? null);
            $rawAvatarName = trim((string) ($catData['avatar_name'] ?? ''));
            $catAvatarName = $rawAvatarName !== '' ? $rawAvatarName : null;
            $rawAvatarDescription = trim((string) ($catData['avatar_description'] ?? ''));
            $catAvatarDescription = $rawAvatarDescription !== '' ? $rawAvatarDescription : null;

            if ($catName === '') {
                continue;
            }

            $catNameLower = mb_strtolower($catName);
            $categoryId = null;

            // Створюємо категорію якщо не існує (незалежно від is_new)
            if (!isset($categoriesByName[$catNameLower])) {
                $insertColumns = ['project_id', 'social_network_id', 'name', 'color', 'sort_order'];
                $insertValues = [$active_project_id, $socialNetworkId, $catName, '#5a6c7d', 999];

                if ($supportsClientType) {
                    $insertColumns[] = 'client_type';
                    $insertValues[] = $catClientType;
                }

                if ($supportsAvatarName) {
                    $insertColumns[] = 'avatar_name';
                    $insertValues[] = $catAvatarName;
                }

                if ($supportsAvatarDescription) {
                    $insertColumns[] = 'avatar_description';
                    $insertValues[] = $catAvatarDescription;
                }

                $this->db->query(
                    'INSERT INTO categories (' . implode(', ', $insertColumns) . ') VALUES (' . implode(', ', array_fill(0, count($insertColumns), '?')) . ')',
                    $insertValues
                );
                $newCatId = (int) $this->db->lastInsertId();
                $categoriesByName[$catNameLower] = $newCatId;
                $categoriesById[$newCatId] = $catName;
                $categoryId = $newCatId;
                $newCategoriesCount++;
            } else {
                $categoryId = (int) $categoriesByName[$catNameLower];
            }

            if ($categoryId !== null && ($supportsClientType || $supportsAvatarName || $supportsAvatarDescription)) {
                $updateParts = [];
                $updateValues = [];

                if ($supportsClientType) {
                    $updateParts[] = 'client_type = ?';
                    $updateValues[] = $catClientType;
                }

                if ($supportsAvatarName) {
                    $updateParts[] = 'avatar_name = ?';
                    $updateValues[] = $catAvatarName;
                }

                if ($supportsAvatarDescription) {
                    $updateParts[] = 'avatar_description = ?';
                    $updateValues[] = $catAvatarDescription;
                }

                if (!empty($updateParts)) {
                    $updateValues[] = $categoryId;
                    $this->db->query(
                        'UPDATE categories SET ' . implode(', ', $updateParts) . ' WHERE id = ?',
                        $updateValues
                    );
                }
            }
        }

        // Видаляємо старі пости на дати, які будемо імпортувати (тільки для поточної соцмережі і проекту)
        $datesToReplace = array_keys($contentData['posts']);
        if (!empty($datesToReplace)) {
            $placeholders = implode(',', array_fill(0, count($datesToReplace), '?'));
            $params = array_merge([$active_project_id, $socialNetworkId], $datesToReplace);
            $this->db->query(
                "DELETE FROM posts WHERE project_id = ? AND social_network_id = ? AND post_date IN ($placeholders)",
                $params
            );
        }

        // Обробляємо пости
        $imported = 0;
        $skipped = 0;
        $supportsImagePrompt = $this->hasPostColumn('image_prompt');
        $supportsImageType = $this->hasPostColumn('image_type');
        $supportsPostType = $this->hasPostColumn('post_type');

        foreach ($contentData['posts'] as $date => $categoriesData) {
            // Перевіряємо формат дати
            $dateObj = DateTime::createFromFormat('Y-m-d', $date);
            if (!$dateObj || $dateObj->format('Y-m-d') !== $date) {
                $skipped++;
                continue;
            }

            if (!is_array($categoriesData)) {
                $skipped++;
                continue;
            }

            foreach ($categoriesData as $categoryName => $posts) {
                // Пропускаємо службові поля (audience, format, тощо)
                if (!is_array($posts)) {
                    continue;
                }

                $categoryKey = mb_strtolower(trim($categoryName));

                // Знаходимо категорію (якщо не знайшли — пропускаємо)
                if (!isset($categoriesByName[$categoryKey])) {
                    $skipped++;
                    continue;
                }

                $categoryId = $categoriesByName[$categoryKey];

                // Вставляємо кожен пост
                foreach ($posts as $postItem) {
                    $text = '';
                    $imagePath = null;
                    $imageAction = 'nothing';
                    $imageText = null;
                    $imagePrompt = null;
                    $imageType = null;
                    $postType = null;

                    if (is_string($postItem)) {
                        $text = trim($postItem);
                    } elseif (is_array($postItem)) {
                        // Підтримка text або caption (для Instagram)
                        $text = trim((string) ($postItem['text'] ?? $postItem['caption'] ?? ''));

                        $rawImagePath = trim((string) ($postItem['image_path'] ?? ''));
                        $imagePath = $rawImagePath !== '' ? $rawImagePath : null;

                        $rawImageAction = trim((string) ($postItem['image_action'] ?? 'nothing'));
                        $allowedActions = ['nothing', 'auto_generate', 'overlay_text', 'generate_from_source_folder'];
                        $imageAction = in_array($rawImageAction, $allowedActions, true) ? $rawImageAction : 'nothing';

                        $rawImageText = trim((string) ($postItem['image_text'] ?? ''));
                        $imageText = $rawImageText !== '' ? $rawImageText : null;

                        $rawImagePrompt = trim((string) ($postItem['image_prompt'] ?? ($postItem['prompt'] ?? '')));
                        $imagePrompt = $rawImagePrompt !== '' ? $rawImagePrompt : null;

                        $rawImageType = trim((string) ($postItem['image_type'] ?? ''));
                        $imageType = $rawImageType !== '' ? $rawImageType : null;

                        $rawPostType = trim((string) ($postItem['post_type'] ?? ''));
                        $postType = $rawPostType !== '' ? $rawPostType : null;
                    } else {
                        $skipped++;
                        continue;
                    }

                    if ($text === '') {
                        $skipped++;
                        continue;
                    }

                    $insertColumns = ['project_id', 'category_id', 'post_date', 'social_network_id', 'text', 'image_path', 'image_action', 'image_text'];
                    $insertValues = [$active_project_id, $categoryId, $date, $socialNetworkId, $text, $imagePath, $imageAction, $imageText];

                    if ($supportsImagePrompt) {
                        $insertColumns[] = 'image_prompt';
                        $insertValues[] = $imagePrompt;
                    }

                    if ($supportsImageType) {
                        $insertColumns[] = 'image_type';
                        $insertValues[] = $imageType;
                    }

                    if ($supportsPostType) {
                        $insertColumns[] = 'post_type';
                        $insertValues[] = $postType;
                    }

                    $placeholders = implode(', ', array_fill(0, count($insertColumns), '?'));
                    $this->db->query(
                        'INSERT INTO posts (' . implode(', ', $insertColumns) . ') VALUES (' . $placeholders . ')',
                        $insertValues
                    );

                    $imported++;
                }
            }
        }

        $message = 'imported=' . $imported . '&skipped=' . $skipped;
        if ($newCategoriesCount > 0) {
            $message .= '&new_categories=' . $newCategoriesCount;
        }

        header('Location: /social-networks/edit?id=' . $networkId . '&project_id=' . $active_project_id . '&' . $message);
        exit;
    }

    public function exportContent()
    {
        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];

        $networkId = (int) ($_GET['id'] ?? 0);
        $dateFromRaw = trim((string) ($_GET['date_from'] ?? ''));
        $dateToRaw = trim((string) ($_GET['date_to'] ?? ''));

        $networkRow = $this->db->query('SELECT id, name FROM social_networks WHERE id = ? LIMIT 1', [$networkId])->fetch(PDO::FETCH_ASSOC);
        if (!$networkRow) {
            header('Location: /social-networks?project_id=' . $active_project_id);
            exit;
        }

        $today = new DateTime();
        $defaultFrom = (clone $today)->modify('first day of this month')->format('Y-m-d');
        $defaultTo = (clone $today)->modify('last day of this month')->format('Y-m-d');

        $dateFrom = $defaultFrom;
        $dateTo = $defaultTo;

        if ($dateFromRaw !== '') {
            $parsedFrom = DateTime::createFromFormat('Y-m-d', $dateFromRaw);
            if ($parsedFrom && $parsedFrom->format('Y-m-d') === $dateFromRaw) {
                $dateFrom = $dateFromRaw;
            }
        }

        if ($dateToRaw !== '') {
            $parsedTo = DateTime::createFromFormat('Y-m-d', $dateToRaw);
            if ($parsedTo && $parsedTo->format('Y-m-d') === $dateToRaw) {
                $dateTo = $dateToRaw;
            }
        }

        if ($dateFrom > $dateTo) {
            $tmp = $dateFrom;
            $dateFrom = $dateTo;
            $dateTo = $tmp;
        }

        $supportsClientType = $this->hasCategoryColumn('client_type');
        $supportsAvatarName = $this->hasCategoryColumn('avatar_name');
        $supportsAvatarDescription = $this->hasCategoryColumn('avatar_description');

        $clientTypeSelect = $supportsClientType ? 'client_type' : 'NULL AS client_type';
        $avatarNameSelect = $supportsAvatarName ? 'avatar_name' : 'NULL AS avatar_name';
        $avatarDescriptionSelect = $supportsAvatarDescription ? 'avatar_description' : 'NULL AS avatar_description';

        $categories = $this->db->query(
            'SELECT id, name, ' . $clientTypeSelect . ', ' . $avatarNameSelect . ', ' . $avatarDescriptionSelect . '
             FROM categories
             WHERE social_network_id = ? AND project_id = ?
             ORDER BY sort_order ASC, id ASC',
            [$networkId, $active_project_id]
        )->fetchAll(PDO::FETCH_ASSOC);

        $categoriesExport = [];
        $categoryNamesMap = [];
        foreach ($categories as $category) {
            $categoryName = trim((string) ($category['name'] ?? ''));
            if ($categoryName === '') {
                continue;
            }

            $categoriesExport[] = [
                'id' => (int) $category['id'],
                'name' => $categoryName,
                'is_new' => false,
                'client_type' => (string) ($category['client_type'] ?? ''),
                'avatar_name' => (string) ($category['avatar_name'] ?? ''),
                'avatar_description' => (string) ($category['avatar_description'] ?? ''),
            ];
            $categoryNamesMap[mb_strtolower($categoryName)] = true;
        }

        $supportsImagePrompt = $this->hasPostColumn('image_prompt');
        $supportsImageType = $this->hasPostColumn('image_type');
        $supportsPostType = $this->hasPostColumn('post_type');
        $imagePromptSelect = $supportsImagePrompt ? ', p.image_prompt' : ', NULL AS image_prompt';
        $imageTypeSelect = $supportsImageType ? ', p.image_type' : ', NULL AS image_type';
        $postTypeSelect = $supportsPostType ? ', p.post_type' : ', NULL AS post_type';

        $posts = $this->db->query(
            'SELECT p.id, p.post_date, p.text, p.image_path, p.image_action, p.image_text' . $imagePromptSelect . $imageTypeSelect . $postTypeSelect . ', c.id AS category_id, c.name AS category_name
             FROM posts p
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE p.project_id = ?
               AND p.social_network_id = ?
               AND p.post_date BETWEEN ? AND ?
             ORDER BY p.post_date ASC, p.id ASC',
            [$active_project_id, $networkId, $dateFrom, $dateTo]
        )->fetchAll(PDO::FETCH_ASSOC);

        $postsExport = [];
        foreach ($posts as $post) {
            $postDate = (string) ($post['post_date'] ?? '');
            if ($postDate === '') {
                continue;
            }

            $categoryName = trim((string) ($post['category_name'] ?? ''));
            if ($categoryName === '') {
                $categoryName = 'Без категорії';
            }

            $categoryKey = mb_strtolower($categoryName);
            if (!isset($categoryNamesMap[$categoryKey])) {
                $categoriesExport[] = [
                    'id' => null,
                    'name' => $categoryName,
                    'is_new' => true,
                    'client_type' => '',
                    'avatar_name' => '',
                    'avatar_description' => '',
                ];
                $categoryNamesMap[$categoryKey] = true;
            }

            if (!isset($postsExport[$postDate])) {
                $postsExport[$postDate] = [];
            }
            if (!isset($postsExport[$postDate][$categoryName])) {
                $postsExport[$postDate][$categoryName] = [];
            }

            $postsExport[$postDate][$categoryName][] = [
                'text' => (string) ($post['text'] ?? ''),
                'image_path' => (string) ($post['image_path'] ?? ''),
                'image_type' => (string) ($post['image_type'] ?? ''),
                'image_action' => (string) ($post['image_action'] ?? 'nothing'),
                'image_text' => (string) ($post['image_text'] ?? ''),
                'image_prompt' => (string) ($post['image_prompt'] ?? ''),
                'post_type' => (string) ($post['post_type'] ?? ''),
            ];
        }

        $exportData = [
            'categories' => $categoriesExport,
            'posts' => $postsExport,
        ];

        $safeNetworkName = preg_replace('/[^a-zA-Z0-9_-]+/u', '-', (string) ($networkRow['name'] ?? 'network'));
        $safeNetworkName = trim((string) $safeNetworkName, '-_');
        if ($safeNetworkName === '') {
            $safeNetworkName = 'network-' . (int) $networkId;
        }

        $filename = 'content-plan-' . $safeNetworkName . '-' . $dateFrom . '_to_' . $dateTo . '.json';

        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        echo json_encode($exportData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        exit;
    }

    public function create()
    {
        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];

        $name = trim($_POST['name'] ?? '');
        $prompt = trim($_POST['prompt'] ?? '');

        if ($name === '') {
            header('Location: /social-networks?project_id=' . $active_project_id . '&error=empty_name');
            exit;
        }

        $existing = $this->db->query('SELECT id FROM social_networks WHERE name = ? LIMIT 1', [$name])->fetch(PDO::FETCH_ASSOC);
        if ($existing) {
            header('Location: /social-networks?project_id=' . $active_project_id . '&error=duplicate_name');
            exit;
        }

        $maxSortRow = $this->db->query('SELECT MAX(sort_order) AS max_sort FROM social_networks')->fetch(PDO::FETCH_ASSOC);
        $maxSort = (int) ($maxSortRow['max_sort'] ?? 0) + 1;

        $this->db->query(
            'INSERT INTO social_networks (name, prompt, is_enabled, sort_order) VALUES (?, ?, 1, ?)',
            [$name, $prompt, $maxSort]
        );

        header('Location: /social-networks?project_id=' . $active_project_id . '&created=1');
        exit;
    }

    public function deleteNetwork()
    {
        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];

        $networkId = (int) ($_POST['network_id'] ?? 0);

        $networkRow = $this->db->query('SELECT id, name FROM social_networks WHERE id = ? LIMIT 1', [$networkId])->fetch(PDO::FETCH_ASSOC);
        if (!$networkRow) {
            header('Location: /social-networks?project_id=' . $active_project_id);
            exit;
        }

        if (array_key_exists($networkRow['name'], $this->defaultNetworks)) {
            header('Location: /social-networks?project_id=' . $active_project_id . '&error=cannot_delete_default');
            exit;
        }

        $this->db->query('DELETE FROM social_networks WHERE id = ?', [$networkId]);

        header('Location: /social-networks?project_id=' . $active_project_id . '&deleted=1');
        exit;
    }
}
