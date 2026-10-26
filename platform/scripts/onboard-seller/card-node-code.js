// js-нода «Картка запуску»: після завершення діалогу бере досьє експерта з Flows API й готує тексти для власника.
// Не кидає винятків: збій не має зірвати сесію (правило 5 стандарту) — тоді власник отримає коротку відмітку про помилку.
const base = String(keys.SELLER_DOSSIER_URL || '').replace(/\/$/, '');
const out = { ownerCardText: '', ownerFull1: '', ownerFull2: '', ownerFull3: '', cardReady: false, cardVerdict: '' };
try {
  const res = await fetch(base + '/owner-card?sessionId=' + encodeURIComponent(session.id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Search-Secret': String(keys.SEARCH_SECRET || '') },
    body: '{}',
  });
  const j = await res.json();
  if (!j || !j.ok) throw new Error((j && j.error) || ('HTTP ' + res.status));
  const who = [user.firstName, user.lastName].filter(Boolean).join(' ') || ('Telegram ' + user.telegramId);
  const un = user.username ? ' (@' + user.username + ')' : '';
  out.ownerCardText = '<b>Новий експерт: ' + who + un + '</b>\n\n' + j.cardText;
  out.ownerFull1 = (j.fullParts && j.fullParts[0]) || '';
  out.ownerFull2 = (j.fullParts && j.fullParts[1]) || '';
  out.ownerFull3 = (j.fullParts && j.fullParts[2]) || '';
  out.cardReady = !!j.ready;
  out.cardVerdict = j.verdict || '';
} catch (e) {
  out.ownerCardText = 'Онбординг експерта завершився, але картку не вдалося зібрати: ' + e.message + '. Telegram ID ' + user.telegramId + '. Досьє в Flows, сесія ' + session.id + '.';
}
if (context.c2Summary) out.ownerCardText = String(out.ownerCardText || '') + '\n\n' + context.c2Summary; // C2_SUMMARY
if (context.provisionText) out.ownerCardText = String(out.ownerCardText || '') + '\n\n' + context.provisionText; // PROVISION
return out;
