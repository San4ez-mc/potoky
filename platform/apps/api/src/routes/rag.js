'use strict';
// RAG-пошук для орг-платформи (Фаза 4): vector-пошук по токену компанії → відповідь Vertex Gemini → джерела.
// Через флоус, бо тут живе вся AI-обв'язка. Auth: заголовок X-Rag-Secret.
const express = require('express');
const router = express.Router();
const { vertexGeminiGenerate } = require('../services/vertexGemini');
const { db } = require('@platform/db');

const VECTOR_URL = process.env.VECTOR_URL || 'http://127.0.0.1:4500';
const RAG_SECRET = process.env.RAG_SECRET || '';

router.post('/search', async (req, res) => {
  const started = Date.now();
  try {
    if (RAG_SECRET && req.headers['x-rag-secret'] !== RAG_SECRET) return res.status(401).json({ error: 'unauthorized' });
    const { query, vectorToken } = req.body || {};
    if (!query || !vectorToken) return res.status(400).json({ error: 'query і vectorToken обовʼязкові' });

    // 1) Семантичний пошук у vector-базі (по токену компанії — поважає folderScope)
    let results = [];
    let vecErr = null;
    try {
      const vr = await fetch(`${VECTOR_URL}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vectorToken}` },
        body: JSON.stringify({ query, limit: 6 }),
      });
      const vj = await vr.json();
      results = Array.isArray(vj?.results) ? vj.results : [];
    } catch (e) { vecErr = e.message; }

    if (!results.length) {
      return res.json({ answer: 'У доступних тобі папках нічого не знайшлось за цим запитом.', sources: [], error: vecErr });
    }

    // 2) Промпт із джерелами
    const context = results.map((r, i) => `[${i + 1}] Джерело: ${r.source}\n${String(r.content || '').slice(0, 1200)}`).join('\n\n');
    const prompt = `Ти — асистент по базі знань компанії. Відповідай ЛИШЕ на основі наведених джерел, українською, стисло і по суті. Якщо відповіді немає в джерелах — прямо скажи про це. Не переліковуй джерела наприкінці (їх покаже інтерфейс).\n\nПИТАННЯ: ${query}\n\nДЖЕРЕЛА:\n${context}`;

    // 3) Vertex Gemini (EU)
    let answer = '';
    let genErr = null;
    try { answer = await vertexGeminiGenerate({ prompt }); }
    catch (e) { genErr = e.message; answer = 'Не вдалося згенерувати відповідь (Vertex). Нижче — знайдені джерела.'; }

    // 4) Лог у api_calls (видно в Сесіях → API)
    db.apiCall.create({ data: {
      sessionId: null, service: 'rag_vertex', method: 'rag.search',
      requestData: { query: String(query).slice(0, 200), foundResults: results.length },
      responseData: { answerLen: answer.length }, statusCode: genErr ? 500 : 200,
      durationMs: Date.now() - started, error: genErr,
    } }).catch(() => {});

    res.json({
      answer,
      sources: results.map((r) => ({
        source: r.source, folderId: r.folderId, score: r.score,
        driveFileId: (r.metadata && r.metadata.driveFileId) || null,
        path: (r.metadata && r.metadata.path) || null,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

module.exports = router;
