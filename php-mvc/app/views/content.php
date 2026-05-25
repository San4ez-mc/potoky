<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Генерація контенту — Content Platform</title>
    <link rel="stylesheet" href="/style.css">
    <style>
        body { background: #f5f7fa; }
        .cs-wrap { max-width: 1400px; margin: 0 auto; padding: 24px; }
        .cs-page-title { font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 4px; }
        .cs-page-sub { font-size: 13px; color: #6b7280; margin-bottom: 24px; }

        .cs-section-label {
            font-size: 11px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.8px; color: #9ca3af; margin: 24px 0 8px; padding-left: 4px;
        }

        .cs-format-tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
        .cs-tab {
            padding: 6px 16px; border-radius: 20px; border: 1.5px solid #e5e7eb;
            background: #fff; font-size: 13px; font-weight: 500; color: #6b7280;
            cursor: pointer; transition: all 0.15s;
        }
        .cs-tab:hover { border-color: #93c5fd; color: #1d4ed8; }
        .cs-tab.active { background: #2563eb; border-color: #2563eb; color: #fff; }

        .cs-table {
            width: 100%; border-collapse: collapse; background: #fff;
            border-radius: 12px; overflow: hidden;
            box-shadow: 0 1px 8px rgba(0,0,0,0.06); margin-bottom: 12px;
        }
        .cs-table thead th {
            background: #f9fafb; padding: 11px 16px; font-size: 11px; font-weight: 600;
            color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;
            text-align: left; border-bottom: 1px solid #f0f0f0;
        }
        .cs-table tbody tr { border-bottom: 1px solid #f3f4f6; transition: background 0.1s; }
        .cs-table tbody tr:last-child { border-bottom: none; }
        .cs-table tbody tr:hover:not(.cs-inline-row) { background: #f9fafb; }
        .cs-table tbody td { padding: 12px 16px; vertical-align: middle; }

        .cs-type-cell { display: flex; align-items: center; gap: 10px; }
        .cs-icon {
            width: 36px; height: 36px; border-radius: 8px;
            display: flex; align-items: center; justify-content: center;
            font-size: 18px; flex-shrink: 0;
        }
        .cs-icon-img  { background: #fdf4ff; }
        .cs-icon-reel { background: #f0fdf4; }
        .cs-icon-post { background: #fff7ed; }

        .cs-type-name { font-size: 14px; font-weight: 600; color: #111827; }
        .cs-type-desc { font-size: 12px; color: #6b7280; margin-top: 1px; line-height: 1.45; }
        .cs-funnel-tag { display: inline-block; margin-top: 6px; font-size: 10px; font-family: monospace; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; border-radius: 4px; padding: 2px 8px; font-weight: 600; letter-spacing: .02em; }

        .cs-badge {
            display: inline-flex; align-items: center; padding: 3px 10px;
            border-radius: 20px; font-size: 11px; font-weight: 600; white-space: nowrap;
        }
        .cs-badge-story  { background: #fdf4ff; color: #7e22ce; }
        .cs-badge-reel   { background: #f0fdf4; color: #15803d; }
        .cs-badge-post   { background: #fff7ed; color: #c2410c; }
        .cs-badge-multi  { background: #eff6ff; color: #1d4ed8; }

        .cs-status-ready { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #16a34a; font-weight: 500; }
        .cs-status-soon  { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #9ca3af; }
        .cs-status-dev   { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #d97706; font-weight: 500; }
        .cs-status-dot   { width: 6px; height: 6px; border-radius: 50%; }
        .dot-green { background: #22c55e; }
        .dot-gray  { background: #d1d5db; }
        .dot-amber { background: #f59e0b; }

        .cs-launch-btn {
            padding: 6px 16px; background: #2563eb; color: #fff;
            border: none; border-radius: 8px; font-size: 13px; font-weight: 600;
            cursor: pointer; transition: background 0.15s; white-space: nowrap;
        }
        .cs-launch-btn:hover { background: #1d4ed8; }
        .cs-soon-btn {
            padding: 6px 16px; background: #f3f4f6; color: #9ca3af;
            border: none; border-radius: 8px; font-size: 13px; cursor: default;
        }

        .cs-inline-row { display: none; }
        .cs-inline-row.open { display: table-row; }
        .cs-inline-panel { padding: 20px 24px; background: #f8faff; border-top: 2px solid #3b82f6; }
        .cs-panel-inner { display: flex; gap: 32px; align-items: flex-start; }
        .cs-panel-form { flex: 1; display: flex; flex-direction: column; gap: 12px; max-width: 520px; }
        .cs-panel-preview { display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .cs-panel-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
        .cs-panel-title { font-size: 15px; font-weight: 700; color: #1e3a8a; }
        .cs-close-btn {
            margin-left: auto; padding: 4px 12px; background: transparent;
            border: 1px solid #e5e7eb; border-radius: 6px; font-size: 12px;
            color: #6b7280; cursor: pointer;
        }
        .cs-close-btn:hover { background: #f3f4f6; }

        .cs-field label { display: block; font-size: 12px; font-weight: 500; color: #374151; margin-bottom: 3px; }
        .cs-field input, .cs-field textarea, .cs-field select {
            width: 100%; box-sizing: border-box; background: #fff; border: 1px solid #d1d5db;
            border-radius: 8px; padding: 7px 11px; font-size: 13px; color: #111;
            outline: none; font-family: inherit; transition: border-color 0.15s;
        }
        .cs-field textarea { resize: vertical; font-family: monospace; font-size: 12px; }
        .cs-field input:focus, .cs-field textarea:focus, .cs-field select:focus { border-color: #3b82f6; }
        .cs-field-hint { font-size: 11px; color: #9ca3af; margin-top: 2px; }

        /* Photo picker */
        .cs-photo-pick { display: flex; gap: 10px; align-items: flex-start; }
        .cs-photo-thumb {
            width: 72px; height: 72px; border-radius: 8px; border: 1.5px dashed #d1d5db;
            background: #f9fafb; overflow: hidden; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            font-size: 24px; color: #9ca3af; cursor: pointer;
        }
        .cs-photo-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .cs-photo-thumb:hover { border-color: #3b82f6; }
        .cs-photo-pick-btns { display: flex; flex-direction: column; gap: 6px; flex: 1; }
        .cs-pick-gallery-btn {
            padding: 7px 14px; background: #eff6ff; color: #2563eb; border: 1.5px solid #bfdbfe;
            border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
            text-align: left; transition: background 0.15s;
        }
        .cs-pick-gallery-btn:hover { background: #dbeafe; }
        .cs-pick-url-toggle { font-size: 11px; color: #9ca3af; cursor: pointer; text-decoration: underline; }
        .cs-pick-url-toggle:hover { color: #374151; }
        .cs-photo-url-input { display: none; }

        .cs-gen-btn {
            padding: 9px 20px; background: #2563eb; color: #fff; border: none;
            border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer;
            transition: background 0.15s; display: flex; align-items: center; gap: 8px;
        }
        .cs-gen-btn:hover { background: #1d4ed8; }
        .cs-gen-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .cs-error-box {
            padding: 8px 12px; background: #fef2f2; border: 1px solid #fca5a5;
            border-radius: 8px; font-size: 12px; color: #b91c1c; display: none;
        }

        .cs-preview-placeholder {
            width: 200px; height: 356px; background: #111; border-radius: 12px;
            display: flex; flex-direction: column; align-items: center;
            justify-content: center; gap: 10px; color: #4b5563; font-size: 13px;
        }
        .cs-preview-placeholder span:first-child { font-size: 36px; }

        .cs-img-box {
            width: 270px; border-radius: 12px; overflow: hidden;
            box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        }
        .cs-img-box img { width: 100%; height: auto; display: block; }

        .cs-video-box {
            width: 200px; height: 356px; background: #111;
            border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        }
        .cs-video-box video { width: 100%; height: 100%; object-fit: contain; }

        .cs-slides-strip { display: flex; gap: 12px; flex-wrap: wrap; max-width: 980px; }
        .cs-block-header td {
            background: linear-gradient(90deg,#eef2ff,#f8faff);
            font-size: 11px; font-weight: 700; color: #4f46e5;
            padding: 10px 18px 8px; border-top: 3px solid #e0e7ff;
            border-bottom: 1px solid #e0e7ff; letter-spacing: .08em;
            text-transform: uppercase; user-select: none;
        }
        .cs-slides-strip img {
            width: 320px; height: auto; max-height: 570px; object-fit: cover;
            border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        .cs-result-actions { display: flex; gap: 8px; width: 270px; flex-wrap: wrap; }
        .cs-action-btn {
            flex: 1; padding: 6px 10px; background: #f3f4f6; border: none;
            border-radius: 7px; font-size: 12px; cursor: pointer; color: #374151;
            text-align: center; text-decoration: none; display: inline-block; transition: background 0.15s;
        }
        .cs-action-btn:hover { background: #e5e7eb; }
        .cs-regen-btn {
            padding: 6px; border: 1.5px solid #93c5fd; background: transparent;
            border-radius: 8px; font-size: 12px; color: #2563eb; cursor: pointer; width: 100%;
        }

        .spinner {
            width: 18px; height: 18px; border: 2.5px solid rgba(255,255,255,0.3);
            border-top-color: #fff; border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .cs-progress { width: 200px; height: 4px; background: #e5e7eb; border-radius: 2px; overflow: hidden; }
        .cs-progress-bar {
            height: 100%; background: #3b82f6; border-radius: 2px;
            animation: progress-pulse 1.5s ease-in-out infinite;
        }
        @keyframes progress-pulse { 0%{width:0%} 50%{width:70%} 100%{width:90%} }

        /* ── Gallery Modal ── */
        .pg-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.5);
            z-index: 9000; display: none; align-items: center; justify-content: center;
        }
        .pg-overlay.open { display: flex; }
        .pg-modal {
            background: #fff; border-radius: 16px; width: 720px; max-width: 95vw;
            max-height: 85vh; display: flex; flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .pg-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px 20px; border-bottom: 1px solid #e5e7eb;
        }
        .pg-header-title { font-size: 15px; font-weight: 700; color: #111827; }
        .pg-close-btn {
            width: 32px; height: 32px; border-radius: 8px; border: none;
            background: #f3f4f6; cursor: pointer; font-size: 16px; color: #6b7280;
        }
        .pg-close-btn:hover { background: #e5e7eb; }
        .pg-body { flex: 1; overflow-y: auto; padding: 16px 20px; }

        /* Upload zone in modal */
        .pg-upload-zone {
            border: 2px dashed #d1d5db; border-radius: 12px;
            padding: 16px; text-align: center; margin-bottom: 16px;
            background: #f9fafb; cursor: pointer; transition: border-color 0.15s;
        }
        .pg-upload-zone:hover, .pg-upload-zone.drag-over { border-color: #3b82f6; background: #eff6ff; }
        .pg-upload-zone input { display: none; }
        .pg-upload-label {
            display: flex; align-items: center; justify-content: center; gap: 8px;
            font-size: 13px; font-weight: 600; color: #2563eb; cursor: pointer;
        }
        .pg-upload-progress {
            font-size: 12px; color: #6b7280; margin-top: 6px; display: none;
        }

        /* Image grid in modal */
        .pg-empty {
            text-align: center; padding: 40px; color: #9ca3af; font-size: 14px;
        }
        .pg-grid {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 10px; margin-top: 4px;
        }
        .pg-img-item {
            border: 2.5px solid transparent; border-radius: 10px; overflow: hidden;
            cursor: pointer; position: relative; transition: border-color 0.15s;
            background: #f3f4f6;
        }
        .pg-img-item:hover { border-color: #3b82f6; }
        .pg-img-item.selected { border-color: #2563eb; }
        .pg-img-item img { width: 100%; height: 120px; object-fit: cover; display: block; }
        .pg-img-name {
            font-size: 10px; color: #6b7280; padding: 4px 6px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .pg-img-check {
            position: absolute; top: 6px; right: 6px; width: 22px; height: 22px;
            background: #2563eb; border-radius: 50%; display: none;
            align-items: center; justify-content: center; color: #fff; font-size: 13px;
        }
        .pg-img-item.selected .pg-img-check { display: flex; }
        .pg-footer {
            padding: 12px 20px; border-top: 1px solid #e5e7eb;
            display: flex; gap: 10px; justify-content: flex-end; align-items: center;
        }
        .pg-select-btn {
            padding: 8px 20px; background: #2563eb; color: #fff; border: none;
            border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .pg-select-btn:hover { background: #1d4ed8; }
        .pg-select-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .pg-cancel-btn {
            padding: 8px 16px; background: #f3f4f6; color: #374151; border: none;
            border-radius: 8px; font-size: 13px; cursor: pointer;
        }
    </style>
</head>
<body>
<?php require_once __DIR__ . '/components/topbar.php'; ?>

<!-- ── Photo Gallery Modal ── -->
<div class="pg-overlay" id="pg-overlay" onclick="if(event.target===this) closeGallery()">
    <div class="pg-modal">
        <div class="pg-header">
            <span class="pg-header-title">📷 Вибрати фото</span>
            <button class="pg-close-btn" onclick="closeGallery()">✕</button>
        </div>
        <div class="pg-body">
            <div class="pg-upload-zone" id="pg-upload-zone" onclick="document.getElementById('pg-file-input').click()" ondragover="pgDragOver(event)" ondragleave="pgDragLeave(event)" ondrop="pgDrop(event)">
                <label class="pg-upload-label">
                    <span>📤</span> Завантажити фото (або перетягни сюди)
                </label>
                <div class="pg-upload-progress" id="pg-upload-status"></div>
                <input type="file" id="pg-file-input" accept="image/*" multiple onchange="pgUploadFile(this)">
            </div>
            <div id="pg-grid" class="pg-grid">
                <div class="pg-empty">Завантажую галерею...</div>
            </div>
        </div>
        <div class="pg-footer">
            <span id="pg-selected-name" style="font-size:12px;color:#6b7280;flex:1;"></span>
            <button class="pg-cancel-btn" onclick="closeGallery()">Скасувати</button>
            <button class="pg-select-btn" id="pg-select-btn" disabled onclick="confirmGallerySelect()">Вибрати</button>
        </div>
    </div>
</div>

<div class="cs-wrap">
    <div class="cs-page-title">Генерація контенту</div>
    <div class="cs-page-sub">Вибери тип → заповни поля → натисни «Згенерувати» → отримай результат</div>

    <div class="cs-format-tabs">
        <button class="cs-tab active" data-filter="story">🎬 Сторіз</button>
        <button class="cs-tab" data-filter="post">📷 Пости</button>
        <button class="cs-tab" data-filter="video">🎥 Відео</button>
    </div>

    <table class="cs-table">
        <thead>
            <tr>
                <th style="width:340px">Тип контенту</th>
                <th>Формат</th>
                <th>Розмір</th>
                <th>Статус</th>
                <th style="width:130px">Дія</th>
            </tr>
        </thead>
        <tbody>

            <!-- ══ СТОРІЗ ══ -->
            <tr class="cs-block-header" data-filter="story"><td colspan="5">🎭 Силует</td></tr>

            <!-- I-1: Силует + плашки, Сторіз -->
            <tr class="cs-data-row" data-filter="story" data-id="silhouette-story">
                <td>
                    <div class="cs-type-cell">
                        <div class="cs-icon cs-icon-img">🧑</div>
                        <div>
                            <div class="cs-type-name">Силует + плашки</div>
                            <div class="cs-type-desc">Фото → remove-bg (видалення фону) → силует на брендовому фоні. Slide-builder рендерить PNG: плашка з заголовком та підзаголовком поверх силуету. Формат 9:16 (Stories / TikTok).</div><span class="cs-funnel-tag">&#128279; content-stories-generator</span>
                        </div>
                    </div>
                </td>
                <td><span class="cs-badge cs-badge-story">Сторіз</span></td>
                <td style="font-size:13px;color:#374151;">9:16 · 1080×1920</td>
                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>
                <td><button class="cs-launch-btn" onclick="toggleForm('silhouette-story')">▶ Запустити</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-silhouette-story">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">🧑</span>
                            <span class="cs-panel-title">Силует + плашки (Сторіз 9:16)</span>
                            <button class="cs-close-btn" onclick="toggleForm('silhouette-story')">✕</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field">
                                    <label>Фото</label>
                                    <div class="cs-photo-pick">
                                        <div class="cs-photo-thumb" id="photo-thumb-silhouette-story" onclick="openGallery('silhouette-story')">📷</div>
                                        <div class="cs-photo-pick-btns">
                                            <button type="button" class="cs-pick-gallery-btn" onclick="openGallery('silhouette-story')">📂 Вибрати з галереї</button>
                                            <button type="button" class="cs-pick-gallery-btn" onclick="pickRandomPhoto('silhouette-story')" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0">🎲 Рандомне фото</button>
                                            <span class="cs-pick-url-toggle" onclick="toggleUrlInput('silhouette-story')">або вставити URL вручну</span>
                                            <input type="url" class="cs-photo-url-input" id="silhouette-story-photoUrl-url" placeholder="https://..." oninput="setPhotoFromUrl('silhouette-story',this.value)">
                                        </div>
                                    </div>
                                    <input type="hidden" id="silhouette-story-photoUrl" value="">
                                    <div class="cs-field-hint">Фон буде видалено автоматично (remove-bg)</div>
                                </div>
                                <div class="cs-field"><label>Заголовок</label><input type="text" id="silhouette-story-text" value="За одну зйомку — 15–30 відео" placeholder="Текст заголовку"></div>
                                <div class="cs-field"><label>Підзаголовок (опційно)</label><input type="text" id="silhouette-story-subText" value="що тримають блог активним 2–3 місяці" placeholder="Текст підзаголовку"></div>
                                
                                <div class="cs-field">
                                    <label>Шаблон</label>
                                    <select id="silhouette-story-template">
                                        <option value="default">Default (класичний)</option>
                                        <option value="minimal">Minimal</option>
                                        <option value="bold">Bold</option>
                                        <option value="dark">Dark</option>
                                    </select>
                                </div>
                                <div class="cs-field">
                                    <label>Колір фону</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input type="color" id="silhouette-story-bgColor" value="#0f172a" style="width:48px;height:36px;border:1px solid #d1d5db;border-radius:8px;padding:2px;cursor:pointer;" oninput="document.getElementById('silhouette-story-bgColor-text').value=this.value">
                                        <input type="text" id="silhouette-story-bgColor-text" value="#0f172a" style="flex:1;" oninput="syncColorText('silhouette-story-bgColor','silhouette-story-bgColor-text')">
                                    </div>
                                </div>
                                <div class="cs-field">
                                    <label>Акцентний колір</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input type="color" id="silhouette-story-accent" value="#3b82f6" style="width:48px;height:36px;border:1px solid #d1d5db;border-radius:8px;padding:2px;cursor:pointer;" oninput="document.getElementById('silhouette-story-accent-text').value=this.value">
                                        <input type="text" id="silhouette-story-accent-text" value="#3b82f6" style="flex:1;" oninput="syncColorText('silhouette-story-accent','silhouette-story-accent-text')">
                                    </div>
                                </div>
                                <div class="cs-field">
                                    <label>Стиль фону</label>
                                    <select id="silhouette-story-bgStyle">
                                        <option value="flat">Монохромний</option>
                                        <option value="gradient">Градієнт (темний)</option>
                                        <option value="radial">Радіальне сяйво</option>
                                        <option value="mesh">Mesh-градієнт</option>
                                        <option value="aurora">Аврора</option>
                                        <option value="grid">Сітка</option>
                                        <option value="dots">Крапки</option>
                                    </select>
                                </div>
                                <button class="cs-gen-btn" id="btn-silhouette-story" onclick="generateViaFunnel('content-stories-generator',{width:1080,height:1920},'silhouette-story')">▶ Згенерувати</button>
                                <div class="cs-error-box" id="err-silhouette-story"></div>
                            </div>
                            <div class="cs-panel-preview">
                                <div id="preview-silhouette-story">
                                    <div class="cs-preview-placeholder"><span>🖼️</span><span>Результат тут</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>

            <!-- Silhouette external comparison placeholder -->
            <tr class="cs-data-row" data-filter="story" data-id="silhouette-story-ext">
                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-img" style="background:#f5f3ff;border-color:#ddd6fe">🔄</div><div><div class="cs-type-name">Силует + Текст (зовнішній API)</div><div class="cs-type-desc">Вирізання силуету через зовнішній сервіс для A/B порівняння якості з нашим мікросервісом. Підключи будь-який remove.bg / AI сервіс.</div><span class="cs-funnel-tag" style="background:#ede9fe;color:#5b21b6;border-color:#c4b5fd">🔗 незабаром</span></div></div></td>
                <td><span class="cs-badge cs-badge-img">Сторіз</span></td>
                <td style="font-size:13px;color:#374151;">9:16 · 1080×1920</td>
                <td><span class="cs-status-ready" style="color:#d97706"><span class="cs-status-dot" style="background:#d97706"></span>Планується</span></td>
                <td><button class="cs-launch-btn" disabled style="opacity:.4;cursor:not-allowed">▶ Запустити</button></td>
            </tr>

            <!-- ══ ПОСТИ ══ -->
            <tr class="cs-block-header" data-filter="post"><td colspan="5">🎭 Силует</td></tr>

            <!-- I-2: Силует + плашки, Пост -->
            <tr class="cs-data-row" data-filter="post" data-id="silhouette-post">
                <td>
                    <div class="cs-type-cell">
                        <div class="cs-icon cs-icon-img">🧑</div>
                        <div>
                            <div class="cs-type-name">Силует + плашки</div>
                            <div class="cs-type-desc">Той самий силует + плашки, але у форматі 4:5 (1080×1350). Оптимально для постів Instagram та Pinterest.</div><span class="cs-funnel-tag">&#128279; content-stories-generator</span>
                        </div>
                    </div>
                </td>
                <td><span class="cs-badge cs-badge-post">Пост 4:5</span></td>
                <td style="font-size:13px;color:#374151;">4:5 · 1080×1350</td>
                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>
                <td><button class="cs-launch-btn" onclick="toggleForm('silhouette-post')">▶ Запустити</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-silhouette-post">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">🧑</span>
                            <span class="cs-panel-title">Силует + плашки (Пост 4:5)</span>
                            <button class="cs-close-btn" onclick="toggleForm('silhouette-post')">✕</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field">
                                    <label>Фото</label>
                                    <div class="cs-photo-pick">
                                        <div class="cs-photo-thumb" id="photo-thumb-silhouette-post" onclick="openGallery('silhouette-post')">📷</div>
                                        <div class="cs-photo-pick-btns">
                                            <button type="button" class="cs-pick-gallery-btn" onclick="openGallery('silhouette-post')">📂 Вибрати з галереї</button>
                                            <button type="button" class="cs-pick-gallery-btn" onclick="pickRandomPhoto('silhouette-post')" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0">🎲 Рандомне фото</button>
                                            <span class="cs-pick-url-toggle" onclick="toggleUrlInput('silhouette-post')">або вставити URL вручну</span>
                                            <input type="url" class="cs-photo-url-input" id="silhouette-post-photoUrl-url" placeholder="https://..." oninput="setPhotoFromUrl('silhouette-post',this.value)">
                                        </div>
                                    </div>
                                    <input type="hidden" id="silhouette-post-photoUrl" value="">
                                    <div class="cs-field-hint">Фон буде видалено автоматично</div>
                                </div>
                                <div class="cs-field"><label>Заголовок</label><input type="text" id="silhouette-post-text" value="Ключова різниця — наявність фундаменту" placeholder="Текст заголовку"></div>
                                <div class="cs-field"><label>Підзаголовок (опційно)</label><input type="text" id="silhouette-post-subText" value="система і фінансовий запас" placeholder="Текст підзаголовку"></div>
                                
                                <div class="cs-field">
                                    <label>Шаблон</label>
                                    <select id="silhouette-post-template">
                                        <option value="default">Default (класичний)</option>
                                        <option value="minimal">Minimal</option>
                                        <option value="bold">Bold</option>
                                        <option value="dark">Dark</option>
                                    </select>
                                </div>
                                <div class="cs-field">
                                    <label>Колір фону</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input type="color" id="silhouette-post-bgColor" value="#0f172a" style="width:48px;height:36px;border:1px solid #d1d5db;border-radius:8px;padding:2px;cursor:pointer;" oninput="document.getElementById('silhouette-post-bgColor-text').value=this.value">
                                        <input type="text" id="silhouette-post-bgColor-text" value="#0f172a" style="flex:1;" oninput="syncColorText('silhouette-post-bgColor','silhouette-post-bgColor-text')">
                                    </div>
                                </div>
                                <div class="cs-field">
                                    <label>Акцентний колір</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input type="color" id="silhouette-post-accent" value="#3b82f6" style="width:48px;height:36px;border:1px solid #d1d5db;border-radius:8px;padding:2px;cursor:pointer;" oninput="document.getElementById('silhouette-post-accent-text').value=this.value">
                                        <input type="text" id="silhouette-post-accent-text" value="#3b82f6" style="flex:1;" oninput="syncColorText('silhouette-post-accent','silhouette-post-accent-text')">
                                    </div>
                                </div>
                                <div class="cs-field">
                                    <label>Стиль фону</label>
                                    <select id="silhouette-post-bgStyle">
                                        <option value="flat">Монохромний</option>
                                        <option value="gradient">Градієнт (темний)</option>
                                        <option value="radial">Радіальне сяйво</option>
                                        <option value="mesh">Mesh-градієнт</option>
                                        <option value="aurora">Аврора</option>
                                        <option value="grid">Сітка</option>
                                        <option value="dots">Крапки</option>
                                    </select>
                                </div>
                                <button class="cs-gen-btn" id="btn-silhouette-post" onclick="generateViaFunnel('content-stories-generator',{width:1080,height:1350},'silhouette-post')">▶ Згенерувати</button>
                                <div class="cs-error-box" id="err-silhouette-post"></div>
                            </div>
                            <div class="cs-panel-preview">
                                <div id="preview-silhouette-post">
                                    <div class="cs-preview-placeholder"><span>🖼️</span><span>Результат тут</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>

            <!-- I-8: Карусель -->
            <tr class="cs-block-header" data-filter="post"><td colspan="5">🗂 Карусель</td></tr>
            <tr class="cs-data-row" data-filter="post" data-id="carousel">
                <td>
                    <div class="cs-type-cell">
                        <div class="cs-icon cs-icon-post">🗂️</div>
                        <div>
                            <div class="cs-type-name">Карусель-Пост (4:5)</div>
                            <div class="cs-type-desc">Одне широке полотно з безшовним переходом між слайдами (до 8 шт.). Sharp нарізає на окремі кадри. Ідеально для освітнього контенту в каруселях.</div><span class="cs-funnel-tag">&#128279; content-carousel</span>
                        </div>
                    </div>
                </td>
                <td><span class="cs-badge cs-badge-post">Карусель</span></td>
                <td style="font-size:13px;color:#374151;">4:5 · 1080×1350</td>
                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>
                <td><button class="cs-launch-btn" onclick="toggleForm('carousel')">▶ Запустити</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-carousel">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">🗂️</span>
                            <span class="cs-panel-title">Карусель</span>
                            <button class="cs-close-btn" onclick="toggleForm('carousel')">✕</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field">
                                    <label>Фото (для силуету)</label>
                                    <div class="cs-photo-pick">
                                        <div class="cs-photo-thumb" id="photo-thumb-carousel" onclick="openGallery('carousel')">📷</div>
                                        <div class="cs-photo-pick-btns">
                                            <button type="button" class="cs-pick-gallery-btn" onclick="openGallery('carousel')">📂 Вибрати з галереї</button>
                                            <button type="button" class="cs-pick-gallery-btn" onclick="pickRandomPhoto('carousel')" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0">🎲 Рандомне фото</button>
                                            <span class="cs-pick-url-toggle" onclick="toggleUrlInput('carousel')">або вставити URL вручну</span>
                                            <input type="url" class="cs-photo-url-input" id="carousel-photoUrl-url" placeholder="https://..." oninput="setPhotoFromUrl('carousel',this.value)">
                                        </div>
                                    </div>
                                    <input type="hidden" id="carousel-photoUrl" value="">
                                </div>
                                
                                <div class="cs-field">
                                    <label>Слайди (по одному на рядок: Заголовок | Підзаголовок)</label>
                                    <textarea rows="5" id="carousel-slides">Cashflow — основа фінансів | Знай куди йдуть гроші
P&L — реальний прибуток | Не оборот, а чистий заробіток
Баланс — активи і борги | Повна картина бізнесу</textarea>
                                    <div class="cs-field-hint">До 8 слайдів. Формат: Заголовок | Підзаголовок</div>
                                </div>
                                <div class="cs-field">
                                    <label>Шаблон</label>
                                    <select id="carousel-template"><option value="default">Default</option></select>
                                </div>
                                <button class="cs-gen-btn" id="btn-carousel" onclick="generateCarousel()">▶ Згенерувати</button>
                                <div class="cs-error-box" id="err-carousel"></div>
                            </div>
                            <div class="cs-panel-preview">
                                <div id="preview-carousel">
                                    <div class="cs-preview-placeholder"><span>🗂️</span><span>Слайди тут</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>


            <tr class="cs-data-row" data-filter="story" data-id="multi-plate">
                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-img">🃏</div><div><div class="cs-type-name">Мультиплашки</div><div class="cs-type-desc">Кілька текстових блоків: пілюля-тег + головна плашка + стрілка + CTA. Фото або кольоровий фон. Найпоширеніший паттерн у блогерів.</div><span class="cs-funnel-tag">&#128279; content-image-template</span></div></div></td>
                <td><span class="cs-badge cs-badge-story">Сторіз</span></td>
                <td style="font-size:13px;color:#374151;">9:16</td>
                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>
                <td><button class="cs-launch-btn" onclick="toggleForm('multi-plate')">▶ Запустити</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-multi-plate">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">🃏</span>
                            <span class="cs-panel-title">Мультиплашки (Сторіз 9:16)</span>
                            <button class="cs-close-btn" onclick="toggleForm('multi-plate')">✕</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field">
                                    <label>Фото фон (опційно)</label>
                                    <div class="cs-photo-pick">
                                        <div class="cs-photo-thumb" id="photo-thumb-multi-plate" onclick="openGallery('multi-plate')">📷</div>
                                        <div class="cs-photo-pick-btns">
                                            <button type="button" class="cs-pick-gallery-btn" onclick="openGallery('multi-plate')">📂 Вибрати з галереї</button>
                                            <button type="button" class="cs-pick-gallery-btn" onclick="pickRandomPhoto('multi-plate')" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0">🎲 Рандомне фото</button>
                                            <span class="cs-pick-url-toggle" onclick="toggleUrlInput('multi-plate')">або вставити URL</span>
                                            <input type="url" class="cs-photo-url-input" id="multi-plate-photoUrl-url" placeholder="https://..." oninput="setPhotoFromUrl('multi-plate',this.value)">
                                        </div>
                                    </div>
                                    <input type="hidden" id="multi-plate-photoUrl" value="">
                                    <div class="cs-field-hint">Якщо не вказано — використовується кольоровий фон нижче</div>
                                </div>
                                <div class="cs-field"><label>Пілюля-тег зверху (опційно)</label><input type="text" id="multi-plate-tag" placeholder="📌 ЛАЙФХАК · ТОП-3 · ВАЖЛИВО"></div>
                                <div class="cs-field"><label>Головний текст (плашка)</label><textarea rows="3" id="multi-plate-title" placeholder="За одне заняття — повна фінансова система"></textarea></div>
                                <div class="cs-field">
                                    <label>Стрілка між блоками</label>
                                    <select id="multi-plate-showArrow">
                                        <option value="no">Без стрілки</option>
                                        <option value="yes">Показати ↓</option>
                                    </select>
                                </div>
                                <div class="cs-field"><label>Підблок / пояснення (опційно)</label><input type="text" id="multi-plate-subtitle" placeholder="Cashflow · P&amp;L · Баланс"></div>
                                <div class="cs-field"><label>CTA-плашка внизу (опційно)</label><input type="text" id="multi-plate-cta" placeholder="Пиши 2 у коментарях 👇"></div>
                                <div class="cs-field">
                                    <label>Колір фону (якщо без фото)</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input type="color" id="multi-plate-bgColor" value="#0f172a" style="width:48px;height:36px;border:1px solid #d1d5db;border-radius:8px;padding:2px;cursor:pointer;" oninput="document.getElementById('multi-plate-bgColor-text').value=this.value">
                                        <input type="text" id="multi-plate-bgColor-text" value="#0f172a" style="flex:1;" oninput="syncColorText('multi-plate-bgColor','multi-plate-bgColor-text')">
                                    </div>
                                </div>
                                <div class="cs-field">
                                    <label>Акцентний колір (тег, стрілка, CTA)</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input type="color" id="multi-plate-accent" value="#3b82f6" style="width:48px;height:36px;border:1px solid #d1d5db;border-radius:8px;padding:2px;cursor:pointer;" oninput="document.getElementById('multi-plate-accent-text').value=this.value">
                                        <input type="text" id="multi-plate-accent-text" value="#3b82f6" style="flex:1;" oninput="syncColorText('multi-plate-accent','multi-plate-accent-text')">
                                    </div>
                                </div>
                                <div class="cs-field">
                                    <label>Стиль фону (якщо без фото)</label>
                                    <select id="multi-plate-bgStyle">
                                        <option value="flat">Монохромний</option>
                                        <option value="gradient">Градієнт (темний)</option>
                                        <option value="radial">Радіальне сяйво</option>
                                        <option value="mesh">Mesh-градієнт</option>
                                        <option value="aurora">Аврора</option>
                                        <option value="grid">Сітка</option>
                                        <option value="dots">Крапки</option>
                                    </select>
                                </div>
                                <button class="cs-gen-btn" id="btn-multi-plate" onclick="generateViaFunnel('content-image-template',{template:'multi-plate',width:1080,height:1920},'multi-plate')">▶ Згенерувати</button>
                                <div class="cs-error-box" id="err-multi-plate"></div>
                            </div>
                            <div class="cs-panel-preview">
                                <div id="preview-multi-plate">
                                    <div class="cs-preview-placeholder"><span>🃏</span><span>Результат тут</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
            <tr class="cs-block-header" data-filter="story"><td colspan="5">🖋 Текст та фон</td></tr>
            <tr class="cs-data-row" data-filter="story" data-id="solid-text">
                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-img">✍️</div><div><div class="cs-type-name">Solid фон + великий текст</div><div class="cs-type-desc">Брендовий фон (твій колір) + акцентна лінія + крупний bold-заголовок. Без фото — тільки колір, типографіка та нікнейм. Рендер через slide-builder.</div><span class="cs-funnel-tag">&#128279; content-image-template</span></div></div></td>
                <td><span class="cs-badge cs-badge-story">Сторіз</span></td>
                <td style="font-size:13px;color:#374151;">9:16</td>
                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>
                <td><button class="cs-launch-btn" onclick="toggleForm('solid-text')">▶ Запустити</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-solid-text">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">✍️</span>
                            <span class="cs-panel-title">Solid фон + великий текст (Сторіз 9:16)</span>
                            <button class="cs-close-btn" onclick="toggleForm('solid-text')">✕</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field"><label>Заголовок</label><input type="text" id="solid-text-title" value="За одне заняття — повна фінансова система" placeholder="Великий заголовок"></div>
                                <div class="cs-field"><label>Підзаголовок (опційно)</label><input type="text" id="solid-text-subtitle" value="Cashflow · P&amp;L · Баланс" placeholder="Підзаголовок"></div>
                                <div class="cs-field"><label>Мітка / тег (опційно)</label><input type="text" id="solid-text-extra" placeholder="Напр.: 📌 Лайфхак · Урок 3"></div>
                                
                                <div class="cs-field">
                                    <label>Колір фону</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input type="color" id="solid-text-bgColor" value="#0f172a" style="width:48px;height:36px;border:1px solid #d1d5db;border-radius:8px;padding:2px;cursor:pointer;" oninput="document.getElementById('solid-text-bgColor-text').value=this.value">
                                        <input type="text" id="solid-text-bgColor-text" value="#0f172a" style="flex:1;" oninput="syncColorText('solid-text-bgColor','solid-text-bgColor-text')">
                                    </div>
                                </div>
                                <div class="cs-field">
                                    <label>Акцентний колір</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input type="color" id="solid-text-accent" value="#00c48c" style="width:48px;height:36px;border:1px solid #d1d5db;border-radius:8px;padding:2px;cursor:pointer;" oninput="document.getElementById('solid-text-accent-text').value=this.value">
                                        <input type="text" id="solid-text-accent-text" value="#00c48c" style="flex:1;" oninput="syncColorText('solid-text-accent','solid-text-accent-text')">
                                    </div>
                                </div>
                                <div class="cs-field">
                                    <label>Стиль фону</label>
                                    <select id="solid-text-bgStyle">
                                        <option value="flat">Монохромний</option>
                                        <option value="gradient">Градієнт (темний)</option>
                                        <option value="radial">Радіальне сяйво</option>
                                        <option value="mesh">Mesh-градієнт</option>
                                        <option value="aurora">Аврора</option>
                                        <option value="grid">Сітка</option>
                                        <option value="dots">Крапки</option>
                                    </select>
                                </div>
                                <button class="cs-gen-btn" id="btn-solid-text" onclick="generateViaFunnel('content-image-template',{template:'solid-text',width:1080,height:1920},'solid-text')">▶ Згенерувати</button>
                                <div class="cs-error-box" id="err-solid-text"></div>
                            </div>
                            <div class="cs-panel-preview">
                                <div id="preview-solid-text">
                                    <div class="cs-preview-placeholder"><span>✍️</span><span>Результат тут</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
            <tr class="cs-data-row" data-filter="story" data-id="photo-text">
                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-img">🖼️</div><div><div class="cs-type-name">Фото фон + текстові плашки</div><div class="cs-type-desc">Фото займає весь кадр як повне тло. Подвійний vignette (темніє зверху і знизу). Заголовок + підзаголовок на напівпрозорій плашці в нижній безпечній зоні.</div><span class="cs-funnel-tag">&#128279; content-image-template</span></div></div></td>
                <td><span class="cs-badge cs-badge-story">Сторіз</span></td>
                <td style="font-size:13px;color:#374151;">9:16</td>
                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>
                <td><button class="cs-launch-btn" onclick="toggleForm('photo-text')">&#x25B6; Запустити</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-photo-text">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">🖼️</span>
                            <span class="cs-panel-title">Фото фон + текстові плашки (Сторіз 9:16)</span>
                            <button class="cs-close-btn" onclick="toggleForm('photo-text')">✕</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field">
                                    <label>Фото (фон)</label>
                                    <div class="cs-photo-pick">
                                        <div class="cs-photo-thumb" id="photo-thumb-photo-text" onclick="openGallery('photo-text')">📷</div>
                                        <div class="cs-photo-pick-btns">
                                            <button type="button" class="cs-pick-gallery-btn" onclick="openGallery('photo-text')">📂 Вибрати з галереї</button>
                                            <button type="button" class="cs-pick-gallery-btn" onclick="pickRandomPhoto('photo-text')" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0">🎲 Рандомне фото</button>
                                            <span class="cs-pick-url-toggle" onclick="toggleUrlInput('photo-text')">або вставити URL вручну</span>
                                            <input type="url" class="cs-photo-url-input" id="photo-text-photoUrl-url" placeholder="https://..." oninput="setPhotoFromUrl('photo-text',this.value)">
                                        </div>
                                    </div>
                                    <input type="hidden" id="photo-text-photoUrl" value="">
                                    <div class="cs-field-hint">Фото буде використано як фон (без видалення фону)</div>
                                </div>
                                <div class="cs-field"><label>Заголовок</label><input type="text" id="photo-text-title" value="Знаєш куди йдуть гроші?" placeholder="Текст заголовку"></div>
                                <div class="cs-field"><label>Підзаголовок</label><input type="text" id="photo-text-subtitle" value="Cashflow — перший крок до фінансового контролю" placeholder="Підзаголовок"></div>
                                
                                <button class="cs-gen-btn" id="btn-photo-text" onclick="generateViaFunnel('content-image-template',{template:'photo-text',width:1080,height:1920},'photo-text')">▶ Згенерувати</button>
                                <div class="cs-error-box" id="err-photo-text"></div>
                            </div>
                            <div class="cs-panel-preview">
                                <div id="preview-photo-text">
                                    <div class="cs-preview-placeholder"><span>🖼️</span><span>Результат тут</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
            <tr class="cs-data-row" data-filter="story" data-id="social-proof">
                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-img">💬</div><div><div class="cs-type-name">Соціальний доказ</div><div class="cs-type-desc">Скріншот переписки в стилі Telegram — справжнє повідомлення від клієнта + опційна твоя відповідь. Trust-контент без підробок.</div><span class="cs-funnel-tag">&#128279; content-image-template</span></div></div></td>
                <td><span class="cs-badge cs-badge-story">Сторіз</span></td>
                <td style="font-size:13px;color:#374151;">9:16</td>
                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>
                <td><button class="cs-launch-btn" onclick="toggleForm('social-proof')">▶ Запустити</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-social-proof">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">💬</span>
                            <span class="cs-panel-title">Переписка-відгук — Telegram style (Сторіз 9:16)</span>
                            <button class="cs-close-btn" onclick="toggleForm('social-proof')">✕</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field"><label>Повідомлення клієнта</label><textarea rows="3" id="social-proof-quote" placeholder="Нарешті зрозумів куди йдуть гроші! Вже перший місяць у плюс 😊"></textarea></div>
                                <div class="cs-field"><label>Ім'я клієнта</label><input type="text" id="social-proof-author" value="" placeholder="Марія К."></div>
                                <div class="cs-field"><label>Твоя відповідь (опційно)</label><input type="text" id="social-proof-result" value="" placeholder="Так тримати! Це тільки початок 💪"></div>
                                <div class="cs-field"><label>Дата (опційно)</label><input type="text" id="social-proof-date" value="" placeholder="Сьогодні / 12 травня / вчора"></div>
                                
                                <button class="cs-gen-btn" id="btn-social-proof" onclick="generateViaFunnel('content-image-template',{template:'social-proof',width:1080,height:1920},'social-proof')">▶ Згенерувати</button>
                                <div class="cs-error-box" id="err-social-proof"></div>
                            </div>
                            <div class="cs-panel-preview">
                                <div id="preview-social-proof">
                                    <div class="cs-preview-placeholder"><span>💬</span><span>Результат тут</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
            <tr class="cs-data-row" data-filter="story" data-id="promo">
                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-img">📣</div><div><div class="cs-type-name">Рекламна / Анонс події</div><div class="cs-type-desc">Постер-анонс: бейдж (напр. "Знижка"), заголовок, дата, CTA-кнопка. Твоє фото як фон або брендовий колір. Підходить для заходів, курсів, акцій.</div><span class="cs-funnel-tag">&#128279; content-image-template</span></div></div></td>
                <td><span class="cs-badge cs-badge-multi">Сторіз / Пост</span></td>
                <td style="font-size:13px;color:#374151;">9:16 / 4:5</td>
                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>
                <td><button class="cs-launch-btn" onclick="toggleForm('promo')">▶ Запустити</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-promo">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">&#x1F4E3;</span>
                            <span class="cs-panel-title">&#x420;&#x435;&#x43A;&#x43B;&#x430;&#x43C;&#x43D;&#x430; / &#x410;&#x43D;&#x43E;&#x43D;&#x441; &#x43F;&#x43E;&#x434;&#x456;&#x457; (&#x421;&#x442;&#x43E;&#x440;&#x456;&#x437; 9:16)</span>
                            <button class="cs-close-btn" onclick="toggleForm('promo')">&#x2715;</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field">
                                    <label>&#x424;&#x43E;&#x442;&#x43E; (&#x444;&#x43E;&#x43D;, &#x43E;&#x43F;&#x446;&#x456;&#x439;&#x43D;&#x43E;)</label>
                                    <div class="cs-photo-pick">
                                        <div class="cs-photo-thumb" id="photo-thumb-promo" onclick="openGallery('promo')">&#x1F4F7;</div>
                                        <div class="cs-photo-pick-btns">
                                            <button type="button" class="cs-pick-gallery-btn" onclick="openGallery('promo')">📂 Вибрати з галереї</button>
                                            <button type="button" class="cs-pick-gallery-btn" onclick="pickRandomPhoto('promo')" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0">🎲 Рандомне фото</button>
                                            <span class="cs-pick-url-toggle" onclick="toggleUrlInput('promo')">&#x430;&#x431;&#x43E; &#x432;&#x441;&#x442;&#x430;&#x432;&#x438;&#x442;&#x438; URL</span>
                                            <input type="url" class="cs-photo-url-input" id="promo-photoUrl-url" placeholder="https://..." oninput="setPhotoFromUrl('promo',this.value)">
                                        </div>
                                    </div>
                                    <input type="hidden" id="promo-photoUrl" value="">
                                    <div class="cs-field-hint">&#x42F;&#x43A;&#x449;&#x43E; &#x43D;&#x435; &#x432;&#x43A;&#x430;&#x437;&#x430;&#x43D;&#x43E; &#x2014; &#x442;&#x435;&#x43C;&#x43D;&#x438;&#x439; &#x433;&#x440;&#x430;&#x434;&#x456;&#x454;&#x43D;&#x442;&#x43D;&#x438;&#x439; &#x444;&#x43E;&#x43D;</div>
                                </div>
                                <div class="cs-field"><label>&#x411;&#x435;&#x439;&#x434;&#x436; / &#x422;&#x435;&#x433;</label><input type="text" id="promo-badge" value="&#x41D;&#x41E;&#x412;&#x418;&#x419; &#x41A;&#x423;&#x420;&#x421;" placeholder="&#x412;&#x41E;&#x420;&#x41A;&#x428;&#x41E;&#x41F; &#xB7; &#x411;&#x415;&#x417;&#x41A;&#x41E;&#x428;&#x422;&#x41E;&#x412;&#x41D;&#x41E; &#xB7; ONLINE"></div>
                                <div class="cs-field"><label>&#x417;&#x430;&#x433;&#x43E;&#x43B;&#x43E;&#x432;&#x43E;&#x43A;</label><input type="text" id="promo-title" value="&#x424;&#x456;&#x43D;&#x430;&#x43D;&#x441;&#x43E;&#x432;&#x430; &#x441;&#x438;&#x441;&#x442;&#x435;&#x43C;&#x430; &#x431;&#x456;&#x437;&#x43D;&#x435;&#x441;&#x443; &#x437;&#x430; 6 &#x442;&#x438;&#x436;&#x43D;&#x456;&#x432;" placeholder="&#x41D;&#x430;&#x437;&#x432;&#x430; &#x43F;&#x43E;&#x434;&#x456;&#x457; &#x430;&#x431;&#x43E; &#x43E;&#x444;&#x435;&#x440;&#x443;"></div>
                                <div class="cs-field"><label>&#x41F;&#x456;&#x434;&#x437;&#x430;&#x433;&#x43E;&#x43B;&#x43E;&#x432;&#x43E;&#x43A;</label><input type="text" id="promo-subtitle" value="Cashflow &#xB7; P&amp;L &#xB7; &#x411;&#x430;&#x43B;&#x430;&#x43D;&#x441; &#xB7; &#x410;&#x432;&#x442;&#x43E;&#x43C;&#x430;&#x442;&#x438;&#x437;&#x430;&#x446;&#x456;&#x44F;" placeholder="&#x414;&#x435;&#x442;&#x430;&#x43B;&#x456; &#x430;&#x431;&#x43E; &#x43F;&#x435;&#x440;&#x435;&#x432;&#x430;&#x433;&#x438;"></div>
                                <div class="cs-field"><label>&#x414;&#x430;&#x442;&#x430; / &#x427;&#x430;&#x441;</label><input type="text" id="promo-date" value="" placeholder="7 &#x447;&#x435;&#x440;&#x432;&#x43D;&#x44F; &#xB7; 19:00 &#xB7; Zoom"></div>
                                <div class="cs-field"><label>CTA (&#x437;&#x430;&#x43A;&#x43B;&#x438;&#x43A; &#x434;&#x43E; &#x434;&#x456;&#x457;)</label><input type="text" id="promo-cta" value="&#x420;&#x435;&#x454;&#x441;&#x442;&#x440;&#x443;&#x439;&#x441;&#x44F; &#x437;&#x430;&#x440;&#x430;&#x437; &#x2192;" placeholder="&#x41F;&#x440;&#x438;&#x454;&#x434;&#x43D;&#x430;&#x442;&#x438;&#x441;&#x44C; &#xB7; &#x414;&#x456;&#x437;&#x43D;&#x430;&#x442;&#x438;&#x441;&#x44C; &#x431;&#x456;&#x43B;&#x44C;&#x448;&#x435;"></div>
                                <div class="cs-field">
                                    <label>&#x410;&#x43A;&#x446;&#x435;&#x43D;&#x442;&#x43D;&#x438;&#x439; &#x43A;&#x43E;&#x43B;&#x456;&#x440;</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input type="color" id="promo-accent" value="#00c48c" style="width:48px;height:36px;border:1px solid #d1d5db;border-radius:8px;padding:2px;cursor:pointer;" oninput="document.getElementById('promo-accent-text').value=this.value">
                                        <input type="text" id="promo-accent-text" value="#00c48c" style="flex:1;" oninput="syncColorText('promo-accent','promo-accent-text')">
                                    </div>
                                </div>
                                
                                <button class="cs-gen-btn" id="btn-promo" onclick="generateViaFunnel('content-image-template',{template:'promo',width:1080,height:1920},'promo')">&#x25B6; &#x417;&#x433;&#x435;&#x43D;&#x435;&#x440;&#x443;&#x432;&#x430;&#x442;&#x438;</button>
                                <div class="cs-error-box" id="err-promo"></div>
                            </div>
                            <div class="cs-panel-preview">
                                <div id="preview-promo">
                                    <div class="cs-preview-placeholder"><span>&#x1F4E3;</span><span>&#x420;&#x435;&#x437;&#x443;&#x43B;&#x44C;&#x442;&#x430;&#x442; &#x442;&#x443;&#x442;</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>


            <!-- ══ Карусель-Сторіз ══ -->
            <tr class="cs-block-header" data-filter="story"><td colspan="5">🗂 Карусель-Сторіз</td></tr>
            <tr class="cs-data-row" data-filter="story" data-id="carousel-story">
                <td>
                    <div class="cs-type-cell">
                        <div class="cs-icon cs-icon-post">🗂️</div>
                        <div>
                            <div class="cs-type-name">Карусель-Сторіз (9:16)</div>
                            <div class="cs-type-desc">Та ж карусель з безшовним фоном, але в форматі 9:16 для Stories. Всі слайди в єдиному стилі — ідеально для серії освітніх сторіз.</div><span class="cs-funnel-tag">&#128279; content-carousel</span>
                        </div>
                    </div>
                </td>
                <td><span class="cs-badge cs-badge-img">Сторіз</span></td>
                <td style="font-size:13px;color:#374151;">9:16 · 1080×1920</td>
                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>
                <td><button class="cs-launch-btn" onclick="toggleForm('carousel-story')">▶ Запустити</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-carousel-story">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">🗂️</span>
                            <span class="cs-panel-title">Карусель-Сторіз</span>
                            <button class="cs-close-btn" onclick="toggleForm('carousel-story')">✕</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field">
                                    <label>Фото (для силуету)</label>
                                    <div class="cs-photo-pick">
                                        <div class="cs-photo-thumb" id="photo-thumb-carousel-story" onclick="openGallery('carousel-story')">📷</div>
                                        <div class="cs-photo-pick-btns">
                                            <button type="button" class="cs-pick-gallery-btn" onclick="openGallery('carousel-story')">📂 Вибрати з галереї</button>
                                            <button type="button" class="cs-pick-gallery-btn" onclick="pickRandomPhoto('carousel-story')" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0">🎲 Рандомне фото</button>
                                            <span class="cs-pick-url-toggle" onclick="toggleUrlInput('carousel-story')">або вставити URL вручну</span>
                                            <input type="url" class="cs-photo-url-input" id="carousel-story-photoUrl-url" placeholder="https://..." oninput="setPhotoFromUrl('carousel-story',this.value)">
                                        </div>
                                    </div>
                                    <input type="hidden" id="carousel-story-photoUrl" value="">
                                </div>
                                <div class="cs-field">
                                    <label>Слайди (по одному на рядок: Заголовок | Підзаголовок)</label>
                                    <textarea rows="5" id="carousel-story-slides">Cashflow — основа фінансів | Знай куди йдуть гроші
P&L — реальний прибуток | Не оборот, а чистий заробіток
Баланс — активи і борги | Повна картина бізнесу</textarea>
                                    <div class="cs-field-hint">До 8 слайдів. Формат: Заголовок | Підзаголовок</div>
                                </div>
                                <div class="cs-field">
                                    <label>Колір фону</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input type="color" id="carousel-story-bgColor" value="#0f172a" style="width:48px;height:36px;border:1px solid #d1d5db;border-radius:8px;padding:2px;cursor:pointer;" oninput="document.getElementById('carousel-story-bgColor-text').value=this.value">
                                        <input type="text" id="carousel-story-bgColor-text" value="#0f172a" style="flex:1;" oninput="syncColorText('carousel-story-bgColor','carousel-story-bgColor-text')">
                                    </div>
                                </div>
                                <div class="cs-field">
                                    <label>Акцентний колір</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input type="color" id="carousel-story-accent" value="#3b82f6" style="width:48px;height:36px;border:1px solid #d1d5db;border-radius:8px;padding:2px;cursor:pointer;" oninput="document.getElementById('carousel-story-accent-text').value=this.value">
                                        <input type="text" id="carousel-story-accent-text" value="#3b82f6" style="flex:1;" oninput="syncColorText('carousel-story-accent','carousel-story-accent-text')">
                                    </div>
                                </div>
                                <div class="cs-field">
                                    <label>Стиль фону</label>
                                    <select id="carousel-story-bgStyle">
                                        <option value="flat">Монохромний</option>
                                        <option value="gradient">Градієнт (темний)</option>
                                        <option value="radial">Радіальне сяйво</option>
                                        <option value="mesh">Mesh-градієнт</option>
                                        <option value="aurora">Аврора</option>
                                        <option value="grid">Сітка</option>
                                        <option value="dots">Крапки</option>
                                    </select>
                                </div>
                                <input type="hidden" id="carousel-story-template" value="carousel-story">
                                <button class="cs-gen-btn" id="btn-carousel-story" onclick="generateCarousel('carousel-story',1080,1920)">▶ Згенерувати</button>
                                <div class="cs-error-box" id="err-carousel-story"></div>
                            </div>
                            <div class="cs-panel-preview">
                                <div id="preview-carousel-story">
                                    <div class="cs-preview-placeholder"><span>🗂️</span><span>Слайди тут</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>


            <!-- ══ ВІДЕО ══ -->
            <tr class="cs-block-header" data-filter="video"><td colspan="5">🎬 Анімована графіка (Remotion)</td></tr>

            <!-- V-1: Список тез -->
            <tr class="cs-data-row" data-filter="video" data-id="bullet-list">
                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-reel">📋</div><div><div class="cs-type-name">Рілс: список тез</div><div class="cs-type-desc">Remotion: bullet-points з'являються по черзі з анімацією. Заголовок зверху, до 6 пунктів. Рендер у .mp4 формат Reels.</div><span class="cs-funnel-tag">&#128279; content-video-basic-subs</span></div></div></td>
                <td><span class="cs-badge cs-badge-reel">Рілс</span></td>
                <td style="font-size:13px;color:#374151;">9:16 відео</td>
                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>
                <td><button class="cs-launch-btn" onclick="toggleForm('bullet-list')">▶ Запустити</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-bullet-list">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">📋</span>
                            <span class="cs-panel-title">Рілс: список тез</span>
                            <button class="cs-close-btn" onclick="toggleForm('bullet-list')">✕</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field"><label>Заголовок</label><input type="text" id="bullet-list-text" value="Фінансова система бізнесу" placeholder="Назва рілсу"></div>
                                
                                <div class="cs-field">
                                    <label>Пункти (по одному на рядок)</label>
                                    <textarea rows="4" id="bullet-list-points">Cashflow: знаєш куди йдуть гроші
P&L: бачиш реальний прибуток
Баланс: контролюєш активи і борги
Система: автоматизуєш рутину</textarea>
                                </div>
                                <div class="cs-field"><label>Тривалість (сек, необов'язково)</label><input type="number" id="bullet-list-duration" placeholder="авто"></div>
                                <div class="cs-field"><label>Якість</label>
                                    <select id="bullet-list-quality">
                                        <option value="draft">Чернетка (швидко)</option>
                                        <option value="standard">Стандарт</option>
                                        <option value="high">Висока</option>
                                    </select>
                                </div>
                                <button class="cs-gen-btn" id="btn-bullet-list" onclick="generateViaHF('social-reel','bullet-list')">▶ Згенерувати</button>
                                <div class="cs-error-box" id="err-bullet-list"></div>
                            </div>
                            <div class="cs-panel-preview"><div id="preview-bullet-list"><div class="cs-preview-placeholder"><span>🎬</span><span>Результат тут</span></div></div></div>
                        </div>
                    </div>
                </td>
            </tr>

            <!-- V-2: Bar Chart -->
            <tr class="cs-data-row" data-filter="video" data-id="bar-chart">
                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-reel">📊</div><div><div class="cs-type-name">Рілс: Bar Chart</div><div class="cs-type-desc">Remotion: стовпчики зростають зліва направо з анімацією. До 6 категорій із значеннями. Ідеально для фінансових порівнянь.</div><span class="cs-funnel-tag">&#128279; content-video-basic-subs</span></div></div></td>
                <td><span class="cs-badge cs-badge-reel">Рілс</span></td>
                <td style="font-size:13px;color:#374151;">9:16 відео</td>
                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>
                <td><button class="cs-launch-btn" onclick="toggleForm('bar-chart')">▶ Запустити</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-bar-chart">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">📊</span>
                            <span class="cs-panel-title">Рілс: Bar Chart</span>
                            <button class="cs-close-btn" onclick="toggleForm('bar-chart')">✕</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field"><label>Заголовок</label><input type="text" id="bar-chart-text" value="Cashflow за квітень 2026" placeholder="Назва графіку"></div>
                                <div class="cs-field"><label>Підзаголовок</label><input type="text" id="bar-chart-subText" value="Аналіз доходів і витрат" placeholder="Підзаголовок"></div>
                                
                                <div class="cs-field">
                                    <label>Стовпці (Назва | Значення | #колір)</label>
                                    <textarea rows="4" id="bar-chart-items">Дохід | 245000 | #00c48c
Витрати | 178000 | #ff6b6b
Прибуток | 67000 | #00d4ff</textarea>
                                </div>
                                <div class="cs-field"><label>Якість</label>
                                    <select id="bar-chart-quality">
                                        <option value="draft">Чернетка (швидко)</option>
                                        <option value="standard">Стандарт</option>
                                        <option value="high">Висока</option>
                                    </select>
                                </div>
                                <button class="cs-gen-btn" id="btn-bar-chart" onclick="generateViaHF('data-chart','bar-chart')">▶ Згенерувати</button>
                                <div class="cs-error-box" id="err-bar-chart"></div>
                            </div>
                            <div class="cs-panel-preview"><div id="preview-bar-chart"><div class="cs-preview-placeholder"><span>🎬</span><span>Результат тут</span></div></div></div>
                        </div>
                    </div>
                </td>
            </tr>

            <!-- V-3 / V-4 / V-5 / V-6 — coming soon -->
            <tr class="cs-block-header" data-filter="video"><td colspan="5">✂️ Монтаж відео</td></tr>
            <tr class="cs-data-row" data-filter="video" data-id="video-subs">
                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-reel">🎙️</div><div><div class="cs-type-name">Монтаж + статичні субтитри</div><div class="cs-type-desc">Відео → Whisper (транскрипція) → FFmpeg: автоматичне видалення пауз та єкань + статичні SRT-субтитри. Вихід: .mp4 для Reels / TikTok.</div><span class="cs-funnel-tag">&#128279; content-video-basic-subs</span></div></div></td>
                <td><span class="cs-badge cs-badge-reel">Рілс</span></td>
                <td style="font-size:13px;color:#374151;">9:16 відео</td>
                <td><span class="cs-status-dev"><span class="cs-status-dot dot-amber"></span>Потрібна форма</span></td>
                <td><button class="cs-soon-btn">🔧 Незабаром</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-video-subs">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">🎙️</span>
                            <span class="cs-panel-title">Монтаж + статичні субтитри</span>
                            <button class="cs-close-btn" onclick="toggleForm('video-subs')">✕</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field">
                                    <label>URL відео</label>
                                    <input type="url" id="video-subs-videoUrl" placeholder="https://...mp4">
                                    <div class="cs-field-hint">Публічне пряме посилання на MP4-файл (Cloudflare R2, Dropbox, Google Drive direct link)</div>
                                </div>
                                <div class="cs-field"><label>Мова</label>
                                    <select id="video-subs-lang">
                                        <option value="uk">Українська</option>
                                        <option value="ru">Російська</option>
                                        <option value="en">English</option>
                                    </select>
                                </div>
                                <div class="cs-field"><label>Розмір шрифту субтитрів</label>
                                    <select id="video-subs-fontSize">
                                        <option value="small">Малий</option>
                                        <option value="medium" selected>Середній</option>
                                        <option value="large">Великий</option>
                                    </select>
                                </div>
                                <button class="cs-gen-btn" id="btn-video-subs" onclick="generateViaVideoFunnel('content-video-basic-subs','video-subs')">▶ Згенерувати</button>
                                <div class="cs-error-box" id="err-video-subs"></div>
                            </div>
                            <div class="cs-panel-preview">
                                <div id="preview-video-subs">
                                    <div class="cs-preview-placeholder"><span>🎙️</span><span>Результат тут</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
            <tr class="cs-data-row" data-filter="video" data-id="video-karaoke">
                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-reel">🎤</div><div><div class="cs-type-name">Монтаж + karaoke субтитри</div><div class="cs-type-desc">Відео → Whisper → Remotion: karaoke-субтитри — кожне слово підсвічується і збільшується синхронно з мовленням. Ефект pulsation. Вихід: анімований .mp4.</div><span class="cs-funnel-tag">&#128279; content-video-remotion</span></div></div></td>
                <td><span class="cs-badge cs-badge-reel">Рілс</span></td>
                <td style="font-size:13px;color:#374151;">9:16 відео</td>
                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>
                <td><button class="cs-launch-btn" onclick="toggleForm('video-karaoke')">▶ Запустити</button></td>
            </tr>
            <tr class="cs-inline-row" id="form-video-karaoke">
                <td colspan="5">
                    <div class="cs-inline-panel">
                        <div class="cs-panel-header">
                            <span style="font-size:20px">🎤</span>
                            <span class="cs-panel-title">Монтаж + karaoke субтитри</span>
                            <button class="cs-close-btn" onclick="toggleForm('video-karaoke')">✕</button>
                        </div>
                        <div class="cs-panel-inner">
                            <div class="cs-panel-form">
                                <div class="cs-field">
                                    <label>URL відео</label>
                                    <input type="url" id="video-karaoke-videoUrl" placeholder="https://...mp4">
                                    <div class="cs-field-hint">Whisper транскрибує мовлення, Remotion відрендерить karaoke-ефект</div>
                                </div>
                                <div class="cs-field"><label>Мова</label>
                                    <select id="video-karaoke-lang">
                                        <option value="uk">Українська</option>
                                        <option value="ru">Російська</option>
                                        <option value="en">English</option>
                                    </select>
                                </div>
                                <div class="cs-field">
                                    <label>Колір підсвітки слів</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input type="color" id="video-karaoke-highlightColor" value="#f59e0b" style="width:48px;height:36px;border:1px solid #d1d5db;border-radius:8px;padding:2px;cursor:pointer;" oninput="document.getElementById('video-karaoke-highlightColor-text').value=this.value">
                                        <input type="text" id="video-karaoke-highlightColor-text" value="#f59e0b" style="flex:1;" oninput="syncColorText('video-karaoke-highlightColor','video-karaoke-highlightColor-text')">
                                    </div>
                                </div>
                                <button class="cs-gen-btn" id="btn-video-karaoke" onclick="generateViaVideoFunnel('content-video-remotion','video-karaoke')">▶ Згенерувати</button>
                                <div class="cs-error-box" id="err-video-karaoke"></div>
                            </div>
                            <div class="cs-panel-preview">
                                <div id="preview-video-karaoke">
                                    <div class="cs-preview-placeholder"><span>🎤</span><span>Результат тут</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
            <tr class="cs-block-header" data-filter="video"><td colspan="5">🤖 Аватар</td></tr>
            <tr class="cs-data-row" data-filter="video" data-id="avatar-heygen">
                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-reel">🤖</div><div><div class="cs-type-name">Talking Head: HeyGen аватар</div><div class="cs-type-desc">Сценарій → HeyGen → відео з цифровим аватаром і клонованим голосом</div></div></div></td>
                <td><span class="cs-badge cs-badge-reel">Рілс</span></td>
                <td style="font-size:13px;color:#374151;">9:16 відео</td>
                <td><span class="cs-status-dev"><span class="cs-status-dot dot-amber"></span>Потрібен API-ключ</span></td>
                <td><button class="cs-soon-btn" title="Потребує налаштування HeyGen API">🔑 API</button></td>
            </tr>
            <tr class="cs-data-row" data-filter="video" data-id="avatar-budget">
                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-reel">🎭</div><div><div class="cs-type-name">Talking Head: Бюджетний (~$0.20)</div><div class="cs-type-desc">ElevenLabs озвучує текст → LivePortrait оживляє фото синхронно зі звуком</div></div></div></td>
                <td><span class="cs-badge cs-badge-reel">Рілс</span></td>
                <td style="font-size:13px;color:#374151;">9:16 відео</td>
                <td><span class="cs-status-dev"><span class="cs-status-dot dot-amber"></span>Потрібен API-ключ</span></td>
                <td><button class="cs-soon-btn" title="Потребує налаштування ElevenLabs API">🔑 API</button></td>
            </tr>

        </tbody>
    </table>

    <div style="font-size:12px;color:#9ca3af;text-align:center;padding-bottom:24px;margin-top:4px;">
        <strong style="color:#22c55e">9 готових</strong> (Силует×2 + Карусель + Solid/Photo/SocProof/Promo + Субтитри×2) ·
        <strong style="color:#d97706">2 потребують API-ключ</strong> (HeyGen, ElevenLabs) ·
        <strong style="color:#6b7280">2 потребують налаштування</strong> (Список тез, Bar Chart — HyperFrames)
    </div>
</div>

<script>
const HF_API = 'https://hyperframes.flows.fineko.space';

// ── Filter tabs ──
function applyFilter(filter) {
    document.querySelectorAll('.cs-data-row, .cs-block-header').forEach(row => {
        const match = row.dataset.filter === filter;
        row.style.display = match ? '' : 'none';
        if (!match && row.classList.contains('cs-data-row')) {
            const fRow = document.getElementById('form-' + row.dataset.id);
            if (fRow) fRow.classList.remove('open');
        }
    });
}
document.querySelectorAll('.cs-tab').forEach(tab => {
    tab.addEventListener('click', function () {
        document.querySelectorAll('.cs-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        applyFilter(this.dataset.filter);
    });
});
// init: show story tab on load
applyFilter('story');

// ── Toggle inline form ──
function toggleForm(id) {
    const formRow = document.getElementById('form-' + id);
    const isOpen = formRow.classList.contains('open');
    document.querySelectorAll('.cs-inline-row.open').forEach(r => r.classList.remove('open'));
    if (!isOpen) {
        formRow.classList.add('open');
        setTimeout(() => formRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
}

// ── Photo picker ──
let _currentPickerPrefix = null;
let _pickerSelectedUrl = null;
let _galleryImages = null; // cache

function openGallery(prefix) {
    _currentPickerPrefix = prefix;
    _pickerSelectedUrl = null;
    document.getElementById('pg-overlay').classList.add('open');
    document.getElementById('pg-select-btn').disabled = true;
    document.getElementById('pg-selected-name').textContent = '';
    document.querySelectorAll('.pg-img-item').forEach(el => el.classList.remove('selected'));
    loadGallery();
}

function closeGallery() {
    document.getElementById('pg-overlay').classList.remove('open');
    _currentPickerPrefix = null;
    _pickerSelectedUrl = null;
}

async function loadGallery(forceRefresh) {
    const grid = document.getElementById('pg-grid');
    if (_galleryImages && !forceRefresh) {
        renderGallery(_galleryImages);
        return;
    }
    grid.innerHTML = '<div class="pg-empty">Завантажую...</div>';
    try {
        const resp = await fetch('/api/source-images');
        const images = await resp.json();
        _galleryImages = images;
        renderGallery(images);
    } catch (e) {
        grid.innerHTML = '<div class="pg-empty">Помилка завантаження галереї</div>';
    }
}

function renderGallery(images) {
    const grid = document.getElementById('pg-grid');
    if (!images || images.length === 0) {
        grid.innerHTML = '<div class="pg-empty">📷 Поки нема фото<br><small>Завантаж перше фото вище</small></div>';
        return;
    }
    grid.innerHTML = images.map(img => `
        <div class="pg-img-item" onclick="pgSelectImage(window.location.origin+'${img.url}','${img.filename}',this)">
            <img src="${img.url}" alt="${img.filename}" loading="lazy">
            <div class="pg-img-name">${img.filename}</div>
            <div class="pg-img-check">✓</div>
        </div>`).join('');
}

function pgSelectImage(url, filename, el) {
    document.querySelectorAll('.pg-img-item').forEach(i => i.classList.remove('selected'));
    el.classList.add('selected');
    _pickerSelectedUrl = url;
    document.getElementById('pg-selected-name').textContent = filename;
    document.getElementById('pg-select-btn').disabled = false;
}

function confirmGallerySelect() {
    if (!_pickerSelectedUrl || !_currentPickerPrefix) return;
    setPhotoForPrefix(_currentPickerPrefix, _pickerSelectedUrl);
    closeGallery();
}

function setPhotoForPrefix(prefix, url) {
    document.getElementById(prefix + '-photoUrl').value = url;
    const thumb = document.getElementById('photo-thumb-' + prefix);
    if (thumb) {
        thumb.innerHTML = `<img src="${url}" alt="photo">`;
    }
}

function toggleUrlInput(prefix) {
    const inp = document.getElementById(prefix + '-photoUrl-url');
    if (!inp) return;
    const isVisible = inp.style.display === 'block';
    inp.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) inp.focus();
}

function setPhotoFromUrl(prefix, url) {
    document.getElementById(prefix + '-photoUrl').value = url;
    const thumb = document.getElementById('photo-thumb-' + prefix);
    if (thumb && url) {
        thumb.innerHTML = `<img src="${url}" alt="photo">`;
    }
}

// ── Upload in gallery modal ──
function pgDragOver(e) { e.preventDefault(); document.getElementById('pg-upload-zone').classList.add('drag-over'); }
function pgDragLeave(e) { document.getElementById('pg-upload-zone').classList.remove('drag-over'); }
function pgDrop(e) {
    e.preventDefault();
    document.getElementById('pg-upload-zone').classList.remove('drag-over');
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (files.length) pgUploadFiles(files);
}

async function pgUploadFile(input) {
    const files = [...input.files];
    if (!files.length) return;
    await pgUploadFiles(files);
    input.value = '';
}

async function pgUploadFiles(files) {
    const status = document.getElementById('pg-upload-status');
    status.style.display = 'block';
    let done = 0, failed = 0;
    for (const file of files) {
        status.textContent = `Завантаження ${done + 1}/${files.length}...`;
        const formData = new FormData();
        formData.append('source_image', file);
        try {
            const resp = await fetch('/images/upload-ajax', { method: 'POST', body: formData });
            const json = await resp.json();
            if (json.ok) done++; else failed++;
        } catch (e) { failed++; }
    }
    _galleryImages = null;
    await loadGallery(true);
    status.textContent = failed
        ? `✅ ${done} завантажено, ❌ ${failed} помилок`
        : `✅ ${done} фото завантажено`;
    if (done > 0) {
        const newItem = document.querySelector('.pg-img-item');
        if (newItem) newItem.click();
    }
}

async function pickRandomPhoto(prefix) {
    if (!_galleryImages) {
        const resp = await fetch('/api/source-images');
        _galleryImages = await resp.json();
    }
    if (!_galleryImages || !_galleryImages.length) return;
    const img = _galleryImages[Math.floor(Math.random() * _galleryImages.length)];
    const url = window.location.origin + img.url;
    setPhotoForPrefix(prefix, url);
}

// ── Generate via Funnel ──
async function generateViaFunnel(funnelSlug, extraParams, prefix) {
    const btn = document.getElementById('btn-' + prefix);
    const errBox = document.getElementById('err-' + prefix);
    const previewDiv = document.getElementById('preview-' + prefix);

    const params = {
        photoUrl:    document.getElementById(prefix + '-photoUrl')?.value?.trim() || '',
        text:        document.getElementById(prefix + '-text')?.value?.trim() || '',
        subText:     document.getElementById(prefix + '-subText')?.value?.trim() || '',
        title:       document.getElementById(prefix + '-title')?.value?.trim() || '',
        subtitle:    document.getElementById(prefix + '-subtitle')?.value?.trim() || '',
        quote:       document.getElementById(prefix + '-quote')?.value?.trim() || '',
        author:      document.getElementById(prefix + '-author')?.value?.trim() || '',
        result:      document.getElementById(prefix + '-result')?.value?.trim() || '',
        date:        document.getElementById(prefix + '-date')?.value?.trim() || '',
        cta:         document.getElementById(prefix + '-cta')?.value?.trim() || '',
        bgColor:     document.getElementById(prefix + '-bgColor')?.value?.trim() || '',
        accent:      document.getElementById(prefix + '-accent')?.value?.trim() || '',
        badge:       document.getElementById(prefix + '-badge')?.value?.trim() || '',
        brandHandle: document.getElementById(prefix + '-brandHandle')?.value?.trim() || '',
        template:    document.getElementById(prefix + '-template')?.value || 'default',
        bgStyle:     document.getElementById(prefix + '-bgStyle')?.value || 'flat',
        extra:       document.getElementById(prefix + '-extra')?.value?.trim() || '',
        showArrow:   document.getElementById(prefix + '-showArrow')?.value || 'no',
        tag:         document.getElementById(prefix + '-tag')?.value?.trim() || '',
        ...extraParams,
    };

    if (funnelSlug === 'content-stories-generator') {
        if (!params.photoUrl) {
            errBox.textContent = 'Вибери або завантаж фото для генерації';
            errBox.style.display = 'block';
            return;
        }
        if (!params.text) {
            errBox.textContent = 'Вкажи заголовок';
            errBox.style.display = 'block';
            return;
        }
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Запускаємо...';
    errBox.style.display = 'none';
    previewDiv.innerHTML = `
        <div class="cs-preview-placeholder">
            <span>⏳</span><span>Обробка...</span>
        </div>
        <div class="cs-progress"><div class="cs-progress-bar"></div></div>
        <div style="font-size:11px;color:#6b7280;">~30–60 секунд</div>`;

    let jobId = null;
    try {
        const resp = await fetch('/api/content-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ funnel: funnelSlug, params }),
        });
        const json = await resp.json();
        if (!resp.ok || json.error) throw new Error(json.error || 'Помилка запуску');
        jobId = json.jobId;
    } catch (e) {
        showError(prefix, e.message);
        btn.disabled = false;
        btn.innerHTML = '▶ Згенерувати';
        return;
    }

    btn.innerHTML = '<div class="spinner"></div> Генеруємо...';
    const result = await pollStatus(jobId, prefix);
    btn.disabled = false;
    btn.innerHTML = '▶ Згенерувати';
    if (!result) return;
    showImageResult(result, prefix, funnelSlug, extraParams);
}

async function pollStatus(jobId, prefix) {
    const maxAttempts = 40;
    for (let i = 0; i < maxAttempts; i++) {
        await sleep(4000);
        try {
            const resp = await fetch('/api/content-status?jobId=' + jobId);
            const job = await resp.json();
            if (job.status === 'done') return job;
            if (job.status === 'error') {
                showError(prefix, job.error || 'Помилка генерації');
                return null;
            }
        } catch (e) { /* network glitch, keep polling */ }
    }
    showError(prefix, 'Тайм-аут. Спробуй ще раз.');
    return null;
}

function showImageResult(job, prefix, funnelSlug, extraParams, _w, _h) {
    const previewDiv = document.getElementById('preview-' + prefix);
    if (job.mediaType === 'image') {
        const src = 'data:' + (job.contentType || 'image/png') + ';base64,' + job.imageBase64;
        previewDiv.innerHTML = `
            <div class="cs-img-box">
                <img src="${src}" alt="Згенероване зображення">
            </div>
            <div class="cs-result-actions">
                <a class="cs-action-btn" href="${src}" download="content.png">⬇ Завантажити</a>
            </div>
            <button class="cs-regen-btn" onclick="generateViaFunnel('${funnelSlug}',${JSON.stringify(extraParams)},'${prefix}')">↻ Перегенерувати</button>`;
    } else if (job.mediaType === 'video') {
        const videoUrl = job.videoUrl || job.videoPath || '';
        if (!videoUrl) { showError(prefix, 'Відео не знайдено у відповіді'); return; }
        previewDiv.innerHTML = `
            <div class="cs-video-box">
                <video id="vid-${prefix}" src="${videoUrl}" controls loop playsinline></video>
            </div>
            <div style="font-size:11px;color:#6b7280;text-align:center;">9:16 відео</div>
            <div class="cs-result-actions">
                <a class="cs-action-btn" href="${videoUrl}" download target="_blank">⬇ Завантажити</a>
                <button class="cs-action-btn" onclick="copyUrl('${videoUrl}',this)">🔗 URL</button>
            </div>`;
        document.getElementById('vid-' + prefix)?.play();
    } else if (job.mediaType === 'carousel') {
        const slides = job.slidesBase64 || [];
        const dlLinks = slides.map((b64, i) =>
            `<a class="cs-action-btn" href="${b64}" download="slide_${i+1}.png">⬇${i+1}</a>`
        ).join('');
        const imgTags = slides.map((b64, i) =>
            `<img src="${b64}" title="Слайд ${i+1}">`
        ).join('');
        previewDiv.innerHTML = `
            <div style="font-size:13px;font-weight:600;color:#374151;">${slides.length} слайдів</div>
            <div class="cs-slides-strip">${imgTags}</div>
            <div class="cs-result-actions" style="max-width:440px;flex-wrap:wrap;">${dlLinks}</div>
            <button class="cs-regen-btn" style="width:100%;margin-top:4px;" onclick="generateCarousel('${prefix}',${_w||1080},${_h||1350})">↻ Перегенерувати</button>`;
    }
}

// ── Generate Carousel ──
async function generateCarousel(prefix='carousel', width=1080, height=1350) {
    const btn = document.getElementById('btn-' + prefix);
    const errBox = document.getElementById('err-' + prefix);
    const previewDiv = document.getElementById('preview-' + prefix);

    const rawSlides = (document.getElementById(prefix + '-slides')?.value || '').trim();
    if (!rawSlides) { errBox.textContent = 'Додай хоча б один слайд'; errBox.style.display = 'block'; return; }

    const slides = rawSlides.split('\n').map(line => {
        const [text, subText] = line.split('|').map(s => s.trim());
        return { text: text || '', subText: subText || '' };
    }).filter(s => s.text);

    if (slides.length < 2) { errBox.textContent = 'Потрібно мінімум 2 слайди'; errBox.style.display = 'block'; return; }

    const photoUrl = document.getElementById(prefix + '-photoUrl')?.value?.trim() || '';
    if (!photoUrl) { errBox.textContent = 'Вибери або завантаж фото'; errBox.style.display = 'block'; return; }

    const params = {
        photoUrl,
        template: document.getElementById(prefix + '-template')?.value || 'default',
        slides,
        width,
        height,
        bgColor: document.getElementById(prefix + '-bgColor')?.value?.trim() || '#0f172a',
        accent:  document.getElementById(prefix + '-accent')?.value?.trim()  || '#3b82f6',
        bgStyle: document.getElementById(prefix + '-bgStyle')?.value || 'flat',
    };

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Запускаємо...';
    errBox.style.display = 'none';
    previewDiv.innerHTML = `<div class="cs-preview-placeholder"><span>⏳</span><span>Будуємо карусель...</span></div>
        <div class="cs-progress"><div class="cs-progress-bar"></div></div>
        <div style="font-size:11px;color:#6b7280;">~45–90 секунд</div>`;

    let jobId = null;
    try {
        const resp = await fetch('/api/content-generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ funnel: 'content-carousel', params }),
        });
        const json = await resp.json();
        if (!resp.ok || json.error) throw new Error(json.error || 'Помилка запуску');
        jobId = json.jobId;
    } catch (e) {
        showError(prefix, e.message); btn.disabled = false; btn.innerHTML = '▶ Згенерувати'; return;
    }

    btn.innerHTML = '<div class="spinner"></div> Генеруємо...';
    const result = await pollStatus(jobId, prefix);
    btn.disabled = false;
    btn.innerHTML = '▶ Згенерувати';
    if (!result) return;
    showImageResult(result, prefix, 'content-carousel', {}, width, height);
}

// ── Generate via HyperFrames ──
async function generateViaHF(template, prefix) {
    const btn = document.getElementById('btn-' + prefix);
    const errBox = document.getElementById('err-' + prefix);
    const previewDiv = document.getElementById('preview-' + prefix);
    const quality = document.getElementById(prefix + '-quality')?.value || 'draft';

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Рендеримо...';
    errBox.style.display = 'none';
    previewDiv.innerHTML = `<div class="cs-preview-placeholder"><span>⏳</span><span>1–2 хвилини...</span></div>`;

    try {
        const data = buildHFData(template, prefix);
        const resp = await fetch(HF_API + '/render/template', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template, data, quality, fps: 24 }),
        });
        const json = await resp.json();
        if (!resp.ok || json.error) throw new Error(json.error || 'Помилка рендеру');

        previewDiv.innerHTML = `
            <div class="cs-video-box">
                <video id="vid-${prefix}" src="${json.videoUrl}" controls loop playsinline></video>
            </div>
            <div style="font-size:11px;color:#6b7280;text-align:center;">${json.duration ? json.duration + 'с · ' : ''}9:16</div>
            <div class="cs-result-actions">
                <a class="cs-action-btn" href="${json.videoUrl}" download target="_blank">⬇ Завантажити</a>
                <button class="cs-action-btn" onclick="copyUrl('${json.videoUrl}',this)">🔗 URL</button>
            </div>
            <button class="cs-regen-btn" onclick="generateViaHF('${template}','${prefix}')">↻ Перегенерувати</button>`;
        document.getElementById('vid-' + prefix)?.play();
    } catch (e) {
        showError(prefix, e.message);
        previewDiv.innerHTML = '<div class="cs-preview-placeholder"><span>⚠️</span><span>Помилка</span></div>';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '▶ Згенерувати';
    }
}

function buildHFData(template, prefix) {
    if (template === 'social-reel') {
        const dur = document.getElementById(prefix + '-duration')?.value;
        const raw = document.getElementById(prefix + '-points')?.value || '';
        return {
            text: document.getElementById(prefix + '-text')?.value || '',
            brandHandle: document.getElementById(prefix + '-brandHandle')?.value || '',
            points: raw.split('\n').map(s => s.trim()).filter(Boolean),
            ...(dur ? { duration: Number(dur) } : {}),
        };
    }
    if (template === 'data-chart') {
        const raw = document.getElementById(prefix + '-items')?.value || '';
        return {
            text: document.getElementById(prefix + '-text')?.value || '',
            subText: document.getElementById(prefix + '-subText')?.value || '',
            brandHandle: document.getElementById(prefix + '-brandHandle')?.value || '',
            items: raw.split('\n').map(s => {
                const [label, value, color] = s.split('|').map(x => x.trim());
                return { label, value: Number(value) || 0, color: color || '#00d4ff' };
            }).filter(i => i.label),
        };
    }
    return {};
}

// ── Generate via Video Funnel ──
async function generateViaVideoFunnel(funnelSlug, prefix) {
    const btn = document.getElementById('btn-' + prefix);
    const errBox = document.getElementById('err-' + prefix);
    const previewDiv = document.getElementById('preview-' + prefix);

    const videoUrl = document.getElementById(prefix + '-videoUrl')?.value?.trim() || '';
    if (!videoUrl) {
        errBox.textContent = 'Вкажи публічне URL відео (MP4)';
        errBox.style.display = 'block';
        return;
    }

    const params = {
        videoUrl,
        lang:           document.getElementById(prefix + '-lang')?.value || 'uk',
        fontSize:       document.getElementById(prefix + '-fontSize')?.value || 'medium',
        highlightColor: document.getElementById(prefix + '-highlightColor')?.value || '#f59e0b',
    };

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Запускаємо...';
    errBox.style.display = 'none';
    previewDiv.innerHTML = `
        <div class="cs-preview-placeholder">
            <span>⏳</span><span>Монтаж відео...</span>
        </div>
        <div class="cs-progress"><div class="cs-progress-bar"></div></div>
        <div style="font-size:11px;color:#6b7280;">3–10 хвилин</div>`;

    let jobId = null;
    try {
        const resp = await fetch('/api/content-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ funnel: funnelSlug, params }),
        });
        const json = await resp.json();
        if (!resp.ok || json.error) throw new Error(json.error || 'Помилка запуску');
        jobId = json.jobId;
    } catch (e) {
        showError(prefix, e.message);
        btn.disabled = false;
        btn.innerHTML = '▶ Згенерувати';
        return;
    }

    btn.innerHTML = '<div class="spinner"></div> Обробляємо...';
    const result = await pollStatus(jobId, prefix);
    btn.disabled = false;
    btn.innerHTML = '▶ Згенерувати';
    if (!result) return;
    showImageResult(result, prefix, funnelSlug, {});
}

// ── Helpers ──
function syncColorText(pickerId, textId) {
    const text = document.getElementById(textId);
    const picker = document.getElementById(pickerId);
    if (!text || !picker) return;
    if (/^#[0-9a-fA-F]{6}$/.test(text.value)) picker.value = text.value;
}

function showError(prefix, msg) {
    const errBox = document.getElementById('err-' + prefix);
    const previewDiv = document.getElementById('preview-' + prefix);
    errBox.textContent = msg;
    errBox.style.display = 'block';
    previewDiv.innerHTML = '<div class="cs-preview-placeholder"><span>⚠️</span><span>Помилка</span></div>';
}

function copyUrl(url, btn) {
    navigator.clipboard.writeText(url).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✅ Ок';
        setTimeout(() => { btn.textContent = orig; }, 2000);
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
</script>
</body>
</html>
