<!DOCTYPE html>
<html lang="uk">

<head>
    <meta charset="UTF-8">
    <title>Додати акаунт</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background: #f7f7fa;
        }

        .form-box {
            max-width: 400px;
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

        input,
        select {
            width: 100%;
            padding: 10px;
            margin-bottom: 16px;
            border: 1px solid #ccc;
            border-radius: 4px;
        }

        button {
            background: #5B2D8E;
            color: #fff;
            border: none;
            padding: 10px 18px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
        }
    </style>
</head>

<body>
    <div class="form-box">
        <h2><?= isset($account) ? 'Редагувати акаунт' : 'Додати акаунт' ?></h2>
        <form method="post" action="<?= isset($account) ? '/accounts/edit' : '/accounts/add' ?>">
            <input type="hidden" name="project_id" value="<?php echo (int) $active_project_id; ?>">
            <?php if (isset($account)): ?>
                <input type="hidden" name="id" value="<?= $account['id'] ?>">
            <?php endif; ?>
            <input type="text" name="name" placeholder="Назва акаунту" required value="<?= $account['name'] ?? '' ?>">
            <select name="platform" required>
                <option value="Threads" <?= (isset($account) && $account['platform'] === 'Threads') ? 'selected' : '' ?>>
                    Threads</option>
                <option value="Instagram" <?= (isset($account) && $account['platform'] === 'Instagram') ? 'selected' : '' ?>>
                    Instagram</option>
            </select>
            <input type="text" name="bot_token" placeholder="Telegram Bot Token" required
                value="<?= $account['bot_token'] ?? '' ?>">
            <input type="text" name="chat_id" placeholder="Telegram Chat ID" required
                value="<?= $account['chat_id'] ?? '' ?>">
            <label><input type="checkbox" name="status" <?= (!isset($account) || $account['status']) ? 'checked' : '' ?>>
                Активний</label>
            <button type="submit">Зберегти</button>
        </form>
        <?php if (isset($account)): ?>
            <form method="get" action="/accounts/delete" style="margin-top:16px;">
                <input type="hidden" name="id" value="<?= $account['id'] ?>">
                <input type="hidden" name="project_id" value="<?php echo (int) $active_project_id; ?>">
                <button type="submit" style="background:#d00;">Видалити акаунт</button>
            </form>
        <?php endif; ?>
    </div>
</body>

</html>