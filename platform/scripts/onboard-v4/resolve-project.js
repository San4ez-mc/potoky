// QA холодного старту: сесія тесту може вказати власний порожній проєкт через contextOverride.testProjectId
if (context.testMode && context.testProjectId) { return { content2ProjectId: context.testProjectId, startArg: null }; }
// funnel-тести: лише ізольований QA-проєкт, не створюємо «Клієнт TG…» і не чіпаємо реальні компанії
if (context.testMode && keys.CONTENT2_TEST_PROJECT_ID) { return { content2ProjectId: keys.CONTENT2_TEST_PROJECT_ID, startArg: null }; }
const adminId = String(keys.ADMIN_TELEGRAM_ID || '');
const isAdmin = String(user.telegramId) === adminId;

if (isAdmin) {
  const startArg = String(context.startArg || '').trim();
  if (startArg) {
    try {
      const res = await fetch(keys.CONTENT2_URL + '/api/webhooks/resolve-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-secret': keys.CONTENT2_WEBHOOK_SECRET },
        body: JSON.stringify({ name: startArg }),
      });
      const json = await res.json();
      if (json && json.ok && json.id) {
        return { content2ProjectId: json.id, startArg: null };
      }
      console.log('resolve project by name: not found', startArg);
    } catch (e) {
      console.log('resolve project by name failed', e.message);
    }
  }
  return { content2ProjectId: keys.CONTENT2_PROJECT_ID, startArg: null };
}

const projectName = 'Клієнт TG' + user.telegramId;
try {
  const res = await fetch(keys.CONTENT2_URL + '/api/webhooks/onboarding-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': keys.CONTENT2_WEBHOOK_SECRET },
    body: JSON.stringify({
      projectName: projectName,
      kind: 'brand',
      data: { title: 'Створення профілю клієнта', content: 'Автоматично створено для нового клієнта онбордингу (Telegram ID ' + user.telegramId + ').' },
    }),
  });
  const json = await res.json();
  if (json && json.ok && json.projectId) {
    return { content2ProjectId: json.projectId };
  }
  console.log('resolve project: unexpected response', JSON.stringify(json).slice(0, 300));
} catch (e) {
  console.log('resolve project failed', e.message);
}
return { content2ProjectId: keys.CONTENT2_PROJECT_ID };
