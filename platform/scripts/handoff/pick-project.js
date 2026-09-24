// У тестовому режимі (funnel-тести) працюємо ТІЛЬКИ з ізольованим QA-проєктом — тести не пишуть у реальні компанії.
if (context.testMode && keys.CONTENT2_TEST_PROJECT_ID) {
  return { projectId: context.projectId || keys.CONTENT2_TEST_PROJECT_ID };
}
var s = context.activeProjectId;
var saved = '';
if (s && typeof s === 'object') saved = s.id ? String(s.id).trim() : '';
else if (s) saved = String(s).trim();
return { projectId: context.projectId || saved || keys.CONTENT2_PROJECT_ID };
