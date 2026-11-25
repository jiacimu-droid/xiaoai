const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('app/src/main/assets/backup-bridge.js','utf8');
function make(){
 const store=new Map(), messages=[], window={__IDBM:{}};
 const ctx={window,module:{exports:{}},document:{getElementById:()=>null},BACKUP_KEYS:['chars','apis','userProfile','moments'],localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},toast:s=>messages.push(s),closeModal:()=>{},setTimeout:()=>0,clearTimeout:()=>{},location:{reload:()=>{}}};
 vm.runInNewContext(src,ctx);return {window,store,messages,decode:ctx.module.exports.decode};
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
