"""
ШІ-агент над браузером (browser-use, мозок — Claude).
Використовується на ПЕРШОМУ проході або як фолбек, коли детермінований /replay зламався
(сайт постачальника змінився). Агент виконує задачу, СТОП перед фінальним submit (dry-run),
і повертає скрін + чернетку сценарію для подальшого детермінованого повтору.

УВАГА: API browser-use ще стабілізується. Тут — версійно-толерантна обгортка;
при деплої звірити з встановленою версією (див. requirements.txt) і, за потреби, підправити.
"""
import os
import base64

DRY_RUN_GUARD = (
    "\n\nВАЖЛИВО: це тестовий прогін. НЕ натискай фінальну кнопку підтвердження/оформлення "
    "(«Відправити», «Замовити», «Оформити замовлення», «Підтвердити»). Дійди до сторінки "
    "ПЕРЕГЛЯДУ замовлення (кошик заповнений, дані доставки введені) і зупинись."
)


def _make_llm():
    from langchain_anthropic import ChatAnthropic
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    model = os.environ.get("AGENT_MODEL", "claude-sonnet-4-6")
    return ChatAnthropic(model=model, api_key=key, temperature=0)


async def run_agent(req, launch_page=None):
    try:
        from browser_use import Agent
        try:
            from browser_use import Browser, BrowserConfig
        except Exception:  # старіші/новіші версії
            Browser = None
            BrowserConfig = None

        task = req.task
        if req.startUrl:
            task = f"Відкрий {req.startUrl}. " + task
        # креди/дані підмішуємо в задачу (агент сам заповнить форми)
        if req.data:
            hints = "; ".join(f"{k}={v}" for k, v in req.data.items() if k not in ("password", "pass"))
            if hints:
                task += f"\n\nДані для форм: {hints}."
            if req.data.get("password") or req.data.get("pass"):
                task += "\nПароль для входу передано у безпечному полі — введи його у поле пароля."
        if req.dry_run:
            task += DRY_RUN_GUARD

        low_mem_args = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        browser = None
        if Browser is not None and BrowserConfig is not None:
            try:
                browser = Browser(config=BrowserConfig(headless=True, extra_chromium_args=low_mem_args))
            except Exception:
                browser = Browser() if Browser else None

        llm = _make_llm()
        agent = Agent(task=task, llm=llm, browser=browser) if browser else Agent(task=task, llm=llm)

        history = await agent.run(max_steps=req.max_steps)

        # Результат + чернетка сценарію (best-effort, версійно-залежно)
        final_text = None
        try:
            final_text = history.final_result()
        except Exception:
            final_text = str(history)[:2000]

        draft_steps = []
        try:
            for a in history.model_actions():  # може відрізнятись між версіями
                draft_steps.append(a)
        except Exception:
            pass

        shot_b64 = None
        if req.screenshot:
            try:
                shot_b64 = history.screenshots()[-1] if hasattr(history, "screenshots") else None
            except Exception:
                shot_b64 = None

        return {"ok": True, "final": final_text, "draft_scenario_raw": draft_steps[:60],
                "screenshot_b64": shot_b64}
    except ImportError as e:
        return {"ok": False, "error": f"browser-use не встановлено/не сумісне: {e}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"agent failed: {e}"}
