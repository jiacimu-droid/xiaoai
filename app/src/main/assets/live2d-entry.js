/* Small native Live2D extension; leaves XiaoAi's original HTML and chat UI intact. */
(function(){
'use strict';
if(window.XaLive2D)return;
const STAGE='https://live2d.xiaoai.invalid';
const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M7 15c1.5-3 8.5-3 10 0M9 9v.8m6-.8v.8M9 18h6"/></svg>';
let panel=null,serial=0,seq=0;
const pending=new Map();
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
  if(p.avatar)p.avatar.style.display=p.avatarDisplay;
  return true;
}
function unmountFrame(p){
  if(p.frame){p.frame.remove();p.frame=null;}
  p.ready=false;p.stage.replaceChildren();
}
function calibrationKey(p){return 'xaLive2DZones:'+p.role+':'+String(p.data?.model||'');}
function savedZones(p){
  try{return JSON.parse(localStorage.getItem(calibrationKey(p))||'{}');}catch(_){return {};}
}
function mountFrame(p){
  unmountFrame(p);
  if(!p.data?.core||!p.data?.model){
    p.stage.append(make('div','xa-l2d-empty',!p.data?.core?'請先匯入官方 Cubism Core JS':'請匯入自己的 Live2D ZIP'));
    return;
  }
  const frame=make('iframe','xa-l2d-frame');
  frame.title='Live2D';frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.referrerPolicy='no-referrer';
  p.frame=frame;
  frame.addEventListener('load',()=>{if(panel===p&&p.frame===frame)send(p,'init',{model:p.data.model,calibration:savedZones(p),mode:p.mode});});
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
  p.loading=true;p.status.textContent=action==='status'?'讀取本地皮套…':'等待檔案選擇及校驗…';
  p.pickModel.disabled=p.pickCore.disabled=true;
  try{
    const result=await rpc(action,p.role);
    if(panel!==p)return;
    if(!result?.ok){
      if(!result?.cancelled)p.status.textContent=result?.why||'讀取失敗';
      else p.status.textContent='已取消，原皮套未更改';
      return;
    }
    const old=p.data;p.data=result;
    p.status.textContent=(result.label||'未匯入皮套')+' · '+result.motions.length+' 動作 · '+result.expressions.length+' 表情';
    if(!old||action!=='status'||old.model!==result.model||old.core!==result.core)mountFrame(p);
    controls(p);
  }catch(e){if(panel===p)p.status.textContent=String(e.message||e);}
  finally{p.loading=false;p.pickModel.disabled=p.pickCore.disabled=false;}
}
function selectedMotion(p){
  try{
    const [group,index]=JSON.parse(p.motions.value);
    return p.data.motions.find(x=>x.group===group&&x.index===index)||null;
  }catch(_){return null;}
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
    const motion=p.nextMotion;p.nextMotion=null;
    if(motion){
      const cue={visualSequence:p.speechSequence,motion:{group:motion.group,index:motion.index}};
      if(motion.expression&&p.data.expressions.includes(motion.expression))cue.expression=motion.expression;
      if(motion.face)cue.face=motion.face;
      send(p,'perform',{cue});
    }
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
    const overlay=document.getElementById('callOverlay');
    if(!overlay?.classList.contains('show')||typeof callChar==='undefined'||roleKey(callChar)!==p.role){close();return;}
    try{media=callAudio;thinking=!!callBusy;}catch(_){}
  }
  watchMedia(p,media);
  if(p.ready)send(p,'update',{state:{speaking:!!p.speaking,thinking,hasPcmSamples:false,mouth:0}});
}
function open(kind,c){
  const role=kind==='preview'?(roleKey(c)||'preview'):roleKey(c);
  if(!role){toastLocal('請先選擇好友');return;}
  if(panel&&panel.kind===kind&&panel.role===role){close();return;}
  close();
  const p={kind,role,mode:'hand',ready:false,data:null,frame:null,loading:false,media:null,nextMotion:null};
  panel=p;
  const root=make('section','xa-l2d '+(kind==='preview'?'xa-l2d-full':'xa-l2d-inline'));
  p.root=root;
  const bar=make('div','xa-l2d-bar'),title=make('strong','',kind==='preview'?'Live2D 檢驗':kind==='call'?'Live2D 視訊':'Live2D · '+roleLabel(c));
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
    root.append(sel);
  }
  const stage=make('div','xa-l2d-stage');p.stage=stage;root.append(stage);
  const status=make('div','xa-l2d-status','讀取本地皮套…');p.status=status;root.append(status);
  const toolbar=make('div','xa-l2d-tools');
  p.pickModel=btn('匯入 ZIP',()=>loadStatus(p,'pick_model'));
  p.pickCore=btn('官方 Core JS',()=>loadStatus(p,'pick_core'));
  toolbar.append(p.pickModel,p.pickCore);
  if(kind==='chat')toolbar.append(btn('視訊通話',()=>{
    const char=currentRole();if(!char||char.blocked)return toastLocal('此好友不可通話');
    close();callOpen(char,'outgoing');open('call',char);
  }));
  const mode=make('select','xa-l2d-select');
  for(const [value,label]of [['hand','摸摸'],['kiss','親親'],['pat','輕拍']])mode.append(new Option(label,value));
  mode.onchange=()=>{p.mode=mode.value;send(p,'mode',{mode:p.mode});};toolbar.append(mode);
  root.append(toolbar);
  const row=make('div','xa-l2d-tools');p.motions=make('select','xa-l2d-select');p.expressions=make('select','xa-l2d-select');
  p.motions.onchange=()=>{
    const m=selectedMotion(p);if(!m||!p.ready)return;
    send(p,'motion',{motion:m});p.motions.value='';
  };
  p.expressions.onchange=()=>{if(p.ready&&p.expressions.value)send(p,'expression',{name:p.expressions.value});p.expressions.value='';};
  row.append(p.motions,p.expressions);root.append(row);
  if(kind==='preview'){
    const calibration=make('div','xa-l2d-tools'),zone=make('select','xa-l2d-select');
    zone.append(new Option('觸摸部位校準',''));
    for(const [k,label]of [['hair','頭髮'],['forehead','額頭'],['eye-left','左眼'],['eye-right','右眼'],['ear-left','左耳'],['ear-right','右耳'],['beast-ear-left','左獸耳'],['beast-ear-right','右獸耳'],['cheek-left','左臉頰'],['cheek-right','右臉頰'],['nose','鼻子'],['mouth','嘴唇'],['neck','頸部'],['throat','喉部'],['collarbone','鎖骨'],['chest','胸口'],['arm-left','左臂'],['arm-right','右臂'],['hand-left','左手'],['hand-right','右手'],['body','身體']])zone.append(new Option(label,k));
    zone.onchange=()=>send(p,'calibrationMode',{zone:zone.value});
    calibration.append(zone,btn('清除校準',()=>{try{localStorage.removeItem(calibrationKey(p));}catch(_){}send(p,'clearCalibration');}));
    root.append(calibration);
  }
  if(kind==='preview')document.body.append(root);
  else if(kind==='chat')document.getElementById('chatHeader').after(root);
  else{
    const av=document.getElementById('callAv');p.avatar=av;
    if(av){p.avatarDisplay=av.style.display;av.style.display='none';av.after(root);}
    else document.getElementById('callOverlay').prepend(root);
  }
  controls(p);p.tick=setInterval(()=>tick(p),120);loadStatus(p);
}
window.addEventListener('message',event=>{
  const p=panel;
  if(!p||event.origin!==STAGE||event.source!==p.frame?.contentWindow||!event.data)return;
  const d=event.data;
  if(d.type==='xa-live2d-state'){
    p.ready=d.phase==='ready';p.status.textContent=p.ready?'已驗證模型畫面 · '+(p.data?.label||''):String(d.message||d.phase);
    controls(p);
  }else if(d.type==='xa-live2d-calibration'&&d.calibration&&typeof d.calibration==='object'){
    try{localStorage.setItem(calibrationKey(p),JSON.stringify(d.calibration));}catch(_){}
  }
});
// Actual call response uses its existing request, not a second model call.
// Motion choices are accepted only from this skin's current real resource list.
try{
  const original=sendChat;
  sendChat=async function(cfg,msgs,opts){
    const p=panel;
    let enabled=false;
    try{enabled=!!(p&&p.kind==='call'&&p.ready&&p.data?.motions.length&&roleKey(callChar)===p.role&&callBusy&&Array.isArray(msgs)&&typeof msgs[0]?.content==='string'&&msgs[0].content.includes('【語音通話模式】'));}catch(_){}
    if(!enabled)return original.apply(this,arguments);
    const motions=p.data.motions;
    const directory=motions.map((m,i)=>i+'='+m.name+(m.fits?'（'+String(m.fits).slice(0,180)+'）':'')).join('、');
    const edited=[{...msgs[0],content:msgs[0].content+'\n【Live2D】可自行選擇真實動作；若適合，在回覆最末尾加一個 [L2D:數字]，數字從當前目錄選。不要在台詞中提到標記。動作目錄：'+directory},...msgs.slice(1)];
    const result=await original.call(this,cfg,edited,opts);
    if(typeof result!=='string')return result;
    const matches=[...result.matchAll(/\[L2D:(\d{1,4})\]/gi)];
    if(panel===p&&matches.length){
      const index=Number(matches.at(-1)[1]);p.nextMotion=motions[index]||null;
    }
    return result.replace(/\[L2D:\d{1,4}\]/gi,'').trim();
  };
}catch(e){console.warn('Live2D call choice hook',e);}
const style=make('style');
style.textContent='.xa-l2d{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:8px;color:var(--ink,#333);background:var(--paper,#faf7f3);border:1px solid var(--line,#ddd);border-radius:14px;min-height:0;flex-shrink:0}.xa-l2d-full{position:fixed;inset:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);z-index:99999;border-radius:0;padding:12px}.xa-l2d-inline{margin:4px 8px}.xa-l2d-bar,.xa-l2d-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.xa-l2d-bar strong{flex:1}.xa-l2d-stage{position:relative;min-height:140px;height:180px;overflow:hidden;background:#e9edf4;border-radius:11px;flex-shrink:0}.xa-l2d-full .xa-l2d-stage{height:auto;flex:1;min-height:150px}.xa-l2d-frame{width:100%;height:100%;border:0;display:block}.xa-l2d-empty{height:100%;display:grid;place-items:center;text-align:center;color:#596470;font-size:13px;padding:14px}.xa-l2d-btn,.xa-l2d-select{font:inherit;font-size:12px;min-height:32px;border:1px solid var(--line,#ccc);color:inherit;background:var(--paper,#fff);border-radius:9px;padding:4px 8px;max-width:100%}.xa-l2d-status{font-size:11px;color:inherit;opacity:.8;overflow-wrap:anywhere}.xa-l2d-tools select{flex:1;min-width:60px}.xa-l2d-chat{border:0;background:none;color:inherit;font-size:11px;min-width:40px;padding:6px}.xa-l2d-chat svg{display:block;width:19px;height:19px;margin:auto}#callOverlay .xa-l2d{width:min(94vw,420px);max-height:48vh;margin:5px auto;color:#333;background:#faf7f3;overflow:auto}#callOverlay .xa-l2d-stage{height:clamp(115px,24vh,230px);min-height:110px}';
document.head.append(style);
function install(){
  const header=document.getElementById('chatHeader');
  if(header&&!document.getElementById('xaLive2DChat')){
    const b=btn('Live2D',()=>open('chat',currentRole()));b.id='xaLive2DChat';b.className='xa-l2d-chat';
    b.innerHTML=icon+'Live2D';header.insertBefore(b,header.querySelector('.chat-more-btn'));
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
window.XaLive2D={openPreview:()=>open('preview',null),closeIfOpen:close};
install();
})();
