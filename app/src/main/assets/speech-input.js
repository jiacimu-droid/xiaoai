/* Voice settings and native speech services for the WebView. */
(function(){
'use strict';
if(window.XaSpeechInput)return;
window.XaSpeechInput=true;
let serial=0,busy=false;
const pending=new Map();
function rpc(action,extra={},onPartial){
  return new Promise((resolve,reject)=>{
    if(!window.SpeechInputNative){reject(Error('目前 WebView 不支援語音橋接'));return;}
    const id='stt-'+(++serial);
    pending.set(id,{resolve,onPartial});
    try{SpeechInputNative.postMessage(JSON.stringify({id,action,...extra}));}
    catch(e){pending.delete(id);reject(e);}
  });
}
if(window.SpeechInputNative)SpeechInputNative.onmessage=e=>{
  try{
    const msg=JSON.parse(e.data),p=pending.get(msg.id);
    if(!p)return;
    if(msg.result?.partial){p.onPartial?.(msg.result.partial);return;}
    pending.delete(msg.id);p.resolve(msg.result);
  }catch(_){}
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
const ttsModels=[
  ['eleven_v4_turbo','Eleven v4 Turbo · 低延遲'],
  ['eleven_v4','Eleven v4 · 情緒表現'],
  ['eleven_v3_conversational','Eleven v3 Conversational · 低延遲'],
  ['eleven_v3','Eleven v3 · 情緒表現'],
  ['eleven_flash_v2_5','Flash v2.5 · 低延遲'],
  ['eleven_multilingual_v2','Multilingual v2 · 多語音色'],
  ['eleven_turbo_v2_5','Turbo v2.5 · 舊版相容']
];
function elevenConfig(){
  const config=DB.get('xaElevenTts',null);
  return config?.enabled?config:null;
}
async function elevenSpeak(text,config){
  const value=String(text||'').trim().slice(0,600);
  const result=await rpc('elevenSpeak',{text:value,model:config.model,voice:config.voice});
  if(!result?.ok)throw Error(result?.why||'ElevenLabs 語音合成失敗');
  const bytes=Uint8Array.from(atob(result.audio),c=>c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes],{type:'audio/mpeg'}));
}
window.XaSpeechInput={elevenConfig,elevenSpeak};

function installTtsSettings(){
  const block=document.getElementById('ttsBlock');
  const actions=block?.querySelector('[onclick="saveTts()"]')?.parentElement;
  const heading=block?.firstElementChild;
  const tip=document.getElementById('ttsTip');
  if(!actions||!heading||!tip)return;
  const control=(label,field)=>{
    const row=document.createElement('label');
    row.className='lbl';row.textContent=label;
    row.append(field);
    return row;
  };
  const choice=(label,options)=>{
    const select=document.createElement('select');
    select.setAttribute('aria-label',label);
    select.style.cssText='display:block;width:100%;margin:5px 0 10px;color:var(--ink);background:var(--paper,#fff);padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit';
    for(const [id,name] of options)select.append(new Option(name,id));
    return select;
  };
  const provider=choice('語音合成供應商',[['minimax','MiniMax'],['eleven','ElevenLabs']]);
  const model=choice('ElevenLabs 語音模型',ttsModels);
  const voice=choice('ElevenLabs 音色',[['','請先載入音色']]);
  const eleven=document.createElement('div');
  const mini=document.createElement('div');
  for(let child=heading.nextSibling;child&&child!==actions;){
    const next=child.nextSibling;mini.append(child);child=next;
  }
  heading.textContent='文字轉語音';
  heading.after(control('語音合成供應商',provider),mini,eleven);
  let nextPage='',hasVoices=false;
  const load=button('載入音色',()=>fetchVoices(false));
  const more=button('載入更多音色',()=>fetchVoices(true));
  const key=button('設定共用金鑰',async()=>{
    try{
      await rpc('elevenKey');
      hasVoices=false;nextPage='';more.hidden=true;
      await fetchVoices(false);
    }catch(e){tip.textContent=e.message;}
  });
  for(const b of [load,more,key])b.className='btn ghost sm';
  more.hidden=true;
  const fields=document.createElement('div');
  fields.className='row';fields.style.cssText='gap:6px;flex-wrap:wrap';
  fields.append(load,more,key);
  eleven.append(control('語音模型',model),control('音色',voice),fields);

  async function fetchVoices(append){
    if(load.disabled)return;
    load.disabled=more.disabled=key.disabled=true;
    tip.textContent='正在載入 ElevenLabs 音色…';
    try{
      const page=await rpc('elevenVoices',{page:append?nextPage:''});
      if(!page?.ok)throw Error(page?.why||'無法載入音色');
      const current=voice.value;
      if(!append)voice.replaceChildren(new Option('請選擇音色',''));
      const known=new Set(Array.from(voice.options,item=>item.value));
      for(const option of page.voices){
        if(!known.has(option.id)){voice.append(new Option(option.name,option.id));known.add(option.id);}
      }
      if(known.has(current))voice.value=current;
      nextPage=page.next||'';more.hidden=!nextPage;hasVoices=voice.options.length>1;
      if(provider.value==='eleven')tip.textContent=hasVoices?'可從清單選擇音色。':'這個帳戶沒有可選的音色。';
    }catch(e){if(provider.value==='eleven')tip.textContent=e.message;}
    finally{load.disabled=more.disabled=key.disabled=false;}
  }
  function show(){
    const selected=provider.value==='eleven';
    mini.hidden=selected;eleven.hidden=!selected;
  }
  function read(){
    return {enabled:true,model:model.value,voice:voice.value,name:voice.selectedOptions[0]?.textContent||''};
  }
  const originalRender=renderTts,originalSave=saveTts,originalTest=testTts;
  renderTts=function(){
    originalRender.apply(this,arguments);
    const saved=DB.get('xaElevenTts',null);
    provider.value=saved?.enabled?'eleven':'minimax';
    model.value=ttsModels.some(([id])=>id===saved?.model)?saved.model:ttsModels[0][0];
    if(saved?.voice&&!Array.from(voice.options).some(item=>item.value===saved.voice))
      voice.append(new Option(saved.name||saved.voice,saved.voice));
    voice.value=saved?.voice||'';
    show();
    if(saved?.enabled){
      tip.textContent=saved.voice?'已設定 ElevenLabs · '+(saved.name||saved.voice):'請選擇 ElevenLabs 音色。';
      if(!hasVoices&&document.getElementById('settings')?.classList.contains('on'))fetchVoices(false);
    }
  };
  provider.addEventListener('change',()=>{
    show();
    if(provider.value==='eleven'){
      if(!hasVoices)fetchVoices(false);
      else tip.textContent='選好模型和音色後保存。';
    }else tip.textContent='可保存切換至 MiniMax。';
  });
  saveTts=async function(){
    if(provider.value!=='eleven'){
      const saved=DB.get('xaElevenTts',null);
      if(saved?.enabled)DB.set('xaElevenTts',{...saved,enabled:false});
      return originalSave.apply(this,arguments);
    }
    const config=read();
    if(!config.voice){tip.textContent='請選擇 ElevenLabs 音色。';return;}
    try{
      const status=await rpc('elevenStatus');
      if(provider.value!=='eleven')return;
      if(!status?.configured){tip.textContent='請先設定 ElevenLabs 共用金鑰。';return;}
      if(!DB.set('xaElevenTts',config))throw Error('無法保存語音設定');
      renderTts();toast('ElevenLabs 語音設定已保存');
    }catch(e){tip.textContent=e.message;}
  };
  testTts=async function(){
    if(provider.value!=='eleven')return originalTest.apply(this,arguments);
    const config=read(),testButton=actions.querySelector('[onclick="testTts()"]');
    if(!config.voice){tip.textContent='請選擇 ElevenLabs 音色。';return;}
    testButton.disabled=true;tip.textContent='正在合成試聽…';
    let url;
    try{
      url=await elevenSpeak('你好，這是 ElevenLabs 的試聽語音。',config);
      const audio=new Audio(url);
      audio.addEventListener('ended',()=>URL.revokeObjectURL(url),{once:true});
      audio.addEventListener('error',()=>URL.revokeObjectURL(url),{once:true});
      await audio.play();tip.textContent='正在播放試聽';
    }catch(e){if(url)URL.revokeObjectURL(url);tip.textContent=e.message;}
    finally{testButton.disabled=false;}
  };
  renderTts();
}
function installVoiceBubbles(){
  const original=playVoiceBubble,originalStop=stopChatVoice;
  let revision=0,pendingKey='';
  stopChatVoice=function(){
    revision++;pendingKey='';
    const url=__vKey.startsWith('eleven:')?__vAudio?.src:null;
    originalStop.apply(this,arguments);
    if(url){URL.revokeObjectURL(url);__vKey='';}
  };
  playVoiceBubble=async function(idx){
    const config=elevenConfig();
    if(!config){revision++;pendingKey='';return original.apply(this,arguments);}
    const text=cur?.msgs?.[idx]?.content;
    if(!text)return;
    const who=role(),key=['eleven',who,idx,config.model,config.voice,text].join(':');
    if(pendingKey===key)return;
    const run=++revision;
    if(__vAudio&&__vKey===key){
      if(__vAudio.paused)await __vAudio.play().catch(()=>{});
      else {__vAudio.pause();__vAudio.currentTime=0;}
      return;
    }
    if(__vAudio){
      __vAudio.pause();
      if(__vKey.startsWith('eleven:'))URL.revokeObjectURL(__vAudio.src);
      __vAudio=null;__vKey='';
    }
    pendingKey=key;
    const bubble=document.getElementById('vw_'+idx);
    bubble?.classList.add('playing');
    let url;
    try{
      url=await elevenSpeak(text,config);
      if(revision!==run||role()!==who||!elevenConfig()||!document.getElementById('chat')?.classList.contains('on')){
        URL.revokeObjectURL(url);bubble?.classList.remove('playing');return;
      }
      const audio=new Audio(url);__vAudio=audio;__vKey=key;
      audio.addEventListener('ended',()=>bubble?.classList.remove('playing'));
      await audio.play();
    }catch(e){
      if(url)URL.revokeObjectURL(url);
      if(__vKey===key){__vKey='';__vAudio=null;}
      bubble?.classList.remove('playing');
      if(revision===run&&role()===who)toast(e.message);
    }finally{if(revision===run)pendingKey='';}
  };
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
try{installTtsSettings();installVoiceBubbles();}catch(e){console.warn('ElevenLabs setup',e?.name||'Error');}
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
  return callBusy||!!callAudio||!!window.XaLive2D?.isPerforming()||(last?.role==='sys'&&last.text==='正在用 MiniMax 合成語音…');
}
async function listenCall(){
  const job={session:callLog,cancelled:false};callCapture=job;
  callStatus('麥克風收音中 · 說完自動辨識');
  try{
    const result=await rpc('callRecord',{},partial=>{
      if(!job.cancelled&&job.session===callLog&&callReady()&&!speaking())callStatus(partial);
    });
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
