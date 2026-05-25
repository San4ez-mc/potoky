<!DOCTYPE html>
<html lang="uk">

<head>
    <meta charset="UTF-8">
    <title>Акаунти — Content Planner Bot</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background: #f7f7fa;
        }

        .container {
            max-width: 900px;
            margin: 40px auto;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 2px 8px #ccc;
            padding: 32px;
        }

        h2 {
            color: #5B2D8E;
            margin-bottom: 24px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
        }

        th,
        td {
            padding: 10px;
            border-bottom: 1px solid #eee;
        }

        th {
            background: #5B2D8E;
            color: #fff;
        }

        .add-btn {
            float: right;
            background: #5B2D8E;
            color: #fff;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 15px;
            margin-bottom: 16px;
        }

        .actions button {
            margin-right: 8px;
        }
    </style>
</head>

<body>
    <?php require __DIR__ . '/components/topbar.php'; ?>
    <div class="container">
        <h2>Список акаунтів</h2>
        <button class="add-btn" onclick="location.href='/accounts/add?project_id=<?php echo (int) $active_project_id; ?>'">+ Додати акаунт</button>
        <table>
            <tr>
                <th>Назва</th>
                <th>Платформа</th>
                <th>Bot Token</th>
                <th>Chat ID</th>
                <th>Статус</th>
                <th>Дії</th>
            </tr>
            <?php foreach ($accounts as $a): ?>
                <tr>
                    <td><?= htmlspecialchars($a['name']) ?></td>
                    <td><?= htmlspecialchars($a['platform']) ?></td>
                    <td><?= htmlspecialchars($a['bot_token']) ?></td>
                    <td><?= htmlspecialchars($a['chat_id']) ?></td>
                    <td><?= $a['status'] ? 'Активний' : 'Пауза' ?></td>
                    <td class="actions">
                        <button onclick="location.href='/accounts/edit?id=<?= $a['id'] ?>&project_id=<?php echo (int) $active_project_id; ?>'">Редагувати</button>
                        <button onclick="location.href='/accounts/delete?id=<?= $a['id'] ?>&project_id=<?php echo (int) $active_project_id; ?>'">Видалити</button>
                        <button onclick="location.href='/accounts/test?id=<?= $a['id'] ?>&project_id=<?php echo (int) $active_project_id; ?>'">Тест</button>
                    </td>
                </tr>
            <?php endforeach; ?>
        </table>
    </div>
</body>

</html>