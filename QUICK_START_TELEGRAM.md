# 📋 Content Planner Bot - Швидкий старт Telegram повідомлень

## 🚀 Швидке налаштування за 3 кроки

### Крок 1: Створіть Telegram бота
1. Знайдіть [@BotFather](https://t.me/BotFather) в Telegram
2. Команда: `/newbot`
3. Збережіть токен бота

### Крок 2: Налаштуйте конфігурацію
```bash
cp php-mvc/config/telegram.php.example php-mvc/config/telegram.php
```

Відредагуйте `php-mvc/config/telegram.php`:
```php
return [
    'bot_token' => '123456789:ABC...', // Ваш токен
    'chat_id' => '123456789' // Ваш ID
];
```

### Крок 3: Протестуйте
```bash
php cron.php test
```

## 📱 Отримання Chat ID

**Варіант 1 (простий):**
- Напишіть [@userinfobot](https://t.me/userinfobot) в Telegram

**Варіант 2:**
1. Напишіть вашому боту `/start`
2. Відкрийте: `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Знайдіть `"chat":{"id":123456789}`

## ⏰ Налаштування автоматичної відправки

### Linux/Unix - Cron (щодня о 9:00):
```bash
crontab -e
# Додайте рядок:
0 9 * * * cd /path/to/project && /usr/bin/php cron.php daily-posts
```

### Windows - Task Scheduler:
1. Створіть нове завдання
2. Тригер: Щодня о 9:00
3. Дія: `C:\php\php.exe C:\path\to\cron.php daily-posts`

### Веб-запит (якщо немає CLI):
```bash
0 9 * * * curl "https://domain.com/cron.php?action=daily-posts&key=SECRET_KEY"
```

⚠️ **Змініть секретний ключ в cron.php (рядок 9)!**

## 🧪 Тестування

```bash
# Показати довідку
php cron.php help

# Тест підключення до Telegram
php cron.php test

# Відправити щоденні пости (вручну)
php cron.php daily-posts
```

## 📨 Формат повідомлення

```
📅 Ваші пости на сьогодні (02.03.2026):

🔗 Threads Posts:

📝 Пост 1
└ Категорія: Жива історія
└ Текст:
Ваш текст поста...

📸 Instagram Posts:

📝 Пост 2
└ Категорія: Дзеркало болю
└ Текст:
Текст для Instagram...

━━━━━━━━━━━━━━━━
Всього постів: 2
```

## 📖 Детальні інструкції

Дивіться [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md) для повної документації.

## ⚙️ Команди

- `php cron.php daily-posts` - Відправити пости на сьогодні
- `php cron.php test` - Тест з'єднання
- `php cron.php help` - Довідка

## 🔐 Безпека

1. Додайте `telegram.php` в `.gitignore` ✅
2. Змініть секретний ключ в `cron.php`
3. Не публікуйте токени в публічних репозиторіях

## 🐛 Налагодження

**Бот не відправляє повідомлення?**
- Перевірте токен та chat_id
- Переконайтеся, що ви написали боту хоч раз
- Запустіть `php cron.php test` для діагностики

**Немає постів на сьогодні?**
- Перевірте дату: повідомлення відправляються лише якщо є пости на поточну дату
- Переконайтеся, що соц.мережі увімкнені (`is_enabled = 1`)

## 📞 Підтримка

Якщо виникли проблеми:
1. Перевірте логи: `tail -f /path/to/logs/cron.log`
2. Запустіть тест: `php cron.php test`
3. Перевірте помилки PHP: `php cron.php daily-posts`
