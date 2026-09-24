var s = context.activeProjectId;
var saved = '';
if (s && typeof s === 'object') saved = s.id ? String(s.id).trim() : '';
else if (s) saved = String(s).trim();
return { projectId: context.projectId || saved || keys.CONTENT2_PROJECT_ID };
