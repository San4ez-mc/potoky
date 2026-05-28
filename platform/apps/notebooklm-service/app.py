"""
NotebookLM Microservice
Provides a simple REST API around notebooklm-py for semantic search over documents.

Endpoints:
  POST /notebooks           — create a new notebook (returns notebookId)
  POST /notebooks/:id/sources — add a URL/text source to a notebook
  POST /notebooks/:id/query  — query the notebook (RAG search)
  GET  /notebooks            — list saved notebooks
  DELETE /notebooks/:id      — delete a notebook

Run: uvicorn app:app --host 0.0.0.0 --port 4200
"""

import os
import json
import asyncio
import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="NotebookLM Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Storage ───────────────────────────────────────────────────────────────────
DATA_DIR = Path(os.environ.get("DATA_DIR", "/var/www/notebooklm.flows.fineko.space/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
NOTEBOOKS_FILE = DATA_DIR / "notebooks.json"

def load_notebooks() -> dict:
    if NOTEBOOKS_FILE.exists():
        return json.loads(NOTEBOOKS_FILE.read_text())
    return {}

def save_notebooks(data: dict):
    NOTEBOOKS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))

# ── Models ────────────────────────────────────────────────────────────────────
class CreateNotebookRequest(BaseModel):
    name: str
    description: Optional[str] = None

class AddSourceRequest(BaseModel):
    type: str = "url"      # "url" | "text"
    content: str           # URL or raw text
    title: Optional[str] = None

class QueryRequest(BaseModel):
    question: str
    language: Optional[str] = "uk"

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"ok": True, "service": "notebooklm"}


@app.get("/notebooks")
async def list_notebooks():
    notebooks = load_notebooks()
    return {"notebooks": [
        {"id": k, "name": v.get("name"), "description": v.get("description"),
         "sourcesCount": len(v.get("sources", []))}
        for k, v in notebooks.items()
    ]}


@app.post("/notebooks")
async def create_notebook(req: CreateNotebookRequest):
    import uuid
    notebook_id = str(uuid.uuid4())[:8]
    notebooks = load_notebooks()
    notebooks[notebook_id] = {
        "name": req.name,
        "description": req.description,
        "sources": [],
        "notebooklm_id": None,
    }
    save_notebooks(notebooks)
    logger.info(f"Created notebook {notebook_id}: {req.name}")
    return {"ok": True, "notebookId": notebook_id, "name": req.name}


@app.post("/notebooks/{notebook_id}/sources")
async def add_source(notebook_id: str, req: AddSourceRequest):
    notebooks = load_notebooks()
    if notebook_id not in notebooks:
        raise HTTPException(404, "Notebook not found")

    nb = notebooks[notebook_id]

    try:
        from notebooklm import NotebookLM
        nlm = NotebookLM()

        # Create NotebookLM notebook if not yet created
        if not nb.get("notebooklm_id"):
            nb["notebooklm_id"] = await asyncio.to_thread(
                nlm.create_notebook, nb["name"]
            )

        # Add source
        if req.type == "url":
            await asyncio.to_thread(nlm.add_source, nb["notebooklm_id"], req.content, source_type="url")
        else:
            await asyncio.to_thread(nlm.add_source, nb["notebooklm_id"], req.content, source_type="text")

        nb["sources"].append({"type": req.type, "content": req.content[:200], "title": req.title})
        save_notebooks(notebooks)
        logger.info(f"Source added to notebook {notebook_id}")
        return {"ok": True, "sourcesCount": len(nb["sources"])}

    except ImportError:
        # notebooklm-py not installed — store locally for future use
        nb["sources"].append({"type": req.type, "content": req.content, "title": req.title})
        save_notebooks(notebooks)
        logger.warning("notebooklm-py not installed, source stored locally only")
        return {"ok": True, "sourcesCount": len(nb["sources"]), "warning": "notebooklm-py not available, stored locally"}


@app.post("/notebooks/{notebook_id}/query")
async def query_notebook(notebook_id: str, req: QueryRequest):
    notebooks = load_notebooks()
    if notebook_id not in notebooks:
        raise HTTPException(404, "Notebook not found")

    nb = notebooks[notebook_id]

    if not nb.get("notebooklm_id"):
        raise HTTPException(400, "Notebook has no sources in NotebookLM yet. Add sources first.")

    try:
        from notebooklm import NotebookLM
        nlm = NotebookLM()
        answer = await asyncio.to_thread(nlm.query, nb["notebooklm_id"], req.question)
        return {"ok": True, "answer": answer, "notebookId": notebook_id}

    except ImportError:
        # Fallback: return all stored source texts for Claude to process
        sources_text = "\n\n---\n\n".join([
            f"[{s.get('title', 'Source')}]\n{s['content']}"
            for s in nb["sources"]
        ])
        return {
            "ok": True,
            "answer": None,
            "fallback": sources_text,
            "warning": "notebooklm-py not available, returning raw sources for LLM processing",
        }


@app.delete("/notebooks/{notebook_id}")
async def delete_notebook(notebook_id: str):
    notebooks = load_notebooks()
    if notebook_id not in notebooks:
        raise HTTPException(404, "Notebook not found")
    del notebooks[notebook_id]
    save_notebooks(notebooks)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4200)
