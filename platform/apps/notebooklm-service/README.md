# NotebookLM Microservice

REST API над [notebooklm-py](https://github.com/teng-lin/notebooklm-py) для семантичного пошуку по документах.

## Setup

```bash
cd /var/www/notebooklm-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Запуск

```bash
uvicorn app:app --host 0.0.0.0 --port 4200
```

PM2:
```bash
pm2 start "uvicorn app:app --host 0.0.0.0 --port 4200" --name notebooklm-service --interpreter python3
```

## ENV

- `DATA_DIR` — де зберігаються метадані ноутбуків (default: `/var/www/notebooklm-service/data`)
- Потрібен запущений Chrome/Playwright для notebooklm-py:  
  `playwright install chromium`

## API

### POST /notebooks
Створити новий ноутбук.
```json
{ "name": "Кейси клієнтів", "description": "База кейсів для контент-плану" }
→ { "ok": true, "notebookId": "abc12345", "name": "Кейси клієнтів" }
```

### POST /notebooks/:id/sources
Додати джерело.
```json
{ "type": "url", "content": "https://...", "title": "Стаття" }
{ "type": "text", "content": "Текст кейсу...", "title": "Кейс Марія К." }
```

### POST /notebooks/:id/query
Запит до ноутбука.
```json
{ "question": "Які кейси є з роздрібної торгівлі?" }
→ { "ok": true, "answer": "..." }
```

### GET /notebooks
Список всіх ноутбуків.

### DELETE /notebooks/:id
Видалити ноутбук.
