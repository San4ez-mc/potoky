<!DOCTYPE html>
<html lang="uk">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Доступи до проектів — Content Planner Bot</title>
    <link rel="stylesheet" href="/style.css">
</head>

<body>
    <div class="topbar">
        <div class="logo">📋 Content Planner Bot</div>
        <div class="menu">
            <a href="/">Контент план</a>
            <a href="/social-networks">Соц.мережі</a>
            <a href="/settings">Налаштування</a>
            <a href="/project-access">Доступи</a>
        </div>
        <a href="/logout" class="logout-link">🚪 Вийти</a>
    </div>

    <div class="container">
        <div style="background:white;border-radius:10px;padding:28px;box-shadow:var(--shadow);">
            <h2>🔐 Доступи адмінів до проектів</h2>
            <p style="color:#64748b;font-size:14px;">Оберіть, до яких проектів має доступ кожен користувач.</p>

            <?php if (!empty($_GET['saved'])): ?>
                <div style="background:#ecfdf5;border:1px solid #86efac;color:#166534;padding:10px 12px;border-radius:8px;margin-bottom:14px;">
                    Доступи збережено ✅
                </div>
            <?php endif; ?>

            <form method="POST" action="/project-access/save">
                <table class="content-table" style="width:100%;margin-top:14px;">
                    <thead>
                        <tr>
                            <th style="width:220px;">Адмін</th>
                            <?php foreach ($projects as $project): ?>
                                <th style="text-align:center;">
                                    <?php echo htmlspecialchars($project['name'], ENT_QUOTES, 'UTF-8'); ?>
                                    <div style="font-size:11px;color:#cbd5e1;">ID: <?php echo (int)$project['id']; ?></div>
                                </th>
                            <?php endforeach; ?>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($admins as $admin): ?>
                            <tr>
                                <td><strong><?php echo htmlspecialchars($admin['username'], ENT_QUOTES, 'UTF-8'); ?></strong></td>
                                <?php foreach ($projects as $project): ?>
                                    <td style="text-align:center;">
                                        <input
                                            type="checkbox"
                                            name="access[<?php echo (int)$admin['id']; ?>][]"
                                            value="<?php echo (int)$project['id']; ?>"
                                            <?php echo !empty($accessMap[(int)$admin['id']][(int)$project['id']]) ? 'checked' : ''; ?>
                                        >
                                    </td>
                                <?php endforeach; ?>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>

                <div style="margin-top:18px;">
                    <button type="submit" class="submit-btn">💾 Зберегти доступи</button>
                </div>
            </form>
        </div>
    </div>
</body>

</html>
