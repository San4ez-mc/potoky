'use strict';
// Тести логіки досьє експерта (без БД): node scripts/qa/test-seller-dossier.js
const assert = require('assert');
const D = require('../../apps/api/src/services/sellerDossier');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('порожній стан: 0/11, не готово, усі 11 блокують', () => {
    const c = D.computeCard(D.emptyState());
    assert.strictEqual(c.ready, false); assert.strictEqual(c.done, 0); assert.strictEqual(c.blockers.length, 11);
});
t('confirmed без цитати відхиляється', () => {
    const s = D.emptyState();
    assert.strictEqual(D.setField(s, { id: 'K4', status: 'confirmed', value: '2000 грн' }).ok, false);
});
t('confirmed без value відхиляється', () => {
    assert.strictEqual(D.setField(D.emptyState(), { id: 'K4', status: 'confirmed', quote: 'так' }).ok, false);
});
t('невідоме поле й неправильний статус відхиляються', () => {
    assert.strictEqual(D.setField(D.emptyState(), { id: 'K99', status: 'confirmed', value: 'x', quote: 'y' }).ok, false);
    assert.strictEqual(D.setField(D.emptyState(), { id: 'K1', status: 'ok', value: 'x' }).ok, false);
});
t('дані з сайту (🟡) не закривають запуск', () => {
    const s = D.emptyState();
    for (const d of D.CRITICAL) assert.ok(D.setField(s, { id: d.id, status: 'from_materials', value: 'з сайту', source: 'site' }).ok);
    const c = D.computeCard(s);
    assert.strictEqual(c.ready, false); assert.strictEqual(c.done, 0);
});
t('конфлікт примусово робить 🔴 навіть якщо передали confirmed', () => {
    const s = D.emptyState();
    D.setField(s, { id: 'K4', status: 'confirmed', value: '1500', quote: 'так', conflict: 'на сайті 1500, експерт сказав 2000' });
    assert.strictEqual(s.fields.K4.status, 'conflict');
    assert.strictEqual(D.computeCard(s).conflicts.length, 1);
});
t('confirmAll: 🟡→✅, але K4 і K9 потребують окремого підтвердження', () => {
    const s = D.emptyState();
    for (const d of D.CRITICAL) D.setField(s, { id: d.id, status: 'from_materials', value: 'v', source: 'site' });
    const r = D.confirmAll(s, 'так, усе вірно');
    assert.deepStrictEqual(r.skippedNeedExplicit.sort(), ['K4', 'K9']);
    assert.strictEqual(r.confirmed.length, 9);
    assert.strictEqual(D.computeCard(s).ready, false);
    D.setField(s, { id: 'K4', status: 'confirmed', value: '2000 грн, передоплата 100%', quote: 'так, 2000 і повна передоплата' });
    D.setField(s, { id: 'K9', status: 'confirmed', value: 'типовий список + знижок не обіцяти', quote: 'так, ще без знижок', source: 'default' });
    const c = D.computeCard(s);
    assert.strictEqual(c.ready, true); assert.strictEqual(c.done, 11);
});
t('confirmAll без цитати відхиляється', () => assert.strictEqual(D.confirmAll(D.emptyState(), '').ok, false));
t('not_applicable потребує note і цитати; потім закриває поле', () => {
    const s = D.emptyState();
    assert.strictEqual(D.setField(s, { id: 'K4', status: 'not_applicable' }).ok, false);
    assert.ok(D.setField(s, { id: 'K4', status: 'not_applicable', note: 'консультація безкоштовна', quote: 'це безкоштовно' }).ok);
    assert.strictEqual(D.computeCard(s).done, 1);
});
t('некритичні поля не блокують запуск', () => {
    const s = D.emptyState();
    for (const d of D.CRITICAL) D.setField(s, { id: d.id, status: 'confirmed', value: 'v', quote: 'q' });
    assert.strictEqual(D.computeCard(s).ready, true);
    assert.ok(D.computeCard(s).optional.every((o) => o.status === 'missing'));
});
t('картка власнику: вердикт, HTML екранується, ≤4000 символів', () => {
    const s = D.emptyState();
    D.setField(s, { id: 'K1', status: 'confirmed', value: 'Психолог <b>x</b> & Ко', quote: 'так' });
    D.setField(s, { id: 'K2', status: 'from_materials', value: 'x'.repeat(5000), source: 'site' });
    const text = D.renderOwnerCard(D.computeCard(s), s);
    assert.ok(text.includes('Не готово: 1/11')); assert.ok(text.includes('&lt;b&gt;')); assert.ok(text.length <= 4000);
});
t('повні відповіді ріжуться на частини ≤3900', () => {
    const s = D.emptyState();
    for (const d of D.CRITICAL) D.setField(s, { id: d.id, status: 'confirmed', value: 'a'.repeat(1400), quote: 'q'.repeat(500) });
    const parts = D.renderFull(D.computeCard(s), s);
    assert.ok(parts.length >= 2); assert.ok(parts.every((p) => p.length <= 3900));
});
console.log(`\nВсі ${n} тестів пройшли`);
