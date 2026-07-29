'use strict';
// Vertex Gemini через збережений конектор google_vertex (service-account у config).
// Використовується RAG-пошуком (Фаза 4 орг-платформи) — відповідь у EU, конфіденційно.
const { GoogleAuth } = require('google-auth-library');
const { db } = require('@platform/db');

let _cache = null; // { auth, projectId, location }

async function loadVertexConnector() {
  const c = await db.savedConnector.findFirst({ where: { type: 'google_vertex', isActive: true } });
  if (!c) throw new Error('Vertex-конектор (google_vertex) не знайдено у збережених конекторах');
  const cfg = c.config || {};
  if (!cfg.serviceAccountJson) throw new Error('serviceAccountJson відсутній у Vertex-конекторі');
  const auth = new GoogleAuth({ credentials: cfg.serviceAccountJson, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return { auth, projectId: cfg.projectId, location: cfg.location || 'europe-west4' };
}

/** Згенерувати відповідь через Vertex Gemini. Кидає помилку — обробляти вище. */
async function vertexGeminiGenerate({ prompt, model = 'gemini-2.5-flash', maxTokens = 2048, temperature = 0.3 }) {
  if (!_cache) _cache = await loadVertexConnector();
  const { auth, projectId, location } = _cache;
  const client = await auth.getClient();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const res = await client.request({
    url, method: 'POST',
    data: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    },
  });
  const parts = res.data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

// Скинути кеш конектора (якщо змінили ключ у UI).
function resetVertexCache() { _cache = null; }

module.exports = { vertexGeminiGenerate, resetVertexCache };
