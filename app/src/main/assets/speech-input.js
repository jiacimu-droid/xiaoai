/* Native, opt-in STT: never sends the resulting message automatically. */
(function(){
'use strict';
if(window.XaSpeechInput)return;
window.XaSpeechInput=true;
let serial=0,busy=false;
const pending=new Map();
function rpc(action,extra={}){
  return new Promise((resolve,reject)=>{
    if(!window.SpeechInputNative){reject(Error('目前 WebView 不支援語音橋接'));return;}
    const id='stt-'+(++serial);
    pending.set(id,{resolve,reject});
    try{SpeechInputNative.postMessage(JSON.stringify({id,action,...extra}));}
    catch(e){pending.delete(id);reject(e);}
  });
}
if(window.SpeechInputNative)SpeechInputNative.onmessage=e=>{
  try{const msg=JSON.parse(e.data),p=pending.get(msg.id);if(p){pending.delete(msg.id);p.resolve(msg.result);}}catch(_){}
};
function role(){try{return cur?.id==null?null:String(cur.id);}catch(_){return null;}}
function visible(el){return !!el&&el.getClientRects().length>0&&!el.disabled&&!el.readOnly;}
function composer(){
  const chat=document.getElementById('chat');
  if(!chat||!chat.classList.contains('on'))return null;
  const fields=[chat.querySelector('#inbar #inp')].filter(visible);
  return fields.length===1?fields[0]:null;
}
function insert(el,value){
  if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement){
    const a=el.selectionStart??el.value.length,b=el.selectionEnd??a;
    el.setRangeText(value,a,b,'end');
  }else{
    el.append(document.createTextNode(value));
  }
  el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();
}
function button(label,fn){
  const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',fn);return b;
}
function preview(value,originalRole){
  const old=document.getElementById('xaSttResult');if(old)old.remove();
  const root=document.createElement('section');root.id='xaSttResult';
  root.setAttribute('role','dialog');root.setAttribute('aria-label','語音辨識結果');
  root.style.cssText='position:fixed;z-index:100005;left:12px;right:12px;bottom:12px;padding:14px;background:var(--paper,#fff);color:var(--ink,#333);border:1px solid var(--line,#ddd);border-radius:14px;box-shadow:0 4px 24px #0003;display:grid;gap:8px';
  const title=document.createElement('strong');title.textContent='語音轉文字';
  const edit=document.createElement('textarea');edit.value=value;edit.rows=4;edit.style.cssText='box-sizing:border-box;width:100%;font:inherit;color:inherit;background:transparent;border:1px solid #999;border-radius:8px;padding:8px';
  const status=document.createElement('small');status.textContent='可先修改文字；不會自動發送。';
  const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
  row.append(button('填入聊天',()=>{
    if(originalRole===null||role()!==originalRole){status.textContent='聊天對象已切換，請複製後自行貼上。';return;}
    const el=composer();if(!el){status.textContent='未找到唯一聊天輸入框，請複製後貼上。';return;}
    try{insert(el,edit.value);root.remove();}catch(_){status.textContent='無法填入，請複製後貼上。';}
  }),button('複製',async()=>{
    try{const r=await rpc('copy',{text:edit.value});status.textContent=r?.ok?'已複製，可貼到輸入框。':r?.why||'複製失敗';}
    catch(e){status.textContent=String(e.message||e);}
  }),button('關閉',()=>root.remove()));
  root.append(title,edit,status,row);document.body.append(root);
}
async function record(b){
  if(busy)return;
  busy=true;b.disabled=true;const originalRole=role();
  const label=b.lastElementChild;const caption=label.textContent;label.textContent='辨識中…';
  try{
    const result=await rpc('record');
    if(result?.needsSettings)window.alert('請先到「設定 → 語音轉文字」選擇並保存辨識接口。');
    else if(result?.ok)preview(String(result.text||''),originalRole);
    else if(!result?.cancelled)window.alert(result?.why||'語音辨識失敗');
  }catch(e){window.alert(String(e.message||e));}
  finally{busy=false;b.disabled=false;label.textContent=caption;}
}
function install(){
  const apiList=document.getElementById('apiList');
  if(apiList&&!document.getElementById('xaSttSettings')){
    const block=document.createElement('section');block.id='xaSttSettings';block.style.margin='16px 0';
    const title=document.createElement('div');title.className='lbl';title.textContent='語音轉文字';
    const status=document.createElement('div');status.className='set-s';status.style.margin='4px 0 8px';
    async function refresh(){
      try{const result=await rpc('status');status.textContent=result?.provider||'尚未選擇辨識接口';}
      catch(e){status.textContent=e.message;}
    }
    const settings=button('配置辨識接口',async()=>{
      try{const result=await rpc('settings');if(!result?.ok&&!result?.cancelled)window.alert(result?.why||'無法開啟設定');}
      catch(e){window.alert(e.message);}
      await refresh();
    });
    settings.className='btn full ghost';
    block.append(title,status,settings);apiList.after(block);refresh();
  }
  const extra=document.getElementById('extra');
  if(!extra||document.getElementById('xaSttButton'))return;
  const b=button('',()=>{
    extra.classList.remove('open');
    record(b);
  });
  b.id='xaSttButton';b.className='ex';b.setAttribute('aria-label','語音轉文字');
  b.innerHTML='<span class="exic" aria-hidden="true">🎙️</span><span>語音轉文字</span>';
  b.style.cssText='border:0;background:none;font-family:inherit';
  extra.firstElementChild.after(b);
}
install();
// Both voice and Live2D calls share the existing callSay/AI/TTS pipeline.
// No capture when ringing, muted, hidden, or while the character is speaking.
let callCapture=null,callSession=null,callRetryAt=0,callStopped=false,callWasMuted=false;
let callQuietUntil=0,callWasBlocked=false;
function callStatus(text){
  const overlay=document.getElementById('callOverlay');
  if(!overlay)return;
  let el=document.getElementById('xaCallSttStatus');
  if(!el){
    el=document.createElement('div');el.id='xaCallSttStatus';
    el.setAttribute('role','status');
    el.style.cssText='text-align:center;font-size:11px;line-height:1.4;padding:2px 8px;opacity:.8;flex:0 0 auto';
    document.getElementById('callCaps')?.before(el);
  }
  el.textContent=text;el.hidden=!text;
}
function stopCallCapture(){
  if(!callCapture||callCapture.cancelled)return;
  callCapture.cancelled=true;
  rpc('cancelCall').catch(()=>{});
}
function callReady(){
  return callPhase==='connected'&&!callMuteOn&&!document.hidden
    &&document.getElementById('callOverlay')?.classList.contains('show');
}
function speaking(){
  const last=callLog[callLog.length-1];
  return callBusy||!!callAudio||(last?.role==='sys'&&last.text==='正在用 MiniMax 合成語音…');
}
async function listenCall(){
  const job={session:callLog,cancelled:false};callCapture=job;
  callStatus('麥克風收音中 · 說完自動辨識');
  try{
    const result=await rpc('callRecord');
    if(job.cancelled||job.session!==callLog||!callReady()||speaking())return;
    if(result?.cancelled)return;
    if(result?.needsSettings){
      callStopped=true;callStatus('請先到設定 → 語音轉文字配置接口');return;
    }
    if(!result?.ok){
      const why=result?.why||'語音辨識失敗';
      if(why.includes('未辨識到文字')){callRetryAt=Date.now()+250;return;}
      callStopped=true;callStatus(why+' · 關閉再開啟麥克風可重試');return;
    }
    if(result.silence)return;
    const value=String(result.text||'').trim();
    if(!value)return;
    const input=document.getElementById('callInp');
    if(!input)return;
    const draft=input.value;
    input.value=value;
    try{
      // callSay consumes the text synchronously before its first await.
      const response=callSay();input.value=draft;
      await response;
    }finally{if(input.value===value)input.value=draft;}
  }catch(e){
    if(!job.cancelled&&job.session===callLog){callStopped=true;callStatus(String(e.message||e)+' · 重開麥克風可重試');}
  }finally{if(callCapture===job)callCapture=null;}
}
function syncCallCapture(){
  if(typeof callPhase==='undefined'||typeof callLog==='undefined')return;
  if(callSession!==callLog){
    stopCallCapture();callSession=callLog;callStopped=false;callRetryAt=0;callQuietUntil=0;callWasBlocked=false;callWasMuted=false;
  }
  if(callWasMuted&&!callMuteOn){callStopped=false;callRetryAt=0;}
  callWasMuted=callMuteOn;
  if(!callReady()){
    stopCallCapture();
    callStatus(callPhase==='connected'&&callMuteOn?'麥克風已關':'');
    return;
  }
  const last=callLog[callLog.length-1];
  if(last?.role==='sys'&&last.text==='接通了，可以直接打字講給他聽，他會回妳並用聲音念出來')callTipClear();
  const blocked=speaking();
  if(blocked){callWasBlocked=true;stopCallCapture();callStatus('對方回應中 · 暫停收音');return;}
  if(callWasBlocked){callQuietUntil=Date.now()+350;callWasBlocked=false;}
  if(callStopped||callCapture||Date.now()<Math.max(callRetryAt,callQuietUntil))return;
  listenCall();
}
setInterval(syncCallCapture,120);
document.addEventListener('visibilitychange',syncCallCapture);
window.addEventListener('pagehide',stopCallCapture);
})();
