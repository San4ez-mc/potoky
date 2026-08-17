"""
Детермінований прогін збереженого сценарію через Playwright (без ШІ, 0 токенів).

Схема сценарію (JSON), який записує ШІ-агент після успіху й ми повторюємо далі:
{
  "startUrl": "https://brewdrop.in.ua/login",
  "steps": [
    {"action": "goto",     "url": "{{startUrl}}"},
    {"action": "fill",     "selector": "#email",    "value": "{{login}}"},
    {"action": "fill",     "selector": "#password", "value": "{{password}}"},
    {"action": "click",    "selector": "button[type=submit]"},
    {"action": "waitFor",  "selector": ".account"},
    {"action": "goto",     "url": "{{productUrl}}"},
    {"action": "click",    "selector": ".add-to-cart"},
    {"action": "fill",     "selector": "#np_city",  "value": "{{city}}"},
    {"action": "fill",     "selector": "#np_branch","value": "{{branch}}"},
    {"action": "waitFor",  "selector": ".order-review"}
    // СТОП тут — фінальний submit НЕ робимо у dry-run
  ]
}
Дії: goto | fill | click | select | waitFor | waitMs | press | check | assertText
Значення інтерполюються з data ({{login}}, {{password}}, {{city}} …).
"""
import asyncio


async def _interp(v, data):
    if isinstance(v, str):
        for k, val in (data or {}).items():
            v = v.replace("{{" + k + "}}", str(val))
    return v


async def run_scenario(page, scenario: dict, data: dict) -> dict:
    steps = scenario.get("steps", []) or []
    done = 0
    for i, step in enumerate(steps):
        act = (step.get("action") or "").lower()
        sel = await _interp(step.get("selector"), data)
        val = await _interp(step.get("value"), data)
        url = await _interp(step.get("url"), data)
        try:
            if act == "goto":
                await page.goto(url, wait_until="domcontentloaded")
            elif act == "fill":
                await page.fill(sel, val or "")
            elif act == "type":
                await page.type(sel, val or "")
            elif act == "click":
                await page.click(sel)
            elif act == "select":
                await page.select_option(sel, val)
            elif act == "check":
                await page.check(sel)
            elif act == "press":
                await page.press(sel or "body", val or "Enter")
            elif act == "waitfor":
                await page.wait_for_selector(sel)
            elif act == "waitms":
                await asyncio.sleep(min(float(val or 1000), 15000) / 1000.0)
            elif act == "asserttext":
                content = await page.text_content(sel)
                if val and val not in (content or ""):
                    return {"ok": False, "steps_done": done, "error": f"assertText fail @step {i}: '{val}' not in element"}
            else:
                return {"ok": False, "steps_done": done, "error": f"unknown action '{act}' @step {i}"}
            done += 1
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "steps_done": done, "error": f"step {i} ({act} {sel or url}): {e}"}
    return {"ok": True, "steps_done": done}
