<!DOCTYPE html>
<html lang="uk">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Редагування соц.мережі — Content Planner Bot</title>
    <link rel="stylesheet" href="/style.css">
    <style>
        .form-card {
            background: white;
            border-radius: 10px;
            padding: 24px;
            box-shadow: var(--shadow);
        }

        .field {
            margin-bottom: 16px;
        }

        .field label {
            display: block;
            margin-bottom: 6px;
            font-weight: 600;
            color: #334155;
        }

        .field textarea,
        .field input {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 14px;
        }

        .category-row {
            display: flex;
            gap: 10px;
            align-items: center;
            margin-bottom: 10px;
        }

        .category-row input {
            flex: 1;
        }

        .category-delete-btn {
            padding: 8px 10px;
            border: 1px solid #e8675f;
            background: white;
            color: #e8675f;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            transition: all 0.2s;
        }

        .category-delete-btn:hover {
            background: #fef2f2;
            color: #c9332e;
        }

        .toolbar {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }

        .hint {
            color: #64748b;
            font-size: 13px;
            margin-top: 6px;
        }
    </style>
</head>

<body>
    <div class="topbar">
        <div class="logo">📋 Content Planner Bot</div>
        <div class="menu">
            <a href="/">Контент план</a>
            <a href="/social-networks">Соц.мережі</a>
            <a href="/settings">Налаштування</a>
        </div>
        <a href="/logout" class="logout-link">🚪 Вийти</a>
    </div>

    <div class="container">
        <div class="form-card">
            <h2 style="margin-top:0;">✏️ Редагування соц.мережі</h2>
            <p style="color:#64748b; margin-top:0;">Мережа:
                <strong><?php echo htmlspecialchars($networkName, ENT_QUOTES, 'UTF-8'); ?></strong>
            </p>

            <?php if (!empty($_GET['saved'])): ?>
                <div
                    style="background:#ecfdf5;border:1px solid #86efac;color:#166534;padding:10px 12px;border-radius:8px;margin-bottom:14px;">
                    Збережено ✅</div>
            <?php endif; ?>

            <?php if (!empty($_GET['imported'])): ?>
                <div
                    style="background:#ecfdf5;border:1px solid #86efac;color:#166534;padding:10px 12px;border-radius:8px;margin-bottom:14px;">
                    Імпортовано: <?php echo (int) $_GET['imported']; ?> постів.
                    <?php if (!empty($_GET['skipped'])): ?>Пропущено: <?php echo (int) $_GET['skipped']; ?>.<?php endif; ?>
                    <?php if (!empty($_GET['new_categories'])): ?>Створено нових категорій:
                        <?php echo (int) $_GET['new_categories']; ?>.<?php endif; ?>
                    ✅
                </div>
            <?php endif; ?>

            <?php if (!empty($_GET['error'])): ?>
                <div
                    style="background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;padding:10px 12px;border-radius:8px;margin-bottom:14px;">
                    Помилка:
                    <?php
                    $errorMsg = $_GET['error'];
                    if ($errorMsg === 'empty')
                        echo 'JSON порожній';
                    elseif ($errorMsg === 'invalid_json')
                        echo 'Невалідний формат JSON';
                    elseif ($errorMsg === 'invalid_structure')
                        echo 'Невірна структура JSON. Очікується {"categories": [...], "posts": {...}}';
                    elseif ($errorMsg === 'network_not_found')
                        echo 'Соц.мережа не знайдена';
                    else
                        echo htmlspecialchars($errorMsg, ENT_QUOTES, 'UTF-8');
                    ?>
                </div>
            <?php endif; ?>

            <form method="POST" action="/social-networks/edit">
                <input type="hidden" name="id" value="<?php echo (int) $networkId; ?>">

                <div class="field">
                    <label for="network_prompt">Промпт</label>
                    <textarea id="network_prompt" name="network_prompt" rows="4"
                        placeholder="Введіть промпт для генерації постів..."><?php echo htmlspecialchars($networkPrompt, ENT_QUOTES, 'UTF-8'); ?></textarea>
                </div>

                <div class="field">
                    <label>Категорії цієї мережі</label>
                    <p class="hint">Редагуйте існуючі категорії або додайте нові рядки.</p>

                    <div id="categoryList">
                        <?php if (!empty($categories)): ?>
                            <?php foreach ($categories as $category): ?>
                                <div class="category-row">
                                    <input type="text" name="categories[]"
                                        value="<?php echo htmlspecialchars($category['name'], ENT_QUOTES, 'UTF-8'); ?>"
                                        placeholder="Назва категорії">
                                    <button type="button" class="category-delete-btn" onclick="deleteCategory(this)"
                                        title="Видалити категорію">✕</button>
                                </div>
                            <?php endforeach; ?>
                        <?php else: ?>
                            <div class="category-row">
                                <input type="text" name="categories[]" value="" placeholder="Назва категорії">
                                <button type="button" class="category-delete-btn" onclick="deleteCategory(this)"
                                    title="Видалити категорію">✕</button>
                            </div>
                        <?php endif; ?>
                    </div>

                    <button type="button" class="small-btn" onclick="addCategoryRow()">+ Додати категорію</button>
                </div>

                <div class="toolbar">
                    <button type="submit" class="submit-btn">💾 Зберегти</button>
                    <button type="button" class="small-btn" onclick="location.href='/social-networks'">← Назад</button>
                </div>
            </form>

            <hr style="margin:30px 0; border:none; border-top:1px solid #e5e7eb;">

            <h3 style="margin-bottom:10px;">📋 JSON категорій (для промпту)</h3>
            <p class="hint">Скопіюйте це в промпт для генерації постів з категоріями:</p>
            <textarea readonly
                style="width:100%; height:120px; padding:10px; border:1px solid #d1d5db; border-radius:8px; font-family:monospace; font-size:12px; background:#f8fafc;"
                onclick="this.select();"><?php
                $categoriesJson = array_map(function ($cat) {
                    return ['id' => (int) $cat['id'], 'name' => $cat['name'], 'description' => $cat['description']];
                }, $categories);
                echo htmlspecialchars(json_encode($categoriesJson, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), ENT_QUOTES, 'UTF-8');
                ?></textarea>

            <hr style="margin:30px 0; border:none; border-top:1px solid #e5e7eb;">

            <h3 style="margin-bottom:10px;">📥 Завантажити контент-план з JSON</h3>
            <p class="hint">Вставте JSON з контент-планом. Структура: categories (масив категорій з id/name/is_new) +
                posts (об'єкт: дата → категорія → масив постів). Кожен пост може бути або рядком (старий формат), або
                об'єктом з полями:
                text (або caption), image_path, image_action, image_text, image_prompt.</p>

            <form method="POST" action="/social-networks/import-content">
                <input type="hidden" name="id" value="<?php echo (int) $networkId; ?>">

                <div class="field">
                    <label for="content_json">JSON контент-плану</label>
                    <textarea id="content_json" name="content_json" rows="14"
                        placeholder='{"categories":[{"id":1,"name":"Жива історія","is_new":false},{"id":null,"name":"Нова рубрика","is_new":true}],"posts":{"2026-03-01":{"Жива історія":[{"text":"Текст посту 1","image_path":"","image_action":"auto_generate","image_text":"Текст на фото","image_prompt":"Professional business portrait, office background, natural light"},{"text":"Текст посту 2","image_action":"nothing","image_path":"","image_text":"","image_prompt":""}],"Дзеркало болю":["Старий формат теж працює"]},"2026-03-08":{"Ситуативка":[{"text":"З 8 березня! текст посту","image_action":"overlay_text","image_text":"Зі святом!","image_prompt":"Elegant spring flowers, premium style"}]}}}'
                        style="font-family:monospace; font-size:12px;"></textarea>
                </div>

                <button type="submit" class="submit-btn">📥 Завантажити контент-план</button>
            </form>
        </div>
    </div>

    <script>
        function addCategoryRow() {
            const list = document.getElementById('categoryList');
            const row = document.createElement('div');
            row.className = 'category-row';
            row.innerHTML = '<input type="text" name="categories[]" value="" placeholder="Назва категорії"><button type="button" class="category-delete-btn" onclick="deleteCategory(this)" title="Видалити категорію">✕</button>';
            list.appendChild(row);
        }

        function deleteCategory(btn) {
            const row = btn.closest('.category-row');
            const categoryInput = row.querySelector('input[name="categories[]"]');
            const categoryName = categoryInput.value.trim();

            let confirmMessage = 'Ви впевнені, що хочете видалити цю категорію?';
            if (categoryName) {
                confirmMessage = `Ви впевнені, що хочете видалити категорію "${categoryName}"?\n\nУвага: Пости з цією категорією залишаться, але втратять зв'язок з категорією.`;
            }

            if (confirm(confirmMessage)) {
                row.remove();
            }
        }
    </script>
</body>

</html>