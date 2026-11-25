(function(g){
'use strict';
if(g.__xaBackupInstalled)return;
g.__xaBackupInstalled=true;
const native=g.BackupNative;
const pending=new Map();let seq=0,busy=false;
const dataKeys=[
 'aiguApi','aiguChar','aiguDialogues','aiguNpcName','ayi2','ghChar','liveData','lvAi','lvTts',
 'mailLastChar','presetAll','presetKeys','rpFreq','ruleRetry','togetherListen','ttsModelUpg',
 'voiceFreq','wbAll','wyPartner','xMineFirst','xaTask','xaTaskCap'
];
const arrays=['chars','apis','wbs','stickers','favorites','moments'];
function backupKey(k){return BACKUP_KEYS.includes(k)||dataKeys.includes(k)||/^(?:cmpChar_|ghAi_)[a-z0-9_-]+$/i.test(k);}
if(native)native.onmessage=e=>{try{const r=JSON.parse(e.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.ok?p.resolve(r):p.reject(new Error(r.why));}catch(_){}};
function call(action,args){return new Promise((resolve,reject)=>{
 const id=String(++seq),timer=setTimeout(()=>{pending.delete(id);reject(new Error('备份接口未响应'));},30000);
 pending.set(id,{resolve,reject,timer});
 try{native.postMessage(JSON.stringify(Object.assign({id,action},args||{})));}catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
});}
function decode(text){
 const obj=JSON.parse(String(text).replace(/^\uFEFF/,''));
 const data=obj&&obj.data&&typeof obj.data==='object'?obj.data:obj;
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('不是小爱机的 JSON 备份');
 const keys=Object.keys(data).filter(backupKey);
 if(!keys.length)throw new Error('备份里没有可导入的数据');
 const result=Object.create(null);
 for(const k of keys)result[k]=data[k];
 for(const k of arrays){if(k in result&&!Array.isArray(result[k]))throw new Error('备份数据格式不兼容（'+k+'）');}
 return result;
}
async function completeBackup(){
 const obj=backupObject();
 const cache=g.__IDBM||{};
 const keys=new Set([...Object.keys(obj.data),...Object.keys(cache).filter(k=>backupKey(k)&&cache[k]!==undefined)]);
 for(let i=0;i<localStorage.length;i++){
  const key=localStorage.key(i);
  if(backupKey(key)&&!keys.has(key)){
   const raw=localStorage.getItem(key);
   try{obj.data[key]=JSON.parse(raw);}catch(_){obj.data[key]=raw;}
   keys.add(key);
  }
 }
 for(const k of keys){
  if(Object.prototype.hasOwnProperty.call(cache,k)&&cache[k]!==undefined)obj.data[k]=JSON.parse(JSON.stringify(cache[k]));
  const value=obj.data[k];
  if(value&&typeof value==='object'&&typeof IDBX!=='undefined')await IDBX.resolve(value);
 }
 obj.__count=Object.keys(obj.data).length;
 return obj;
}
if(native){
 async function saveFile(name,format,readText){
  if(busy)return;busy=true;
  let started=false;
  try{
   const text=await readText();
   await call('begin',{name,format});started=true;
   for(let i=0;i<text.length;){
    let end=Math.min(i+24000,text.length);
    if(end<text.length&&text.charCodeAt(end-1)>=0xD800&&text.charCodeAt(end-1)<=0xDBFF)end--;
    await call('chunk',{text:text.slice(i,end)});i=end;
   }
   await call('finish');toast(format==='report'?'请选择报告保存位置':'请选择备份保存位置');
  }catch(e){if(started)try{await call('cancel');}catch(_){}toast('导出失败：'+e.message);}
  finally{busy=false;}
 }
 g.exportData=()=>saveFile(backupName(),'backup',async()=>JSON.stringify(await completeBackup()));
 g.xaSaveDiagnosticReport=(name,text)=>saveFile(name,'report',()=>text);
}
g.copyExport=async function(){
 if(busy)return;busy=true;
 try{
  const text=JSON.stringify(await completeBackup());
  if(navigator.clipboard&&navigator.clipboard.writeText){
   try{await navigator.clipboard.writeText(text);toast('备份文本已复制');return;}catch(_){}
  }
  fallbackCopy(text);
 }catch(e){toast('复制失败：'+e.message);}
 finally{busy=false;}
};
const inp=document.getElementById('importFile');
if(inp)inp.accept='*/*';
g.importData=function(input){
 const file=input.files&&input.files[0];if(!file)return;
 const rd=new FileReader();
 rd.onerror=()=>{toast('无法读取备份文件，请先保存到手机本地再选取');input.value='';};
 rd.onload=()=>{
  try{
   const data=decode(rd.result);
   g.__importBuf=data;
   const n=Array.isArray(data.chars)?data.chars.length:0;
   const hasExternalRefs=/"@@idb@@[a-z0-9]+_\d+"/i.test(String(rd.result));
   const warning=hasExternalRefs?'<br>旧备份含外部图片引用，未随文件导出的媒体无法恢复。':'';
   modal('<div class="mhd">导入数据</div><div style="font-size:12px;line-height:1.8">文件：'+esc(file.name)+'<br>角色：'+n+' · 共 '+Object.keys(data).length+' 项<br>导入将覆盖备份中包含的数据，建议先备份当前数据。'+warning+'</div><div style="display:flex;gap:8px;margin-top:16px"><button class="btn ghost" style="flex:1" onclick="closeModal()">取消</button><button class="btn full" style="flex:1" onclick="doImport()">确认导入</button></div>');
  }catch(e){toast('导入失败：'+e.message);}finally{input.value='';}
 };
 try{rd.readAsText(file,'UTF-8');}catch(e){rd.onerror();}
};
g.doImport=async function(){
 const data=g.__importBuf;if(!data||busy)return;busy=true;
 const saved=new Map(),cache=g.__IDBM||{};
 try{
  for(const k of Object.keys(data)){
   saved.set(k,{raw:localStorage.getItem(k),cached:Object.prototype.hasOwnProperty.call(cache,k),value:cache[k]});
   const value=data[k];
   try{localStorage.setItem(k,JSON.stringify(value));cache[k]=value;}
   catch(e){if(!value||typeof value!=='object'||typeof IDBX==='undefined')throw e;await IDBX.overflow(k,value);}
  }
 }catch(e){
  let rollback=true;
  for(const [k] of saved){try{localStorage.removeItem(k);}catch(_){rollback=false;}}
  for(const [k,previous] of saved){
   try{if(previous.raw!==null)localStorage.setItem(k,previous.raw);}catch(_){rollback=false;}
   if(previous.cached)cache[k]=previous.value;else delete cache[k];
  }
  busy=false;toast('导入失败：'+e.message+(rollback?'，已恢复原存档':'，请保留原备份'));return;
 }
 g.__importBuf=null;
 closeModal();toast('导入完成，正在重新打开小手机…');setTimeout(()=>location.reload(),500);
};
if(typeof module!=='undefined')module.exports={decode,completeBackup};
})(window);
