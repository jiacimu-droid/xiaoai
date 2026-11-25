(function(g){
'use strict';
if(g.__xaBackupInstalled)return;
g.__xaBackupInstalled=true;
const native=g.BackupNative;
const pending=new Map();let seq=0,busy=false;
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
 const keys=Object.keys(data).filter(k=>BACKUP_KEYS.includes(k));
 if(!keys.length)throw new Error('备份里没有可导入的数据');
 const result=Object.create(null);
 for(const k of keys)result[k]=data[k];
 if('chars' in result&&!Array.isArray(result.chars))throw new Error('角色数据格式不兼容');
 return result;
}
async function completeBackup(){
 const obj=backupObject();
 for(const k of Object.keys(obj.data)){
  if(Object.prototype.hasOwnProperty.call(g.__IDBM||{},k))obj.data[k]=JSON.parse(JSON.stringify(g.__IDBM[k]));
  const value=obj.data[k];
  if(value&&typeof value==='object'&&typeof IDBX!=='undefined')await IDBX.resolve(value);
 }
 return obj;
}
if(native){
 g.exportData=async function(){
  if(busy)return;busy=true;
  try{
   const text=JSON.stringify(await completeBackup());
   await call('begin',{name:backupName()});
   for(let i=0;i<text.length;){
    let end=Math.min(i+24000,text.length);
    if(end<text.length&&text.charCodeAt(end-1)>=0xD800&&text.charCodeAt(end-1)<=0xDBFF)end--;
    await call('chunk',{text:text.slice(i,end)});i=end;
   }
   await call('finish');toast('请选择备份保存位置');
  }catch(e){try{await call('cancel');}catch(_){}toast('导出失败：'+e.message);}
  finally{busy=false;}
 };
}
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
   const hasExternalRefs=JSON.stringify(data).includes('@@idb@@');
   const warning=hasExternalRefs?'<br>旧备份含外部图片引用，未随文件导出的媒体无法恢复。':'';
   modal('<div class="mhd">导入数据</div><div style="font-size:12px;line-height:1.8">文件：'+esc(file.name)+'<br>角色：'+n+' · 共 '+Object.keys(data).length+' 项<br>导入将覆盖备份中包含的数据，建议先备份当前数据。'+warning+'</div><div style="display:flex;gap:8px;margin-top:16px"><button class="btn ghost" style="flex:1" onclick="closeModal()">取消</button><button class="btn full" style="flex:1" onclick="doImport()">确认导入</button></div>');
  }catch(e){toast('导入失败：'+e.message);}finally{input.value='';}
 };
 try{rd.readAsText(file,'UTF-8');}catch(e){rd.onerror();}
};
g.doImport=async function(){
 const data=g.__importBuf;if(!data||busy)return;busy=true;
 const saved=new Map();
 try{
  for(const k of Object.keys(data)){
   saved.set(k,localStorage.getItem(k));
   const value=data[k];
   try{localStorage.setItem(k,typeof value==='string'?value:JSON.stringify(value));}
   catch(e){if(!value||typeof value!=='object'||typeof IDBX==='undefined')throw e;await IDBX.overflow(k,value);}
  }
 }catch(e){
  let rollback=true;
  for(const [k] of saved){try{localStorage.removeItem(k);}catch(_){rollback=false;}}
  for(const [k,v] of saved){try{if(v!==null)localStorage.setItem(k,v);delete g.__IDBM[k];}catch(_){rollback=false;}}
  busy=false;toast('导入失败：'+e.message+(rollback?'，已恢复原存档':'，请保留原备份'));return;
 }
 g.__importBuf=null;
 closeModal();toast('导入完成，正在重新打开小手机…');setTimeout(()=>location.reload(),500);
};
if(typeof module!=='undefined')module.exports={decode};
})(window);
