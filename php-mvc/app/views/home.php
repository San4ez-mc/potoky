<!DOCTYPE html>
<html lang="uk">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Контент план — Content Planner Bot</title>
    <link rel="stylesheet" href="/style.css">
    <style>
        .content-planner-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            flex-wrap: wrap;
            gap: 10px;
        }

        .date-input {
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-size: 14px;
        }

        .controls {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .table-wrapper {
            overflow-x: auto;
            overflow-y: visible;
            max-height: calc(100vh - 200px);
            position: relative;
            border: 1px solid #e5e5e5;
            border-radius: 8px;
        }

        .content-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            min-width: 1600px;
        }

        .content-table th {
            background: #5a6c7d;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: 600;
            font-size: 13px;
            position: sticky;
            top: 0;
            z-index: 10;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .content-table td {
            padding: 8px;
            border-bottom: 1px solid #e5e5e5;
            vertical-align: top;
            min-width: 150px;
        }

        .date-cell {
            font-weight: 600;
            text-align: center;
            background: #f9fafb;
            border-right: 2px solid #e0e0e0;
        }

        .post-text {
            width: 100%;
            min-height: 120px;
            padding: 6px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 12px;
            resize: vertical;
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow: hidden;
        }

        .mini-btn {
            padding: 5px 8px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            background: #fff;
            cursor: pointer;
            font-size: 12px;
        }

        .mini-btn.save {
            border-color: #52c77a;
            color: #2f855a;
        }

        .mini-btn.delete {
            border-color: #e8675f;
            color: #e8675f;
        }

        .mini-btn.add {
            border-color: #5a6c7d;
            color: #5a6c7d;
        }

        .category-chip {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 6px;
        }

        .muted {
            color: #64748b;
            font-size: 12px;
        }

        .category-cell {
            min-width: 210px;
        }

        .category-meta-form {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px dashed #e2e8f0;
        }

        .category-meta-form.is-disabled {
            opacity: 0.55;
        }

        .category-meta-input {
            width: 100%;
            padding: 6px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 12px;
            box-sizing: border-box;
            background: #fff;
        }

        .category-meta-status {
            min-height: 14px;
        }

        .image-action-row {
            display: flex;
            gap: 6px;
            align-items: stretch;
        }

        .image-run-btn {
            min-width: 40px;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            background: #fff;
            color: #334155;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
        }

        .image-run-btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }

        .image-action-status {
            font-size: 11px;
            color: #64748b;
            min-height: 16px;
            white-space: normal;
            word-break: break-word;
        }

        .image-action-status.error {
            color: #b91c1c;
        }

        .image-action-status.success {
            color: #166534;
        }

        .generation-box {
            margin-top: 6px;
            border: 1px solid #dbeafe;
            background: #f8fbff;
            border-radius: 6px;
            padding: 6px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .generation-row {
            display: flex;
            gap: 6px;
            align-items: center;
        }

        .generation-status {
            font-size: 11px;
            border-radius: 999px;
            padding: 3px 8px;
            width: fit-content;
            border: 1px solid #cbd5e1;
            color: #334155;
            background: #fff;
        }

        .generation-status.is-ready {
            border-color: #86efac;
            background: #f0fdf4;
            color: #166534;
        }

        .generation-status.is-processing,
        .generation-status.is-queued {
            border-color: #bfdbfe;
            background: #eff6ff;
            color: #1d4ed8;
        }

        .generation-status.is-failed {
            border-color: #fecaca;
            background: #fef2f2;
            color: #991b1b;
        }

        .generation-meta {
            font-size: 11px;
            color: #64748b;
            line-height: 1.4;
            word-break: break-word;
        }

        .bulk-generation-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
            margin-bottom: 10px;
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid #dbeafe;
            background: #f8fbff;
        }
    </style>
</head>

