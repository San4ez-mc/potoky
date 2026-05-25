<!DOCTYPE html>
<html lang="uk">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Categories — Content Planner Bot</title>
    <link rel="stylesheet" href="/style.css">
    <style>
        .category-card {
            background: white;
            border-radius: 12px;
            padding: 18px;
            margin-bottom: 12px;
            border-left: 4px solid #5B2D8E;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .category-color {
            width: 32px;
            height: 32px;
            border-radius: 8px;
        }

        .category-info {
            flex: 1;
            margin: 0 16px;
        }

        .category-actions {
            display: flex;
            gap: 8px;
        }
    </style>
</head>

<body>
    <?php
    require_once __DIR__ . '/../core/Database.php';
    require_once __DIR__ . '/../controllers/AuthController.php';
    AuthController::check();
    ?>
    <div class="topbar">
        <div class="logo">📋 Content Planner Bot</div>
        <div class="menu">
            <a href="/">Content Plan</a>
            <a href="/categories">Categories</a>
            <a href="/settings">Settings</a>
        </div>
        <a href="/logout" class="logout-link">🚪 Вийти</a>
    </div>
    <div class="container">
        <div style="background:white;border-radius:10px;padding:28px;box-shadow:var(--shadow);">
            <h2>📂 Категорії (Рубрики)</h2>
            <p style="color:#7f8c8d;margin-bottom:20px;font-size:14px;">Додавайте теми для ваших постів. Одна категорія
                може мати кілька постів.</p>

            <button class="add-btn" onclick="location.href='/categories/add'" style="margin-bottom:20px;">+ Нова
                категорія</button>

            <div id="categories">
                <div class="category-card">
                    <div class="category-color" style="background:#5a6c7d;"></div>
                    <div class="category-info">
                        <h3 style="margin:0;font-size:16px;">Дзеркало болю</h3>
                        <p style="margin:0;color:#7f8c8d;font-size:13px;">Описание категорії...</p>
                    </div>
                    <div class="category-actions">
                        <button style="padding:8px 12px;font-size:13px;">✏️ Редагувати</button>
                        <button class="danger" style="padding:8px 12px;font-size:13px;">🗑️ Видалити</button>
                    </div>
                </div>
                <div class="category-card">
                    <div class="category-color" style="background:#f5a623;"></div>
                    <div class="category-info">
                        <h3 style="margin:0;font-size:16px;">Жива історія</h3>
                        <p style="margin:0;color:#7f8c8d;font-size:13px;">Описание категорії...</p>
                    </div>
                    <div class="category-actions">
                        <button style="padding:8px 12px;font-size:13px;">✏️ Редагувати</button>
                        <button class="danger" style="padding:8px 12px;font-size:13px;">🗑️ Видалити</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</body>

</html>