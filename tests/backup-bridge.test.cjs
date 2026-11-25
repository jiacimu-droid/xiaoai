const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('app/src/main/assets/backup-bridge.js','utf8');
const html=fs.readFileSync('app/src/main/assets/index.html','utf8');
const legacy=html.slice(html.indexOf('const BACKUP_KEYS='),html.indexOf('function exportData(){'));
function make({native=false,idb,write}={}){
 const store=new Map(),messages=[],clipboard=[],chunks=[],window={__IDBM:{}};
 if(native)window.BackupNative={postMessage(raw){
  const m=JSON.parse(raw);
  if(m.action==='chunk')chunks.push(m.text);
  queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:m.id,ok:true})}));
 }};
 const localStorage={get length(){return store.size;},key:i=>[...store.keys()][i],getItem:k=>store.get(k)??null,
  setItem(k,v){if(write)write(k,v);store.set(k,v);},removeItem:k=>store.delete(k)};
 const ctx=vm.createContext({window,module:{exports:{}},document:{getElementById:()=>null},localStorage,
  IDBX:idb,navigator:{clipboard:{writeText(text){clipboard.push(text);}}},toast:s=>messages.push(s),
  closeModal:()=>{},setTimeout:()=>0,clearTimeout:()=>{},location:{reload:()=>{}}});
 vm.runInContext(legacy+'\n'+src,ctx);
 return {window,store,messages,clipboard,chunks,legacyBackup:ctx.backupObject,...ctx.module.exports};
}
test('accept original browser v1 envelope, BOM and plain legacy payload',()=>{
 const {decode}=make(), chars=[{name:'测试角色',messages:[{text:'你好'}]}];
 for(const data of [{__app:'小爱机',__ver:'v1',data:{chars}},{chars}]){
  const restored=decode('\uFEFF'+JSON.stringify(data));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.chars)),chars);
 }
});
test('reject unrelated files and invalid role data',()=>{
 const {decode}=make();assert.throws(()=>decode('<html>'));assert.throws(()=>decode('{"other":1}'));assert.throws(()=>decode('{"chars":{}}'));
});
test('import keeps existing unrelated local keys and writes old JSON data',async()=>{
 const {window,store}=make();store.set('unrelated','old');window.__importBuf={chars:[{name:'角色'}],apis:[]};await window.doImport();assert.equal(store.get('chars'),'[{"name":"角色"}]');assert.equal(store.get('unrelated'),'old');
});
test('the HTML exporter transfers chats, API settings and string preferences to the APK',async()=>{
 const old=make(),apk=make();
 const data={chars:[{id:'c1',name:'角色',msgs:[{role:'u',content:'旧聊天 🫧'}]}],apis:[{model:'demo'}],lang:'s',theme:'晚霞',pfActiveId:'p2'};
 for(const [key,value] of Object.entries(data))old.store.set(key,JSON.stringify(value));
 apk.window.__importBuf=apk.decode(JSON.stringify(old.legacyBackup()));
 await apk.window.doImport();
 for(const [key,value] of Object.entries(data))assert.deepEqual(JSON.parse(apk.store.get(key)),value);
});
test('APK export and clipboard data round trip media, UTF-8 and additional settings',async()=>{
 const image='data:image/png;base64,'+'a'.repeat(28000);
 const apk=make({native:true,idb:{async resolve(value){if(Array.isArray(value)&&value[0]?.avatar==='@@idb@@a_28000')value[0].avatar=image;}}});
 apk.store.set('chars',JSON.stringify([{name:'角色🫧',avatar:'@@idb@@a_28000'}]));
 apk.store.set('xaTask','0');
 apk.store.set('cmpChar_card','"c1"');
 apk.store.set('unrelated','"private"');
 apk.window.__IDBM.liveData={title:'直播 🫧'};
 await apk.window.exportData();await apk.window.copyExport();
 assert.ok(apk.chunks.length>1);
 const saved=JSON.parse(apk.chunks.map(chunk=>Buffer.from(chunk)).reduce((all,chunk)=>Buffer.concat([all,chunk]),Buffer.alloc(0)));
 assert.deepEqual(JSON.parse(apk.clipboard[0]).data,saved.data);
 assert.equal(saved.__count,Object.keys(saved.data).length);
 assert.equal(saved.data.chars[0].avatar,image);
 assert.equal(saved.data.chars[0].name,'角色🫧');
 assert.equal(saved.data.xaTask,0);
 assert.equal(saved.data.liveData.title,'直播 🫧');
 assert.equal(saved.data.unrelated,undefined);
 const restored=make();
 restored.window.__importBuf=restored.decode(JSON.stringify(saved));
 await restored.window.doImport();
 for(const [key,value] of Object.entries(saved.data))assert.deepEqual(JSON.parse(restored.store.get(key)),value);
});
test('a write failure restores disk data and cached data',async()=>{
 const apk=make({write(k,v){if(k==='apis'&&v==='[]')throw new Error('storage full');}});
 apk.store.set('theme','"old"');apk.window.__IDBM.theme='current';
 apk.store.set('apis','[{"model":"before"}]');
 apk.window.__importBuf={theme:'new',apis:[]};
 await apk.window.doImport();
 assert.equal(apk.store.get('theme'),'"old"');
 assert.equal(apk.window.__IDBM.theme,'current');
 assert.equal(apk.store.get('apis'),'[{"model":"before"}]');
 assert.match(apk.messages.at(-1),/已恢复原存档/);
});
