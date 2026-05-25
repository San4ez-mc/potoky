<!DOCTYPE html>
<html lang="uk">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Зображення — Content Planner Bot</title>
    <link rel="stylesheet" href="/style.css">
    <style>
        .page-card {
            background: white;
            padding: 24px;
            border-radius: 12px;
            margin-top: 20px;
            box-shadow: var(--shadow);
        }

        .tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 24px;
        }

        .tab {
            padding: 10px 20px;
            border: 1px solid #d1d5db;
            background: #f8fafc;
            color: #334155;
            border-radius: 8px;
            font-size: 14px;
            cursor: pointer;
        }

        .tab.active {
            background: #5a6c7d;
            color: #fff;
            border-color: #5a6c7d;
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
        }

        .upload-section,
        .prompts-section {
            background: #fff;
            padding: 18px;
            border-radius: 10px;
            border: 1px solid #e5e7eb;
            margin-bottom: 18px;
        }

        .upload-form {
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }

        .upload-form input[type="file"] {
            padding: 8px;
            border: 1px dashed #cbd5e1;
            border-radius: 8px;
            flex: 1;
            min-width: 260px;
        }
        .drop-zone {
            border: 2px dashed #93c5fd;
            border-radius: 12px;
            padding: 28px 20px;
            text-align: center;
            background: #f0f9ff;
            cursor: pointer;
            transition: background .15s, border-color .15s;
            margin-bottom: 14px;
        }
        .drop-zone.drag-over { background: #dbeafe; border-color: #3b82f6; }
        .drop-zone .dz-icon { font-size: 36px; margin-bottom: 8px; }
        .drop-zone .dz-text { font-size: 15px; color: #1e40af; font-weight: 600; }
        .drop-zone .dz-hint { font-size: 12px; color: #64748b; margin-top: 4px; }
        .upload-progress-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
        .upload-progress-item { display: flex; align-items: center; gap: 10px; font-size: 13px; }
        .upload-progress-bar-wrap { flex: 1; background: #e2e8f0; border-radius: 4px; height: 6px; }
        .upload-progress-bar { background: #3b82f6; height: 6px; border-radius: 4px; width: 0%; transition: width .2s; }
        .upload-status-ok { color: #16a34a; font-weight: 600; }
        .upload-status-err { color: #dc2626; }

        .images-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 18px;
        }

        .image-card {
            background: #fff;
            border-radius: 12px;
            border: 1px solid #e5e7eb;
            overflow: hidden;
        }

        .image-preview {
            width: 100%;
            height: 230px;
            object-fit: cover;
            cursor: pointer;
        }

        .image-info {
            padding: 12px;
        }

        .image-filename {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 4px;
            word-break: break-word;
        }

        .image-size {
            font-size: 12px;
            color: #64748b;
            margin-bottom: 8px;
        }

        .image-actions {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
            flex-wrap: wrap;
        }

        .btn {
            padding: 8px 12px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 13px;
            cursor: pointer;
            background: #fff;
        }

        .btn-primary {
            background: #5a6c7d;
            color: white;
            border-color: #5a6c7d;
        }

        .btn-success {
            background: #22c55e;
            color: white;
            border-color: #22c55e;
        }

        .btn-danger {
            background: #ef4444;
            color: white;
            border-color: #ef4444;
        }

        .btn-secondary {
            background: #f8fafc;
            color: #334155;
        }

        .variations-section {
            border-top: 1px solid #e5e7eb;
            margin-top: 10px;
            padding-top: 10px;
        }

        .variations-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
        }

        .variation-thumb {
            width: 100%;
            height: 70px;
            object-fit: cover;
            border-radius: 6px;
            cursor: pointer;
        }

        .alert {
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 16px;
            font-size: 14px;
        }

        .alert-success {
            background: #d1fae5;
            color: #065f46;
            border: 1px solid #6ee7b7;
        }

        .alert-error {
            background: #fee2e2;
            color: #991b1b;
            border: 1px solid #fca5a5;
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: #6b7280;
            border: 1px dashed #cbd5e1;
            border-radius: 10px;
        }

        .prompt-form {
            display: grid;
            gap: 10px;
            margin-bottom: 16px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 14px;
        }

        .prompt-form input,
        .prompt-form textarea,
        .form-group select {
            width: 100%;
            padding: 10px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 14px;
        }

        .prompt-form textarea {
            min-height: 90px;
            resize: vertical;
        }

        .prompt-list {
            display: grid;
            gap: 10px;
        }

        .prompt-item {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 10px;
            padding: 12px;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            background: #fff;
        }

        .prompt-item.default {
            background: #eff6ff;
            border-color: #93c5fd;
        }

        .prompt-name {
            font-weight: 600;
            margin-bottom: 6px;
        }

        .prompt-text {
            font-size: 13px;
            color: #64748b;
        }

        .prompt-badge {
            font-size: 11px;
            background: #3b82f6;
            color: #fff;
            border-radius: 4px;
            padding: 2px 6px;
            margin-left: 8px;
        }

        .generated-gallery {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 14px;
        }

        .generated-card {
            background: #fff;
            border-radius: 10px;
            border: 1px solid #e5e7eb;
            overflow: hidden;
        }

        .generated-card img {
            width: 100%;
            height: 220px;
            object-fit: cover;
            cursor: pointer;
        }

        .generated-info {
            padding: 10px;
        }

        .generated-source {
            font-size: 12px;
            color: #64748b;
            margin-bottom: 3px;
        }

        .generated-date {
            font-size: 11px;
            color: #94a3b8;
        }

        .loading {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(15, 23, 42, 0.4);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }

        .loading.active {
            display: flex;
        }

        .loading-card {
            background: #fff;
            padding: 20px;
            border-radius: 12px;
            text-align: center;
            min-width: 280px;
        }

        .spinner {
            border: 3px solid #f1f5f9;
            border-top: 3px solid #5a6c7d;
            border-radius: 50%;
            width: 36px;
            height: 36px;
            animation: spin 1s linear infinite;
            margin: 0 auto 12px;
        }

        @keyframes spin {
            0% {
                transform: rotate(0deg);
            }

            100% {
                transform: rotate(360deg);
            }
        }

        .modal {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1001;
            align-items: center;
            justify-content: center;
        }

        .modal.active {
            display: flex;
        }

        .modal-content {
            background: #fff;
            border-radius: 12px;
            padding: 20px;
            width: min(500px, 92vw);
        }

        .modal-header {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 12px;
        }

        .modal-footer {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 14px;
        }
    </style>
</head>

<body>
    <?php require __DIR__ . '/components/topbar.php'; ?>

    <div class="container">
        <div class="page-card">
            <h2 style="margin-bottom:6px;">🖼️ Зображення</h2>
            <p style="color:#64748b;font-size:13px;margin-bottom:16px;">Керуйте джерельними фото, промптами і
                згенерованими варіаціями.</p>

            <div class="tabs">
                <button class="tab active" data-tab="images" onclick="switchTab(event, 'images')">📸 Зображення</button>
                <button class="tab" data-tab="prompts" onclick="switchTab(event, 'prompts')">💬 Промпти</button>
                <button class="tab" data-tab="generated" onclick="switchTab(event, 'generated')">✨ Згенеровані</button>
            </div>

            <?php if (isset($_GET['success'])): ?>
                <div class="alert alert-success">✅ Зображення успішно завантажено!</div>
            <?php endif; ?>

            <?php if (isset($_GET['error'])): ?>
                <div class="alert alert-error">
                    ❌ Помилка:
                    <?php
                    $error = $_GET['error'];
                    if ($error === 'size')
                        echo 'Файл занадто великий (макс. 10MB)';
                    elseif ($error === 'format')
                        echo 'Непідтримуваний формат';
                    else
                        echo 'Не вдалося завантажити файл';
                    ?>
                </div>
            <?php endif; ?>

            <div id="tab-images" class="tab-content active">
                <div class="upload-section">
                    <h3 style="margin-bottom:10px;">📤 Завантажити початкове зображення</h3>
                    <p style="color:#6b7280;font-size:13px;margin-bottom:12px;">Підтримуються: JPG, PNG, GIF, WebP
                        (макс. 10MB)</p>
                    <p style="color:#64748b;font-size:12px;margin-bottom:12px;">Папка проєкту:
                        <code>public/uploads/source_images/<?php echo htmlspecialchars($sourceFolderName, ENT_QUOTES, 'UTF-8'); ?>/</code>
                    </p>
                    <div class="drop-zone" id="drop-zone"
                         onclick="document.getElementById('dz-input').click()"
                         ondragover="dzOver(event)"
                         ondragleave="dzLeave(event)"
                         ondrop="dzDrop(event)">
                        <div class="dz-icon">📤</div>
                        <div class="dz-text">Перетягни фото сюди або натисни для вибору</div>
                        <div class="dz-hint">JPG, PNG, GIF, WebP — до 10 МБ кожне &nbsp;·&nbsp; Можна вибрати кілька одразу</div>
                        <input type="file" id="dz-input" accept="image/*" multiple style="display:none"
                               onchange="dzFiles(this.files)">
                    </div>
                    <div class="upload-progress-list" id="upload-progress-list"></div>
                </div>

                <div class="images-grid">
                    <?php if (empty($sourceImages)): ?>
                        <div class="empty-state" style="grid-column:1/-1;">
                            <div style="font-size:40px;margin-bottom:8px;">📁</div>
                            <h3>Немає зображень</h3>
                            <p>Завантажте перше зображення, щоб почати генерацію</p>
                            <p style="margin-top:8px;font-size:12px;">Папка:
                                <code>public/uploads/source_images/<?php echo htmlspecialchars($sourceFolderName, ENT_QUOTES, 'UTF-8'); ?>/</code>
                            </p>
                        </div>
                    <?php else: ?>
                        <?php foreach ($sourceImages as $image): ?>
                            <div class="image-card">
                                <img src="<?php echo htmlspecialchars($image['path'], ENT_QUOTES, 'UTF-8'); ?>"
                                    alt="<?php echo htmlspecialchars($image['filename'], ENT_QUOTES, 'UTF-8'); ?>"
                                    class="image-preview" onclick="window.open(this.src, '_blank')">
                                <div class="image-info">
                                    <div class="image-filename">
                                        <?php echo htmlspecialchars($image['filename'], ENT_QUOTES, 'UTF-8'); ?></div>
                                    <div class="image-size"><?php echo round($image['size'] / 1024, 1); ?> KB</div>
                                    <div class="image-actions">
                                        <button class="btn btn-success"
                                            onclick="showGenerateModal('<?php echo htmlspecialchars($image['filename'], ENT_QUOTES, 'UTF-8'); ?>')">✨
                                            Згенерувати копії</button>
                                        <form method="POST" action="/images/delete" style="display:inline;">
                                            <input type="hidden" name="filename"
                                                value="<?php echo htmlspecialchars($image['filename'], ENT_QUOTES, 'UTF-8'); ?>">
                                            <button type="submit" class="btn btn-danger"
                                                onclick="return confirm('Видалити це зображення?')">🗑️</button>
                                        </form>
                                    </div>

                                    <?php
                                    $baseFilename = pathinfo($image['filename'], PATHINFO_FILENAME);
                                    if (isset($generatedImages[$baseFilename]) && !empty($generatedImages[$baseFilename])):
                                        ?>
                                        <div class="variations-section">
                                            <div style="font-size:12px;color:#64748b;margin-bottom:6px;">Згенеровано варіацій:
                                                <?php echo count($generatedImages[$baseFilename]); ?></div>
                                            <div class="variations-grid">
                                                <?php foreach ($generatedImages[$baseFilename] as $var): ?>
                                                    <img src="<?php echo htmlspecialchars($var['path'], ENT_QUOTES, 'UTF-8'); ?>"
                                                        class="variation-thumb" onclick="window.open(this.src, '_blank')"
                                                        title="<?php echo htmlspecialchars($var['filename'], ENT_QUOTES, 'UTF-8'); ?>">
                                                <?php endforeach; ?>
                                            </div>
                                        </div>
                                    <?php endif; ?>
                                </div>
                            </div>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </div>
            </div>

            <div id="tab-prompts" class="tab-content">
                <div class="prompts-section">
                    <h3 style="margin-bottom:8px;">💬 Управління промптами</h3>
                    <p style="color:#64748b;font-size:13px;margin-bottom:12px;">Створюйте кастомні промпти для генерації
                        зображень.</p>

                    <div class="prompt-form">
                        <input type="text" id="prompt-name" placeholder="Назва промпта" required>
                        <textarea id="prompt-text" placeholder="Текст промпта англійською" required></textarea>
                        <div>
                            <button class="btn btn-primary" onclick="addPrompt()">Додати промпт</button>
                        </div>
                    </div>

                    <div class="prompt-list">
                        <?php foreach ($prompts as $prompt): ?>
                            <div class="prompt-item <?php echo $prompt['is_default'] ? 'default' : ''; ?>">
                                <div>
                                    <div class="prompt-name">
                                        <?php echo htmlspecialchars($prompt['name'], ENT_QUOTES, 'UTF-8'); ?>
                                        <?php if ($prompt['is_default']): ?>
                                            <span class="prompt-badge">Дефолтний</span>
                                        <?php endif; ?>
                                    </div>
                                    <div class="prompt-text">
                                        <?php echo htmlspecialchars($prompt['prompt_text'], ENT_QUOTES, 'UTF-8'); ?></div>
                                </div>
                                <?php if (!$prompt['is_default']): ?>
                                    <button class="btn btn-danger"
                                        onclick="deletePrompt(<?php echo (int) $prompt['id']; ?>)">🗑️</button>
                                <?php endif; ?>
                            </div>
                        <?php endforeach; ?>
                    </div>
                </div>
            </div>

            <div id="tab-generated" class="tab-content">
                <div class="prompts-section">
                    <h3 style="margin-bottom:8px;">✨ Всі згенеровані зображення</h3>
                    <p style="color:#64748b;font-size:13px;margin-bottom:12px;">Папка:
                        <code>public/uploads/generated_images/<?php echo htmlspecialchars($sourceFolderName, ENT_QUOTES, 'UTF-8'); ?>/</code></p>

                    <?php
                    $allGenerated = [];
                    foreach ($generatedImages as $source => $images) {
                        foreach ($images as $img) {
                            $allGenerated[] = array_merge($img, ['source' => $source]);
                        }
                    }
                    usort($allGenerated, function ($a, $b) {
                        return ($b['created'] ?? 0) <=> ($a['created'] ?? 0);
                    });
                    ?>

                    <?php if (empty($allGenerated)): ?>
                        <div class="empty-state">
                            <div style="font-size:40px;margin-bottom:8px;">✨</div>
                            <h3>Немає згенерованих зображень</h3>
                            <p>Згенеруйте варіації на вкладці «Зображення»</p>
                        </div>
                    <?php else: ?>
                        <div class="generated-gallery">
                            <?php foreach ($allGenerated as $img): ?>
                                <div class="generated-card">
                                    <img src="<?php echo htmlspecialchars($img['path'], ENT_QUOTES, 'UTF-8'); ?>"
                                        alt="<?php echo htmlspecialchars($img['filename'], ENT_QUOTES, 'UTF-8'); ?>"
                                        onclick="window.open(this.src, '_blank')">
                                    <div class="generated-info">
                                        <div class="generated-source">🖼️ Джерело:
                                            <?php echo htmlspecialchars($img['source'], ENT_QUOTES, 'UTF-8'); ?></div>
                                        <div class="generated-date">📅
                                            <?php echo date('d.m.Y H:i', (int) ($img['created'] ?? time())); ?></div>
                                    </div>
                                </div>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </div>
            </div>
        </div>
    </div>

    <div class="modal" id="generate-modal">
        <div class="modal-content">
            <div class="modal-header">✨ Генерація варіацій</div>
            <div class="form-group">
                <label for="selected-prompt"
                    style="display:block;margin-bottom:6px;font-size:13px;color:#475569;">Оберіть промпт:</label>
                <select id="selected-prompt">
                    <option value="0">Використати дефолтні промпти</option>
                    <?php foreach ($prompts as $prompt): ?>
                        <option value="<?php echo (int) $prompt['id']; ?>">
                            <?php echo htmlspecialchars($prompt['name'], ENT_QUOTES, 'UTF-8'); ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeGenerateModal()">Скасувати</button>
                <button class="btn btn-success" onclick="confirmGenerate()">Згенерувати</button>
            </div>
        </div>
    </div>

    <div class="loading" id="loading">
        <div class="loading-card">
            <div class="spinner"></div>
            <strong>Генерація варіацій через AI...</strong>
            <div style="font-size:12px;color:#64748b;margin-top:8px;">Це може зайняти 30-60 секунд</div>
        </div>
    </div>

    <script>
        let currentFilename = null;

        function switchTab(event, tabName) {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            event.currentTarget.classList.add('active');
            document.getElementById('tab-' + tabName).classList.add('active');
        }

        function showGenerateModal(filename) {
            currentFilename = filename;
            document.getElementById('generate-modal').classList.add('active');
        }

        function closeGenerateModal() {
            document.getElementById('generate-modal').classList.remove('active');
            currentFilename = null;
        }

        function confirmGenerate() {
            const filenameToGenerate = currentFilename;
            const promptId = document.getElementById('selected-prompt').value;
            closeGenerateModal();
            if (filenameToGenerate) {
                generateVariations(filenameToGenerate, promptId);
            }
        }

        function generateVariations(filename, promptId = 0) {
            const loading = document.getElementById('loading');
            loading.classList.add('active');

            const formData = new FormData();
            formData.append('source_filename', filename);
            formData.append('prompt_id', promptId);

            fetch('/images/generate-variations', {
                method: 'POST',
                body: formData
            })
                .then(response => response.json())
                .then(data => {
                    loading.classList.remove('active');
                    if (data.success) {
                        const count = data.count || (data.variations ? data.variations.length : 0);
                        alert('✅ Успішно згенеровано ' + count + ' варіацій зображення!');
                        location.reload();
                    } else {
                        alert('❌ Помилка: ' + (data.error || 'Невідома помилка'));
                    }
                })
                .catch(error => {
                    loading.classList.remove('active');
                    alert('❌ Помилка генерації: ' + error.message);
                });
        }

        function addPrompt() {
            const name = document.getElementById('prompt-name').value.trim();
            const text = document.getElementById('prompt-text').value.trim();

            if (!name || !text) {
                alert('❌ Заповніть всі поля');
                return;
            }

            const formData = new FormData();
            formData.append('name', name);
            formData.append('prompt_text', text);

            fetch('/images/add-prompt', {
                method: 'POST',
                body: formData
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        alert('✅ Промпт успішно додано!');
                        location.reload();
                    } else {
                        alert('❌ Помилка: ' + (data.error || 'Невідома помилка'));
                    }
                })
                .catch(error => {
                    alert('❌ Помилка: ' + error.message);
                });
        }

        function deletePrompt(id) {
            if (!confirm('Видалити цей промпт?')) {
                return;
            }

            const formData = new FormData();
            formData.append('id', id);

            fetch('/images/delete-prompt', {
                method: 'POST',
                body: formData
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        alert('✅ Промпт видалено!');
                        location.reload();
                    } else {
                        alert('❌ Помилка: ' + (data.error || 'Невідома помилка'));
                    }
                })
                .catch(error => {
                    alert('❌ Помилка: ' + error.message);
                });
        }

        // ── Drag-and-drop multi-upload ──
        function dzOver(e) {
            e.preventDefault();
            document.getElementById('drop-zone').classList.add('drag-over');
        }
        function dzLeave(e) {
            document.getElementById('drop-zone').classList.remove('drag-over');
        }
        function dzDrop(e) {
            e.preventDefault();
            document.getElementById('drop-zone').classList.remove('drag-over');
            const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
            if (files.length) dzFiles(files);
        }
        async function dzFiles(fileList) {
            const files = [...fileList];
            if (!files.length) return;
            const list = document.getElementById('upload-progress-list');
            list.innerHTML = '';
            let anyOk = false;

            for (const file of files) {
                const safeId = 'f' + Math.random().toString(36).slice(2);
                const row = document.createElement('div');
                row.className = 'upload-progress-item';
                row.innerHTML =
                    '<span style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + file.name + '</span>' +
                    '<div class="upload-progress-bar-wrap"><div class="upload-progress-bar" id="bar-' + safeId + '"></div></div>' +
                    '<span id="st-' + safeId + '">...</span>';
                list.appendChild(row);

                const bar = document.getElementById('bar-' + safeId);
                const st  = document.getElementById('st-' + safeId);

                try {
                    const fd = new FormData();
                    fd.append('source_image', file);
                    if (bar) bar.style.width = '30%';
                    const resp = await fetch('/images/upload-ajax', { method: 'POST', body: fd });
                    if (bar) bar.style.width = '100%';
                    const json = await resp.json();
                    if (json.ok) {
                        if (st) { st.className = 'upload-status-ok'; st.textContent = '✅'; }
                        anyOk = true;
                    } else {
                        if (st) { st.className = 'upload-status-err'; st.textContent = '❌ ' + (json.error || 'Помилка'); }
                    }
                } catch(err) {
                    if (bar) bar.style.width = '100%';
                    if (st) { st.className = 'upload-status-err'; st.textContent = '❌ Помилка'; }
                }
            }

            if (anyOk) setTimeout(() => location.reload(), 900);
        }
    </script>
</body>

</html>