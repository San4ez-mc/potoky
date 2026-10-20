'use strict';
// Прогін роута /api/seller-dossier з підміненою БД (у памʼяті): node scripts/qa/test-seller-dossier-route.js
const Module = require('module');
const assert = require('assert');
const files = [];
const fakeDb = { db: {
    session: { findUnique: async ({ where }) => (where.id === 'S1' ? { id: 'S1', userId: 'U1', botId: 'B1' } : null) },
    file: {
        findFirst: async ({ where }) => files.find((f) => f.userId === where.userId && f.botId === where.botId && f.fileType === where.fileType) || null,
        create: async ({ data }) => { const r = { id: 'F' + (files.length + 1), ...data }; files.push(r); return r; },
        update: async ({ where, data }) => { Object.assign(files.find((f) => f.id === where.id), data); return null; },
    },
} };
const origLoad = Module._load;
Module._load = function (req, ...rest) {
    if (req === '@platform/db') return fakeDb;
    if (req === '@platform/logger') return { error() {}, info() {}, warn() {} };
    return origLoad.call(this, req, ...rest);
};
process.env.SEARCH_SECRET = 'sec';
const express = require('express');
const router = require('../../apps/api/src/routes/sellerDossier');
const app = express(); app.use(express.json()); app.use('/api/seller-dossier', router);

(async () => {
    const srv = app.listen(0); const port = srv.address().port;
    const call = async (route, body, { secret = 'sec', session = 'S1' } = {}) => {
        const r = await fetch(`http://127.0.0.1:${port}/api/seller-dossier/${route}?sessionId=${session}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Search-Secret': secret }, body: JSON.stringify(body || {}) });
        return { status: r.status, json: await r.json() };
    };
    let r = await call('get', {}, { secret: 'bad' }); assert.strictEqual(r.status, 401);
    r = await call('get', {}, { session: 'NOPE' }); assert.strictEqual(r.status, 404);
    r = await call('get'); assert.strictEqual(r.json.ready, false); assert.strictEqual(r.json.critical.length, 11);
    r = await call('set-many', { fields: [{ id: 'K2', status: 'confirmed', value: 'Діагностична консультація' }] });
    assert.strictEqual(r.json.ok, false); // без цитати
    r = await call('set-many', { fields: [
        { id: 'K1', status: 'from_materials', value: 'Психолог, працює з тривогою', source: 'site' },
        { id: 'K4', status: 'from_materials', value: '1500 грн', source: 'site' },
        { id: 'K9', status: 'from_materials', value: 'типовий список', source: 'default' },
    ], materials: [{ kind: 'site', ref: 'https://example.com' }] });
    assert.strictEqual(r.json.ok, true); assert.strictEqual(r.json.closed, '0/11');
    r = await call('confirm-all', { quote: 'так, усе вірно' });
    assert.deepStrictEqual(r.json.stillNeedExplicit.sort(), ['K4', 'K9']); assert.strictEqual(r.json.closed, '1/11');
    assert.strictEqual(files.length, 1); // один рядок на експерта, оновлюється
    r = await call('expert-card'); assert.ok(r.json.text.includes('Ось що в мене записано')); assert.ok(!/K\d/.test(r.json.text), 'експерту не показуємо коди K1-K11');
    r = await call('owner-card'); assert.ok(r.json.cardText.includes('Не готово: 1/11')); assert.ok(r.json.fullParts.length >= 1);
    srv.close();
    console.log('Роут: усі перевірки пройшли');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
