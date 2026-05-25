<!DOCTYPE html>
<html lang="uk">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Соц.мережі — Content Planner Bot</title>
    <link rel="stylesheet" href="/style.css">
    <style>
        .network-row {
            background: white;
            border-radius: 12px;
            padding: 18px;
            margin-bottom: 12px;
            border-left: 4px solid #5a6c7d;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 20px;
        }

        .network-row:hover {
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }

        .network-info {
            flex: 1;
        }

        .network-name {
            font-size: 16px;
            font-weight: 600;
            margin: 0;
            color: #2d3748;
        }

        .network-meta {
            font-size: 13px;
            color: #7f8c8d;
            margin: 8px 0 0 0;
        }

        .network-actions {
            display: flex;
            gap: 12px;
            align-items: center;
        }

        .toggle-switch {
            width: 50px;
            height: 28px;
            background: #e0e0e0;
            border-radius: 14px;
            cursor: pointer;
            border: none;
            position: relative;
            transition: background 0.3s;
        }

        .toggle-switch.active {
            background: #52c77a;
        }

        .toggle-switch::after {
            content: '';
            position: absolute;
            width: 24px;
            height: 24px;
            background: white;
            border-radius: 12px;
            top: 2px;
            left: 2px;
            transition: left 0.3s;
        }

        .toggle-switch.active::after {
            left: 24px;
        }

        .edit-btn,
        .delete-btn {
            padding: 8px 12px;
            font-size: 13px;
            border: 1px solid #ddd;
            border-radius: 6px;
            cursor: pointer;
            background: white;
            transition: all 0.2s;
        }

        .small-btn {
            padding: 7px 10px;
            font-size: 12px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            cursor: pointer;
            background: white;
        }

        .toggle-label {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            user-select: none;
            font-size: 13px;
            color: #475569;
        }

        .toggle-label input[type="checkbox"] {
            appearance: none;
            -webkit-appearance: none;
            width: 40px;
            height: 22px;
            background: #d1d5db;
            border-radius: 11px;
            position: relative;
            cursor: pointer;
            transition: background 0.25s;
            flex-shrink: 0;
        }

        .toggle-label input[type="checkbox"]:checked {
            background: #52c77a;
        }

        .toggle-label input[type="checkbox"]::after {
            content: '';
            position: absolute;
            width: 16px;
            height: 16px;
            background: white;
            border-radius: 50%;
            top: 3px;
            left: 3px;
            transition: left 0.25s;
        }

        .toggle-label input[type="checkbox"]:checked::after {
            left: 21px;
        }

        .toggle-status {
            font-size: 11px;
            color: #64748b;
            min-width: 60px;
        }

        .toggle-status.saving { color: #94a3b8; }
        .toggle-status.saved  { color: #16a34a; }
        .toggle-status.error  { color: #dc2626; }

        .edit-btn:hover {
            background: #f0f0f0;
            border-color: #5a6c7d;
        }

        .delete-btn:hover {
            background: #fff5f5;
            border-color: #e8675f;
            color: #e8675f;
        }
    </style>
</head>

<body>
    <?php require __DIR__ . '/components/topbar.php'; ?>
    
    <div class="container">
        <div style="background:white;border-radius:10px;padding:28px;box-shadow:var(--shadow);">
            <h2>📱 Соціальні мережі</h2>
            <p style="color:#7f8c8d;margin-bottom:20px;font-size:14px;">Налаштуйте соціальні мережі та промпти для
                автоматичного генерування контенту.</p>

            <?php if (!empty($_GET['created'])): ?>
                <div style="background:#ecfdf5;border:1px solid #86efac;color:#166534;padding:10px 12px;border-radius:8px;margin-bottom:14px;">
                    Соц.мережу додано ✅</div>
            <?php endif; ?>
            <?php if (!empty($_GET['deleted'])): ?>
                <div style="background:#ecfdf5;border:1px solid #86efac;color:#166534;padding:10px 12px;border-radius:8px;margin-bottom:14px;">
                    Соц.мережу видалено ✅</div>
            <?php endif; ?>
            <?php if (!empty($_GET['error'])): ?>
                <div style="background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;padding:10px 12px;border-radius:8px;margin-bottom:14px;">
                    <?php
                    $err = $_GET['error'];
                    if ($err === 'empty_name') echo 'Введіть назву соц.мережі';
                    elseif ($err === 'duplicate_name') echo 'Соц.мережа з такою назвою вже існує';
                    elseif ($err === 'cannot_delete_default') echo 'Стандартні соц.мережі не можна видаляти';
                    else echo htmlspecialchars($err, ENT_QUOTES, 'UTF-8');
                    ?>
                </div>
            <?php endif; ?>

            <p style="color:#64748b;font-size:13px;margin-bottom:16px;">Категорії редагуються окремо для кожної
                соцмережі.</p>

            <?php
            $networkEmojis = [
                'Threads Posts'     => '🔗',
                'Instagram Posts'   => '📸',
                'Instagram Stories' => '🎬',
                'Instagram Reels'   => '🎞️',
                'YouTube Shorts'    => '🎥',
                'TikTok'            => '🎵',
            ];
            ?>
            <div id="networks">
                <?php foreach ($networksData as $name => $data):
                    $emoji = $networkEmojis[$name] ?? '📡';
                    $isDefault = in_array($name, $defaultNetworkNames, true);
                ?>
                <div class="network-row">
                    <div class="network-info">
                        <p class="network-name"><?php echo $emoji . ' ' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8'); ?></p>
                        <p class="network-meta">Категорій: <?php echo (int) $data['categories_count']; ?></p>
                    </div>
                    <div class="network-actions">
                        <label class="toggle-label">
                            <input type="checkbox" class="network-status-toggle"
                                data-network-id="<?php echo (int) $data['id']; ?>"
                                <?php echo $data['is_enabled'] ? 'checked' : ''; ?>>
                            Увімкнено
                        </label>
                        <span class="toggle-status" data-network-id="<?php echo (int) $data['id']; ?>"></span>
                        <button class="edit-btn" onclick="editNetwork(<?php echo (int) $data['id']; ?>)">✏️ Редагувати</button>
                        <?php if (!$isDefault): ?>
                        <form method="POST" action="/social-networks/delete" style="display:inline;"
                            onsubmit="return confirm('Видалити цю соц.мережу? Всі пов\'язані категорії та пости будуть видалені.');">
                            <input type="hidden" name="network_id" value="<?php echo (int) $data['id']; ?>">
                            <input type="hidden" name="project_id" value="<?php echo (int) $active_project_id; ?>">
                            <button type="submit" class="delete-btn" title="Видалити">🗑️</button>
                        </form>
                        <?php endif; ?>
                    </div>
                </div>
                <?php endforeach; ?>
            </div>

            <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:20px;">
                <button type="button" class="edit-btn" onclick="toggleCreateForm()" id="addNetworkBtn" style="font-size:14px;">➕ Додати соц.мережу</button>
                <div id="createNetworkForm" style="display:none;margin-top:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;">
                    <h3 style="margin-top:0;font-size:16px;color:#1e293b;">Нова соц.мережа</h3>
                    <form method="POST" action="/social-networks/create">
                        <input type="hidden" name="project_id" value="<?php echo (int) $active_project_id; ?>">
                        <div style="margin-bottom:12px;">
                            <label style="display:block;font-weight:600;color:#334155;margin-bottom:6px;font-size:14px;">Назва</label>
                            <input type="text" name="name" placeholder="Наприклад: LinkedIn, Pinterest..." required
                                style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
                        </div>
                        <div style="margin-bottom:16px;">
                            <label style="display:block;font-weight:600;color:#334155;margin-bottom:6px;font-size:14px;">Промпт (необов'язково)</label>
                            <textarea name="prompt" rows="3" placeholder="Напишіть пост на тему &quot;{category}&quot; про &quot;{topic}&quot;."
                                style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;"></textarea>
                        </div>
                        <div style="display:flex;gap:10px;">
                            <button type="submit" class="edit-btn" style="background:#5a6c7d;color:white;border-color:#5a6c7d;">Зберегти</button>
                            <button type="button" class="edit-btn" onclick="toggleCreateForm()">Скасувати</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>

    <script>
        function toggleCreateForm() {
            const form = document.getElementById('createNetworkForm');
            const btn = document.getElementById('addNetworkBtn');
            if (form.style.display === 'none') {
                form.style.display = 'block';
                btn.textContent = '✕ Закрити';
            } else {
                form.style.display = 'none';
                btn.textContent = '➕ Додати соц.мережу';
            }
        }

        function editNetwork(networkId) {
            const projectId = <?php echo (int) $active_project_id; ?>;
            location.href = '/social-networks/edit?id=' + networkId + '&project_id=' + projectId;
        }

        document.addEventListener('DOMContentLoaded', function () {
            document.querySelectorAll('.network-status-toggle').forEach(function (checkbox) {
                checkbox.addEventListener('change', function () {
                    const networkId = this.getAttribute('data-network-id');
                    const isEnabled = this.checked ? 1 : 0;
                    const statusEl = document.querySelector('.toggle-status[data-network-id="' + networkId + '"]');

                    if (statusEl) { statusEl.textContent = '...'; statusEl.className = 'toggle-status saving'; }

                    const formData = new FormData();
                    formData.append('network_id', networkId);
                    formData.append('is_enabled', isEnabled);

                    fetch('/social-networks/status', {
                        method: 'POST',
                        headers: { 'X-Requested-With': 'XMLHttpRequest' },
                        body: formData
                    })
                        .then(r => r.json())
                        .then(data => {
                            if (!data || !data.ok) throw new Error(data && data.error ? data.error : 'error');
                            if (statusEl) {
                                statusEl.textContent = isEnabled ? 'Увімкнено ✅' : 'Вимкнено';
                                statusEl.className = 'toggle-status saved';
                                setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'toggle-status'; }, 2000);
                            }
                        })
                        .catch(err => {
                            console.error('Помилка збереження статусу:', err);
                            // Відкатуємо чекбокс назад
                            checkbox.checked = !checkbox.checked;
                            if (statusEl) { statusEl.textContent = 'Помилка ❌'; statusEl.className = 'toggle-status error'; }
                        });
                });
            });
        });
    </script>
</body>

</html>