# AI Bots Platform

Монорепо для управління AI-ботами курсу «Фінансова система малого бізнесу» та Michael Bot.

## Структура

```
platform/
├── apps/
│   ├── api/              # Express API сервер
│   ├── admin/            # React адмін-панель
│   └── worker/           # Bull workers
├── packages/
│   ├── db/               # Prisma schema + client
│   ├── errors/           # Кастомні класи помилок
│   ├── logger/           # Централізований логер
│   ├── claude/           # Claude API wrapper
│   ├── telegram/         # Telegram Bot wrapper
│   └── storage/          # Файлове сховище
└── projects/
    └── finance-course/   # Боти фінансового курсу
```

## Швидкий старт

```bash
# Встановити залежності
yarn install

# Скопіювати .env
cp .env.example .env
# Заповнити всі змінні

# Згенерувати Prisma client
yarn db:generate

# Запустити міграції (розробка)
yarn db:migrate:dev

# Запустити API
yarn dev:api

# Запустити worker
yarn dev:worker
```

## Стек

- **Runtime:** Node.js 18+
- **API:** Express.js
- **БД:** PostgreSQL + Prisma ORM
- **Черга:** Bull + Redis
- **AI:** Anthropic Claude API
- **Telegram:** node-telegram-bot-api
- **Frontend:** React + Tailwind CSS
- **Process manager:** PM2

## Деплой

```bash
# Production міграції
yarn db:migrate:deploy

# PM2
pm2 start ecosystem.config.js
pm2 save
```
