"""
ШІ-агент над браузером (browser-use 0.13.x, мозок — Claude, нативний ChatAnthropic).
Використовується для постачальників БЕЗ API / як фолбек, коли детермінований /replay
зламався. Виконує задачу, СТОП перед фінальним submit (dry-run), повертає результат.

Примітка: brewdrop має власний REST API → для нього браузер НЕ потрібен (див. воронку).
"""
import os

DRY_RUN_GUARD = (
    "\n\nВАЖЛИВО: це тестовий прогін. НЕ натискай фінальну кнопку підтвердження/оформлення "
    "(«Відправити», «Замовити», «Оформити замовлення», «Підтвердити»). Дійди до сторінки "
    "ПЕРЕГЛЯДУ замовлення (кошик заповнений, дані введені) і зупинись."
)


async def run_agent(req, launch_page=None):
    try:
        from browser_use import Agent, ChatAnthropic, BrowserProfile

        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            return {"ok": False, "error": "ANTHROPIC_API_KEY не заповнено у .env — /agent недоступний"}
        model = os.environ.get("AGENT_MODEL", "claude-sonnet-4-6")

        task = req.task
        if req.startUrl:
            task = f"Відкрий {req.startUrl}. " + task
        if req.data:
            hints = "; ".join(f"{k}={v}" for k, v in req.data.items() if k not in ("password", "pass"))
            if hints:
                task += f"\n\nДані для форм: {hints}."
            if req.data.get("password") or req.data.get("pass"):
                task += "\nПароль для входу передано — введи його у поле пароля."
        if req.dry_run:
            task += DRY_RUN_GUARD

        llm = ChatAnthropic(model=model, api_key=key, temperature=0)
        profile = BrowserProfile(headless=os.environ.get("BROWSER_HEADLESS", "1") != "0")
        agent = Agent(task=task, llm=llm, browser_profile=profile, use_vision=True)

        history = await agent.run(max_steps=req.max_steps)

        final_text = None
        try: final_text = history.final_result()
        except Exception: final_text = str(history)[:2000]

        shot_b64 = None
        if req.screenshot:
            for m in ("screenshot", "final_screenshot"):
                try:
                    fn = getattr(history, m, None)
                    if callable(fn): shot_b64 = fn(); break
                except Exception:
                    pass

        steps = []
        try:
            for a in (history.model_actions() or []):
                steps.append(str(a)[:300])
        except Exception:
            pass

        return {"ok": True, "final": final_text, "draft_scenario_raw": steps[:60], "screenshot_b64": shot_b64}
    except ImportError as e:
        return {"ok": False, "error": f"browser-use import failed: {e}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"agent failed: {e}"}
