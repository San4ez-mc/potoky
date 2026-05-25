<!DOCTYPE html>
<html lang="uk">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Налаштування — Content Planner Bot</title>
    <link rel="stylesheet" href="/style.css">
</head>

<body>
    <div class="topbar">
        <div class="logo">📋 Content Planner Bot</div>
        <div class="menu">
            <a href="/">Контент план</a>
            <a href="/social-networks">Соц.мережі</a>
            <a href="/images">Зображення</a>
            <a href="/settings">Налаштування</a>
        </div>
        <a href="/logout" class="logout-link">🚪 Вийти</a>
    </div>
    <div class="container">
        <div style="background:white;border-radius:10px;padding:28px;box-shadow:var(--shadow);">
            <h2>⚙️ Налаштування Проекту</h2>
            <p style="color:#7f8c8d;margin-bottom:20px;font-size:14px;">Налаштуйте параметри проекту та Telegram бота
                для автоматичної розсилки.</p>

            <?php if (!empty($_GET['saved'])): ?>
                <div
                    style="background:#ecfdf5;border:1px solid #86efac;color:#166534;padding:10px 12px;border-radius:8px;margin-bottom:14px;">
                    Налаштування збережено ✅
                </div>
            <?php endif; ?>

            <form method="POST" action="/settings/save" style="max-width:700px;">
                <div style="margin-bottom:20px;">
                    <label style="display:block;margin-bottom:6px;font-weight:600;">📁 Проєкт</label>
                    <select name="project_id" onchange="window.location.href='/settings?project_id=' + this.value"
                        style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;">
                        <?php foreach (($projects ?? []) as $project): ?>
                            <option value="<?php echo (int) $project['id']; ?>" <?php echo ((int) $project['id'] === (int) ($selectedProject['id'] ?? 0)) ? 'selected' : ''; ?>>
                                <?php echo htmlspecialchars($project['name'], ENT_QUOTES, 'UTF-8'); ?> (ID:
                                <?php echo (int) $project['id']; ?>)
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>

                <div style="margin-bottom:20px;">
                    <label style="display:block;margin-bottom:6px;font-weight:600;">📝 Назва Проекту</label>
                    <input type="text" name="project_name"
                        value="<?php echo htmlspecialchars($settings['project_name'] ?? ($selectedProject['name'] ?? 'Дім Душі'), ENT_QUOTES, 'UTF-8'); ?>"
                        placeholder="Введіть назву проекту"
                        style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;">
                </div>

                <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">

                <h3 style="margin-bottom:16px;">🤖 Telegram Бот</h3>
                <p style="color:#64748b;font-size:13px;margin-bottom:16px;">
                    Налаштуйте бота для автоматичних повідомлень.
                    <a href="https://t.me/BotFather" target="_blank" style="color:#5a6c7d;">Створити бота через
                        @BotFather</a>
                </p>

                <div style="margin-bottom:20px;">
                    <label style="display:block;margin-bottom:6px;font-weight:600;">🔑 Токен Бота</label>
                    <input type="text" name="telegram_bot_token"
                        value="<?php echo htmlspecialchars($settings['telegram_bot_token'] ?? '', ENT_QUOTES, 'UTF-8'); ?>"
                        placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                        style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-family:monospace;">
                    <small style="color:#64748b;font-size:12px;">Отримайте токен у @BotFather після створення
                        бота</small>
                </div>

                <div style="margin-bottom:20px;">
                    <label style="display:block;margin-bottom:6px;font-weight:600;">💬 ID Чату/Групи</label>
                    <input type="text" name="telegram_chat_id"
                        value="<?php echo htmlspecialchars($settings['telegram_chat_id'] ?? '', ENT_QUOTES, 'UTF-8'); ?>"
                        placeholder="123456789"
                        style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-family:monospace;">
                    <small style="color:#64748b;font-size:12px;">
                        ID вашого чату або групи. Отримати через
                        <a href="https://t.me/userinfobot" target="_blank" style="color:#5a6c7d;">@userinfobot</a>
                        або getUpdates API
                    </small>
                </div>

                <button type="submit" class="submit-btn">💾 Зберегти налаштування</button>
            </form>

            <hr style="margin:40px 0;border:none;border-top:1px solid #e0e0e0;">

            <h3>⏰ Налаштування розсилки</h3>
            <div style="background:#f8fafc;padding:16px;border-radius:8px;border-left:4px solid #5a6c7d;">
                <p style="margin:0;color:#475569;font-size:14px;">
                    <strong>Час розсилки налаштовується через cron.</strong><br>
                    Додайте в crontab для щоденної розсилки о 9:00:<br>
                    <code
                        style="background:#fff;padding:8px;display:block;margin-top:8px;border-radius:6px;font-size:12px;">0 9 * * * cd /path/to/project && php cron.php daily-posts</code>
                </p>
                <p style="margin-top:12px;margin-bottom:0;color:#64748b;font-size:13px;">
                    📖 Детальніше в <a href="/QUICK_START_TELEGRAM.md"
                        style="color:#5a6c7d;">QUICK_START_TELEGRAM.md</a>
                </p>
            </div>
        </div>
    </div>
</body>

</html>