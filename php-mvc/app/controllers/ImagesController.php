<?php

require_once __DIR__ . '/../core/BaseController.php';

class ImagesController extends BaseController
{
    public function __construct($db)
    {
        parent::__construct($db);
    }

    public function index()
    {
        $projectData = $this->ensureProjectSelected();
        $projects = $projectData['projects'];
        $active_project_id = $projectData['active_project_id'];

        $sourceFolderName = $this->getProjectSourceFolderName($active_project_id);
        $sourceDir = $this->getProjectSourceDirectory($active_project_id, true);
        $generatedDir = $this->getProjectGeneratedDirectory($active_project_id, true);

        // Отримуємо всі source images
        $sourceImages = [];
        if (is_dir($sourceDir)) {
            $files = scandir($sourceDir);
            foreach ($files as $file) {
                if ($file === '.' || $file === '..')
                    continue;
                $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
                if (in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'])) {
                    $sourceImages[] = [
                        'filename' => $file,
                        'path' => '/uploads/source_images/' . rawurlencode($sourceFolderName) . '/' . rawurlencode($file),
                        'size' => filesize($sourceDir . $file)
                    ];
                }
            }
        }

        // Отримуємо всі generated images
        $generatedImages = [];
        if (is_dir($generatedDir)) {
            $files = scandir($generatedDir);
            foreach ($files as $file) {
                if ($file === '.' || $file === '..')
                    continue;
                $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
                if (in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'])) {
                    // Витягуємо source filename з назви (формат: source_filename_timestamp.ext)
                    preg_match('/^(.+?)_var\d+_\d+\.\w+$/', $file, $matches);
                    $sourceFile = $matches[1] ?? 'unknown';

                    if (!isset($generatedImages[$sourceFile])) {
                        $generatedImages[$sourceFile] = [];
                    }
                    $generatedImages[$sourceFile][] = [
                        'filename' => $file,
                        'path' => '/uploads/generated_images/' . rawurlencode($sourceFolderName) . '/' . rawurlencode($file),
                        'size' => filesize($generatedDir . $file),
                        'created' => filectime($generatedDir . $file)
                    ];
                }
            }
        }

        // Отримуємо всі промпти
        $prompts = $this->db->query('SELECT * FROM image_prompts ORDER BY is_default DESC, name ASC')->fetchAll(PDO::FETCH_ASSOC);

        require __DIR__ . '/../views/images.php';
    }

