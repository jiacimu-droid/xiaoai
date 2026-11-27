const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const early=fs.readFileSync('app/src/main/assets/runtime-log-early.js','utf8');
const runtime=fs.readFileSync('app/src/main/assets/runtime-log.js','utf8');

test('the APK entry loads each diagnostics script once in startup order',()=>{
 const html=fs.readFileSync('app/src/main/assets/index.html','utf8');
 const scripts=Array.from(html.matchAll(/<script src="([^"<>]+)"><\/script>/g),match=>match[1]);
 assert.deepEqual(scripts.filter(name=>name.startsWith('runtime-log')||name==='phone-bridge.js'),[
  'runtime-log-early.js','phone-bridge.js','runtime-log.js',
 ]);
 assert.doesNotMatch(html,/\bfunction\s+(?:xaLogBoot|xaLogSink)\s*\(|\bDB\.set\s*=/);
});

test('the report includes early script errors and native diagnostics without request or task contents',async()=>{
 const handlers=Object.create(null),saved=new Map(),writes=[];
 const overflowError=new Error('private IndexedDB details');
 const calls=[];
 const env={
  URL,location:{href:'https://appassets.androidplatform.net/assets/index.html',origin:'https://appassets.androidplatform.net'},
  navigator:{userAgent:'test'},localStorage:{length:0},
  DB:{get:(k,d)=>saved.get(k)??d,set:(k,v)=>{writes.push(k);saved.set(k,v);return true;}},
  IDBX:{overflow(key,value){calls.push([key,value]);return key==='failed'?Promise.reject(overflowError):Promise.resolve('ref');}},
  console:{error(){},warn(){}},document:{getElementById:()=>null,createElement:()=>({}),
   querySelectorAll:()=>[],head:{appendChild(){}},addEventListener(){}},
  esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  xaCut:(value,count)=>String(value).slice(0,count),
  addEventListener:(k,h)=>{handlers[k]=h;},setTimeout:()=>1,
  xaPhoneDiagnostics:async()=>({ok:true,report:'運行連接：已連接'}),
 };
 env.window=env;env.top=env;
 const c=vm.createContext(env);
 vm.runInContext(early,c);
 handlers.error({error:new TypeError('private message'),filename:'https://appassets.androidplatform.net/assets/index.html?secret=yes',lineno:43});
 env.console.error({apiKey:'my-secret-key'});
 vm.runInContext(runtime,c);
 const firstSetter=env.DB.set;
 const firstOverflow=env.IDBX.overflow;
 vm.runInContext(runtime,c);
 assert.equal(env.DB.set,firstSetter);
 assert.equal(env.IDBX.overflow,firstOverflow);
 assert.equal(saved.get('xaLogStat').boots,1);
 assert.equal(env.DB.set('npcReject',[1]),true);
 assert.deepEqual(writes.filter(key=>key==='npcReject'),['npcReject']);
 assert.deepEqual(saved.get('npcReject'),[1]);
 assert.equal(await env.IDBX.overflow('wbs','world book'), 'ref');
 await assert.rejects(env.IDBX.overflow('failed','world book'), error=>error===overflowError);
 assert.deepEqual(calls,[['wbs','world book'],['failed','world book']]);
 c.xaLogApiErr(new Error('API 401: bearer sample-key'));
 c.xaLogXa('fail',{goal:'private task',steps:[{a:'tap_text',why:'private recipient'}]});
 const report=await c.xaFullLogText();
 assert.match(report,/TypeError/);assert.match(report,/index\.html:43/);
 assert.match(report,/HTTP 401/);assert.match(report,/tap_text/);
 assert.match(report,/運行連接：已連接/);
 assert.doesNotMatch(report,/private message|secret=yes|my-secret-key|sample-key|private task|private recipient|private IndexedDB details/);
 c.xaLog('err','診斷 <測試> & 註記','');
 const summary=c.v1217PeekRows();
 assert.match(summary,/最近一次：診斷 &lt;測試&gt; &amp; 註記/);
 assert.doesNotMatch(summary,/<測試>/);
});