<body>
    <?php require __DIR__ . '/components/topbar.php'; ?>

    <div class="container">
        <div style="background:white;border-radius:10px;padding:12px 28px 28px 28px;box-shadow:var(--shadow);">
            <div class="content-planner-header">
                <div>
                    <h2 style="margin:0;">📅 План контенту</h2>
                    <p style="margin:5px 0 0 0; color:#7f8c8d; font-size:14px;">
                        <?php echo htmlspecialchars($projectName, ENT_QUOTES, 'UTF-8'); ?></p>
                </div>
                <form method="GET" action="/" class="controls">
                    <input type="hidden" name="project_id" value="<?php echo $active_project_id; ?>">
                    <label style="margin:0;font-size:13px;color:#7f8c8d;">З:</label>
                    <input type="date" class="date-input" name="date_from"
                        value="<?php echo htmlspecialchars($dateFrom, ENT_QUOTES, 'UTF-8'); ?>">
                    <label style="margin:0;font-size:13px;color:#7f8c8d;">До:</label>
                    <input type="date" class="date-input" name="date_to"
                        value="<?php echo htmlspecialchars($dateTo, ENT_QUOTES, 'UTF-8'); ?>">
                    <button type="submit" class="submit-btn">Застосувати</button>
                </form>
            </div>

            <?php if (empty($enabledNetworks)): ?>
                <div style="padding:16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;">
                    Немає увімкнених соц.мереж. Увімкніть хоча б одну на сторінці "Соц.мережі".
                </div>
            <?php else: ?>
                <?php
                $clientTypeOptions = [
                    'ТИП 1' => 'Не знає про продукт',
                    'ТИП 2' => 'Знає, але думає, що йому не потрібно',
                    'ТИП 3' => 'Знає, але не впевнений, що це найкраще рішення',
                ];
                $categoryLookupById = [];
                $avatarSuggestions = [];
                foreach ($categoryRowsByNetwork as $networkCategories) {
                    foreach ($networkCategories as $categoryRow) {
                        $categoryLookupById[(int) $categoryRow['id']] = $categoryRow;
                        $avatarName = trim((string) ($categoryRow['avatar_name'] ?? ''));
                        if ($avatarName !== '' && !in_array($avatarName, $avatarSuggestions, true)) {
                            $avatarSuggestions[] = $avatarName;
                        }
                    }
                }
                ?>
                <!-- Фільтр видимих колонок мереж -->
                <div id="network-filter"
                    style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px;padding:10px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                    <span style="font-size:13px;color:#475569;font-weight:600;">📱 Показати:</span>
                    <?php foreach ($enabledNetworks as $network): ?>
                        <label
                            style="display:flex;align-items:center;gap:5px;font-size:13px;color:#334155;cursor:pointer;user-select:none;">
                            <input type="checkbox" class="network-vis-cb"
                                data-filter-network-id="<?php echo (int) $network['id']; ?>" checked
                                style="cursor:pointer;width:15px;height:15px;accent-color:#5a6c7d;">
                            <?php echo htmlspecialchars($network['name'], ENT_QUOTES, 'UTF-8'); ?>
                        </label>
                    <?php endforeach; ?>
                </div>

                <div class="bulk-generation-bar">
                    <span style="font-size:12px;color:#334155;font-weight:600;">⚡ Масова генерація:</span>
                    <button type="button" class="mini-btn add" id="bulk-generate-selected">Згенерувати для вибраних (<span
                            id="bulk-selected-count">0</span>)</button>
                    <input type="date" id="bulk-day-input" class="date-input"
                        value="<?php echo htmlspecialchars($dateFrom, ENT_QUOTES, 'UTF-8'); ?>" style="padding:6px 8px;font-size:12px;">
                    <button type="button" class="mini-btn add" id="bulk-generate-day">Згенерувати весь день</button>
                    <span id="bulk-generation-status" class="muted"></span>
                </div>

                <div class="table-wrapper">
                    <table class="content-table">
                        <thead>
                            <tr>
                                <th style="width:7%;text-align:center;">📅 Дата</th>
                                <?php foreach ($enabledNetworks as $network): ?>
                                    <th colspan="2" style="text-align:center;" class="net-header-col"
                                        data-network-id="<?php echo (int) $network['id']; ?>">
                                        <?php echo htmlspecialchars($network['name'], ENT_QUOTES, 'UTF-8'); ?>
                                    </th>
                                <?php endforeach; ?>
                            </tr>
                            <tr style="border-bottom:2px solid #5a6c7d;">
                                <th></th>
                                <?php foreach ($enabledNetworks as $network): ?>
                                    <th style="width:10%;font-size:12px;" class="net-sub-col"
                                        data-network-id="<?php echo (int) $network['id']; ?>">Категорія</th>
                                    <th style="width:45%;font-size:12px;" class="net-sub-col"
                                        data-network-id="<?php echo (int) $network['id']; ?>">Пост</th>
                                <?php endforeach; ?>
                            </tr>
                        </thead>
                        <tbody>
                            <?php
                            $weekdayMap = [1 => 'Понеділок', 2 => 'Вівторок', 3 => 'Середа', 4 => 'Четвер', 5 => 'Пʼятниця', 6 => 'Субота', 7 => 'Неділя'];
                            foreach ($dates as $dateValue):
                                $maxCount = 0;
                                foreach ($enabledNetworks as $network) {
                                    $count = count($postsByDateNetwork[$dateValue][$network['id']] ?? []);
                                    if ($count > $maxCount) {
                                        $maxCount = $count;
                                    }
                                }
                                $rowsForDate = max(1, $maxCount + 1);
                                $dt = new DateTime($dateValue);
                                $dateLabel = $dt->format('d.m.y');
                                $weekdayLabel = $weekdayMap[(int) $dt->format('N')];

                                for ($rowIndex = 0; $rowIndex < $rowsForDate; $rowIndex++):
                                    ?>
                                    <tr>
                                        <?php if ($rowIndex === 0): ?>
                                            <td rowspan="<?php echo $rowsForDate; ?>" class="date-cell">
                                                <?php echo $dateLabel; ?><br>
                                                <small class="muted"><?php echo $weekdayLabel; ?></small>
                                            </td>
                                        <?php endif; ?>

                                        <?php foreach ($enabledNetworks as $network):
                                            $items = $postsByDateNetwork[$dateValue][$network['id']] ?? [];
                                            $postItem = $items[$rowIndex] ?? null;
                                            ?>
                                            <?php if ($postItem): ?>
                                                <td class="net-sub-col category-cell" data-network-id="<?php echo (int) $network['id']; ?>">
                                                    <?php $selectedCategory = $categoryLookupById[(int) ($postItem['category_id'] ?? 0)] ?? null; ?>
                                                    <form method="POST" action="/content-plan/update-post-category" class="category-form"
                                                        data-post-id="<?php echo (int) $postItem['id']; ?>" style="margin:0;">
                                                        <input type="hidden" name="post_id" value="<?php echo (int) $postItem['id']; ?>">
                                                        <input type="hidden" name="date_from"
                                                            value="<?php echo htmlspecialchars($dateFrom, ENT_QUOTES, 'UTF-8'); ?>">
                                                        <input type="hidden" name="date_to"
                                                            value="<?php echo htmlspecialchars($dateTo, ENT_QUOTES, 'UTF-8'); ?>">
                                                        <select name="category_id" class="category-select" data-autosave="true"
                                                            style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;min-width:150px;">
                                                            <option value="">— виберіть —</option>
                                                            <?php foreach (($categoryRowsByNetwork[$network['id']] ?? []) as $cat): ?>
                                                                <option value="<?php echo (int) $cat['id']; ?>"
                                                                    data-client-type="<?php echo htmlspecialchars((string) ($cat['client_type'] ?? ''), ENT_QUOTES, 'UTF-8'); ?>"
                                                                    data-avatar-name="<?php echo htmlspecialchars((string) ($cat['avatar_name'] ?? ''), ENT_QUOTES, 'UTF-8'); ?>"
                                                                    data-avatar-description="<?php echo htmlspecialchars((string) ($cat['avatar_description'] ?? ''), ENT_QUOTES, 'UTF-8'); ?>"
                                                                    <?php echo ((int) $postItem['category_id'] === (int) $cat['id'] ? 'selected' : ''); ?>>
                                                                    <?php echo htmlspecialchars($cat['name'], ENT_QUOTES, 'UTF-8'); ?>
                                                                </option>
                                                            <?php endforeach; ?>
                                                        </select>
                                                    </form>

                                                    <form method="POST" action="/content-plan/update-category-meta"
                                                        class="category-meta-form <?php echo $selectedCategory ? '' : 'is-disabled'; ?>"
                                                        data-category-meta="true" style="margin:0;">
                                                        <input type="hidden" name="category_id" class="category-id-input"
                                                            value="<?php echo (int) ($selectedCategory['id'] ?? 0); ?>">
                                                        <select name="client_type" class="category-meta-input" <?php echo $selectedCategory ? '' : 'disabled'; ?>>
                                                            <option value="">Тип клієнта (не вказано)</option>
                                                            <?php foreach ($clientTypeOptions as $typeValue => $typeDescription): ?>
                                                                <option value="<?php echo htmlspecialchars($typeValue, ENT_QUOTES, 'UTF-8'); ?>"
                                                                    <?php echo (($selectedCategory['client_type'] ?? '') === $typeValue) ? 'selected' : ''; ?>>
                                                                    <?php echo htmlspecialchars($typeValue . ' — ' . $typeDescription, ENT_QUOTES, 'UTF-8'); ?>
                                                                </option>
                                                            <?php endforeach; ?>
                                                        </select>
                                                        <input type="text" name="avatar_name" class="category-meta-input"
                                                            list="contentPlanAvatarSuggestions"
                                                            value="<?php echo htmlspecialchars((string) ($selectedCategory['avatar_name'] ?? ''), ENT_QUOTES, 'UTF-8'); ?>"
                                                            placeholder="Аватар (напр. Віктор)" <?php echo $selectedCategory ? '' : 'disabled'; ?>>
                                                        <input type="text" name="avatar_description" class="category-meta-input"
                                                            value="<?php echo htmlspecialchars((string) ($selectedCategory['avatar_description'] ?? ''), ENT_QUOTES, 'UTF-8'); ?>"
                                                            placeholder="Короткий опис аватара" <?php echo $selectedCategory ? '' : 'disabled'; ?>>
                                                        <div class="category-meta-status muted"></div>
                                                    </form>
                                                </td>
                                                <td class="net-sub-col" data-network-id="<?php echo (int) $network['id']; ?>">
                                                    <div style="display:flex; gap:6px; align-items:flex-start;">
                                                        <input type="checkbox" class="media-select-post"
                                                            data-post-id="<?php echo (int) $postItem['id']; ?>"
                                                            data-post-date="<?php echo htmlspecialchars($dateValue, ENT_QUOTES, 'UTF-8'); ?>"
                                                            title="Виділити для масової генерації"
                                                            style="margin-top:6px; width:14px; height:14px; cursor:pointer; accent-color:#2563eb;">
                                                        <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
                                                            <!-- Превью картинки -->
                                                            <?php if (!empty($postItem['image_path'])): ?>
                                                                <div style="position:relative; width:100%; max-width:200px;">
                                                                    <?php
                                                                    $rawImagePath = (string) $postItem['image_path'];
                                                                    if (preg_match('/^https?:\/\//i', $rawImagePath)) {
                                                                        $imageSrc = $rawImagePath;
                                                                    } elseif (strpos($rawImagePath, '/uploads/') === 0) {
                                                                        $imageSrc = $rawImagePath;
                                                                    } else {
                                                                        $imageSrc = '/uploads/images/' . rawurlencode(basename($rawImagePath));
                                                                    }
                                                                    ?>
                                                                    <img src="<?php echo htmlspecialchars($imageSrc, ENT_QUOTES, 'UTF-8'); ?>"
                                                                        alt="Post image"
                                                                        style="width:100%; height:auto; border-radius:6px; border:1px solid #d1d5db;">
                                                                    <form method="POST" action="/content-plan/delete-post-image"
                                                                        style="position:absolute; top:4px; right:4px;">
                                                                        <input type="hidden" name="post_id"
                                                                            value="<?php echo (int) $postItem['id']; ?>">
                                                                        <input type="hidden" name="date_from"
                                                                            value="<?php echo htmlspecialchars($dateFrom, ENT_QUOTES, 'UTF-8'); ?>">
                                                                        <input type="hidden" name="date_to"
                                                                            value="<?php echo htmlspecialchars($dateTo, ENT_QUOTES, 'UTF-8'); ?>">
                                                                        <button type="submit"
                                                                            style="background:#ff4444; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:12px;">✕
                                                                            Видалити</button>
                                                                    </form>
                                                                </div>
                                                            <?php endif; ?>

                                                            <!-- Тип поста -->
                                                            <div style="margin-top:4px;">
                                                                <?php $postTypeValue = (string) ($postItem['post_type'] ?? ''); ?>
                                                                <select class="post-type-select"
                                                                    data-post-id="<?php echo (int) $postItem['id']; ?>"
                                                                    style="width:100%; padding:6px; border:1px solid #d1d5db; border-radius:4px; font-size:12px; box-sizing:border-box;">
                                                                    <option value="" <?php echo ($postTypeValue === '' ? 'selected' : ''); ?>>
                                                                        📄 Тип поста (опціонально)</option>
                                                                    <option value="Карусель" <?php echo ($postTypeValue === 'Карусель' ? 'selected' : ''); ?>>🎠 Карусель</option>
                                                                    <option value="Сторіз" <?php echo ($postTypeValue === 'Сторіз' ? 'selected' : ''); ?>>📱 Сторіз</option>
                                                                    <option value="Reels" <?php echo ($postTypeValue === 'Reels' ? 'selected' : ''); ?>>🎬 Reels</option>
                                                                    <option value="Shorts" <?php echo ($postTypeValue === 'Shorts' ? 'selected' : ''); ?>>⚡ Shorts</option>
                                                                    <option value="Thread" <?php echo ($postTypeValue === 'Thread' ? 'selected' : ''); ?>>🧵 Thread</option>
                                                                </select>
                                                            </div>

                                                            <!-- Textarea з текстом -->
                                                            <form method="POST" action="/content-plan/save-post" class="post-form"
                                                                data-post-id="<?php echo (int) $postItem['id']; ?>" style="flex:1;">
                                                                <input type="hidden" name="post_id"
                                                                    value="<?php echo (int) $postItem['id']; ?>">
                                                                <input type="hidden" name="date_from"
                                                                    value="<?php echo htmlspecialchars($dateFrom, ENT_QUOTES, 'UTF-8'); ?>">
                                                                <input type="hidden" name="date_to"
                                                                    value="<?php echo htmlspecialchars($dateTo, ENT_QUOTES, 'UTF-8'); ?>">
                                                                <textarea name="post_text" class="post-text"
                                                                    data-autosave="true"><?php echo htmlspecialchars($postItem['text'] ?? '', ENT_QUOTES, 'UTF-8'); ?></textarea>
                                                            </form>

                                                            <!-- Завантаження картинки -->
                                                            <form method="POST" action="/content-plan/update-post-image"
                                                                class="image-upload-form" enctype="multipart/form-data"
                                                                style="display:flex; gap:4px; align-items:center; margin-top:4px;">
                                                                <input type="hidden" name="post_id"
                                                                    value="<?php echo (int) $postItem['id']; ?>">
                                                                <input type="hidden" name="date_from"
                                                                    value="<?php echo htmlspecialchars($dateFrom, ENT_QUOTES, 'UTF-8'); ?>">
                                                                <input type="hidden" name="date_to"
                                                                    value="<?php echo htmlspecialchars($dateTo, ENT_QUOTES, 'UTF-8'); ?>">
                                                                <label style="font-size:11px; color:#64748b;">📤 Картинка:</label>
                                                                <input type="file" name="image" accept="image/*" class="image-upload-input"
                                                                    data-autosave="true"
                                                                    style="font-size:11px; flex:1; padding:4px; border:1px solid #d1d5db; border-radius:4px;">
                                                            </form>
                                                            <div class="image-upload-status muted"
                                                                data-post-id="<?php echo (int) $postItem['id']; ?>"
                                                                style="min-height:14px;"></div>

                                                            <!-- Текст на фото -->
                                                            <div style="margin-top:4px;">
                                                                <input type="text" class="image-text-input"
                                                                    placeholder="💬 Текст на фото (опціонально)"
                                                                    value="<?php echo htmlspecialchars($postItem['image_text'] ?? '', ENT_QUOTES, 'UTF-8'); ?>"
                                                                    data-post-id="<?php echo (int) $postItem['id']; ?>"
                                                                    style="width:100%; padding:6px; border:1px solid #d1d5db; border-radius:4px; font-size:12px; box-sizing:border-box;">
                                                            </div>

                                                            <!-- Промпт для генерації -->
                                                            <div style="margin-top:4px;">
                                                                <textarea class="image-prompt-input"
                                                                    placeholder="🎯 Промпт для зображення (опціонально, якщо пусто — генерується авто)"
                                                                    data-post-id="<?php echo (int) $postItem['id']; ?>"
                                                                    style="width:100%; min-height:58px; padding:6px; border:1px solid #d1d5db; border-radius:4px; font-size:12px; box-sizing:border-box; resize:vertical;"><?php echo htmlspecialchars($postItem['image_prompt'] ?? '', ENT_QUOTES, 'UTF-8'); ?></textarea>
                                                            </div>

                                                            <!-- Тип зображення -->
                                                            <div style="margin-top:4px;">
                                                                <?php $imageTypeValue = (string) ($postItem['image_type'] ?? ''); ?>
                                                                <select class="image-type-input"
                                                                    data-post-id="<?php echo (int) $postItem['id']; ?>"
                                                                    style="width:100%; padding:6px; border:1px solid #d1d5db; border-radius:4px; font-size:12px; box-sizing:border-box;">
                                                                    <option value="">🏷️ Тип зображення (опціонально)</option>
                                                                    <option value="З персонажем" <?php echo ($imageTypeValue === 'З персонажем' ? 'selected' : ''); ?>>
                                                                        З персонажем
                                                                    </option>
                                                                    <option value="Без персонажа" <?php echo ($imageTypeValue === 'Без персонажа' ? 'selected' : ''); ?>>
                                                                        Без персонажа
                                                                    </option>
                                                                </select>
                                                            </div>

                                                            <!-- Випадаючий список дії з картинкою -->
                                                            <form method="POST" action="/content-plan/update-image-action"
                                                                class="image-action-form"
                                                                style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
                                                                <input type="hidden" name="post_id"
                                                                    value="<?php echo (int) $postItem['id']; ?>">
                                                                <input type="hidden" name="date_from"
                                                                    value="<?php echo htmlspecialchars($dateFrom, ENT_QUOTES, 'UTF-8'); ?>">
                                                                <input type="hidden" name="date_to"
                                                                    value="<?php echo htmlspecialchars($dateTo, ENT_QUOTES, 'UTF-8'); ?>">
                                                                <div class="image-action-row">
                                                                    <select name="image_action" class="image-action-select"
                                                                        data-post-id="<?php echo (int) $postItem['id']; ?>"
                                                                        style="width:100%; padding:6px; border:1px solid #d1d5db; border-radius:4px; font-size:12px; cursor:pointer;">
                                                                        <option value="nothing" <?php echo (($postItem['image_action'] ?? 'nothing') === 'nothing' ? 'selected' : ''); ?>>
                                                                            🚫 Нічого не робити
                                                                        </option>
                                                                        <option value="auto_generate" <?php echo (($postItem['image_action'] ?? '') === 'auto_generate' ? 'selected' : ''); ?>>
                                                                            ✨ Згенерувати зображення
                                                                        </option>
                                                                        <option value="generate_from_source_folder" <?php echo (($postItem['image_action'] ?? '') === 'generate_from_source_folder' ? 'selected' : ''); ?>>
                                                                            🖼️ На основі зображення з папки
                                                                        </option>
                                                                        <option value="overlay_text" <?php echo (($postItem['image_action'] ?? '') === 'overlay_text' ? 'selected' : ''); ?>>
                                                                            📝 Накласти текст на зображення
                                                                        </option>
                                                                    </select>
                                                                    <button type="button" class="image-run-btn"
                                                                        data-post-id="<?php echo (int) $postItem['id']; ?>"
                                                                        title="Запустити обрану дію">▶</button>
                                                                </div>
                                                                <div class="image-action-status"
                                                                    data-post-id="<?php echo (int) $postItem['id']; ?>"></div>
                                                            </form>

                                                            <?php
                                                            $genStatusRaw = trim((string) ($postItem['generation_status'] ?? 'not_generated'));
                                                            $genOutputUrl = trim((string) ($postItem['generation_output_url'] ?? ''));
                                                            $genErrorText = trim((string) ($postItem['generation_error'] ?? ''));
                                                            $avatarEngine = trim((string) ($postItem['avatar_engine'] ?? ''));

                                                            $statusLabelMap = [
                                                                'not_generated' => 'Не згенеровано',
                                                                'queued' => 'В черзі ШІ...',
                                                                'processing' => 'В обробці...',
                                                                'ready' => 'Готово',
                                                                'generated' => 'Готово',
                                                                'failed' => 'Помилка',
                                                            ];
                                                            $statusLabel = $statusLabelMap[$genStatusRaw] ?? 'Не згенеровано';
                                                            $statusCss = 'generation-status';
                                                            if (in_array($genStatusRaw, ['ready', 'generated'], true)) {
                                                                $statusCss .= ' is-ready';
                                                            } elseif (in_array($genStatusRaw, ['queued', 'processing'], true)) {
                                                                $statusCss .= ' is-' . $genStatusRaw;
                                                            } elseif ($genStatusRaw === 'failed') {
                                                                $statusCss .= ' is-failed';
                                                            }
                                                            ?>
                                                            <div class="generation-box" data-generation-box="<?php echo (int) $postItem['id']; ?>">
                                                                <div class="generation-row">
                                                                    <button type="button" class="mini-btn add generate-media-btn"
                                                                        data-post-id="<?php echo (int) $postItem['id']; ?>">⚡ Згенерувати медіа</button>
                                                                    <span class="<?php echo htmlspecialchars($statusCss, ENT_QUOTES, 'UTF-8'); ?>"
                                                                        data-generation-status="<?php echo (int) $postItem['id']; ?>"
                                                                        data-status-raw="<?php echo htmlspecialchars($genStatusRaw, ENT_QUOTES, 'UTF-8'); ?>"><?php echo htmlspecialchars($statusLabel, ENT_QUOTES, 'UTF-8'); ?></span>
                                                                </div>
                                                                <select class="generation-avatar-engine-select"
                                                                    data-post-id="<?php echo (int) $postItem['id']; ?>"
                                                                    style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;">
                                                                    <option value="" <?php echo ($avatarEngine === '' ? 'selected' : ''); ?>>Графіка: Без фото</option>
                                                                    <option value="heygen" <?php echo ($avatarEngine === 'heygen' ? 'selected' : ''); ?>>Мій Аватар: HeyGen</option>
                                                                    <option value="liveportrait" <?php echo (in_array($avatarEngine, ['liveportrait', 'replicate_liveportrait'], true) ? 'selected' : ''); ?>>Мій Аватар: LivePortrait</option>
                                                                </select>
                                                                <div class="generation-meta" data-generation-meta="<?php echo (int) $postItem['id']; ?>">
                                                                    <?php if ($genOutputUrl !== ''): ?>
                                                                        <a href="<?php echo htmlspecialchars($genOutputUrl, ENT_QUOTES, 'UTF-8'); ?>" target="_blank"
                                                                            rel="noopener noreferrer">Відкрити згенероване медіа</a>
                                                                    <?php elseif ($genErrorText !== ''): ?>
                                                                        <?php echo htmlspecialchars($genErrorText, ENT_QUOTES, 'UTF-8'); ?>
                                                                    <?php else: ?>
                                                                        Немає активної генерації.
                                                                    <?php endif; ?>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <form method="POST" action="/content-plan/delete-post" style="margin:0;">
                                                            <input type="hidden" name="post_id"
                                                                value="<?php echo (int) $postItem['id']; ?>">
                                                            <input type="hidden" name="date_from"
                                                                value="<?php echo htmlspecialchars($dateFrom, ENT_QUOTES, 'UTF-8'); ?>">
                                                            <input type="hidden" name="date_to"
                                                                value="<?php echo htmlspecialchars($dateTo, ENT_QUOTES, 'UTF-8'); ?>">
                                                            <button type="submit" class="mini-btn delete" title="Видалити пост"
                                                                onclick="return confirm('Видалити цей пост?')">🗑️</button>
                                                        </form>
                                                    </div>
                                                </td>
                                            <?php else: ?>
                                                <?php $draftKey = 'draft_' . (int) $network['id'] . '_' . str_replace('-', '', $dateValue) . '_' . (int) $rowIndex; ?>
                                                <td class="net-sub-col category-cell" data-network-id="<?php echo (int) $network['id']; ?>">
                                                    <select class="new-post-category"
                                                        data-draft-key="<?php echo htmlspecialchars($draftKey, ENT_QUOTES, 'UTF-8'); ?>"
                                                        style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;min-width:150px;">
                                                        <option value="">— виберіть —</option>
                                                        <?php foreach (($categoryRowsByNetwork[$network['id']] ?? []) as $cat): ?>
                                                            <option value="<?php echo (int) $cat['id']; ?>"
                                                                data-client-type="<?php echo htmlspecialchars((string) ($cat['client_type'] ?? ''), ENT_QUOTES, 'UTF-8'); ?>"
                                                                data-avatar-name="<?php echo htmlspecialchars((string) ($cat['avatar_name'] ?? ''), ENT_QUOTES, 'UTF-8'); ?>"
                                                                data-avatar-description="<?php echo htmlspecialchars((string) ($cat['avatar_description'] ?? ''), ENT_QUOTES, 'UTF-8'); ?>">
                                                                <?php echo htmlspecialchars($cat['name'], ENT_QUOTES, 'UTF-8'); ?>
                                                            </option>
                                                        <?php endforeach; ?>
                                                    </select>

                                                    <form method="POST" action="/content-plan/update-category-meta"
                                                        class="category-meta-form is-disabled" data-category-meta="true"
                                                        data-draft-key="<?php echo htmlspecialchars($draftKey, ENT_QUOTES, 'UTF-8'); ?>"
                                                        style="margin:0;">
                                                        <input type="hidden" name="category_id" class="category-id-input" value="">
                                                        <select name="client_type" class="category-meta-input" disabled>
                                                            <option value="">Тип клієнта (не вказано)</option>
                                                            <?php foreach ($clientTypeOptions as $typeValue => $typeDescription): ?>
                                                                <option
                                                                    value="<?php echo htmlspecialchars($typeValue, ENT_QUOTES, 'UTF-8'); ?>">
                                                                    <?php echo htmlspecialchars($typeValue . ' — ' . $typeDescription, ENT_QUOTES, 'UTF-8'); ?>
                                                                </option>
                                                            <?php endforeach; ?>
                                                        </select>
                                                        <input type="text" name="avatar_name" class="category-meta-input"
                                                            list="contentPlanAvatarSuggestions" value="" placeholder="Аватар (напр. Віктор)"
                                                            disabled>
                                                        <input type="text" name="avatar_description" class="category-meta-input" value=""
                                                            placeholder="Короткий опис аватара" disabled>
                                                        <div class="category-meta-status muted"></div>
                                                    </form>
                                                </td>
                                                <td class="net-sub-col" data-network-id="<?php echo (int) $network['id']; ?>">
                                                    <div style="display:flex; flex-direction:column; gap:6px;">
                                                        <form method="POST" action="/content-plan/create-post" class="new-post-form"
                                                            data-draft-key="<?php echo htmlspecialchars($draftKey, ENT_QUOTES, 'UTF-8'); ?>"
                                                            style="margin:0;">
                                                            <input type="hidden" name="network_id"
                                                                value="<?php echo (int) $network['id']; ?>">
                                                            <input type="hidden" name="post_date"
                                                                value="<?php echo htmlspecialchars($dateValue, ENT_QUOTES, 'UTF-8'); ?>">
                                                            <input type="hidden" name="date_from"
                                                                value="<?php echo htmlspecialchars($dateFrom, ENT_QUOTES, 'UTF-8'); ?>">
                                                            <input type="hidden" name="date_to"
                                                                value="<?php echo htmlspecialchars($dateTo, ENT_QUOTES, 'UTF-8'); ?>">
                                                            <input type="hidden" name="category_id" class="new-post-category-hidden"
                                                                value="">
                                                            <textarea name="post_text" class="post-text new-post-text"
                                                                data-autocreate="true"
                                                                data-draft-key="<?php echo htmlspecialchars($draftKey, ENT_QUOTES, 'UTF-8'); ?>"
                                                                placeholder="Введіть текст поста..."></textarea>
                                                        </form>

                                                        <!-- Підказки для нових полів (стануть активними після створення поста) -->
                                                        <div style="opacity:0.5; pointer-events:none;">
                                                            <div style="font-size:11px; color:#64748b; margin-top:4px;">
                                                                📤 Картинка (доступна після створення поста)
                                                            </div>
                                                            <div style="font-size:11px; color:#64748b; margin-top:4px;">
                                                                💬 Текст на фото (доступний після створення поста)
                                                            </div>
                                                            <div style="font-size:11px; color:#64748b; margin-top:4px;">
                                                                🎯 Промпт для зображення (доступний після створення поста)
                                                            </div>
                                                            <div style="font-size:11px; color:#64748b; margin-top:4px;">
                                                                ✨ Генерація / створення на основі папки (доступно після створення поста)
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            <?php endif; ?>
                                        <?php endforeach; ?>
                                    </tr>
                                    <?php
                                endfor;
                            endforeach;
                            ?>
                        </tbody>
                    </table>
                </div>

                <datalist id="contentPlanAvatarSuggestions">
                    <?php foreach ($avatarSuggestions as $avatarName): ?>
                        <option value="<?php echo htmlspecialchars($avatarName, ENT_QUOTES, 'UTF-8'); ?>"></option>
                    <?php endforeach; ?>
                </datalist>
            <?php endif; ?>

            <div
                style="margin-top:20px;padding:14px;background:#ecf0f6;border-radius:8px;border-left:4px solid #5a6c7d;font-size:13px;">
                <strong>💡 Як це працює:</strong> У кожній даті та колонці мережі доступна кнопка додавання категорії.
                Біля кожної доданої категорії є іконка видалення. Редагування тексту поста зберігається в БД.
            </div>
        </div>
    </div>

    <script>
        // Автоматичне розтягування textarea під текст
        function autoResize(textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        }

        document.addEventListener('DOMContentLoaded', function () {
            function updateCategoryOptionsMetadata(categoryId, metadata) {
                if (!categoryId) return;
                document.querySelectorAll('option[value="' + categoryId + '"]').forEach(function (option) {
                    option.dataset.clientType = metadata.clientType || '';
                    option.dataset.avatarName = metadata.avatarName || '';
                    option.dataset.avatarDescription = metadata.avatarDescription || '';
                });
            }

            function setCategoryMetaFormState(metaForm, enabled) {
                if (!metaForm) return;
                metaForm.classList.toggle('is-disabled', !enabled);
                metaForm.querySelectorAll('.category-meta-input').forEach(function (input) {
                    input.disabled = !enabled;
                    if (!enabled) {
                        if (input.tagName === 'SELECT') {
                            input.value = '';
                        } else {
                            input.value = '';
                        }
                    }
                });
                const categoryIdInput = metaForm.querySelector('.category-id-input');
                if (categoryIdInput && !enabled) {
                    categoryIdInput.value = '';
                }
                const status = metaForm.querySelector('.category-meta-status');
                if (status && !enabled) {
                    status.textContent = '';
                }
            }

            function fillCategoryMetaForm(metaForm, option) {
                if (!metaForm) return;
                if (!option || !option.value) {
                    setCategoryMetaFormState(metaForm, false);
                    return;
                }

                const categoryIdInput = metaForm.querySelector('.category-id-input');
                const clientTypeInput = metaForm.querySelector('select[name="client_type"]');
                const avatarNameInput = metaForm.querySelector('input[name="avatar_name"]');
                const avatarDescriptionInput = metaForm.querySelector('input[name="avatar_description"]');

                if (categoryIdInput) categoryIdInput.value = option.value;
                if (clientTypeInput) clientTypeInput.value = option.dataset.clientType || '';
                if (avatarNameInput) avatarNameInput.value = option.dataset.avatarName || '';
                if (avatarDescriptionInput) avatarDescriptionInput.value = option.dataset.avatarDescription || '';

                setCategoryMetaFormState(metaForm, true);
            }

            function mapUploadError(errorCode) {
                const map = {
                    file_too_large: 'Файл завеликий (макс. 15MB)',
                    file_too_large_ini: 'Файл завеликий для налаштувань сервера (upload_max_filesize)',
                    file_too_large_form: 'Файл завеликий для форми',
                    unsupported_file_type: 'Непідтримуваний формат файлу',
                    upload_partial: 'Файл завантажено частково, спробуйте ще раз',
                    no_file: 'Файл не обрано',
                    server_no_tmp_dir: 'На сервері відсутня тимчасова папка',
                    server_cant_write: 'Сервер не може записати файл',
                    upload_blocked_extension: 'Завантаження заблоковане розширенням PHP',
                    upload_failed: 'Не вдалося завантажити файл'
                };
                return map[errorCode] || ('Помилка: ' + (errorCode || 'невідома'));
            }

            const textareas = document.querySelectorAll('.post-text');
            const saveTimeouts = new Map();

            textareas.forEach(function (textarea) {
                autoResize(textarea);
                textarea.addEventListener('input', function () {
                    autoResize(this);
                });

                if (textarea.hasAttribute('data-autosave')) {
                    textarea.addEventListener('input', function () {
                        const form = this.closest('form.post-form');
                        if (!form) return;
                        const postId = form.getAttribute('data-post-id');
                        if (saveTimeouts.has(postId)) {
                            clearTimeout(saveTimeouts.get(postId));
                        }
                        const timeoutId = setTimeout(function () {
                            const formData = new FormData(form);
                            fetch('/content-plan/save-post', { method: 'POST', body: formData })
                                .then(response => { if (!response.ok) console.error('Помилка збереження:', response.status); })
                                .catch(error => console.error('Помилка збереження:', error));
                        }, 1000);
                        saveTimeouts.set(postId, timeoutId);
                    });

                    textarea.addEventListener('blur', function () {
                        const form = this.closest('form.post-form');
                        if (!form) return;
                        const postId = form.getAttribute('data-post-id');
                        if (saveTimeouts.has(postId)) {
                            clearTimeout(saveTimeouts.get(postId));
                            saveTimeouts.delete(postId);
                        }
                        const formData = new FormData(form);
                        fetch('/content-plan/save-post', { method: 'POST', body: formData })
                            .then(response => { if (!response.ok) console.error('Помилка збереження:', response.status); })
                            .catch(error => console.error('Помилка збереження:', error));
                    });
                }
            });

            // Автозбереження категорій
            const categorySelects = document.querySelectorAll('.category-select[data-autosave="true"]');
            categorySelects.forEach(function (select) {
                const categoryCell = select.closest('.category-cell');
                const metaForm = categoryCell ? categoryCell.querySelector('.category-meta-form[data-category-meta="true"]') : null;
                fillCategoryMetaForm(metaForm, select.options[select.selectedIndex] || null);

                select.addEventListener('change', function () {
                    const form = this.closest('form.category-form');
                    if (!form) return;
                    fillCategoryMetaForm(metaForm, this.options[this.selectedIndex] || null);
                    const formData = new FormData(form);
                    fetch('/content-plan/update-post-category', { method: 'POST', body: formData })
                        .then(response => { if (!response.ok) console.error('Помилка оновлення категорії:', response.status); })
                        .catch(error => console.error('Помилка оновлення категорії:', error));
                });
            });

            const categoryMetaTimeouts = new WeakMap();
            const categoryMetaForms = document.querySelectorAll('.category-meta-form[data-category-meta="true"]');
            const saveCategoryMeta = function (metaForm) {
                if (!metaForm) return;
                const categoryId = metaForm.querySelector('.category-id-input')?.value || '';
                if (!categoryId) return;

                const status = metaForm.querySelector('.category-meta-status');
                if (status) {
                    status.textContent = 'Зберігаю...';
                }

                const formData = new FormData(metaForm);
                fetch('/content-plan/update-category-meta', { method: 'POST', body: formData })
                    .then(response => response.json())
                    .then(data => {
                        if (!data || !data.ok) {
                            throw new Error((data && data.error) ? data.error : 'save_failed');
                        }

                        const metadata = {
                            clientType: metaForm.querySelector('select[name="client_type"]')?.value || '',
                            avatarName: metaForm.querySelector('input[name="avatar_name"]')?.value || '',
                            avatarDescription: metaForm.querySelector('input[name="avatar_description"]')?.value || ''
                        };
                        updateCategoryOptionsMetadata(categoryId, metadata);

                        if (status) {
                            status.textContent = 'Збережено';
                        }
                    })
                    .catch(error => {
                        console.error('Помилка збереження метаданих категорії:', error);
                        if (status) {
                            status.textContent = 'Помилка збереження';
                        }
                    });
            };

            categoryMetaForms.forEach(function (metaForm) {
                metaForm.querySelectorAll('.category-meta-input').forEach(function (input) {
                    const scheduleSave = function () {
                        if (input.disabled) return;
                        if (categoryMetaTimeouts.has(metaForm)) {
                            clearTimeout(categoryMetaTimeouts.get(metaForm));
                        }
                        const timeoutId = setTimeout(function () {
                            saveCategoryMeta(metaForm);
                        }, input.tagName === 'SELECT' ? 150 : 700);
                        categoryMetaTimeouts.set(metaForm, timeoutId);
                    };

                    input.addEventListener('input', scheduleSave);
                    input.addEventListener('change', scheduleSave);
                    input.addEventListener('blur', function () {
                        if (categoryMetaTimeouts.has(metaForm)) {
                            clearTimeout(categoryMetaTimeouts.get(metaForm));
                            categoryMetaTimeouts.delete(metaForm);
                        }
                        if (!input.disabled) {
                            saveCategoryMeta(metaForm);
                        }
                    });
                });
            });

            // Обробник дій з картинкою
            const imageActionSelects = document.querySelectorAll('.image-action-select');
            const runnableImageActions = ['auto_generate', 'generate_from_source_folder', 'overlay_text'];

            function updateImageRunButtonState(form) {
                if (!form) return;
                const select = form.querySelector('.image-action-select');
                const button = form.querySelector('.image-run-btn');
                if (!select || !button) return;
                button.disabled = !runnableImageActions.includes(select.value);
            }

            imageActionSelects.forEach(function (select) {
                const form = select.closest('form.image-action-form');
                updateImageRunButtonState(form);
                select.addEventListener('change', function () {
                    const form = this.closest('form');
                    if (!form) return;
                    const formData = new FormData(form);
                    fetch('/content-plan/update-image-action', { method: 'POST', body: formData })
                        .then(response => { if (!response.ok) console.error('Помилка оновлення дії:', response.status); })
                        .catch(error => console.error('Помилка оновлення дії:', error));
                    updateImageRunButtonState(form);
                });
            });

            const imageRunButtons = document.querySelectorAll('.image-run-btn');
            imageRunButtons.forEach(function (button) {
                button.addEventListener('click', function () {
                    const form = this.closest('form.image-action-form');
                    if (!form) return;
                    const select = form.querySelector('.image-action-select');
                    const status = form.querySelector('.image-action-status');
                    const postId = this.getAttribute('data-post-id');
                    if (!select || !runnableImageActions.includes(select.value)) return;

                    this.disabled = true;
                    this.textContent = '⏳';
                    if (status) {
                        status.textContent = 'Виконую дію...';
                        status.classList.remove('error', 'success');
                    }

                    const formData = new FormData();
                    formData.append('post_id', postId);
                    formData.append('image_action', select.value);

                    fetch('/content-plan/run-image-action', { method: 'POST', body: formData })
                        .then(response => response.json())
                        .then(data => {
                            if (!data || !data.ok) throw new Error(data && data.error ? data.error : 'Помилка виконання дії');
                            if (status) {
                                const sourceInfo = data.source_filename ? ' Джерело: ' + data.source_filename : '';
                                status.textContent = (data.message || 'Готово') + ' ✅' + sourceInfo;
                                status.classList.remove('error');
                                status.classList.add('success');
                            }
                            setTimeout(() => window.location.reload(), 1800);
                        })
                        .catch(error => {
                            console.error('Помилка запуску дії:', error);
                            if (status) {
                                status.textContent = error.message || 'Помилка запуску';
                                status.classList.remove('success');
                                status.classList.add('error');
                            }
                        })
                        .finally(() => {
                            button.textContent = '▶';
                            updateImageRunButtonState(form);
                        });
                });
            });

            // Автозавантаження картинки при виборі файлу
            const imageInputs = document.querySelectorAll('.image-upload-input[data-autosave="true"]');
            imageInputs.forEach(function (input) {
                input.addEventListener('change', function () {
                    if (!this.files || this.files.length === 0) return;
                    const form = this.closest('form.image-upload-form');
                    if (!form) return;
                    const postId = form.querySelector('input[name="post_id"]')?.value || '';
                    const status = document.querySelector('.image-upload-status[data-post-id="' + postId + '"]');
                    if (status) { status.textContent = 'Завантажую...'; status.style.color = '#64748b'; }

                    const formData = new FormData(form);
                    fetch('/content-plan/update-post-image', {
                        method: 'POST',
                        headers: { 'X-Requested-With': 'XMLHttpRequest' },
                        body: formData
                    })
                        .then(response => response.json())
                        .then(data => {
                            if (!data || !data.ok) {
                                if (status) { status.textContent = mapUploadError(data && data.error ? data.error : 'unknown_error'); status.style.color = '#b91c1c'; }
                                return;
                            }
                            if (status) { status.textContent = 'Збережено ✅'; status.style.color = '#166634'; }
                            window.location.reload();
                        })
                        .catch(error => {
                            console.error('Помилка завантаження картинки:', error);
                            if (status) { status.textContent = 'Помилка мережі ❌'; status.style.color = '#b91c1c'; }
                        });
                });
            });

            // Синхронізація категорії для порожніх слотів
            const newPostCategorySelects = document.querySelectorAll('.new-post-category');
            newPostCategorySelects.forEach(function (select) {
                const draftKey = select.getAttribute('data-draft-key');
                const hidden = document.querySelector('.new-post-form[data-draft-key="' + draftKey + '"] .new-post-category-hidden');
                const metaForm = document.querySelector('.category-meta-form[data-draft-key="' + draftKey + '"]');
                if (!hidden) return;
                hidden.value = select.value || '';
                fillCategoryMetaForm(metaForm, select.options[select.selectedIndex] || null);
                select.addEventListener('change', function () {
                    hidden.value = this.value || '';
                    fillCategoryMetaForm(metaForm, this.options[this.selectedIndex] || null);
                });
            });

            // Автостворення поста для порожнього слоту
            const newPostTimeouts = new Map();
            const newPostTextareas = document.querySelectorAll('.new-post-text[data-autocreate="true"]');
            newPostTextareas.forEach(function (textarea) {
                const draftKey = textarea.getAttribute('data-draft-key') || '';

                const submitNewPost = function () {
                    const form = textarea.closest('form.new-post-form');
                    if (!form) return;
                    const textValue = (textarea.value || '').trim();
                    const categoryValue = (form.querySelector('.new-post-category-hidden')?.value || '').trim();
                    if (textValue === '' && categoryValue === '') return;
                    const formData = new FormData(form);
                    fetch('/content-plan/create-post', {
                        method: 'POST',
                        headers: { 'X-Requested-With': 'XMLHttpRequest' },
                        body: formData
                    })
                        .then(response => response.json())
                        .then(data => { if (!data || !data.ok) { console.error('Помилка створення поста'); return; } window.location.reload(); })
                        .catch(error => console.error('Помилка створення поста:', error));
                };

                textarea.addEventListener('input', function () {
                    autoResize(this);
                    if (newPostTimeouts.has(draftKey)) clearTimeout(newPostTimeouts.get(draftKey));
                    newPostTimeouts.set(draftKey, setTimeout(submitNewPost, 900));
                });

                textarea.addEventListener('blur', function () {
                    if (newPostTimeouts.has(draftKey)) { clearTimeout(newPostTimeouts.get(draftKey)); newPostTimeouts.delete(draftKey); }
                    submitNewPost();
                });
            });

            // Текст на фото
            const imageTextInputs = document.querySelectorAll('.image-text-input');
            imageTextInputs.forEach(function (input) {
                let debounceTimer;
                input.addEventListener('input', function () {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        const postId = this.getAttribute('data-post-id');
                        const formData = new FormData();
                        formData.append('post_id', postId);
                        formData.append('image_text', this.value);
                        fetch('/content-plan/update-image-text', { method: 'POST', body: formData })
                            .then(r => r.json())
                            .catch(e => console.error('Помилка збереження тексту на фото:', e));
                    }, 1000);
                });
            });

            // Промпт для зображення
            const imagePromptInputs = document.querySelectorAll('.image-prompt-input');
            imagePromptInputs.forEach(function (input) {
                let debounceTimer;
                input.addEventListener('input', function () {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        const postId = this.getAttribute('data-post-id');
                        const formData = new FormData();
                        formData.append('post_id', postId);
                        formData.append('image_prompt', this.value);
                        fetch('/content-plan/update-image-prompt', { method: 'POST', body: formData })
                            .then(r => r.json())
                            .catch(e => console.error('Помилка збереження промпта:', e));
                    }, 1000);
                });
            });

            // Тип зображення
            const imageTypeInputs = document.querySelectorAll('.image-type-input');
            imageTypeInputs.forEach(function (input) {
                let debounceTimer;
                const saveImageType = function () {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        const postId = this.getAttribute('data-post-id');
                        const formData = new FormData();
                        formData.append('post_id', postId);
                        formData.append('image_type', this.value);
                        fetch('/content-plan/update-image-type', { method: 'POST', body: formData })
                            .then(r => r.json())
                            .catch(e => console.error('Помилка збереження типу зображення:', e));
                    }, 1000);
                };
                input.addEventListener('change', saveImageType);
                input.addEventListener('input', saveImageType);
            });

            // Тип поста
            const postTypeSelects = document.querySelectorAll('.post-type-select');
            postTypeSelects.forEach(function (select) {
                select.addEventListener('change', function () {
                    const postId = this.getAttribute('data-post-id');
                    const formData = new FormData();
                    formData.append('post_id', postId);
                    formData.append('post_type', this.value);
                    fetch('/content-plan/update-post-type', { method: 'POST', body: formData })
                        .then(r => r.json())
                        .catch(e => console.error('Помилка збереження типу поста:', e));
                });
            });

            function mapGenerationStatusLabel(statusRaw) {
                const map = {
                    not_generated: 'Не згенеровано',
                    queued: 'В черзі ШІ...',
                    processing: 'В обробці...',
                    ready: 'Готово',
                    generated: 'Готово',
                    failed: 'Помилка'
                };
                return map[statusRaw] || 'Не згенеровано';
            }

            function paintGenerationStatus(postId, statusRaw, metaTextOrUrl, isUrl) {
                const badge = document.querySelector('[data-generation-status="' + postId + '"]');
                const meta = document.querySelector('[data-generation-meta="' + postId + '"]');
                if (badge) {
                    badge.dataset.statusRaw = statusRaw || 'not_generated';
                    badge.textContent = mapGenerationStatusLabel(statusRaw || 'not_generated');
                    badge.className = 'generation-status';
                    if (['ready', 'generated'].includes(statusRaw)) {
                        badge.classList.add('is-ready');
                    } else if (['queued', 'processing'].includes(statusRaw)) {
                        badge.classList.add('is-' + statusRaw);
                    } else if (statusRaw === 'failed') {
                        badge.classList.add('is-failed');
                    }
                }
                if (meta) {
                    if (metaTextOrUrl && isUrl) {
                        meta.innerHTML = '<a href="' + metaTextOrUrl.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer">Відкрити згенероване медіа</a>';
                    } else {
                        meta.textContent = metaTextOrUrl || (statusRaw === 'failed' ? 'Помилка генерації' : 'Немає активної генерації.');
                    }
                }
            }

            function getPostAvatarEngine(postId) {
                const select = document.querySelector('.generation-avatar-engine-select[data-post-id="' + postId + '"]');
                return select ? select.value : '';
            }

            const avatarEngineSelects = document.querySelectorAll('.generation-avatar-engine-select');
            avatarEngineSelects.forEach(function (select) {
                select.addEventListener('change', function () {
                    const postId = this.getAttribute('data-post-id');
                    const formData = new FormData();
                    formData.append('post_id', postId);
                    formData.append('avatar_engine', this.value || '');
                    fetch('/generation/update-avatar-engine', { method: 'POST', body: formData })
                        .then(r => r.json())
                        .then(data => {
                            if (!data || !data.ok) {
                                console.error('Не вдалося зберегти avatar engine', data);
                            }
                        })
                        .catch(e => console.error('Помилка оновлення avatar engine:', e));
                });
            });

            function runGenerationForPost(postId) {
                const avatarEngine = getPostAvatarEngine(postId);
                const formData = new FormData();
                formData.append('post_id', postId);
                formData.append('avatar_engine', avatarEngine || '');
                paintGenerationStatus(postId, 'queued', 'Відправляю запит у Flow...');
                return fetch('/generation/run', { method: 'POST', body: formData })
                    .then(r => r.json())
                    .then(data => {
                        if (!data || !data.ok) {
                            throw new Error((data && data.error) ? data.error : 'generation_start_failed');
                        }
                        paintGenerationStatus(postId, data.status || 'processing', 'Запит прийнято. Очікуємо результат від Flow.');
                        return data;
                    })
                    .catch(e => {
                        paintGenerationStatus(postId, 'failed', e.message || 'Помилка запуску');
                        throw e;
                    });
            }

            const generateButtons = document.querySelectorAll('.generate-media-btn');
            generateButtons.forEach(function (button) {
                button.addEventListener('click', function () {
                    const postId = this.getAttribute('data-post-id');
                    this.disabled = true;
                    runGenerationForPost(postId)
                        .catch(() => { })
                        .finally(() => { this.disabled = false; });
                });
            });

            const postCheckboxes = document.querySelectorAll('.media-select-post');
            const selectedCountNode = document.getElementById('bulk-selected-count');
            const bulkStatusNode = document.getElementById('bulk-generation-status');
            const bulkGenerateSelectedBtn = document.getElementById('bulk-generate-selected');
            const bulkGenerateDayBtn = document.getElementById('bulk-generate-day');
            const bulkDayInput = document.getElementById('bulk-day-input');

            function getSelectedPostIds() {
                const ids = [];
                document.querySelectorAll('.media-select-post:checked').forEach(function (cb) {
                    const postId = parseInt(cb.getAttribute('data-post-id') || '0', 10);
                    if (postId > 0) ids.push(postId);
                });
                return ids;
            }

            function refreshBulkCounter() {
                const count = getSelectedPostIds().length;
                if (selectedCountNode) {
                    selectedCountNode.textContent = String(count);
                }
                if (bulkGenerateSelectedBtn) {
                    bulkGenerateSelectedBtn.disabled = count === 0;
                }
            }

            postCheckboxes.forEach(function (cb) {
                cb.addEventListener('change', refreshBulkCounter);
            });
            refreshBulkCounter();

            if (bulkGenerateSelectedBtn) {
                bulkGenerateSelectedBtn.addEventListener('click', function () {
                    const postIds = getSelectedPostIds();
                    if (postIds.length === 0) return;

                    this.disabled = true;
                    if (bulkStatusNode) bulkStatusNode.textContent = 'Запускаю генерацію для вибраних постів...';

                    fetch('/generation/run-bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ post_ids: postIds })
                    })
                        .then(r => r.json())
                        .then(data => {
                            if (!data || !data.ok) throw new Error((data && data.error) ? data.error : 'bulk_generation_failed');
                            if (bulkStatusNode) bulkStatusNode.textContent = 'Запущено: ' + (data.started || 0) + ', помилок: ' + (data.failed || 0);
                            postIds.forEach(function (postId) {
                                paintGenerationStatus(postId, 'processing', 'Запит прийнято. Очікуємо результат від Flow.');
                            });
                        })
                        .catch(e => {
                            if (bulkStatusNode) bulkStatusNode.textContent = 'Помилка: ' + (e.message || 'невідома');
                        })
                        .finally(() => {
                            this.disabled = false;
                            refreshBulkCounter();
                        });
                });
            }

            if (bulkGenerateDayBtn) {
                bulkGenerateDayBtn.addEventListener('click', function () {
                    const dateValue = (bulkDayInput && bulkDayInput.value) ? bulkDayInput.value : '';
                    if (!dateValue) return;

                    this.disabled = true;
                    if (bulkStatusNode) bulkStatusNode.textContent = 'Запускаю генерацію для дати ' + dateValue + '...';

                    fetch('/generation/run-day', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ post_date: dateValue })
                    })
                        .then(r => r.json())
                        .then(data => {
                            if (!data || !data.ok) throw new Error((data && data.error) ? data.error : 'day_generation_failed');
                            if (bulkStatusNode) bulkStatusNode.textContent = 'Для дати ' + dateValue + ': запущено ' + (data.started || 0) + ', помилок ' + (data.failed || 0);
                        })
                        .catch(e => {
                            if (bulkStatusNode) bulkStatusNode.textContent = 'Помилка: ' + (e.message || 'невідома');
                        })
                        .finally(() => {
                            this.disabled = false;
                        });
                });
            }

            function pollGenerationStatuses() {
                const statusNodes = document.querySelectorAll('[data-generation-status]');
                statusNodes.forEach(function (node) {
                    const postId = node.getAttribute('data-generation-status');
                    const rawStatus = (node.dataset.statusRaw || '').trim();
                    if (!postId || !['queued', 'processing'].includes(rawStatus)) return;

                    fetch('/generation/status?post_id=' + encodeURIComponent(postId), { method: 'GET' })
                        .then(r => r.json())
                        .then(data => {
                            if (!data || !data.ok) return;
                            const status = data.generation_status || 'not_generated';
                            const outputUrl = data.generation_output_url || '';
                            const errorText = data.generation_error || '';
                            if (outputUrl) {
                                paintGenerationStatus(postId, status, outputUrl, true);
                            } else if (errorText) {
                                paintGenerationStatus(postId, status, errorText, false);
                            } else {
                                paintGenerationStatus(postId, status, status === 'processing' ? 'Виконується у Flow...' : '');
                            }
                        })
                        .catch(() => { });
                });
            }

            setInterval(pollGenerationStatuses, 8000);
            pollGenerationStatuses();

            // ─── Фільтр видимості колонок мереж (зберігається в localStorage) ───
            const VIS_STORAGE_KEY = 'network_vis_p<?php echo (int) $active_project_id; ?>';

            function setNetworkColsVisible(networkId, visible) {
                document.querySelectorAll('.net-header-col[data-network-id="' + networkId + '"], .net-sub-col[data-network-id="' + networkId + '"]').forEach(function (el) {
                    el.style.display = visible ? '' : 'none';
                });
            }

            function applyNetworkVisibility() {
                let stored = {};
                try { stored = JSON.parse(localStorage.getItem(VIS_STORAGE_KEY) || '{}'); } catch (e) { }
                document.querySelectorAll('.network-vis-cb').forEach(function (cb) {
                    const nid = cb.getAttribute('data-filter-network-id');
                    const visible = stored[nid] !== false; // default: true
                    cb.checked = visible;
                    setNetworkColsVisible(nid, visible);
                });
            }

            document.querySelectorAll('.network-vis-cb').forEach(function (cb) {
                cb.addEventListener('change', function () {
                    const nid = this.getAttribute('data-filter-network-id');
                    const visible = this.checked;
                    setNetworkColsVisible(nid, visible);
                    let stored = {};
                    try { stored = JSON.parse(localStorage.getItem(VIS_STORAGE_KEY) || '{}'); } catch (e) { }
                    stored[nid] = visible;
                    localStorage.setItem(VIS_STORAGE_KEY, JSON.stringify(stored));
                });
            });

            applyNetworkVisibility();
        });
    </script>
</body>

</html>