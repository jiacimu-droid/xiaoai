const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const early=fs.readFileSync('app/src/main/assets/runtime-log-early.js','utf8');
const runtime=fs.readFileSync('app/src/main/assets/runtime-log.js','utf8');

test('the report includes early script errors and native diagnostics without request or task contents',async()=>{
 const handlers=Object.create(null),saved=new Map();
 const env={
  URL,location:{href:'https://appassets.androidplatform.net/assets/index.html',origin:'https://appassets.androidplatform.net'},
  navigator:{userAgent:'test'},localStorage:{length:0},
  DB:{get:(k,d)=>saved.get(k)??d,set:(k,v)=>{saved.set(k,v);return true;}},
  console:{error(){},warn(){}},document:{getElementById:()=>null,createElement:()=>({}),
   querySelectorAll:()=>[],head:{appendChild(){}},addEventListener(){}},
  addEventListener:(k,h)=>{handlers[k]=h;},setTimeout:()=>1,
  xaPhoneDiagnostics:async()=>({ok:true,report:'運行連接：已連接'}),
  sendChatRaw:async()=>{throw new Error('API 401: bearer sample-key');},
  xaEnd(task,state){task.state=state;},
 };
 env.window=env;env.top=env;
 const c=vm.createContext(env);
 vm.runInContext(early,c);
 handlers.error({error:new TypeError('private message'),filename:'https://appassets.androidplatform.net/assets/index.html?secret=yes',lineno:43});
 env.console.error({apiKey:'my-secret-key'});
 vm.runInContext(runtime,c);
 await assert.rejects(c.sendChatRaw(),/sample-key/);
 c.xaEnd({state:'run',goal:'private task',steps:[{a:'tap_text',why:'private recipient'}]},'fail');
 const report=await c.xaFullLogText();
 assert.match(report,/TypeError/);assert.match(report,/index\.html:43/);
 assert.match(report,/HTTP 401/);assert.match(report,/tap_text/);
 assert.match(report,/運行連接：已連接/);
 assert.doesNotMatch(report,/private message|secret=yes|my-secret-key|sample-key|private task|private recipient/);
});
