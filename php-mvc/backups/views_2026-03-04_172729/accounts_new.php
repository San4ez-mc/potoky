<!DOCTYPE html>
<html lang="uk">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Акаунти — Content Planner Bot</title>
    <link rel="stylesheet" href="/style.css">
</head>

<body>
    <div class="topbar">
        <div class="logo">📋 Content Planner Bot</div>
        <div class="menu">
            <a href="/accounts">Акаунти</a>
            <a href="/rubrics">Рубрики</a>
        </div>
        <a href="/logout" class="logout-link">🚪 Вийти</a>
    </div>
    <div class="container">
        <h2>📱 Список соцмереж акаунтів</h2>
        <button class="add-btn" onclick="location.href='/accounts/add'">+ Додати акаунт</button>
        <table>
            <tr>
                <th>Назва</th>
                <th>Платформа</th>
                <th>Chat ID</th>
                <th>Статус</th>
                <th>Дії</th>
            </tr>
            <?php if (empty($accounts)): ?>
                <tr>
                    <td colspan="5" style="text-align:center;color:#999;">Немає акаунтів. Додайте першу соцмережу.</td>
                </tr>
            <?php else: ?>
                <?php foreach ($accounts as $a): ?>
                    <tr>
                        <td><?= htmlspecialchars($a['name']) ?></td>
                        <td><?= htmlspecialchars($a['platform']) ?></td>
                        <td><code
                                style="background:#f0f0f5;padding:4px 8px;border-radius:4px;"><?= htmlspecialchars($a['chat_id']) ?></code>
                        </td>
                        <td><span
                                class="<?= $a['status'] ? 'status-active' : 'status-inactive' ?>"><?= $a['status'] ? '✓ Активний' : '⏸ Пауза' ?></span>
                        </td>
                        <td class="actions">
                            <button onclick="location.href='/accounts/edit?id=<?= $a['id'] ?>'">✏️ Редагувати</button>
                            <button class="danger"
                                onclick="if(confirm('Видалити?')) location.href='/accounts/delete?id=<?= $a['id'] ?>'">🗑️
                                Видалити</button>
                        </td>
                    </tr>
                <?php endforeach; ?>
            <?php endif; ?>
        </table>
    </div>
</body>

</html>