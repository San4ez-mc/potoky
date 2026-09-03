// n_reconcile — джерело істини (goverla CRM-клон, патч patch-goverla-crm-audit-2026-09-04.js).
// Аудит 2026-09-04: (1) оплату, уже підтверджену раніше в цій сесії, не звіряємо вдруге
// (квитанція могла прийти ДО адреси — транзакцію вже спожито, повторний пошук дав би хибне
// "не знайдено"); (2) у виписці дивимось лише платежі ПІСЛЯ видачі orderRef (orderRefAt) —
// інакше чужа передоплата тієї ж суми (типові 200 грн) зараховувалась цьому клієнту;
// (3) слабкий збіг "лише за сумою" — тільки коли клієнт САМ сказав, що оплатив (або дав
// квитанцію) і кандидат рівно один.
if (context.payStatus === 'confirmed' && context.payTxId) return { payStatus:'confirmed', payVia: context.payVia || 'mono:prev', payTxId: context.payTxId };
// Реквізити: активний ФОП з CRM (context.fop, ставить n_pay_amount), інакше funnelKey.
var EXPECTED_IBAN = String((context.fop&&context.fop.iban)||keys.FOP_IBAN||'').replace(/\s/g,'');
var EXPECTED_CODE = String((context.fop&&context.fop.code)||keys.FOP_CODE||'').replace(/\D/g,'');
var orderRef = String(context.orderRef||'').toUpperCase();
var expected = Number(context.payAmount)||0;
var stmt = Array.isArray(context.monoStatement)?context.monoStatement:[];
var sinceMs = Number(context.orderRefAt)||0;
if (sinceMs) { var sinceSec = Math.floor(sinceMs/1000) - 10*60; stmt = stmt.filter(function(t){ return !t || !t.time || Number(t.time) >= sinceSec; }); }
var claimedPaid = /оплат|заплат|перек[аи]|скинув|скинула|відправив|відправила|перевів|перевела|кинув|кинула|paid/i.test(String(context.lastUserMessage||input||'')) || !!context.lastReceiptImageUrl;
var consumed = Array.isArray(context.consumedTxIds)?context.consumedTxIds:[];
function isC(id){ return consumed.indexOf(id)>=0; }
function parseAmount(txt){ if(!txt)return null; var m=String(txt).match(/(\d[\d\s]*[.,]?\d{0,2})\s*(?:грн|uah|₴)?/i); if(!m)return null; var n=parseFloat(m[1].replace(/\s/g,'').replace(',','.')); return isFinite(n)?Math.round(n*100)/100:null; }
function normName(s){ return String(s||'').toLowerCase().replace(/[^0-9a-zа-яіїєґ]+/gi,' ').trim(); }
function nameOverlap(a,b){ var aa=normName(a).split(' ').filter(function(x){return x.length>2;}); var bb=normName(b).split(' ').filter(function(x){return x.length>1;}); if(!aa.length||!bb.length)return false; for(var i=0;i<aa.length;i++){ if(bb.indexOf(aa[i])>=0) return true; } return false; }
// 1) унікальний збіг за orderRef у призначенні
function matchByRef(){ if(!orderRef)return null; for(var i=0;i<stmt.length;i++){ var t=stmt[i]; if(!isC(t.id) && String(t.comment||'').toUpperCase().indexOf(orderRef)>=0) return t; } return null; }
// 2) за сумою + розрізнення за ПЛАТНИКОМ/ЧАСОМ (щоб однакові суми не плутались)
function matchByAmount(amount, hints){ hints=hints||{}; if(!amount)return null; var cands=[]; for(var i=0;i<stmt.length;i++){ var t=stmt[i]; if(!isC(t.id) && Math.abs(Number(t.amountUah)-amount)<0.01) cands.push(t); } if(!cands.length)return null;
  if(hints.payerName){ for(var j=0;j<cands.length;j++){ if(nameOverlap(hints.payerName,(cands[j].counterName||'')+' '+(cands[j].description||''))) return cands[j]; } }
  if(hints.timeSec){ var best=null,bd=1e18; for(var k=0;k<cands.length;k++){ var d=Math.abs(Number(cands[k].time)-Number(hints.timeSec)); if(d<bd){bd=d;best=cands[k];} } if(best&&bd<=5400) return best; }
  cands.sort(function(a,b){return Number(b.time)-Number(a.time);}); return cands[0]; }
