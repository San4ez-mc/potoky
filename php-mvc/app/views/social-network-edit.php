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
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 10px;
            align-items: start;
            margin-bottom: 10px;
            padding: 10px;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            background: #f8fafc;
        }

        .category-fields {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }

        .category-row input,
        .category-row select {
            flex: 1;
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 14px;
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
    <?php require __DIR__ . '/components/topbar.php'; ?>

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
                <input type="hidden" name="project_id" value="<?php echo (int) $active_project_id; ?>">

                <div class="field">
                    <label for="network_prompt">Промпт</label>
                    <textarea id="network_prompt" name="network_prompt" rows="4"
                        placeholder="Введіть промпт для генерації постів..."><?php echo htmlspecialchars($networkPrompt, ENT_QUOTES, 'UTF-8'); ?></textarea>
                </div>

                <div class="field">
                    <label>Категорії цієї мережі</label>
                    <p class="hint">Для кожної категорії можна задати тип клієнта та аватар (назва + опис).</p>

                    <?php
                    $clientTypeOptions = [
                        'ТИП 1' => 'Не знає про продукт',
                        'ТИП 2' => 'Знає, але думає, що йому не потрібно',
                        'ТИП 3' => 'Знає, але не впевнений, що це найкраще рішення',
                    ];

                    $avatarSuggestions = ['Віктор'];
                    foreach ($categories as $category) {
                        $avatarName = trim((string) ($category['avatar_name'] ?? ''));
                        if ($avatarName !== '' && !in_array($avatarName, $avatarSuggestions, true)) {
                            $avatarSuggestions[] = $avatarName;
                        }
                    }
                    ?>

                    <div id="categoryList">
                        <?php if (!empty($categories)): ?>
                            <?php foreach ($categories as $index => $category): ?>
                                <div class="category-row" data-index="<?php echo (int) $index; ?>">
                                    <div class="category-fields">
                                        <input type="text" name="categories[<?php echo (int) $index; ?>][name]"
                                            value="<?php echo htmlspecialchars($category['name'], ENT_QUOTES, 'UTF-8'); ?>"
                                            placeholder="Назва категорії">

                                        <select name="categories[<?php echo (int) $index; ?>][client_type]">
                                            <option value="">Тип клієнта (не вказано)</option>
                                            <?php foreach ($clientTypeOptions as $typeValue => $typeDescription): ?>
                                                <option value="<?php echo htmlspecialchars($typeValue, ENT_QUOTES, 'UTF-8'); ?>"
                                                    <?php echo (($category['client_type'] ?? '') === $typeValue) ? 'selected' : ''; ?>>
                                                    <?php echo htmlspecialchars($typeValue . ' — ' . $typeDescription, ENT_QUOTES, 'UTF-8'); ?>
                                                </option>
                                            <?php endforeach; ?>
                                        </select>

                                        <input type="text" list="avatarSuggestions"
                                            name="categories[<?php echo (int) $index; ?>][avatar_name]"
                                            value="<?php echo htmlspecialchars((string) ($category['avatar_name'] ?? ''), ENT_QUOTES, 'UTF-8'); ?>"
                                            placeholder="Аватар (напр. Віктор)">

                                        <input type="text" name="categories[<?php echo (int) $index; ?>][avatar_description]"
                                            value="<?php echo htmlspecialchars((string) ($category['avatar_description'] ?? ''), ENT_QUOTES, 'UTF-8'); ?>"
                                            placeholder="Короткий опис аватара">
                                    </div>

                                    <button type="button" class="category-delete-btn" onclick="deleteCategory(this)"
                                        title="Видалити категорію">✕</button>
                                </div>
                            <?php endforeach; ?>
                        <?php else: ?>
                            <div class="category-row" data-index="0">
                                <div class="category-fields">
                                    <input type="text" name="categories[0][name]" value="" placeholder="Назва категорії">
                                    <select name="categories[0][client_type]">
                                        <option value="">Тип клієнта (не вказано)</option>
                                        <?php foreach ($clientTypeOptions as $typeValue => $typeDescription): ?>
                                            <option value="<?php echo htmlspecialchars($typeValue, ENT_QUOTES, 'UTF-8'); ?>">
                                                <?php echo htmlspecialchars($typeValue . ' — ' . $typeDescription, ENT_QUOTES, 'UTF-8'); ?>
                                            </option>
                                        <?php endforeach; ?>
                                    </select>
                                    <input type="text" list="avatarSuggestions" name="categories[0][avatar_name]" value=""
                                        placeholder="Аватар (напр. Віктор)">
                                    <input type="text" name="categories[0][avatar_description]" value=""
                                        placeholder="Короткий опис аватара">
                                </div>
                                <button type="button" class="category-delete-btn" onclick="deleteCategory(this)"
                                    title="Видалити категорію">✕</button>
                            </div>
                        <?php endif; ?>
                    </div>

                    <datalist id="avatarSuggestions">
                        <?php foreach ($avatarSuggestions as $avatarName): ?>
                            <option value="<?php echo htmlspecialchars($avatarName, ENT_QUOTES, 'UTF-8'); ?>"></option>
                        <?php endforeach; ?>
                    </datalist>

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
                    return [
                        'id' => (int) $cat['id'],
                        'name' => $cat['name'],
                        'description' => $cat['description'],
                        'client_type' => (string) ($cat['client_type'] ?? ''),
                        'avatar_name' => (string) ($cat['avatar_name'] ?? ''),
                        'avatar_description' => (string) ($cat['avatar_description'] ?? ''),
                    ];
                }, $categories);
                echo htmlspecialchars(json_encode($categoriesJson, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), ENT_QUOTES, 'UTF-8');
                ?></textarea>

            <hr style="margin:30px 0; border:none; border-top:1px solid #e5e7eb;">

            <h3 style="margin-bottom:10px;">📥 Завантажити контент-план з JSON</h3>
            <p class="hint"><strong>Структура JSON:</strong></p>
            <ul style="margin: 0 0 15px 20px;">
                <li><strong>categories</strong> — масив категорій з полями: <code>id</code>, <code>name</code>,
                    <code>is_new</code>, <code>client_type</code>, <code>avatar_name</code>,
                    <code>avatar_description</code></li>
                <li><strong>posts</strong> — об'єкт: дата → категорія → масив постів</li>
            </ul>
            <p class="hint" style="margin-bottom: 5px;"><strong>Опис нових полів category:</strong></p>
            <ul style="margin: 0 0 15px 20px;">
                <li><code>client_type</code> — тип клієнта: <code>ТИП 1</code> (не знає про продукт), <code>ТИП 2</code>
                    (знає, але думає, що не потрібно), <code>ТИП 3</code> (знає, але не впевнений, що це найкраще
                    рішення)</li>
                <li><code>avatar_name</code> — ім'я аватара (наприклад, <code>Віктор</code>)</li>
                <li><code>avatar_description</code> — короткий редагований опис аватара</li>
            </ul>
            <p class="hint" style="margin-bottom: 5px;"><strong>Поля кожного поста:</strong></p>
            <ul style="margin: 0 0 15px 20px;">
                <li><code>text</code> (або <code>caption</code>) — текст посту</li>
                <li><code>image_path</code> — посилання на зображення (опціонально)</li>
                <li><code>image_type</code> — тип зображення (опціонально, довільне значення)</li>
                <li><code>image_action</code> — дія з зображенням: <code>nothing</code>, <code>auto_generate</code>,
                    <code>overlay_text</code>, <code>generate_from_source_folder</code></li>
                <li><code>image_text</code> — текст для накладення на зображення</li>
                <li><code>image_prompt</code> — опис для генерації або редагування зображення (для Gemini)</li>
            </ul>
            <p class="hint" style="margin-bottom: 10px;"><strong>Приклад структури:</strong></p>
            <textarea readonly
                style="width:100%; height:220px; padding:10px; border:1px solid #d1d5db; border-radius:8px; font-family:monospace; font-size:12px; background:#f8fafc; margin-bottom:14px;"
                onclick="this.select();">{
    "categories": [
        {
            "id": 1,
            "name": "Жива історія",
            "is_new": false,
            "client_type": "ТИП 1",
            "avatar_name": "Віктор",
            "avatar_description": "Підприємець 35 років, хоче систематизувати маркетинг"
        }
    ],
    "posts": {
        "2026-03-01": {
            "Жива історія": [
                {
                    "text": "Текст посту",
                    "image_path": "",
                    "image_type": "photo",
                    "image_action": "auto_generate",
                    "image_text": "Текст на фото",
                    "image_prompt": "Professional portrait"
                }
            ]
        }
    }
}</textarea>

            <form method="POST" action="/social-networks/import-content">
                <input type="hidden" name="id" value="<?php echo (int) $networkId; ?>">
                <input type="hidden" name="project_id" value="<?php echo (int) $active_project_id; ?>">

                <div class="field" style="position: relative;">
                    <div
                        style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <label for="content_json">JSON контент-плану</label>
                        <button type="button" onclick="copyExampleJson()"
                            style="background: #4CAF50; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px;">📋
                            Копіювати приклад</button>
                    </div>
                    <textarea id="content_json" name="content_json" rows="16"
                        style="font-family:monospace; font-size:12px; line-height: 1.4;"></textarea>
                </div>

                <button type="submit" class="submit-btn">📥 Завантажити контент-план</button>
            </form>

            <div style="margin-top:20px;padding-top:16px;border-top:1px dashed #d1d5db;">
                <h4 style="margin:0 0 8px 0;">📤 Скачати контент-план з системи</h4>
                <p class="hint" style="margin-top:0;">Експортує JSON у тому ж форматі, що і для імпорту. Зручно віддати
                    ШІ на редагування і завантажити назад без втрати полів.</p>

                <?php
                $defaultFrom = date('Y-m-01');
                $defaultTo = date('Y-m-t');
                $exportDateFrom = trim((string) ($_GET['date_from'] ?? $defaultFrom));
                $exportDateTo = trim((string) ($_GET['date_to'] ?? $defaultTo));
                ?>

                <form method="GET" action="/social-networks/export-content"
                    style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
                    <input type="hidden" name="id" value="<?php echo (int) $networkId; ?>">
                    <input type="hidden" name="project_id" value="<?php echo (int) $active_project_id; ?>">

                    <div style="min-width:180px;">
                        <label for="date_from"
                            style="display:block;font-size:13px;color:#475569;margin-bottom:4px;">Дата від</label>
                        <input type="date" id="date_from" name="date_from"
                            value="<?php echo htmlspecialchars($exportDateFrom, ENT_QUOTES, 'UTF-8'); ?>">
                    </div>

                    <div style="min-width:180px;">
                        <label for="date_to" style="display:block;font-size:13px;color:#475569;margin-bottom:4px;">Дата
                            до</label>
                        <input type="date" id="date_to" name="date_to"
                            value="<?php echo htmlspecialchars($exportDateTo, ENT_QUOTES, 'UTF-8'); ?>">
                    </div>

                    <button type="submit" class="small-btn" style="height:40px;">⬇️ Скачати JSON</button>
                </form>
            </div>
        </div>
    </div>

    <script>
        let categoryIndex = <?php echo !empty($categories) ? (int) (count($categories)) : 1; ?>;
        const clientTypeOptions = <?php echo json_encode($clientTypeOptions, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;

        function addCategoryRow() {
            const list = document.getElementById('categoryList');
            const row = document.createElement('div');
            row.className = 'category-row';
            row.dataset.index = String(categoryIndex);

            const optionsHtml = Object.entries(clientTypeOptions)
                .map(([value, description]) => `<option value="${value}">${value} — ${description}</option>`)
                .join('');

            row.innerHTML = `
                <div class="category-fields">
                    <input type="text" name="categories[${categoryIndex}][name]" value="" placeholder="Назва категорії">
                    <select name="categories[${categoryIndex}][client_type]">
                        <option value="">Тип клієнта (не вказано)</option>
                        ${optionsHtml}
                    </select>
                    <input type="text" list="avatarSuggestions" name="categories[${categoryIndex}][avatar_name]" value="" placeholder="Аватар (напр. Віктор)">
                    <input type="text" name="categories[${categoryIndex}][avatar_description]" value="" placeholder="Короткий опис аватара">
                </div>
                <button type="button" class="category-delete-btn" onclick="deleteCategory(this)" title="Видалити категорію">✕</button>
            `;

            list.appendChild(row);
            categoryIndex++;
        }

        function deleteCategory(btn) {
            const row = btn.closest('.category-row');
            const categoryInput = row.querySelector('input[name$="[name]"]');
            const categoryName = categoryInput.value.trim();

            let confirmMessage = 'Ви впевнені, що хочете видалити цю категорію?';
            if (categoryName) {
                confirmMessage = `Ви впевнені, що хочете видалити категорію "${categoryName}"?\n\nУвага: Пости з цією категорією залишаться, але втратять зв'язок з категорією.`;
            }

            if (confirm(confirmMessage)) {
                row.remove();
            }
        }

        function copyExampleJson() {
            const exampleJson = {
                categories: [
                    {
                        id: 1,
                        name: "Жива історія",
                        is_new: false,
                        client_type: "ТИП 1",
                        avatar_name: "Віктор",
                        avatar_description: "Підприємець 35 років, хоче систематизувати маркетинг"
                    },
                    {
                        id: null,
                        name: "Нова рубрика",
                        is_new: true,
                        client_type: "ТИП 2",
                        avatar_name: "Олена",
                        avatar_description: "Маркетолог, скептично ставиться до нових інструментів"
                    }
                ],
                posts: {
                    "2026-03-01": {
                        "Жива історія": [
                            {
                                text: "Текст посту з генерацією зображення",
                                post_type: "",
                                image_path: "",
                                image_type: "photo",
                                image_action: "auto_generate",
                                image_text: "Текст на фото",
                                image_prompt: "Professional business portrait, office background, natural light"
                            },
                            {
                                text: "Текст посту без зображення",
                                post_type: "",
                                image_action: "nothing",
                                image_path: "",
                                image_type: "illustration",
                                image_text: "",
                                image_prompt: ""
                            },
                            {
                                text: "Генерація з файлу з папки",
                                post_type: "Карусель",
                                image_action: "generate_from_source_folder",
                                image_path: "",
                                image_type: "source_variation",
                                image_text: "",
                                image_prompt: "Sunset over the mountains, golden hour, calm atmosphere"
                            }
                        ],
                        "Дзеркало болю": [
                            "Старий формат теж працює"
                        ]
                    },
                    "2026-03-08": {
                        "Ситуативка": [
                            {
                                text: "З 8 березня! текст посту",
                                post_type: "Сторіз",
                                image_action: "overlay_text",
                                image_type: "banner",
                                image_text: "Зі святом!",
                                image_path: "",
                                image_prompt: "Elegant spring flowers, premium style"
                            }
                        ]
                    }
                }
            };

            document.getElementById('content_json').value = JSON.stringify(exampleJson, null, 2);
            document.getElementById('content_json').focus();
        }
    </script>
</body>

</html>