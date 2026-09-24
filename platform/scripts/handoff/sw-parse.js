var m = String(input || context.message || context.text || '').trim();
var name = '';
var a = m.match(/^\s*(?:перемкни(?:ся)?|переключи(?:ся)?|switch)\s+(?:на\s+|to\s+)?(?:проєкт\s+|проект\s+|компанію\s+|project\s+)?[«"']?([^«»"'\n]{2,60}?)[»"']?\s*[.!]?\s*$/i);
var b = m.match(/^\s*\/(?:project|проєкт)\s+[«"']?([^«»"'\n]{2,60}?)[»"']?\s*$/i);
var c = m.match(/(?:працюй|працюємо|працюйте)\s+(?:з|над|на)\s+(?:проєктом|проектом|компанією)\s+[«"']?([^«»"'\n]{2,60}?)[»"']?\s*[.!]?\s*$/i);
var r = a || b || c;
if (r) name = r[1].trim();
return { swName: name };
