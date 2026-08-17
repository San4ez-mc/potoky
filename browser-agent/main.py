"""
browser-agent — перевикористовуваний мікросервіс веб-автоматизації для FINEKO.

Дві родини задач:
  • ДІЇ (розміщення замовлень у CRM постачальників): /replay (детерміновано) + /agent (ШІ-фолбек).
  • ЧИТАННЯ (метрики IG/Threads тощо): /read — код-first (curl-impersonate → markdown), ШІ не потрібен.

Обмеження боксу: 1 CPU, ~3.8ГБ RAM. Тому:
  • Браузерні задачі СЕРІАЛІЗОВАНІ (одночасно максимум одна) через asyncio-семафор.
  • Браузер запускається НА ВИМОГУ і закривається після задачі (не тримаємо резидентно).

Auth: заголовок X-Agent-Secret == env BROWSER_AGENT_SECRET.
"""
import os
import asyncio
import base64
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from typing import Any, Optional

SECRET = os.environ.get("BROWSER_AGENT_SECRET", "")
HEADLESS = os.environ.get("BROWSER_HEADLESS", "1") != "0"
NAV_TIMEOUT_MS = int(os.environ.get("BROWSER_NAV_TIMEOUT_MS", "30000"))

# Максимум одна браузерна задача одночасно (1 ядро!).
_browser_lock = asyncio.Semaphore(1)

app = FastAPI(title="FINEKO browser-agent", version="0.1.0")


def _auth(x_agent_secret: Optional[str]):
    if not SECRET or x_agent_secret != SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")


# ── Chromium на вимогу (низька памʼять) ───────────────────────────────────────
@asynccontextmanager
async def launch_page():
    from playwright.async_api import async_playwright
    args = [
        "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
        "--disable-extensions", "--disable-background-networking",
        "--blink-settings=imagesEnabled=true",  # лишаємо картинки для скрінів-звірки
    ]
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=HEADLESS, args=args)
        try:
            context = await browser.new_context(viewport={"width": 1280, "height": 900})
            page = await context.new_page()
            page.set_default_timeout(NAV_TIMEOUT_MS)
            yield page
        finally:
            await browser.close()


def interp(s: Any, data: dict) -> Any:
    """{{key}} → data[key] (плоска інтерполяція у рядках сценарію)."""
    if not isinstance(s, str):
        return s
    for k, v in (data or {}).items():
        s = s.replace("{{" + k + "}}", str(v))
    return s


# ── Моделі ────────────────────────────────────────────────────────────────────
class ReplayReq(BaseModel):
    scenario: dict            # { startUrl, steps:[{action,selector,value,url,...}] }
    data: dict = {}           # креди + дані замовлення для інтерполяції
    screenshot: bool = True    # dryRun-звірка


class AgentReq(BaseModel):
    task: str                 # НЛ-завдання агенту
    data: dict = {}           # креди + дані (можна згадувати у task)
    startUrl: Optional[str] = None
    dry_run: bool = True      # НЕ тиснути фінальний submit
    screenshot: bool = True
    max_steps: int = 40


class ReadReq(BaseModel):
    url: str
    mode: str = "markdown"    # markdown | text | html | json
    render_js: bool = False    # True → через браузер (для JS-сайтів); інакше curl-impersonate


# ── /health ───────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"ok": True, "service": "browser-agent", "headless": HEADLESS,
            "busy": _browser_lock.locked()}


# ── /replay — детермінований прогін сценарію (0 токенів) ──────────────────────
@app.post("/replay")
async def replay(req: ReplayReq, x_agent_secret: str = Header(default=None)):
    _auth(x_agent_secret)
    async with _browser_lock:
        from scenario import run_scenario
        try:
            async with launch_page() as page:
                result = await run_scenario(page, req.scenario, req.data)
                shot = None
                if req.screenshot:
                    shot = base64.b64encode(await page.screenshot(full_page=False)).decode()
                return {"ok": result.get("ok", False), "steps_done": result.get("steps_done"),
                        "error": result.get("error"), "url": page.url,
                        "screenshot_b64": shot}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)}


# ── /agent — ШІ веде браузер (перший прохід / фолбек) ─────────────────────────
@app.post("/agent")
async def agent(req: AgentReq, x_agent_secret: str = Header(default=None)):
    _auth(x_agent_secret)
    async with _browser_lock:
        from agent_runner import run_agent
        return await run_agent(req, launch_page)


# ── /read — код-first читання (економія токенів) ──────────────────────────────
@app.post("/read")
async def read(req: ReadReq, x_agent_secret: str = Header(default=None)):
    _auth(x_agent_secret)
    from reader import read_url
    if req.render_js:
        async with _browser_lock:
            async with launch_page() as page:
                return await read_url(req.url, req.mode, page=page)
    return await read_url(req.url, req.mode, page=None)
