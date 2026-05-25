# Налаштування щоденних повідомлень в Telegram

## 1. Налаштування Telegram бота

### Створення бота:
1. Відкрийте [@BotFather](https://t.me/BotFather) в Telegram
2. Відправте команду `/newbot`
3. Введіть назву бота (наприклад: "Content Planner Bot")
4. Введіть username бота (має закінчуватися на `bot`, наприклад: `content_planner_mariel_bot`)
5. Збережіть токен, який надасть BotFather (формат: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### Отримання Chat ID:
1. Напишіть вашому новому боту будь-яке повідомлення (наприклад: `/start`)
2. Відкрийте у браузері: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
3. Знайдіть у відповіді `"chat":{"id":123456789}` - це ваш chat_id
4. Або використайте бота [@userinfobot](https://t.me/userinfobot) - він покаже ваш ID

## 2. Налаштування конфігурації

Відредагуйте файл `php-mvc/config/telegram.php`:

```php
<?php
return [
    'bot_token' => '123456789:ABCdefGHIjklMNOpqrsTUVwxyz', // Ваш токен бота
    'chat_id' => '123456789' // Ваш chat_id
];
```

## 3. Тестування

Перевірте роботу бота:

```bash
php cron.php test
```

Ви повинні отримати тестове повідомлення в Telegram.

## 4. Налаштування Cron завдання

### Для Linux/Unix хостингу:

Відкрийте crontab:
```bash
crontab -e
```

Додайте рядок для щоденного запуску о 9:00 ранку:
```bash
0 9 * * * /usr/bin/php /path/to/your/project/cron.php daily-posts >> /path/to/logs/cron.log 2>&1
```

Або використовуйте веб-запит (якщо CLI недоступний):
```bash
0 9 * * * curl "https://yourdomain.com/cron.php?action=daily-posts&key=YOUR_SECRET_KEY" >> /path/to/logs/cron.log 2>&1
```

### Для Windows (Task Scheduler):

1. Відкрийте "Task Scheduler" (Планувальник завдань)
2. Створіть нове завдання
3. У вкладці "Тригер" встановіть щоденний запуск о 9:00
4. У вкладці "Дія" вкажіть:
   - Програма: `C:\php\php.exe` (шлях до вашого PHP)
   - Аргументи: `C:\path\to\cron.php daily-posts`

### Інші варіанти запуску:

**Вручну через CLI:**
```bash
php cron.php daily-posts
```

**Через браузер (для тестування):**
```
https://yourdomain.com/cron.php?action=daily-posts&key=YOUR_SECRET_KEY
```

⚠️ **ВАЖЛИВО:** Змініть секретний ключ у файлі `cron.php` (рядок 9):
```php
$secretKey = 'ваш_складний_секретний_ключ_тут';
```

## 5. Формат повідомлення

Бот відправить повідомлення у форматі:

```
📅 Ваші пости на сьогодні (02.03.2026):

🔗 Threads Posts:

📝 Пост 1
└ Категорія: Жива історія
└ Текст:
Текст вашого поста тут...

📝 Пост 2
└ Категорія: Дзеркало болю
└ Текст:
Текст другого поста...

📸 Instagram Posts:

📝 Пост 3
└ Категорія: Архітектура розуму
└ Текст:
Текст поста для Instagram...

━━━━━━━━━━━━━━━━
Всього постів: 3
```

## 6. Налаштування часу відправки

Змініте час у cron завданні відповідно до ваших потреб:

- `0 9 * * *` - щодня о 9:00
- `0 8 * * 1-5` - о 8:00 лише по робочих днях (пн-пт)
- `0 10,18 * * *` - двічі на день: о 10:00 та 18:00

## 7. Логування

Перегляньте логи для діагностики:

```bash
tail -f /path/to/logs/cron.log
```

## Доступні команди

- `php cron.php daily-posts` - Відправити щоденні пости
- `php cron.php test` - Тест підключення до Telegram
- `php cron.php help` - Показати довідку
