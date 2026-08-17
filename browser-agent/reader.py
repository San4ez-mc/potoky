"""
Код-first читання сторінок (економія токенів): не тягнемо весь сирий DOM у ШІ,
а віддаємо чистий markdown/текст або витягнутий JSON.

Пріоритет:
  1) curl-impersonate (curl_cffi) — HTTP із фінгерпринтом браузера (обхід простого анти-бота), 0 браузера.
  2) render_js=True → Playwright (для JS-сайтів) — важче, під семафором.
Далі HTML → markdown (markitdown) / текст (BeautifulSoup).
"""
from typing import Optional


def _html_to_markdown(html: str) -> str:
    try:
        from markitdown import MarkItDown
        import io
        md = MarkItDown()
        res = md.convert_stream(io.BytesIO(html.encode("utf-8")), file_extension=".html")
        return res.text_content
    except Exception:
        # запасний варіант — грубий текст
        from bs4 import BeautifulSoup
        return BeautifulSoup(html, "html.parser").get_text("\n", strip=True)


def _html_to_text(html: str) -> str:
    from bs4 import BeautifulSoup
    return BeautifulSoup(html, "html.parser").get_text("\n", strip=True)


async def read_url(url: str, mode: str = "markdown", page=None) -> dict:
    html = None
    via = None
    if page is not None:
        # JS-рендер через браузер
        await page.goto(url, wait_until="networkidle")
        html = await page.content()
        via = "browser"
    else:
        # curl-impersonate: маскуємось під Chrome
        try:
            from curl_cffi import requests as creq
            r = creq.get(url, impersonate="chrome", timeout=25)
            html = r.text
            via = f"curl_cffi:{r.status_code}"
            if mode == "json":
                try:
                    return {"ok": True, "via": via, "json": r.json()}
                except Exception:
                    pass
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"fetch failed: {e}"}

    if html is None:
        return {"ok": False, "error": "no content"}
    if mode == "html":
        out = html[:500000]
    elif mode == "text":
        out = _html_to_text(html)
    else:  # markdown
        out = _html_to_markdown(html)
    return {"ok": True, "via": via, "mode": mode, "content": out[:500000]}