    public function addPrompt()
    {
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        $name = trim($_POST['name'] ?? '');
        $text = trim($_POST['prompt_text'] ?? '');

        if (empty($name) || empty($text)) {
            echo json_encode(['success' => false, 'error' => 'Заповніть всі поля']);
            exit;
        }

        try {
            $this->db->query('INSERT INTO image_prompts (name, prompt_text, is_default) VALUES (?, ?, 0)', [$name, $text]);
            echo json_encode(['success' => true]);
        } catch (Exception $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    public function deletePrompt()
    {
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        $promptId = (int) ($_POST['id'] ?? 0);

        if ($promptId <= 0) {
            echo json_encode(['success' => false, 'error' => 'Невірний ID']);
            exit;
        }

        try {
            $this->db->query('DELETE FROM image_prompts WHERE id = ?', [$promptId]);
            echo json_encode(['success' => true]);
        } catch (Exception $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    public function uploadSourceImage()
    {
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];

        if (!isset($_FILES['source_image']) || $_FILES['source_image']['error'] !== UPLOAD_ERR_OK) {
            header('Location: /images?project_id=' . $active_project_id);
            exit;
        }

        $file = $_FILES['source_image'];
        $uploadDir = $this->getProjectSourceDirectory($active_project_id, true);

        // Валідація розміру (max 10MB)
        if ($file['size'] > 10 * 1024 * 1024) {
            header('Location: /images?project_id=' . $active_project_id . '&error=size');
            exit;
        }

        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'])) {
            header('Location: /images?project_id=' . $active_project_id . '&error=format');
            exit;
        }

        $filename = 'source_' . time() . '_' . uniqid() . '.' . $ext;
        $filepath = $uploadDir . $filename;

        if (move_uploaded_file($file['tmp_name'], $filepath)) {
            header('Location: /images?project_id=' . $active_project_id . '&success=uploaded');
        } else {
            header('Location: /images?project_id=' . $active_project_id . '&error=upload');
        }
        exit;
    }

    public function generateVariations()
    {
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];

        $sourceFilename = trim($_POST['source_filename'] ?? '');
        $promptId = (int) ($_POST['prompt_id'] ?? 0);
        if (empty($sourceFilename)) {

            echo json_encode(['success' => false, 'error' => 'No source filename']);
            exit;
        }

        $sourceDir = $this->getProjectSourceDirectory($active_project_id, true);
        $generatedDir = $this->getProjectGeneratedDirectory($active_project_id, true);
        $sourcePath = $sourceDir . $sourceFilename;

        if (!file_exists($sourcePath)) {
            echo json_encode(['success' => false, 'error' => 'Source file not found']);
            exit;
        }

        // Отримуємо промпт якщо вибрано
        $customPrompt = null;
        if ($promptId > 0) {
            $promptData = $this->db->query('SELECT prompt_text FROM image_prompts WHERE id = ?', [$promptId])->fetch(PDO::FETCH_ASSOC);
            $customPrompt = $promptData['prompt_text'] ?? null;
        }

        $variations = [];
        $baseFilename = pathinfo($sourceFilename, PATHINFO_FILENAME);

        for ($i = 1; $i <= 5; $i++) {
            $generatedPath = $this->generateImageVariation($sourcePath, $baseFilename, $i, $generatedDir, $customPrompt);
            if ($generatedPath) {
                $variations[] = [
                    'path' => str_replace(__DIR__ . '/../../public', '', $generatedPath),
                    'filename' => basename($generatedPath)
                ];
            }
        }

        echo json_encode(['success' => true, 'variations' => $variations, 'count' => count($variations)]);
        exit;
    }

    private function generateImageVariation($sourcePath, $baseFilename, $index, $outputDir, $customPrompt = null)
    {
        $timestamp = time();
        $outputFilename = $baseFilename . '_var' . $index . '_' . $timestamp . '.jpg';
        $outputPath = $outputDir . $outputFilename;
        $seed = random_int(100000, 999999) + ($index * 37);

        // Використовуємо кастомний промпт або дефолтні
        if ($customPrompt) {
            $prompt = $customPrompt;
        } else {
            // Варіації промптів для різного контенту
            $prompts = [
                1 => "professional female constellations facilitator, standing three-quarter pose, open palms gesture, calm confident smile, direct eye contact, modern therapy studio, soft natural window light, shallow depth of field, editorial portrait, high detail, photorealistic",
                2 => "expert systemic constellations coach, seated at round table, gentle hand gesture while explaining, empathetic facial expression, notebook and symbolic cards on table, warm beige interior, cinematic lighting, realistic skin texture, premium branding photo",
                3 => "female therapist leading a small workshop, side profile pose, expressive hands mid-explanation, focused compassionate face, flipchart with abstract family-system diagram blurred in background, Scandinavian office, documentary style photo, 85mm lens look",
                4 => "close-up portrait of a constellation practitioner, subtle smile with thoughtful eyes, hand touching heart gesture, elegant business-casual outfit, clean neutral background, soft rim light, magazine cover style, high-end retouch, photorealistic",
                5 => "lifestyle scene of expert constellations mentor walking in bright studio corridor, natural movement pose, confident posture, relaxed smile, one hand holding journal, airy light, modern minimal interior, premium personal brand photography"
            ];
            $prompt = $prompts[$index] ?? $prompts[1];
        }

        // Додаємо варіативні модифікатори, щоб уникати однакових результатів
        $poseVariants = [
            'slight body turn to the left',
            'sitting posture with straight back',
            'walking forward natural motion',
            'leaning lightly on table edge',
            'hands gently folded at waist'
        ];
        $expressionVariants = [
            'warm empathetic smile',
            'thoughtful focused expression',
            'confident calm look',
            'soft supportive eye contact',
            'inspired professional expression'
        ];
        $gestureVariants = [
            'open palm gesture',
            'one hand near heart',
            'subtle explaining hand movement',
            'holding notebook naturally',
            'gentle welcoming gesture'
        ];
        $cameraVariants = [
            '35mm documentary angle',
            '50mm natural perspective',
            '85mm portrait compression',
            'slight high-angle shot',
            'eye-level cinematic framing'
        ];
        $lightVariants = [
            'soft daylight from window',
            'golden hour warm tones',
            'neutral studio softbox lighting',
            'cinematic rim light and soft shadows',
            'bright airy interior light'
        ];

        $variantPrompt = $prompt
            . ', ' . $poseVariants[array_rand($poseVariants)]
            . ', ' . $expressionVariants[array_rand($expressionVariants)]
            . ', ' . $gestureVariants[array_rand($gestureVariants)]
            . ', ' . $cameraVariants[array_rand($cameraVariants)]
            . ', ' . $lightVariants[array_rand($lightVariants)]
            . ', unique composition, different framing, no duplicate image, variation #' . $index
            . ', creative seed ' . $seed;

        // Спробуємо кілька безкоштовних сервісів по черзі
        $services = [
            'pollinations',  // Повністю безкоштовний, швидкий
            'deepai',       // 150 запитів/місяць безкоштовно
            'huggingface',  // Безкоштовні inference запити
            'craiyon',      // Безкоштовний DALL-E mini
            'local'         // Fallback - локальна обробка
        ];

        // Ротуємо стартовий сервіс по індексу варіації, щоб не завжди брати перший
        $totalServices = count($services);
        $startOffset = ($index - 1) % $totalServices;

        for ($attempt = 0; $attempt < $totalServices; $attempt++) {
            $service = $services[($startOffset + $attempt) % $totalServices];
            $result = null;

            switch ($service) {
                case 'pollinations':
                    $result = $this->generateWithPollinations($variantPrompt, $outputPath, $seed);
                    break;

                case 'deepai':
                    $result = $this->generateWithDeepAI($sourcePath, $variantPrompt, $outputPath);
                    break;

                case 'huggingface':
                    $result = $this->generateWithHuggingFace($variantPrompt, $outputPath);
                    break;

                case 'craiyon':
                    $result = $this->generateWithCraiyon($variantPrompt, $outputPath);
                    break;

                case 'local':
                    $result = $this->generateWithLocalProcessing($sourcePath, $index, $outputPath);
                    break;
            }

            if ($result) {
                return $outputPath;
            }
        }

        return null;
    }

    private function generateWithPollinations($prompt, $outputPath, $seed = null)
    {
        try {
            // Pollinations.ai - повністю безкоштовний
            $encodedPrompt = urlencode($prompt);
            $seedParam = $seed !== null ? '&seed=' . (int) $seed : '';
            $url = "https://image.pollinations.ai/prompt/{$encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&enhance=true{$seedParam}&referrer=content-planner";

            $imageData = $this->fetchImageData($url);
            if ($imageData && strlen($imageData) > 1000) {
                file_put_contents($outputPath, $imageData);
                return true;
            }
        } catch (Exception $e) {
            error_log("Pollinations error: " . $e->getMessage());
        }
        return false;
    }

    private function generateWithDeepAI($sourcePath, $prompt, $outputPath)
    {
        try {
            // DeepAI - безкоштовний з обмеженнями (150 запитів/місяць)
            // Використовуємо text2img API без ключа (публічний ендпоінт)
            $url = "https://api.deepai.org/api/text2img";

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query(['text' => $prompt]));
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_TIMEOUT, 30);

            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200 && $response) {
                $data = json_decode($response, true);
                if (isset($data['output_url'])) {
                    $imageData = $this->fetchImageData($data['output_url']);
                    if ($imageData && strlen($imageData) > 1000) {
                        file_put_contents($outputPath, $imageData);
                        return true;
                    }
                }
            }
        } catch (Exception $e) {
            error_log("DeepAI error: " . $e->getMessage());
        }
        return false;
    }

    private function generateWithHuggingFace($prompt, $outputPath)
    {
        try {
            // Hugging Face Inference API - безкоштовний для невеликих запитів
            // Використовуємо Stable Diffusion модель
            $url = "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-2-1";

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['inputs' => $prompt]));
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json',
            ]);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_TIMEOUT, 60);

            $imageData = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200 && $imageData && strlen($imageData) > 1000) {
                file_put_contents($outputPath, $imageData);
                return true;
            }
        } catch (Exception $e) {
            error_log("HuggingFace error: " . $e->getMessage());
        }
        return false;
    }

    private function generateWithCraiyon($prompt, $outputPath)
    {
        try {
            // Craiyon (DALL-E mini) - безкоштовний сервіс для генерації зображень
            // API endpoint може змінюватись, використовуємо публічний API
            $url = "https://api.craiyon.com/v3";

            $payload = json_encode([
                'prompt' => $prompt,
                'model' => 'photo',
                'negative_prompt' => 'low quality, blurry, distorted',
                'version' => '35s5hfwn9n78gb06'
            ]);

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json',
                'Accept: application/json'
            ]);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_TIMEOUT, 120); // Craiyon може бути повільним

            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200 && $response) {
                $data = json_decode($response, true);
                // Craiyon повертає base64 encoded images або URLs
                if (isset($data['images']) && is_array($data['images']) && !empty($data['images'])) {
                    // Беремо перше зображення
                    $firstImage = $data['images'][0];

                    // Якщо це base64
                    if (strpos($firstImage, 'data:image') === 0) {
                        $imageData = base64_decode(preg_replace('#^data:image/\w+;base64,#i', '', $firstImage));
                    } else {
                        // Якщо це URL
                        $imageData = $this->fetchImageData($firstImage);
                    }

                    if ($imageData && strlen($imageData) > 1000) {
                        file_put_contents($outputPath, $imageData);
                        return true;
                    }
                }
            }
        } catch (Exception $e) {
            error_log("Craiyon error: " . $e->getMessage());
        }
        return false;
    }

    private function generateWithLocalProcessing($sourcePath, $index, $outputPath)
    {
        try {
            // Fallback: локальна обробка з GD library
            $imageInfo = getimagesize($sourcePath);
            if (!$imageInfo) {
                return false;
            }

            $mime = $imageInfo['mime'];
            switch ($mime) {
                case 'image/jpeg':
                    $image = imagecreatefromjpeg($sourcePath);
                    break;
                case 'image/png':
                    $image = imagecreatefrompng($sourcePath);
                    break;
                case 'image/gif':
                    $image = imagecreatefromgif($sourcePath);
                    break;
                case 'image/webp':
                    $image = imagecreatefromwebp($sourcePath);
                    break;
                default:
                    return false;
            }

            if (!$image) {
                return false;
            }

            $width = imagesx($image);
            $height = imagesy($image);

            // Застосовуємо різні фільтри для варіацій
            switch ($index) {
                case 1:
                    imagefilter($image, IMG_FILTER_BRIGHTNESS, 10);
                    imagefilter($image, IMG_FILTER_CONTRAST, -5);
                    break;
                case 2:
                    imagefilter($image, IMG_FILTER_COLORIZE, 10, 5, -10);
                    break;
                case 3:
                    imagefilter($image, IMG_FILTER_SMOOTH, 3);
                    imagefilter($image, IMG_FILTER_BRIGHTNESS, -10);
                    break;
            }

            // Додаємо водяний знак
            $textColor = imagecolorallocatealpha($image, 100, 100, 100, 50);
            $text = "Варіація #{$index}";
            imagestring($image, 3, 10, $height - 20, $text, $textColor);

            // Зберігаємо результат
            imagejpeg($image, $outputPath, 90);
            imagedestroy($image);

            return true;
        } catch (Exception $e) {
            error_log("Local processing error: " . $e->getMessage());
            return false;
        }
    }

    private function fetchImageData($url)
    {
        // Спочатку пробуємо cURL
        if (function_exists('curl_init')) {
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
            curl_setopt($ch, CURLOPT_TIMEOUT, 30);
            curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

            $data = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200 && $data) {
                return $data;
            }
        }

        // Fallback: file_get_contents
        $context = stream_context_create([
            'http' => [
                'timeout' => 30,
                'user_agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            ],
            'ssl' => [
                'verify_peer' => false,
                'verify_peer_name' => false
            ]
        ]);

        $data = @file_get_contents($url, false, $context);
        return $data ?: null;
    }



    // POST /images/upload-ajax — JSON response upload (for gallery modal)
    public function uploadSourceImageAjax()
    {
        header('Content-Type: application/json');

        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        if (!isset($_FILES['source_image']) || $_FILES['source_image']['error'] !== UPLOAD_ERR_OK) {
            echo json_encode(['ok' => false, 'error' => 'Файл не отримано']);
            return;
        }

        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];
        $file = $_FILES['source_image'];

        if ($file['size'] > 10 * 1024 * 1024) {
            echo json_encode(['ok' => false, 'error' => 'Файл більше 10MB']);
            return;
        }

        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'])) {
            echo json_encode(['ok' => false, 'error' => 'Недозволений формат']);
            return;
        }

        $uploadDir = $this->getProjectSourceDirectory($active_project_id, true);
        $sourceFolderName = $this->getProjectSourceFolderName($active_project_id);
        $filename = 'source_' . time() . '_' . uniqid() . '.' . $ext;
        $filepath = $uploadDir . $filename;

        if (move_uploaded_file($file['tmp_name'], $filepath)) {
            echo json_encode([
                'ok'       => true,
                'filename' => $filename,
                'url'      => '/uploads/source_images/' . rawurlencode($sourceFolderName) . '/' . rawurlencode($filename),
            ]);
        } else {
            echo json_encode(['ok' => false, 'error' => 'Помилка збереження']);
        }
    }

    // GET /api/source-images — returns JSON list of uploaded source images
    public function listSourceImages()
    {
        header('Content-Type: application/json');
        header('Cache-Control: no-cache');

        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];
        $sourceFolderName = $this->getProjectSourceFolderName($active_project_id);
        $sourceDir = $this->getProjectSourceDirectory($active_project_id, true);

        $images = [];
        if (is_dir($sourceDir)) {
            $files = scandir($sourceDir);
            foreach ($files as $file) {
                if ($file === '.' || $file === '..') continue;
                $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
                if (!in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'])) continue;
                $filepath = $sourceDir . $file;
                $images[] = [
                    'filename' => $file,
                    'url'      => '/uploads/source_images/' . rawurlencode($sourceFolderName) . '/' . rawurlencode($file),
                    'size'     => filesize($filepath),
                    'created'  => filemtime($filepath),
                ];
            }
        }

        usort($images, fn($a, $b) => $b['created'] - $a['created']);
        echo json_encode($images);
    }

    public function deleteSourceImage()
    {
        require_once __DIR__ . '/AuthController.php';
        AuthController::check();

        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];

        $filename = trim($_POST['filename'] ?? '');
        if (empty($filename)) {
            header('Location: /images?project_id=' . $active_project_id);
            exit;
        }

        $sourceDir = $this->getProjectSourceDirectory($active_project_id, true);
        $filepath = $sourceDir . $filename;

        if (file_exists($filepath)) {
            unlink($filepath);
        }

        header('Location: /images?project_id=' . $active_project_id);
        exit;
    }
}
