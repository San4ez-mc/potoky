var id = String(context.swRes.id);
var name = String(context.swRes.name || context.swName || '');
// swSaved пишеться у файл користувача (active_project); at робить кожен запис унікальним,
// щоб повернення A→B→A у межах однієї сесії теж збережилось.
return {
  projectId: id,
  swProjectName: name,
  swSaved: JSON.stringify({ id: id, name: name, at: Date.now() })
};
