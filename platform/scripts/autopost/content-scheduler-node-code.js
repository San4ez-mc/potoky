return (async () => {
const BOT_TOKEN = keys.TELEGRAM_BOT_TOKEN;
const OWNER_ID = keys.OWNER_TELEGRAM_ID || '345126254';
const NEXTAUTH_URL = 'https://content2.fineko.space';
const AUTOPOST_BASE = 'https://flows.fineko.space/webhook/bot/';

const mode = context.mode;
const posts = Array.isArray(context.posts) ? context.posts : [];
const today = context.today || new Date().toISOString().slice(0,10);
const callbackUrl = context.callbackUrl;
const CHAT_ID = context.telegramChatId || keys.TELEGRAM_CHANNEL_ID;

const LABELS = {
  instagram_posts:'📸 Instagram', instagram_stories:'📱 Stories',
  instagram_reels:'🎬 Reels', threads:'🧵 Threads',
  linkedin:'💼 LinkedIn', tiktok:'🎵 TikTok',
  telegram:'✈️ Telegram', facebook:'📘 Facebook', youtube:'▶️ YouTube',
};

async function tgMsg(chatId, text) {
  const r = await fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/sendMessage',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({chat_id:chatId, text, parse_mode:'HTML', disable_web_page_preview:true})
  });
  return r.json();
}
async function tgPhoto(chatId, photo, caption) {
  const r = await fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/sendPhoto',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({chat_id:chatId, photo, caption, parse_mode:'HTML'})
  });
  return r.json();
}

async function tgVideo(chatId, video, caption) {
  const r = await fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/sendVideo',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({chat_id:chatId, video, caption, parse_mode:'HTML', supports_streaming:true})
  });
  return r.json();
}
function header1(label, day) { return '<b>'+label+'  |  '+day+'</b>'; }

let sent = 0;
let autoposted = 0;
const errors = [];

if (mode === 'digest') {
  await tgMsg(CHAT_ID, '🌅 Контент на '+today+' ('+posts.length+' постів)');
  for (const post of posts) {
    const label = LABELS[post.platform] || post.platform || '';
    const time = post.scheduleTime ? ' · '+post.scheduleTime : '';
    for (const item of (post.items||[])) {
      const content = (item.content||'').trim();
      if (!content) continue;
      try {
        const header = label+time;
        const escaped = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const msg = '<b>'+header+'</b>\n<pre>'+escaped+'</pre>';
        if (item.imagePath) {
          const url = item.imagePath.startsWith('http') ? item.imagePath : NEXTAUTH_URL+item.imagePath;
          if (item.mediaKind === 'video' || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) await tgVideo(CHAT_ID, url, header);
          else await tgPhoto(CHAT_ID, url, header);
        }
        await tgMsg(CHAT_ID, msg);
        sent++;
      } catch(e) { errors.push('post '+post.id+': '+e.message); }
    }
  }
  await tgMsg(CHAT_ID, '✅ Дайджест: '+sent+'/'+posts.length+' постів');
} else {
  for (const post of posts) {
    const label = LABELS[post.platform] || post.platform || '';

    // Пряма автопублікація: одна пост-група = одна публікація (перший item — пост, наступні — відповіді-ланцюжок)
    const autoSlug = (post.postDirectly && post.autopostSlug) ? String(post.autopostSlug).replace(/[^a-zA-Z0-9_-]/g,'') : '';
    let autoFailed = false;
    if (autoSlug) {
      try {
        const chain = [];
        for (const item of (post.items||[])) {
          const t = (item.content||'').trim();
          if (!t) continue;
          const one = { text: t };
          if (item.imagePath) {
            const u = item.imagePath.startsWith('http') ? item.imagePath : NEXTAUTH_URL+item.imagePath;
            // відео зберігається в imagePath: без явного типу публікатор слав би mp4 як картинку
            if (item.mediaKind === 'video' || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u)) one.videoUrl = u; else one.imageUrl = u;
          }
          chain.push(one);
        }
        if (chain.length) {
          const first = chain[0];
          const r = await fetch(AUTOPOST_BASE+autoSlug, {
            method:'POST', headers:{'Content-Type':'application/json'},
            // callbackUrl + postGroupId: публікатор САМ повертає результат (published/failed + externalId) у content2
            body: JSON.stringify({ text: first.text, content: first.text, imageUrl: first.imageUrl || null, videoUrl: first.videoUrl || null,
              title: post.hook || null, hook: post.hook || null, formatKey: post.formatKey || null, items: chain, postGroupId: post.id, callbackUrl: callbackUrl || null })
          });
          if (!r.ok) throw new Error('HTTP '+r.status);
          autoposted++;
        }
      } catch(e) {
        autoFailed = true;
        errors.push('autopost '+autoSlug+' '+post.id+': '+e.message);
        if (callbackUrl) { try { await fetch(callbackUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postGroupId:post.id,status:'failed',platform:post.platform,error:'запуск публікатора '+autoSlug+': '+e.message})}); } catch(e2){} }
      }
    }

    // Telegram — лише якщо для цієї мережі не вимкнено
    if (post.sendToTelegram !== false) {
      let first = true;
      for (const item of (post.items||[])) {
        const content = (item.content||'').trim();
        try {
          const note = (autoSlug && first) ? '\n\n🚀 Автопублікація в '+label+' запущена' : '';
          const msg = '<b>'+label+'  |  '+today+'</b>\n\n'+content+note+'\n\n<a href="'+NEXTAUTH_URL+'/calendar">📋 Платформа</a>';
          if (item.imagePath) {
            const url = item.imagePath.startsWith('http') ? item.imagePath : NEXTAUTH_URL+item.imagePath;
            const isVideo = item.mediaKind === 'video' || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
            // підпис до медіа в Telegram ≤1024 символів, тому довгий текст шлемо окремим повідомленням
            if (isVideo) { await tgVideo(CHAT_ID, url, header1(label, today)); await tgMsg(CHAT_ID, msg); }
            else await tgPhoto(CHAT_ID, url, msg);
          } else {
            await tgMsg(CHAT_ID, msg);
          }
          sent++;
          first = false;
        } catch(e) { errors.push('post '+post.id+': '+e.message); }
      }
    }
    // Результат прямої публікації повертає САМ публікатор (published/failed). Тут «published» ставимо лише
    // постам без автопубліктора (доставка в Telegram) — інакше позначили б успішним те, що ще публікується або впало.
    if (callbackUrl && !autoSlug) {
      try { await fetch(callbackUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postGroupId:post.id,status:'published'})}); } catch(e){}
    }
  }
}

if (errors.length) {
  try { await tgMsg(OWNER_ID, '⚠️ Scheduler помилки ('+today+'):\n'+errors.join('\n')); } catch(e){}
}
return {sent, autoposted, errors, today, mode};
})();
