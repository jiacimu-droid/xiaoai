/* Small native Live2D extension; leaves XiaoAi's original HTML and chat UI intact. */
(function(){
'use strict';
if(window.XaLive2D)return;
const STAGE='https://live2d.xiaoai.invalid';
const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M7 15c1.5-3 8.5-3 10 0M9 9v.8m6-.8v.8M9 18h6"/></svg>';
let panel=null,serial=0,seq=0;
const pending=new Map();
// Per-call perception survives minimizing and switching to voice. No touch initiates a model request.
const callPerception=new WeakMap();
let performanceJob=null;
function toastLocal(s){try{toast(s);}catch(_){console.warn(s);}}
function rpc(action,role){
  return new Promise((resolve,reject)=>{
    if(!window.Live2DNative){reject(Error('目前的 WebView 不支援安全 Live2D 橋接'));return;}
    const id='l2d-'+(++serial);pending.set(id,{resolve,reject});
    try{Live2DNative.postMessage(JSON.stringify({id,action,role}));}
    catch(e){pending.delete(id);reject(e);}
  });
}
if(window.Live2DNative)Live2DNative.onmessage=e=>{
  try{
    const msg=JSON.parse(e.data),entry=pending.get(msg.id);
    if(entry){pending.delete(msg.id);entry.resolve(msg.result);}
  }catch(_){}
};
function make(tag,cls,text){
  const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;
}
function btn(text,fn){
  const b=make('button','xa-l2d-btn',text);b.type='button';b.addEventListener('click',fn);return b;
}
function roleKey(c){return c&&c.id!=null?'role:'+String(c.id):'';}
function currentRole(){try{return cur;}catch(_){return null;}}
function roleLabel(c){return String(c?.remark||c?.name||'好友');}
function send(p,type,data={}){
  if(!p||!p.frame||!p.frame.contentWindow)return;
  p.frame.contentWindow.postMessage({type,...data},STAGE);
}
function close(){
  if(!panel)return false;
  const p=panel;panel=null;
  clearInterval(p.tick);
  if(p.media&&p.listeners)for(const [kind,fn]of p.listeners)p.media.removeEventListener(kind,fn);
  send(p,'pause');p.root.remove();
  if(p.kind==='call'){
    p.name.before(p.avatar);
    delete p.overlay.dataset.live2d;
  }
  return true;
}
function unmountFrame(p){
  if(p.frame){p.frame.remove();p.frame=null;}
  p.ready=false;p.parameters=[];p.stage.replaceChildren();
}
function calibrationKey(p){return 'xaLive2DZones:'+p.role+':'+String(p.data?.model||'');}
function savedZones(p){
  try{return JSON.parse(localStorage.getItem(calibrationKey(p))||'{}');}catch(_){return {};}
}
function mountFrame(p){
  unmountFrame(p);
  if(!p.data?.core||!p.data?.model){
    if(p.kind==='call'){
      p.status.textContent=p.data?.model?'請先到角色設定的 Live2D 皮套管理安裝官方 Core':'請先到角色設定的 Live2D 皮套管理匯入這位好友的皮套';
      return;
    }
    p.stage.append(make('div','xa-l2d-empty',!p.data?.core?(p.data?.model?'皮套已保存，尚缺渲染核心。請點官方 Core 一鍵安裝。':'請匯入 Live2D ZIP，並安裝官方 Core。'):'請匯入自己的 Live2D ZIP'));
    return;
  }
  const frame=make('iframe','xa-l2d-frame');
  frame.title='Live2D';frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.referrerPolicy='no-referrer';
  p.frame=frame;
  frame.addEventListener('load',()=>{if(panel===p&&p.frame===frame)send(p,'init',{model:p.data.model,calibration:savedZones(p),mode:p.mode,framing:p.kind==='call'?'call':'full'});});
  frame.src=STAGE+'/assets/live2d/stage.html';
  p.stage.append(frame);
  p.status.textContent='正在載入模型…';
}
function controls(p){
  const list=p.motions;list.replaceChildren();
  const ex=p.expressions;ex.replaceChildren();
  list.append(new Option('選擇動作',''));
  for(const m of p.data?.motions||[]){
    const option=new Option(m.name||m.group+'#'+m.index,JSON.stringify([m.group,m.index]));list.append(option);
  }
  ex.append(new Option('選擇表情',''));
  for(const name of p.data?.expressions||[])ex.append(new Option(name,name));
  list.disabled=!p.ready;ex.disabled=!p.ready;
}
async function loadStatus(p,action='status'){
  if(panel!==p||p.loading)return;
  p.loading=true;p.status.textContent=action==='status'?'讀取本地皮套…':action==='install_core'?'等待授權並下載官方渲染核心…':'等待檔案選擇及校驗…';
  const buttons=[p.pickModel,p.pickCore,p.installCore].filter(Boolean);
  for(const button of buttons)button.disabled=true;
  try{
    const result=await rpc(action,p.role);
    if(panel!==p)return;
    if(!result?.ok){
      if(!result?.cancelled)p.status.textContent=result?.why||'讀取失敗';
      else p.status.textContent='已取消，原皮套未更改';
      return;
    }
    const old=p.data;p.data=result;
    p.status.textContent=(result.model?(action==='pick_model'?'皮套已匯入 · ':'')+result.label:'未匯入皮套')+' · '+result.motions.length+' 動作 · '+result.expressions.length+' 表情 · '+(result.core?'Core 已安裝':'尚缺 Core，請點官方一鍵安裝');
    if(!old||action!=='status'||old.model!==result.model||old.core!==result.core)mountFrame(p);
    controls(p);
  }catch(e){if(panel===p)p.status.textContent=String(e.message||e);}
  finally{p.loading=false;for(const button of buttons)button.disabled=false;}
}
function selectedMotion(p){
  try{
    const [group,index]=JSON.parse(p.motions.value);
    return p.data.motions.find(x=>x.group===group&&x.index===index)||null;
  }catch(_){return null;}
}
// Decode locally generated TTS audio separately from playback: never reroute or mute
// the existing audio element, and never fetch remote voice URLs for lip sync.
const speechEnvelopes=new WeakMap(),speechMotions=new WeakMap();
function speechEnvelope(media){
  const source=media.currentSrc||media.src||'';
  if(!/^(blob:|data:audio\/)/i.test(source)||source.length>32*1024*1024)return null;
  const cached=speechEnvelopes.get(media);
  if(cached?.source===source)return cached;
  const entry={source,levels:null,step:.04};speechEnvelopes.set(media,entry);
  (async()=>{
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)return;
    let ctx;
    try{
      const response=await fetch(source);
      const blob=await response.blob();
      if(!blob.size||blob.size>24*1024*1024)return;
      ctx=new Context();
      const buffer=await ctx.decodeAudioData(await blob.arrayBuffer());
      if(!buffer.length||!buffer.sampleRate||buffer.duration>600)return;
      const step=Math.max(1,Math.round(buffer.sampleRate*entry.step));
      const levels=new Float32Array(Math.ceil(buffer.length/step));
      const channels=Array.from({length:Math.min(buffer.numberOfChannels,2)},(_,i)=>buffer.getChannelData(i));
      if(!channels.length)return;
      for(let i=0;i<levels.length;i++){
        let energy=0,n=0;
        const end=Math.min(buffer.length,(i+1)*step);
        for(let j=i*step;j<end;j+=4)for(const channel of channels){energy+=channel[j]*channel[j];n++;}
        levels[i]=Math.min(1,Math.max(0,(Math.sqrt(energy/Math.max(1,n))-.008)*5));
      }
      entry.levels=levels;entry.step=step/buffer.sampleRate;
    }catch(_){/* Unsupported or revoked local media: retain existing speaking fallback. */}
    finally{if(ctx)try{await ctx.close();}catch(_){}}
  })();
  return entry;
}
function mouthState(p){
  if(!p.speaking||!p.media||p.media.paused||p.media.ended)return {hasPcmSamples:false,mouth:0};
  const e=speechEnvelope(p.media);
  if(!e?.levels)return {hasPcmSamples:false,mouth:0};
  const time=p.media.currentTime;
  if(!Number.isFinite(time))return {hasPcmSamples:false,mouth:0};
  const i=Math.min(e.levels.length-1,Math.max(0,Math.floor(time/e.step)));
  return {hasPcmSamples:true,mouth:e.levels[i]||0};
}
function watchMedia(p,media){
  if(media===p.media)return;
  if(p.media&&p.listeners){
    for(const [kind,fn]of p.listeners)p.media.removeEventListener(kind,fn);
    if(p.speaking)send(p,'event',{event:'interrupted',sequence:p.speechSequence||0});
  }
  p.media=media;p.speaking=false;p.listeners=[];
  if(!media)return;
  const start=()=>{
    if(panel!==p||p.media!==media||p.speaking)return;
    p.speaking=true;p.speechSequence=++seq;
    speechEnvelope(media);
    const choice=speechMotions.get(media);
    const cue=verifiedCue(p,choice);
    if(cue){p.pendingVisual=null;send(p,'perform',{cue:{...cue,visualSequence:p.speechSequence}});}
    else if(performanceJob?.session===p.session)send(p,'perform',{cue:{visualSequence:p.speechSequence}});
    send(p,'event',{event:'playing',sequence:p.speechSequence});
  };
  const finish=event=>{
    if(!p.speaking)return;
    p.speaking=false;
    send(p,'event',{event:event==='ended'?'finished':'interrupted',sequence:p.speechSequence});
  };
  p.listeners=[['playing',start],['ended',()=>finish('ended')],['pause',()=>finish('pause')],['error',()=>finish('error')]];
  for(const [kind,fn]of p.listeners)media.addEventListener(kind,fn);
  if(!media.paused&&!media.ended&&media.readyState>=2)start();
}
function tick(p){
  if(panel!==p)return;
  let media=null,thinking=false;
  if(p.kind==='chat'){
    const chat=document.getElementById('chat');
    if(!chat?.classList.contains('on')||roleKey(currentRole())!==p.role){close();return;}
    try{if(__vAudio&&String(__vKey||'').startsWith(String(currentRole().id)+':'))media=__vAudio;}catch(_){}
  }else if(p.kind==='call'){
    try{media=callAudio;thinking=!!callBusy;}catch(_){}
  }
  watchMedia(p,media);
  if(p.ready){
    const listening=p.kind==='call'&&document.getElementById('xaCallSttStatus')?.textContent.startsWith('麥克風收音中')===true&&!thinking&&!p.speaking;
    send(p,'update',{state:{speaking:!!p.speaking,thinking,listening,...mouthState(p)}});
    if(p.kind==='call'){
      const pending=p.pendingVisual,last=callLog[callLog.length-1];
      if(pending&&(pending.session!==callLog||Date.now()>pending.expires))p.pendingVisual=null;
      else if(pending&&!callAudio&&!callBusy&&last?.role==='sys'&&/語音失敗|語音放不出來/.test(last.text)){
        p.pendingVisual=null;const cue=verifiedCue(p,pending.choice);if(cue)send(p,'perform',{cue,immediate:true});
      }
    }
  }
}
function touchMode(p){
  const row=make('div','xa-l2d-touch-modes');
  row.setAttribute('role','group');row.setAttribute('aria-label','觸摸方式');
  for(const [value,label]of [['hand','摸摸'],['kiss','親親'],['pat','扇巴掌']]){
    const b=btn(label,()=>{
      p.mode=value;send(p,'mode',{mode:value});
      for(const item of row.children)item.setAttribute('aria-pressed',String(item===b));
    });
    b.setAttribute('aria-pressed',String(value===p.mode));row.append(b);
  }
  return row;
}
const faceChannels={gazeX:['ParamEyeBallX'],gazeY:['ParamEyeBallY'],smile:['ParamMouthForm'],eyeSmile:['ParamEyeLSmile','ParamEyeRSmile'],eyeOpen:['ParamEyeLOpen','ParamEyeROpen'],browX:['ParamBrowLX','ParamBrowRX'],browY:['ParamBrowLY','ParamBrowRY'],browAngle:['ParamBrowLAngle','ParamBrowRAngle'],browForm:['ParamBrowLForm','ParamBrowRForm'],squint:['ParamEyeLSquint','ParamEyeRSquint'],cheekPuff:['ParamCheekPuff'],pout:['ParamMouthFunnel']};
const headChannels={yaw:['ParamAngleX'],pitch:['ParamAngleY'],roll:['ParamAngleZ']};
const bodyChannels={yaw:['ParamBodyAngleX'],pitch:['ParamBodyAngleY'],roll:['ParamBodyAngleZ']};
const positiveFace=new Set(['eyeOpen','eyeSmile','squint','cheekPuff','pout']);
function supportedChannels(p,bindings){
  const ids=new Set(p?.parameters||[]);
  return Object.keys(bindings).filter(key=>bindings[key].every(id=>ids.has(id)));
}
function checkedPose(raw,allowed,limit,positive=new Set()){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const out={};
  for(const key of allowed){
    const n=raw[key];
    if(typeof n==='number'&&Number.isFinite(n))out[key]=Math.max(positive.has(key)?0:-limit,Math.min(limit,n));
  }
  return Object.keys(out).length?out:null;
}
function verifiedCue(p,choice){
  if(!choice||!p?.data||choice.role!==p.role||choice.model!==p.data.model)return null;
  const cue={};
  const motion=choice.motion&&p.data.motions.find(m=>m.group===choice.motion.group&&m.index===choice.motion.index);
  if(motion)cue.motion={group:motion.group,index:motion.index};
  if(choice.expression&&p.data.expressions.includes(choice.expression))cue.expression=choice.expression;
  const face=checkedPose(choice.face||motion?.face,supportedChannels(p,faceChannels),1,positiveFace);
  if(face)cue.face=face;
  // A real Motion3 owns the head/body curves. Never fight it with another pose.
  if(!motion){
    const head=checkedPose(choice.head,supportedChannels(p,headChannels),25);
    const body=checkedPose(choice.body,supportedChannels(p,bodyChannels),10);
    if(head)cue.head=head;if(body)cue.body=body;
  }
  return Object.keys(cue).length?cue:null;
}
const touchRegions={hair:'頭髮',forehead:'額頭','eye-left':'左眼','eye-right':'右眼','ear-left':'左耳','ear-right':'右耳','beast-ear-left':'左獸耳','beast-ear-right':'右獸耳','cheek-left':'左臉頰','cheek-right':'右臉頰',nose:'鼻子',mouth:'嘴唇',neck:'頸部',throat:'喉部',collarbone:'鎖骨',chest:'胸口','arm-left':'左臂','arm-right':'右臂','hand-left':'左手','hand-right':'右手',body:'身體'};
const touchGestures={tap:'輕觸',hold:'按住','stroke-left':'向左撫摸','stroke-right':'向右撫摸','stroke-up':'向上撫摸','stroke-down':'向下撫摸',kiss:'親吻',slap:'拍打','slap-left':'向左扇巴掌','slap-right':'向右扇巴掌'};
function perception(session){
  let state=callPerception.get(session);
  if(!state){state={pending:[],recent:[],next:0};callPerception.set(session,state);}
  return state;
}
function acceptTouch(p,d){
  if(!Object.hasOwn(touchRegions,d.region)||!Object.hasOwn(touchGestures,d.gesture))return;
  const duration=Math.max(0,Math.min(30000,Number(d.durationMs)||0));
  const receipt=touchGestures[d.gesture]+' · '+touchRegions[d.region]+'（'+Math.round(duration/100)/10+' 秒）';
  if(p.touchReceipt)p.touchReceipt.textContent=receipt;
  if(p.kind!=='call'||p.session!==callLog||callPhase!=='connected')return;
  const state=perception(p.session);
  state.pending.push({id:++state.next,time:Date.now(),region:d.region,gesture:d.gesture,duration,receipt});
  // No callSay, no synthetic user utterance, no microphone interruption.
}
function describeTouches(events){
  if(!events.length)return '';
  const old=events.slice(0,Math.max(0,events.length-24)),recent=events.slice(-24);
  const counts=new Map();
  for(const e of old){const label=touchGestures[e.gesture]+' · '+touchRegions[e.region];counts.set(label,(counts.get(label)||0)+1);}
  return [...Array.from(counts,([label,count])=>label+' ×'+count),...recent.map(e=>e.receipt)].join('；');
}
function showMotion(p,motion){
  send(p,'motion',{motion});
  if(motion.expression&&p.data?.expressions.includes(motion.expression))send(p,'expression',{name:motion.expression});
}
function motionControls(p){
  const row=make('div','xa-l2d-tools');
  p.motions=make('select','xa-l2d-select');p.expressions=make('select','xa-l2d-select');
  p.motions.setAttribute('aria-label','動作');
  p.expressions.setAttribute('aria-label','表情');
  p.motions.onchange=()=>{
    const m=selectedMotion(p);if(!m||!p.ready)return;
    showMotion(p,m);p.motions.value='';
  };
  p.expressions.onchange=()=>{if(p.ready&&p.expressions.value)send(p,'expression',{name:p.expressions.value});p.expressions.value='';};
  row.append(p.motions,p.expressions);
  return row;
}
function syncCall(){
  const overlay=document.getElementById('callOverlay');
  const toggle=document.getElementById('xaLive2DCallToggle');
  if(!overlay||!toggle)return;
  toggle.textContent=callVideoOn?'返回語音':'Live2D 視訊';
  toggle.setAttribute('aria-pressed',String(callVideoOn));
  toggle.hidden=callPhase==='incoming'||callPhase==='idle';
  if(!callVideoOn||!callChar||!overlay.classList.contains('show')){
    if(panel?.kind==='call')close();
    return;
  }
  if(panel?.kind==='call'&&panel.session===callLog)return;
  close();
  const avatar=document.getElementById('callAv'),name=document.getElementById('callName');
  const root=make('section','xa-l2d-call'),stage=make('div','xa-l2d-call-stage');
  const fallback=make('div','xa-l2d-call-fallback'),status=make('div','xa-l2d-call-status','正在載入皮套…');
  status.setAttribute('role','status');
  fallback.append(avatar,status);
  const p={kind:'call',role:roleKey(callChar),session:callLog,mode:'hand',ready:false,root,stage,status,avatar,name,overlay,fallback};
  const interaction=make('div','xa-l2d-call-interaction');
  interaction.hidden=true;
  const tools=motionControls(p);
  const manual=make('details','xa-l2d-manual');manual.append(make('summary','','動作 / 表情'),tools);
  p.touchReceipt=make('div','xa-l2d-touch-receipt','選擇方式後，直接觸摸角色');
  p.touchReceipt.setAttribute('aria-live','polite');
  p.partCaption=make('div','xa-l2d-part-caption');p.partCaption.hidden=true;
  p.partCaption.setAttribute('aria-live','off');
  interaction.append(p.partCaption,touchMode(p),p.touchReceipt,manual);
  p.interaction=interaction;
  root.append(stage,fallback,interaction);
  name.closest('.call-hero').after(root);
  overlay.dataset.live2d='';
  panel=p;
  controls(p);
  p.tick=setInterval(()=>tick(p),40);
  loadStatus(p);
}
function open(kind,c){
  const role=kind==='preview'?(roleKey(c)||'preview'):roleKey(c);
  if(!role){toastLocal('請先選擇好友');return;}
  if(panel&&panel.kind===kind&&panel.role===role){close();return;}
  close();
  const p={kind,role,mode:'hand',ready:false,data:null,frame:null,loading:false,media:null};
  panel=p;
  const root=make('section','xa-l2d '+(kind==='preview'?'xa-l2d-full':'xa-l2d-inline'));
  p.root=root;
  const bar=make('div','xa-l2d-bar'),title=make('strong','',kind==='preview'?'Live2D 檢驗':'Live2D · '+roleLabel(c));
  bar.append(title,btn('關閉',close));root.append(bar);
  if(kind==='preview'){
    const sel=make('select','xa-l2d-select');
    sel.append(new Option('獨立檢驗皮套','preview'));
    try{for(const char of chars||[])if(roleKey(char))sel.append(new Option(roleLabel(char),roleKey(char)));}catch(_){}
    sel.value=role;
    sel.onchange=()=>{
      const wanted=sel.value;
      close();
      let chosen=null;try{chosen=(chars||[]).find(x=>roleKey(x)===wanted)||null;}catch(_){}
      open('preview',chosen);
    };
    root.append(sel,make('div','xa-l2d-status','獨立檢驗不會改動聊天角色；如要直接綁定，請先在上方選擇好友，再匯入 ZIP。'));
  }
  const stage=make('div','xa-l2d-stage');p.stage=stage;root.append(stage);
  const status=make('div','xa-l2d-status','讀取本地皮套…');p.status=status;root.append(status);
  const toolbar=make('div','xa-l2d-tools');
  p.pickModel=btn('匯入 ZIP',()=>loadStatus(p,'pick_model'));
  p.installCore=btn('官方 Core 一鍵安裝',()=>loadStatus(p,'install_core'));
  p.pickCore=btn('手動匯入 Core JS',()=>loadStatus(p,'pick_core'));
  toolbar.append(p.pickModel,p.installCore,p.pickCore);
  if(kind==='chat')toolbar.append(btn('視訊通話',()=>{
    const char=currentRole();if(!char||char.blocked)return toastLocal('此好友不可通話');
    close();callOpen(char,'outgoing',true);
  }));
  toolbar.append(touchMode(p));
  root.append(toolbar);
  root.append(motionControls(p));
  if(kind==='preview'){
    const calibration=make('div','xa-l2d-tools'),zone=make('select','xa-l2d-select');
    zone.append(new Option('觸摸部位校準',''));
    for(const [k,label]of [['hair','頭髮'],['forehead','額頭'],['eye-left','左眼'],['eye-right','右眼'],['ear-left','左耳'],['ear-right','右耳'],['beast-ear-left','左獸耳'],['beast-ear-right','右獸耳'],['cheek-left','左臉頰'],['cheek-right','右臉頰'],['nose','鼻子'],['mouth','嘴唇'],['neck','頸部'],['throat','喉部'],['collarbone','鎖骨'],['chest','胸口'],['arm-left','左臂'],['arm-right','右臂'],['hand-left','左手'],['hand-right','右手'],['body','身體']])zone.append(new Option(label,k));
    zone.onchange=()=>send(p,'calibrationMode',{zone:zone.value});
    calibration.append(zone,btn('清除校準',()=>{try{localStorage.removeItem(calibrationKey(p));}catch(_){}send(p,'clearCalibration');}));
    root.append(calibration);
  }
  if(kind==='preview')document.body.append(root);
  else document.getElementById('chatHeader').after(root);
  controls(p);p.tick=setInterval(()=>tick(p),40);loadStatus(p);
}
window.addEventListener('message',event=>{
  const p=panel;
  if(!p||event.origin!==STAGE||event.source!==p.frame?.contentWindow||!event.data)return;
  const d=event.data;
  if(d.type==='xa-live2d-state'){
    p.ready=d.phase==='ready';p.status.textContent=p.ready?'已驗證模型畫面 · '+(p.data?.label||''):String(d.message||d.phase);
    if(p.kind==='call'){
      p.fallback.hidden=p.ready;
      p.stage.style.visibility=p.ready?'visible':'hidden';
      p.interaction.hidden=!p.ready;
      if(p.ready&&p.speaking){
        const cue=verifiedCue(p,speechMotions.get(p.media));
        if(cue)send(p,'perform',{cue:{...cue,visualSequence:p.speechSequence}});
        send(p,'event',{event:'playing',sequence:p.speechSequence});
      }
      if(!p.ready&&d.phase==='error')p.status.textContent='皮套無法顯示，請在 Live2D 檢驗確認';
    }
    controls(p);
  }else if(d.type==='xa-live2d-capabilities'&&p.ready&&Array.isArray(d.parameters)){
    p.parameters=d.parameters.filter(id=>typeof id==='string'&&/^Param[A-Za-z0-9_]+$/.test(id)).slice(0,128);
  }else if(d.type==='xa-live2d-touch'&&p.ready){
    acceptTouch(p,d);
  }else if(d.type==='xa-live2d-calibration'&&d.calibration&&typeof d.calibration==='object'){
    try{localStorage.setItem(calibrationKey(p),JSON.stringify(d.calibration));}catch(_){}
  }
});
function callMotionOptions(){
  const session=callLog,state=perception(session),p=panel;
  const visible=p?.kind==='call'&&p.ready&&p.data&&p.session===session;
  const touches=state.pending.slice(),lastId=touches.at(-1)?.id||0;
  const observed=(state.recent.length?'\n【本次通話先前已感知的觸摸，非新事件】'+describeTouches(state.recent):'')+
    (touches.length?'\n【本輪新增真實觸摸感知，非用戶口述】'+describeTouches(touches):'');
  if(!visible&&!observed)return null;
  const motions=visible?(p.data.motions||[]).filter(m=>!/^idle$/i.test(m.group)):[];
  const expressions=visible?p.data.expressions||[]:[];
  const directory=motions.map((m,i)=>i+'='+m.name+(m.fits?'（'+String(m.fits).slice(0,180)+'）':'')).join('、');
  const faces=expressions.map((name,i)=>i+'='+name).join('、');
  const faceKeys=supportedChannels(visible?p:null,faceChannels);
  const headKeys=supportedChannels(visible?p:null,headChannels);
  const bodyKeys=supportedChannels(visible?p:null,bodyChannels);
  return {
    structured:!!visible,
    prompt:observed+(visible?'\n【Live2D 視訊表演】請將對方本輪話語及真實觸摸一起理解。觸摸的本地反射只是物理呈現，不代表你本人感到害羞或喜歡。依你的性格、情緒及此刻想法，自主選擇台詞及身體表演，不必每次都使用全部通道，不要虛構資源。必須按語意把整輪台詞拆成1至16個短句/語意片段，逐段安排該段自己的表演，不要把所有動作與表情塞在第一句。本次是機器可讀視訊協議，優先於普通聊天氣泡、翻譯、旁白與格式規則；只輸出 [L2S]{"speech":[{"id":"s1","text":"第一句實際台詞。","motion":0,"expression":0,"face":{"smile":0.4}},{"id":"s2","text":"第二句實際台詞。","motion":1,"face":{"gazeX":0.3,"eyeOpen":0.8}}]}[/L2S]。motion及expression為目錄編號（不是必填；無合適資源可省略），face/head/body可獨立選擇；每段text是唯一可朗讀正文，不另寫總台詞。僅使用下列實際通道；不把標記念出來，不加 Markdown 或其他文字。需要親吻、靠近、害羞等情境時，主動從實際目錄挑選最貼合的動作或表情；沒有對應動作則用可用的臉、頭或身體通道表達，不要假裝有資源。每段按自己的語義選擇，不必全程維持同一表情。face數值-1至1（eyeOpen、eyeSmile、squint、cheekPuff、pout為0至1），head角度±25、body±10；有原生動作時不要再指定head/body。口型開合由真實語音驅動，嘴角與神態可自主選擇。\n動作：'+(directory||'無')+'\n表情：'+(faces||'無')+'\nface通道：'+(faceKeys.join('、')||'無')+'\nhead通道：'+(headKeys.join('、')||'無')+'\nbody通道：'+(bodyKeys.join('、')||'無'):''),
    parse(reply){
      if(typeof reply!=='string'||!reply.trim())return {reply,motion:null};
      if(session===callLog&&lastId&&state.pending.some(e=>e.id<=lastId)){
        // Only acknowledge the snapshot after a real model reply; preserve
        // contacts arriving during inference and retry after a failed request.
        state.pending=state.pending.filter(e=>e.id>lastId);
        state.recent=state.recent.concat(touches).slice(-12);
      }
      const makeChoice=(motion,expression,pose={})=>{
        if(!expression&&motion&&expressions.includes(motion.expression))expression=motion.expression;
        const choice=visible?{role:p.role,model:p.data.model,motion,expression,
          face:checkedPose(pose.face,faceKeys,1,positiveFace),
          head:checkedPose(pose.head,headKeys,25),body:checkedPose(pose.body,bodyKeys,10)}:null;
        return choice&&verifiedCue(p,choice)?choice:null;
      };
      const marked=/\[\/?L2S\]/i.test(reply);
      const structured=marked||/"speech"\s*:/.test(reply);
      if(structured){
        // Accept provider fences, wrapper prose and a missing closing tag.
        // Never send the protocol itself to captions, history or TTS.
        const tagged=reply.match(/\[L2S\]([\s\S]*?)(?:\[\/L2S\]|$)/i);
        const source=(tagged?tagged[1]:reply).replace(/```(?:json)?/gi,'').trim();
        let raw=null;
        try{
          const key=source.search(/"speech"\s*:/),start=key<0?-1:source.indexOf('[',key);
          if(start>=0){
            let depth=0,quoted=false,escaped=false;
            for(let i=start;i<source.length;i++){
              const ch=source[i];
              if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
              if(ch==='"'){quoted=true;continue;}
              if(ch==='[')depth++;
              if(ch===']'&&--depth===0){raw=JSON.parse(source.slice(start,i+1));break;}
            }
          }
        }catch(_){}
        if(!Array.isArray(raw)){
          // Recover complete quoted text values from a truncated or malformed response.
          const words=[];
          for(const m of source.matchAll(/"text"\s*:\s*("(?:\\.|[^"\\])*")/g)){
            try{const word=JSON.parse(m[1]);if(typeof word==='string'&&word.trim())words.push(word.trim());}catch(_){}
          }
          return {reply:words.join(' '),motion:null,repair:true};
        }
        const lookup=(value,list,name)=>{
          if(Number.isInteger(value))return list[value]??null;
          if(typeof value!=='string')return null;
          const v=value.trim();
          if(/^\d{1,4}$/.test(v))return list[Number(v)]??null;
          const matches=list.filter(x=>String(name(x)).toLowerCase()===v.toLowerCase());
          return matches.length===1?matches[0]:null;
        };
        const parts=raw.slice(0,16).map((item,i)=>{
          const text=typeof item?.text==='string'?item.text.replace(/\s+/g,' ').trim():'';
          if(!text)return null;
          return {id:'s'+(i+1),text,choice:makeChoice(
            lookup(item.motion,motions,m=>m.name),
            lookup(item.expression,expressions,e=>e),item)};
        }).filter(Boolean);
        if(!parts.length)return {reply:'',motion:null,repair:true};
        const text=parts.map(item=>item.text).join(' ');
        if(!visible)return {reply:text,motion:null};
        return {reply:text,motion:{kind:'speechPlan',role:p.role,model:p.data.model,parts}};
      }
      let motion=null,expression=null,pose={};
      let text=reply.replace(/\[L2P\]([\s\S]*?)\[\/L2P\]/gi,(_,raw)=>{
        if(raw.length<=2048)try{const v=JSON.parse(raw);if(v&&typeof v==='object'&&!Array.isArray(v))pose=v;}catch(_){}
        return '';
      }).replace(/\[(L2D|L2E):(\d{1,4})\]/gi,(_,kind,index)=>{
        if(kind.toUpperCase()==='L2D')motion=motions[Number(index)]||motion;
        else expression=expressions[Number(index)]||expression;
        return '';
      });
      return {reply:text.trim(),motion:makeChoice(motion,expression,pose)};
    }
  };
}
const style=make('style');
style.textContent='.xa-l2d{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:8px;color:var(--ink,#333);background:var(--paper,#faf7f3);border:1px solid var(--line,#ddd);border-radius:14px;min-height:0;flex-shrink:0}.xa-l2d-full{position:fixed;inset:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);z-index:99999;border-radius:0;padding:12px}.xa-l2d-inline{margin:4px 8px}.xa-l2d-bar,.xa-l2d-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.xa-l2d-bar strong{flex:1}.xa-l2d-stage{position:relative;min-height:140px;height:180px;overflow:hidden;background:#e9edf4;border-radius:11px;flex-shrink:0}.xa-l2d-full .xa-l2d-stage{height:auto;flex:1;min-height:150px}.xa-l2d-frame{width:100%;height:100%;border:0;display:block}.xa-l2d-empty{height:100%;display:grid;place-items:center;text-align:center;color:#596470;font-size:13px;padding:14px}.xa-l2d-btn,.xa-l2d-select{font:inherit;font-size:12px;min-height:32px;border:1px solid var(--line,#ccc);color:inherit;background:var(--paper,#fff);border-radius:9px;padding:4px 8px;max-width:100%}.xa-l2d-status{font-size:11px;color:inherit;opacity:.8;overflow-wrap:anywhere}.xa-l2d-tools select{flex:1;min-width:60px}';
style.textContent+=`
#callOverlay .xa-l2d-call-toggle {position:absolute;right:12px;top:7px;z-index:7;min-height:36px;padding:0 10px;border:1px solid currentColor;border-radius:18px;background:var(--ovbg);color:inherit;font:inherit;font-size:12px;cursor:pointer}
#callOverlay[data-live2d] {overflow:hidden}
#callOverlay[data-live2d] .call-min {top:10px;left:12px}
#callOverlay[data-live2d] .call-hero {min-height:54px;padding:8px 104px 6px 52px;justify-content:center}
#callOverlay[data-live2d] .call-name {display:block;margin:0;max-width:100%;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:600}
#callOverlay[data-live2d] .call-status {margin:1px 0 0;padding:0;font-size:11px;letter-spacing:normal}
#callOverlay[data-live2d] .xa-l2d-call {position:relative;flex:1 1 0;min-height:0;width:100%;max-width:none;border-radius:0;overflow:hidden;background:#e9edf4;color:#2d3d4d}
.xa-l2d-call-stage,.xa-l2d-call-fallback {position:absolute;inset:0}
.xa-l2d-call-stage {visibility:hidden}
.xa-l2d-call-fallback {display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:8px;text-align:center;overflow:auto}
.xa-l2d-call [hidden] {display:none}
#callOverlay[data-live2d] .xa-l2d-call .call-av {width:64px;height:64px;border-radius:14px;font-size:27px}
.xa-l2d-call-status {font-size:12px}
.xa-l2d-call-interaction {position:absolute;bottom:8px;right:12px;left:12px;display:flex;flex-direction:column;align-items:center;gap:5px;pointer-events:none}
.xa-l2d-touch-modes {display:flex;gap:4px;align-items:center;justify-content:center;pointer-events:auto}
.xa-l2d-call-interaction .xa-l2d-touch-modes {padding:4px;border-radius:24px;background:#304c62c9;color:#fff}
.xa-l2d-touch-modes button {border:0;background:transparent;color:inherit;border-radius:18px;min-height:34px;padding:5px 12px;cursor:pointer}
.xa-l2d-touch-modes button[aria-pressed=true] {background:var(--paper,#fff);color:var(--ink,#263746);box-shadow:0 1px 5px #0002}
.xa-l2d-part-caption {max-width:100%;text-align:center;font-size:15px;line-height:1.35;color:white;background:#304c62d9;border-radius:12px;padding:6px 12px;overflow-wrap:anywhere}
.xa-l2d-touch-receipt {font-size:11px;color:white;text-shadow:0 1px 4px #000;background:#304c6299;border-radius:10px;padding:3px 8px}
.xa-l2d-manual {pointer-events:auto;text-align:center;max-width:100%}
.xa-l2d-manual summary {display:inline-block;padding:5px 12px;border-radius:14px;background:#304c62c9;color:white;font-size:11px;cursor:pointer}
.xa-l2d-manual .xa-l2d-tools {margin-top:4px;padding:5px;border-radius:10px;background:var(--paper,#fff);color:var(--ink,#333);pointer-events:auto}
.xa-l2d-frame {touch-action:none}
#callOverlay[data-live2d] #callCaps {flex:0 1 auto;max-height:24%;padding:6px 12px 1px}
#callOverlay[data-live2d] #callCaps:empty {display:none}
#callOverlay[data-live2d] .call-inrow {width:calc(100% - 24px);margin:6px 0}
#callOverlay[data-live2d] .call-actions {gap:clamp(10px,5vw,26px);padding:2px 8px max(10px, env(safe-area-inset-bottom));margin:0}
#callOverlay[data-live2d] .call-act {width:64px;gap:5px}
#callOverlay[data-live2d] .call-btn {width:44px;height:44px;padding:0;border-radius:50%}
#callOverlay[data-live2d] .call-btn svg {width:24px;height:24px}
#callOverlay[data-live2d] .call-act-lab {font-size:10px}
@media (max-height: 480px) {
  #callOverlay[data-live2d] .call-hero {min-height:44px;padding-top:3px}
  #callOverlay[data-live2d] .call-inrow {margin:2px 0}
  #callOverlay[data-live2d] .call-actions {padding-bottom:4px}
  #callOverlay[data-live2d] .call-act-lab {display:none}
}
`;
document.head.append(style);
function install(){
  const overlay=document.getElementById('callOverlay');
  if(overlay){
    const toggle=btn('Live2D 視訊',()=>callVideoToggle());
    toggle.id='xaLive2DCallToggle';toggle.className='xa-l2d-call-toggle';toggle.hidden=true;
    overlay.append(toggle);
  }
  const extra=document.getElementById('extra');
  const voiceCall=extra?.querySelector('[onclick="startCall()"]');
  if(voiceCall){
    const video=btn('',()=>{
      const char=currentRole();if(!char||char.blocked)return toastLocal('此好友不可通話');
      extra.classList.remove('open');
      close();callOpen(char,'outgoing',true);
    });
    video.className='ex';video.style.cssText='border:0;background:none;font-family:inherit';
    video.innerHTML='<span class="exic" aria-hidden="true">📹</span><span>視訊通話</span>';
    voiceCall.after(video);
  }
  const roleSettings=document.getElementById('tabContentInfo');
  if(roleSettings){
    const manage=btn('管理 Live2D 皮套',()=>{closeDrawer();open('chat',currentRole());});
    manage.className='btn full ghost';manage.style.marginBottom='10px';
    roleSettings.lastElementChild.before(manage);
  }
  try{
    APP_INFO_MAP.live2d={name:'Live2D',iconSvg:icon};
    if(!desktopItems.some(x=>x.type==='app'&&x.key==='live2d')){
      const last=deskMaxPage(),items=desktopItems.filter(x=>(typeof x.pg==='number'?x.pg:0)===last);
      let used=0,col=0,h=0;
      for(const item of items){
        const span=deskSpan(item),height=deskHeight(item);
        if(col&&col+span>4){used+=h+14;col=0;h=0;}
        col+=span;h=Math.max(h,height);if(col>=4){used+=h+14;col=0;h=0;}
      }
      const cap=Math.max(260,(document.querySelector('.desk-page')?.clientHeight||DESK_CAP)-62);
      const pg=used+Math.max(h,82)+14<=cap?last:last+1;
      desktopItems.push({type:'app',key:'live2d',span:1,pg});DB.set('desktopItems',desktopItems);renderDesktop();
    }else renderDesktop();
    const oldClick=handleAppClick;
    handleAppClick=function(key){
      if(key==='live2d'){
        if(!document.getElementById('home')?.classList.contains('editing'))open('preview',null);
        return;
      }
      return oldClick.apply(this,arguments);
    };
  }catch(e){console.warn('Live2D desktop',e);}
}
function activeJob(job){
  return performanceJob===job&&job.session===callLog&&job.request===callSpeechRequest&&callPhase!=='idle';
}
function segmentCaption(job,text){
  const p=panel;
  if(p?.kind!=='call'||p.session!==job.session||!p.partCaption)return;
  p.partCaption.textContent=text||'';p.partCaption.hidden=!text;
}
function cancelPerformance(){
  const job=performanceJob;if(!job)return;
  performanceJob=null;segmentCaption(job,'');
  if(job.cancelWait)job.cancelWait();
}
function silentPart(job,part){
  if(!activeJob(job))return Promise.resolve(false);
  segmentCaption(job,part.text);
  const p=panel;
  if(p?.kind==='call'&&p.ready&&p.session===job.session){
    const cue=verifiedCue(p,part.choice);
    send(p,'perform',{cue:cue||{},immediate:true});
  }
  // Subtitle-only pacing, explicitly not an audible speech clock.
  return new Promise(resolve=>{
    const timer=setTimeout(()=>{job.cancelWait=null;resolve(activeJob(job));},Math.max(1100,Math.min(6500,part.text.length*155)));
    job.cancelWait=()=>{clearTimeout(timer);job.cancelWait=null;resolve(false);};
  });
}
function playPart(job,part,url){
  if(!activeJob(job)){URL.revokeObjectURL(url);return Promise.resolve({status:'cancelled'});}
  let audio;
  try{audio=new Audio(url);}catch(e){
    URL.revokeObjectURL(url);return Promise.resolve({status:'error',reason:e?.name||'AudioInitError'});
  }
  callAudio=audio;
  if(part.choice)speechMotions.set(audio,part.choice);
  return new Promise(resolve=>{
    let done=false,started=false,timer=null;
    const finish=(status,reason)=>{
      if(done)return;done=true;clearTimeout(timer);job.cancelWait=null;
      if(callAudio===audio)callAudio=null;
      if(status!=='ended')try{audio.pause();}catch(_){}
      URL.revokeObjectURL(url);resolve({status,reason,started});
    };
    job.cancelWait=()=>finish('cancelled');
    audio.addEventListener('playing',()=>{
      if(!activeJob(job))return finish('cancelled');
      started=true;clearTimeout(timer);
      segmentCaption(job,part.text);
      const p=panel;
      if(p?.kind==='call'&&p.session===job.session&&p.ready)watchMedia(p,audio);
    });
    audio.addEventListener('ended',()=>finish('ended'),{once:true});
    audio.addEventListener('error',()=>finish('error','MediaError '+(audio.error?.code||'unknown')),{once:true});
    audio.addEventListener('pause',()=>{if(!audio.ended)finish(activeJob(job)?'error':'cancelled','UnexpectedPause');},{once:true});
    timer=setTimeout(()=>{if(!started)finish('error','PlaybackStartTimeout');},15000);
    try{Promise.resolve(audio.play()).catch(e=>finish('error',e?.name||'PlaybackRejected'));}catch(e){finish('error',e?.name||'PlaybackRejected');}
  });
}
async function performSpeechPlan(text,plan){
  callStopAudio();
  const job={session:callLog,request:++callSpeechRequest,cancelWait:null};performanceJob=job;
  let config=null;try{config=DB.get('ttsConfig',null);}catch(_){}
  const enabled=!!callTtsOn&&!!config?.key&&!!config?.group&&typeof minimaxSpeak==='function';
  let failed=0,lastFailure='';
  try{
    for(const part of plan.parts){
      if(!activeJob(job))return;
      if(enabled){
        callTip('正在用 MiniMax 合成語音…');
        let url;
        try{
          url=await minimaxSpeak(part.text,config);
          if(typeof url!=='string'||!url.trim())throw Error('EmptyAudioSource');
        }catch(e){
          if(!activeJob(job))return;
          url=null;lastFailure='語音合成失敗：'+friendly(e);
        }
        if(url){
          if(!activeJob(job)){URL.revokeObjectURL(url);return;}
          callTipClear();
          const result=await playPart(job,part,url);
          if(!activeJob(job)||result.status==='cancelled')return;
          if(result.status==='ended')continue;
          lastFailure='語音播放失敗：'+(result.reason||'UnknownPlaybackError');
          console.warn('Live2D segment playback failed',result.reason||'UnknownPlaybackError');
        }
        failed++;
        // A failed segment must not disable TTS for all subsequent dialogue.
        callTip(lastFailure+'，繼續下一段');
      }
      if(!activeJob(job))return;
      if(!await silentPart(job,part))return;
    }
    if(activeJob(job)){
      callTipClear();
      if(failed)callTip(failed+' 段語音未完整播放：'+lastFailure);
      else if(!enabled)callTip(callTtsOn?'尚未完成 MiniMax 語音設定，本輪僅字幕':'已關閉語音，本輪僅字幕');
    }
  }finally{
    if(performanceJob===job){performanceJob=null;segmentCaption(job,'');}
  }
}
window.XaLive2D={openPreview:()=>open('preview',null),closeIfOpen:close,syncCall,callMotionOptions,
  isPerforming:()=>!!performanceJob&&activeJob(performanceJob),
  playSilentMotion:choice=>{if(panel?.kind==='call'&&panel.ready){panel.pendingVisual=null;const cue=verifiedCue(panel,choice);if(cue)send(panel,'perform',{cue,immediate:true});}},
  setSpeechMotion:(audio,motion)=>speechMotions.set(audio,motion)};
try{
  const speak=callSpeak,stop=callStopAudio,plainSay=callSay;
  callSay=async function(){
    const visual=callMotionOptions();
    if(!visual?.structured)return plainSay.apply(this,arguments);
    if(!callChar||!document.getElementById('callOverlay')?.classList.contains('show'))return;
    if(callBusy)return toast('他還在想，等一下下');
    const inp=document.getElementById('callInp'),raw=String(inp?.value||'').trim();
    if(!raw)return;
    if(inp)inp.value='';
    const t=typeof xaSanitize==='function'?xaSanitize(raw):raw;
    callPush('me',t);callHist.push({role:'user',content:t});
    const cfg=activeApi();
    if(!cfg){callTip('還沒接 API，他聽不到妳說話');return;}
    callBusy=true;
    const sb=document.getElementById('callSend');if(sb)sb.classList.add('off');
    callTip('接通中…');
    const session=callLog;
    try{
      const sys=buildSys(callChar)+'\n\n【視訊通話】自然口語，繁體中文，短句，不寫旁白。'+visual.prompt;
      const msgs=[{role:'system',content:sys},...callHist.slice(-16)];
      const opts={noRetry:true,noDigest:true};
      const result=await sendChat(cfg,msgs,opts);
      if(callPhase==='idle'||session!==callLog)return;
      let parsed=visual.parse(result);
      // One protocol-only repair, without inventing a second conversational turn.
      if(!parsed.motion||parsed.motion.kind!=='speechPlan'){
        try{
          const fixed=await sendChat(cfg,[...msgs,{role:'assistant',content:String(result||'')},{role:'user',content:'保持上一則實際台詞的原意，按視訊協議重新輸出完整 [L2S] JSON，不加其他字。每段獨立選擇可用表演；不要把 JSON 當台詞。'}],opts);
          if(callPhase==='idle'||session!==callLog)return;
          const candidate=visual.parse(fixed);
          if(candidate.motion?.kind==='speechPlan'||(!parsed.reply&&candidate.reply))parsed=candidate;
        }catch(e){console.warn('Live2D response format repair failed',e?.name||'Error');}
      }
      if(callPhase==='idle'||session!==callLog)return;
      const cleanText=value=>String(typeof xaSanitize==='function'?xaSanitize(value):value||'').replace(/\s+/g,' ').trim();
      let motion=parsed.motion,clean=cleanText(parsed.reply);
      if(motion?.kind==='speechPlan'){
        const parts=motion.parts.map(part=>({...part,text:cleanText(part.text)})).filter(part=>part.text);
        motion={...motion,parts};clean=parts.map(part=>part.text).join(' ');
      }
      if(!clean){callTip('視訊回覆格式不完整，請再說一次');return;}
      callPush('ta',clean);callHist.push({role:'assistant',content:clean});callSpeak(clean,motion);
    }catch(e){if(callPhase!=='idle'&&session===callLog)callTip('斷線：'+friendly(e));}
    finally{if(session===callLog){callBusy=false;document.getElementById('callSend')?.classList.remove('off');}}
  };
  callStopAudio=function(){cancelPerformance();return stop.apply(this,arguments);};
  callSpeak=function(text,choice){
    if(choice?.kind==='speechPlan'){
      const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
      if(normalize(choice.parts.map(part=>part.text).join(' '))===normalize(text)){
        return performSpeechPlan(text,choice).catch(e=>{console.warn('Live2D segmented speech',e);});
      }
      // Never attach stale choreography to text modified by the chat parser.
      choice=null;
    }
    cancelPerformance();
    const p=panel,session=callLog;
    if(p?.kind==='call'&&choice){p.pendingVisual={choice,session,expires:Date.now()+90000};}
    return speak.call(this,text,choice);
  };
}catch(e){console.warn('Live2D speech integration',e);}
install();
})();
