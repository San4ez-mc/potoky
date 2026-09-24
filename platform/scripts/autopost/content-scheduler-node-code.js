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
          await tgPhoto(CHAT_ID, url, header);
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
    if (autoSlug) {
      try {
        const chain = [];
        for (const item of (post.items||[])) {
          const t = (item.content||'').trim();
          if (!t) continue;
          const one = { text: t };
          if (item.imagePath) one.imageUrl = item.imagePath.startsWith('http') ? item.imagePath : NEXTAUTH_URL+item.imagePath;
          chain.push(one);
        }
        if (chain.length) {
          const r = await fetch(AUTOPOST_BASE+autoSlug, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ text: chain[0].text, imageUrl: chain[0].imageUrl || null, items: chain, postGroupId: post.id })
          });
          if (!r.ok) throw new Error('HTTP '+r.status);
          autoposted++;
        }
      } catch(e) { errors.push('autopost '+autoSlug+' '+post.id+': '+e.message); }
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
            await tgPhoto(CHAT_ID, url, msg);
          } else {
            await tgMsg(CHAT_ID, msg);
          }
          sent++;
          first = false;
        } catch(e) { errors.push('post '+post.id+': '+e.message); }
      }
    }
    if (callbackUrl) {
      try { await fetch(callbackUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postGroupId:post.id,status:'published'})}); } catch(e){}
    }
  }
}

if (errors.length) {
  try { await tgMsg(OWNER_ID, '⚠️ Scheduler помилки ('+today+'):\n'+errors.join('\n')); } catch(e){}
}
return {sent, autoposted, errors, today, mode};
})();
