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