var found = matchByRef();
var via = found ? 'mono:ref' : '';
// Крок 2: лінк-квитанція у тексті (check.monobank.ua / pb.ua/check тощо) — парсимо кодом
if(!found){
  var link=(String(context.lastUserMessage||input||'').match(/https?:\/\/[^\s]+/)||[])[0];
  function linkOk(u){ try{ var h=new URL(u).hostname.toLowerCase(); return ['check.monobank.ua','send.monobank.ua','pay.mono.ua','pb.ua','privatbank.ua','next.privat24.ua','portmone.com.ua','check.gov.ua'].some(function(d){return h===d||h.endsWith('.'+d);}); }catch(e){return false;} }
  if(link && linkOk(link)){ var ac=new AbortController(); var to=setTimeout(function(){try{ac.abort();}catch(e){}},8000);
    try{ var r=await fetch(link,{redirect:'follow',signal:ac.signal}); var html=(await r.text()).slice(0,300000); var txt=html.replace(/<[^>]+>/g,' ');
      var okRec = txt.replace(/\s/g,'').indexOf(EXPECTED_IBAN)>=0 || txt.replace(/\D/g,'').indexOf(EXPECTED_CODE)>=0;
      var amt = parseAmount((txt.match(/(?:Сума|Сумма|Amount)[^\d]{0,20}(\d[\d\s]*[.,]?\d{0,2})/i)||[])[1]);
      var payer=(txt.match(/Платник[^A-Za-zА-Яа-яІЇЄҐіїєґ]{0,15}([A-Za-zА-Яа-яІЇЄҐіїєґ'\-]{2,}\s+[A-Za-zА-Яа-яІЇЄҐіїєґ'\-]{2,}(?:\s+[A-Za-zА-Яа-яІЇЄҐіїєґ'\-]{2,})?)/)||[])[1]||'';
      if(okRec){ found = matchByAmount(amt||expected, { payerName:payer }); if(found) via='mono:link'; }
    }catch(e){}finally{clearTimeout(to);} }
}
// Крок 3: скрін — ШІ-візія (лише коли Mono не знайшов). Останній резерв.
function imgOk(u){ try{ var h=new URL(u).hostname.toLowerCase(); if(h==='api.telegram.org') return true; return ['cdninstagram.com','fbcdn.net','fbsbx.com'].some(function(d){return h===d||h.endsWith('.'+d);}); }catch(e){return false;} }
if(!found && context.lastReceiptImageUrl && keys.GEMINI_API_KEY && imgOk(context.lastReceiptImageUrl)){
  var ac2=new AbortController(); var to2=setTimeout(function(){try{ac2.abort();}catch(e){}},10000);
  try{
    var ir=await fetch(context.lastReceiptImageUrl,{signal:ac2.signal}); var ab=await ir.arrayBuffer(); if(ab.byteLength>8000000) throw new Error('img too large'); var b64=Buffer.from(ab).toString('base64');
    var mime=(ir.headers.get('content-type')||'image/jpeg').split(';')[0];
    var gr=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key='+encodeURIComponent(keys.GEMINI_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:'Це банківська квитанція про переказ. Поверни ЛИШЕ JSON {"amount":число,"recipientCode":"код одержувача","iban":"IBAN одержувача","payerName":"ПІБ платника","purpose":"призначення"}'},{inline_data:{mime_type:mime,data:b64}}]}]})});
    var gj=await gr.json(); var t=((((gj.candidates||[])[0]||{}).content||{}).parts||[{}])[0].text||''; var mm=t.match(/\{[\s\S]*\}/);
    if(mm){ var f=JSON.parse(mm[0]); var okRec2=String(f.iban||'').replace(/\s/g,'').indexOf(EXPECTED_IBAN)>=0 || String(f.recipientCode||'').replace(/\D/g,'').indexOf(EXPECTED_CODE)>=0; var amt2=Number(f.amount)||parseAmount(f.amount); if(okRec2){ found=matchByAmount(amt2||expected, { payerName:f.payerName }); if(found) via='mono:ai'; } }
  }catch(e){}finally{clearTimeout(to2);}
}
// Крок 4: клієнт написав «оплатив» без квитанції → слабкий збіг за сумою — ЛИШЕ якщо він це
// справді сказав і кандидат за сумою (після orderRefAt) рівно один.
if(!found && expected && claimedPaid){
  var amtCands = stmt.filter(function(t){ return !isC(t.id) && Math.abs(Number(t.amountUah)-expected)<0.01; });
  if(amtCands.length===1){ found = amtCands[0]; via='mono:amount'; }
}
if(found){ consumed.push(found.id); return { payStatus:'confirmed', payVia:via, payTxId:found.id, consumedTxIds:consumed }; }
return { payStatus:'not_found', payVia:'none' };
