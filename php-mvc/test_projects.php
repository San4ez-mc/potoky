<?php
/**
 * Тестова сторінка для перевірки системи проектів
 */

session_start();

if (!isset($_SESSION['admin_id'])) {
    header('Location: /login');
    exit;
}

$config = require __DIR__ . '/config/database.php';
require __DIR__ . '/app/core/Database.php';
require __DIR__ . '/app/core/BaseController.php';

$db = new Database($config);
$controller = new BaseController($db);

$projectData = $controller->ensureProjectSelected();

?>
<!DOCTYPE html>
<html lang="uk">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Тест системи проектів</title>
    <link rel="stylesheet" href="/style.css">
</head>

<body>
    <?php
    $projects = $projectData['projects'];
    $active_project_id = $projectData['active_project_id'];
    require __DIR__ . '/app/views/components/topbar.php';
    ?>

    <div class="container">
        <div style="background:white;border-radius:10px;padding:28px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
            <h2>🧪 Тест системи проектів</h2>

            <div style="margin-top: 20px; padding: 15px; background: #f0f9ff; border-radius: 8px;">
                <h3>Активний проект:</h3>
                <p>ID: <?php echo $active_project_id; ?></p>
                <?php
                foreach ($projects as $p) {
                    if ($p['id'] == $active_project_id) {
                        echo '<p>Назва: ' . htmlspecialchars($p['name'], ENT_QUOTES, 'UTF-8') . '</p>';
                        break;
                    }
                }
                ?>
            </div>

            <div style="margin-top: 20px;">
                <h3>Усі доступні проекти:</h3>
                <ul>
                    <?php foreach ($projects as $project): ?>
                        <li>
                            ID: <?php echo $project['id']; ?> -
                            <strong><?php echo htmlspecialchars($project['name'], ENT_QUOTES, 'UTF-8'); ?></strong>
                            <?php if ($project['id'] == $active_project_id): ?>
                                <span style="color: #10b981;">✓ Обрано</span>
                            <?php endif; ?>
                        </li>
                    <?php endforeach; ?>
                </ul>
            </div>

            <div style="margin-top: 30px; padding: 15px; background: #fef3c7; border-radius: 8px;">
                <h3>Статус міграції:</h3>
                <?php
                $checks = [
                    'posts має project_id' => $db->query("SHOW COLUMNS FROM posts LIKE 'project_id'")->fetch(PDO::FETCH_ASSOC),
                    'categories має project_id' => $db->query("SHOW COLUMNS FROM categories LIKE 'project_id'")->fetch(PDO::FETCH_ASSOC),
                    'Таблиця projects існує' => $db->query("SHOW TABLES LIKE 'projects'")->fetch(PDO::FETCH_ASSOC),
                    'Таблиця admin_projects існує' => $db->query("SHOW TABLES LIKE 'admin_projects'")->fetch(PDO::FETCH_ASSOC),
                ];

                foreach ($checks as $label => $result) {
                    $icon = $result ? '✅' : '❌';
                    echo "<p>{$icon} {$label}</p>";
                }
                ?>
            </div>

            <div style="margin-top: 20px;">
                <a href="/?project_id=<?php echo $active_project_id; ?>"
                    style="display: inline-block; padding: 10px 20px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px;">
                    📋 Перейти до контент-плану
                </a>
            </div>
        </div>
    </div>
</body>

</html>