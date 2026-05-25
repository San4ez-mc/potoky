<!DOCTYPE html>
<html lang="uk">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Вхід — Content Planner Bot</title>
    <link rel="stylesheet" href="/style.css">
    <style>
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #5B2D8E 0%, #4A1F6B 100%);
        }

        .form-box {
            margin: 0;
            max-width: 420px;
            background: white;
        }

        .form-box h2 {
            text-align: center;
            margin-bottom: 24px;
            color: #5B2D8E;
        }

        .error {
            margin-bottom: 18px;
        }
    </style>
</head>

<body>
    <div class="form-box">
        <h2>🔐 Вхід</h2>
        <?php if (!empty($error)): ?>
            <div class="error"><?php echo htmlspecialchars($error); ?></div>
        <?php endif; ?>
        <form method="post" action="/login">
            <input type="text" name="username" placeholder="Логін" required autofocus>
            <input type="password" name="password" placeholder="Пароль" required>
            <button type="submit">Увійти</button>
        </form>
        <form method="post" action="/forgot" style="margin-top:12px;">
            <button type="submit" class="secondary">Відновити пароль</button>
        </form>
    </div>
</body>

</html>