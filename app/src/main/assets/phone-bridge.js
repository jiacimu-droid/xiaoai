(function(g){
'use strict';
const bridge=g.PhoneNative;
if(!bridge||typeof bridge.postMessage!=='function')return;
let seq=0, status={enabled:false,connected:false};const pending=new Map();
bridge.onmessage=function(e){try{const m=JSON.parse(e.data);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);p.resolve(m.result);}catch(_){}};
function rpc(action,args){return new Promise(resolve=>{const id=String(++seq),timer=setTimeout(()=>{pending.delete(id);resolve({ok:false,why:'原生操作未回報，請先觀察，不要直接重試',screen:''});},action==='authorize'||action==='open_app'?60000:8000);pending.set(id,{resolve,timer});try{bridge.postMessage(JSON.stringify({id,command:Object.assign({},args||{},{action})}));}catch(e){clearTimeout(timer);pending.delete(id);resolve({ok:false,why:'無法連接 Android',screen:''});}});}
async function refresh(){const r=await rpc('status');status={enabled:r.enabled===true,connected:r.connected===true};const t=document.getElementById('xaNativeTg');if(t){t.classList.toggle('on',status.enabled);t.setAttribute('aria-checked',String(status.enabled));}const label=document.getElementById('xaNativeStatus');if(label)label.textContent=status.enabled?'已授權':'未授權';return status;}
g.xaNativeRefresh=refresh;
g.xaNativeToggle=async function(){await refresh();await rpc(status.enabled?'disable':'authorize');await refresh();};
g.xaNativeCancel=function(){return rpc('cancel');};
g.__xaAct=async function(action,args){const s=await refresh();if(!s.enabled)return {ok:false,why:'無障礙未授權，請在設置開啟',screen:''};return rpc(action,args);};
if(typeof module!=='undefined')module.exports={rpc,refresh};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh);else refresh();
})(typeof window!=='undefined'?window:globalThis);

/* Real phone requests must not be answered by the virtual-component chat lane. */
(function(g){
'use strict';
if(!g.PhoneNative||typeof g.xaTaskEntry!=='function')return;
const entry=g.xaTaskEntry, schedule=g.scheduleAutoReply, respond=g.respond, sys=g.buildSys, skip=g.xaSkipTask;
const route=new WeakMap();
function latest(c){return (c.msgs||[]).slice().reverse().find(m=>m.role==='u'&&m.type!=='recalled');}
function report(c,s){c.msgs.push({role:'a',type:'text',content:s,time:xaNow()});save();if(chatVisible(c))renderMsgs();}
function isExplicit(t){return /(?:打开|打開|点开|點開|启动|啟動|控制|操作).*(?:QQ|微信|小红书|小紅書|手机|手機|屏幕|螢幕|应用|應用|APP)/i.test(t);}
function held(c){const r=c&&route.get(c);return !!(r&&r.message===latest(c));}
g.xaTaskEntry=function(c,txt){
 if(!c||!txt)return;
 if(xaFeedAnswer(c,txt)){route.set(c,{message:latest(c)});return;}
 if(!isExplicit(txt)&&!xaTaskGuess(txt))return entry.apply(this,arguments);
 const message=latest(c);if(!message)return;
 route.set(c,{message});
 (async()=>{
   let decision;
   try{
     const cfg=activeApi();
     if(!cfg)throw Error('请先配置模型接口');
     const raw=await sendChatRaw(cfg,[{role:'system',content:'判断用户最新一句是否要求操作真实 Android 手机。只返回 JSON {"route":"phone"} 或 {"route":"chat"}。打开真实 QQ、微信、小红书、点击屏幕、搜索真实应用属于 phone；小爱机内置虚拟 QQ 装扮、普通聊天或角色扮演属于 chat。不要执行任务，不要编造动作。'}, {role:'user',content:JSON.stringify({request:txt})}],{maxTokens:100,noDigest:true});
     const cleaned=String(raw||'').trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi,'');
     decision=JSON.parse(cleaned).route;
     if(decision!=='chat'&&decision!=='phone')throw Error('请求类型无法识别');
   }catch(e){if(latest(c)===message)report(c,'暂时无法判断手机操作请求：'+String(e.message||e));return;}
   if(latest(c)!==message)return;
   if(decision==='chat'){
     route.delete(c);
     if(replyModeOf(c)==='flash'){try{respNeed();}catch(_){}}
     else schedule(c);
     return;
   }
   const status=await g.xaNativeRefresh();
   if(latest(c)!==message)return;
   if(!status.enabled){report(c,'还没有连接无障碍服务，请先在设置中授权。');return;}
   if(!xaTaskOn(c)){report(c,'无障碍已经连接，请开启设置里的办事总开关，以及这个角色对话设置里的办事开关。');return;}
   if(Object.keys(XA_LIVE).length){report(c,'还有一个手机任务正在执行，请先结束它。');return;}
   c._taskQ=String(txt);
   xaAskStart(c,String(txt));
 })().catch(e=>{if(latest(c)===message)report(c,'手机任务未启动：'+String(e.message||e));});
};
g.scheduleAutoReply=function(c){if(held(c))return;return schedule.apply(this,arguments);};
g.respond=function(){if(held(cur))return;return respond.apply(this,arguments);};
g.xaSkipTask=function(cid){
 const c=v1215Char(cid);const result=skip.apply(this,arguments);
 if(c&&held(c)){route.delete(c);if(replyModeOf(c)!=='flash')schedule(c);}
 return result;
};
g.buildSys=function(c){return sys(c)+'\n【真实手机与虚拟组件】真实手机操作只能通过独立手机任务和真实工具回执完成。不得在普通聊天中假称已经打开、点击、输入或发送。真实 QQ 与内置 QQ 装扮组件不同；不要用组件 JSON 冒充 Android 操作。';};
})(window);
