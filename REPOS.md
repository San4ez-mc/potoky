# Git репозиторії — маппінг по папках

## Локальні репозиторії

| Локальна папка | GitHub репо | Сервер (deploy path) |
|---|---|---|
| `D:\програмування\система для воронок\platform\` | `github.com/San4ez-mc/potoky` | `/var/www/flows.fineko.space` |
| (немає локально) | `github.com/San4ez-mc/content` | `/var/www/content.fineko.space` |

---

## Деталі

### `potoky.git` — Node.js платформа воронок
- **Що:** flows.fineko.space — основний рушій воронок (Node.js + PostgreSQL + Redis)
- **Локально:** `D:\програмування\система для воронок\platform\`
- **Сервер:** `/var/www/flows.fineko.space` (PM2)
- **Деплой:** `git pull` + `pm2 restart` на сервері
- **SSH до сервера:** `ssh -i ~/.ssh/id_ed25519 root@173.242.62.180`
- **Пуш:** від Windows (credentials закешовані)

### `content.git` — PHP платформа контент-студії
- **Що:** content.fineko.space — PHP MVC (без фреймворку), маршрутизація через `php-mvc/public/index.php`
- **Локально:** немає постійного клону (тимчасовий: `C:\Users\Admin\AppData\Local\Temp\content-php\`)
- **Сервер:** `/var/www/content.fineko.space/php-mvc/`
- **Деплой:** `git pull` на сервері або правки напряму → `git add` + `git commit` на сервері → пуш від Windows (сервер не має credentials)
- **Пуш з Windows:** клонувати в temp → SCP файлів з сервера → commit + push → `git reset --hard origin/main` на сервері

---

## Мікросервіси на сервері (не в git, керуються PM2)

| Сервіс | Порт | Папка на сервері | PM2 назва |
|---|---|---|---|
| flows (платформа) | — | `/var/www/flows.fineko.space` | `flows` |
| slide-builder | 3002 | `/var/www/slides.flows.fineko.space/slide-builder` | `slide-builder` |
| image-processor | 3101 | `/var/www/img.flows.fineko.space` | `img-processor` |
| video-worker | — | `/var/www/video.flows.fineko.space` | `video-worker` |
| render | — | `/var/www/render.flows.fineko.space` | `render` |

---

## Workflow для змін

### Зміни в platform/ (Node.js flows)
```
1. Редагуй локально в D:\програмування\система для воронок\platform\
2. git add platform/... && git commit && git push
3. На сервері: cd /var/www/flows.fineko.space && git pull && pm2 restart flows
```

### Зміни в content.php (PHP)
```
1. SSH на сервер, редагуй напряму /var/www/content.fineko.space/php-mvc/...
   АБО: клонуй в temp, редагуй, SCP на сервер
2. На сервері: git add ... && git commit (з попередньо налаштованим user.name/email)
3. Від Windows: cd temp/content-php && git fetch && ... && git push
4. На сервері: git reset --hard origin/main
```

### Зміни в slide-builder (шаблони/логіка)
```
1. SCP файлів напряму на сервер (шаблони: /var/www/slides.flows.fineko.space/slide-builder/src/templates/)
2. Для JS змін: pm2 restart slide-builder
3. Шаблони .html — hot-reload, pm2 restart не потрібен
```
