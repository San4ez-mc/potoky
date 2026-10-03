return (async () => {
  var k = (typeof keys!=='undefined' && keys) ? keys : {};
  if(!k.THREADS_USER_ID || !k.THREADS_ACCESS_TOKEN) return { publishError:'NEED_THREADS_KEYS', note:'встав THREADS_USER_ID, THREADS_ACCESS_TOKEN' };
  var base = 'https://graph.threads.net/v1.0/'+k.THREADS_USER_ID;
  var qs = 'access_token='+encodeURIComponent(k.THREADS_ACCESS_TOKEN);

  // items[] — ланцюжок: перший item = пост, наступні = відповіді на попередній (тред / CTA-коментар).
  // Без items — працює як раніше: один пост з text/imageUrl/videoUrl.
  var items = (Array.isArray(context.items) && context.items.length)
    ? context.items
    : [{ text: context.text||context.content||'', imageUrl: context.imageUrl, videoUrl: context.videoUrl }];

  function sleep(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

  async function postOne(it, replyTo) {
    var text = String(it.text||'').slice(0,500);
    var mt = it.videoUrl ? 'VIDEO' : (it.imageUrl ? 'IMAGE' : 'TEXT');
    var body = 'media_type='+mt+'&text='+encodeURIComponent(text);
    if(mt==='IMAGE') body += '&image_url='+encodeURIComponent(it.imageUrl);
    if(mt==='VIDEO') body += '&video_url='+encodeURIComponent(it.videoUrl);
    if(replyTo) body += '&reply_to_id='+encodeURIComponent(replyTo);
    var cj = null;
    for (var attempt = 0; attempt < 3; attempt++) {
      var c = await fetch(base+'/threads?'+qs, {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:body});
      cj = await c.json();
      if (cj && cj.id) break;
      var ecode = cj && cj.error && cj.error.code;
      // code 1/2 = тимчасова помилка Meta ("unknown error"/"service unavailable") — повторюємо з паузою
      if (ecode === 1 || ecode === 2) { await sleep(6000); continue; }
      break;
    }
    if(!cj || !cj.id) return { error:'CONTAINER_FAILED '+JSON.stringify(cj).slice(0,300) };
    if(mt!=='TEXT'){
      // Контейнер із медіа готується не миттєво: чекаємо статусу FINISHED (відео — до ~3 хв), а не фіксовану паузу.
      var ready = false, perr = null;
      for (var w = 0; w < (mt==='VIDEO' ? 40 : 10); w++) {
        await sleep(mt==='VIDEO' ? 5000 : 2000);
        try {
          var sr = await fetch('https://graph.threads.net/v1.0/'+cj.id+'?fields=status,error_message&'+qs);
          var sj = await sr.json();
          if (sj && sj.status === 'FINISHED') { ready = true; break; }
          if (sj && (sj.status === 'ERROR' || sj.status === 'EXPIRED')) { perr = sj.status+' '+(sj.error_message||''); break; }
        } catch(e) {}
      }
      if (perr) return { error:'MEDIA_FAILED '+perr };
      if (!ready) return { error:'MEDIA_NOT_READY (контейнер '+cj.id+' не став FINISHED вчасно)' };
    }
    var p = await fetch(base+'/threads_publish?creation_id='+encodeURIComponent(cj.id)+'&'+qs, {method:'POST'});
    var pj = await p.json();
    if(!pj || !pj.id) return { error:'PUBLISH_FAILED '+JSON.stringify(pj).slice(0,300) };
    return { id: pj.id };
  }

  var ids = [];
  var prev = context.replyToId || null;   // replyToId — дослати відповідь під уже опублікований пост
  var err = null;
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    if(!String(it.text||'').trim() && !it.imageUrl && !it.videoUrl) continue;
    if (prev) await sleep(5000);   // Meta радить не смикати відповідь одразу після публікації батьківського поста
    var r = await postOne(it, prev);
    if(r.error){ err = 'пост '+(i+1)+'/'+items.length+': '+r.error; break; }
    ids.push(r.id);
    prev = r.id;
  }

  var permalink = null;
  if(ids.length){
    try {
      var pl = await fetch('https://graph.threads.net/v1.0/'+ids[0]+'?fields=permalink&'+qs);
      var plj = await pl.json();
      permalink = (plj && plj.permalink) || null;
    } catch(e) {}
  }

  var publishError = err || (ids.length ? null : 'EMPTY_POST');
  if(context.callbackUrl){ await fetch(context.callbackUrl, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:publishError?'failed':'published', platform:'threads', threadId:ids[0]||null, externalId:ids[0]||null, url:permalink, error:publishError, postGroupId:context.postGroupId||null})}).catch(function(){}); }
  return { platform:'threads', threadId: ids[0]||null, threadIds: ids, permalink: permalink, publishError: publishError };
})();
