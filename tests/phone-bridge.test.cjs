const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const js=fs.readFileSync('app/src/main/assets/phone-bridge.js','utf8');
function env(enabled){const calls=[];const window={PhoneNative:{postMessage(raw){const m=JSON.parse(raw);calls.push(m.command);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:m.id,result:m.command.action==='status'?{ok:true,enabled,connected:enabled}:{ok:true,why:'receipt',screen:'actual nodes'}})}));}}};vm.runInNewContext(js,{window,document:{readyState:'loading',addEventListener(){},getElementById(){return null}},setTimeout,clearTimeout,Map,JSON});return {window,calls};}
test('disabled bridge refuses action',async()=>{const {window,calls}=env(false);const r=await window.__xaAct('swipe',{});assert.equal(r.ok,false);assert.equal(calls.length,1);});
test('enabled bridge routes action and real reply',async()=>{const {window,calls}=env(true);const r=await window.__xaAct('swipe',{startX:.5});assert.equal(r.screen,'actual nodes');assert.equal(calls[1].action,'swipe');assert.equal(calls[1].startX,.5);});
test('HTML uses original settings and task bridge',()=>{const h=fs.readFileSync('app/src/main/assets/index.html','utf8');assert.match(h,/id="xaNativeTg"/);assert.match(h,/var XA_ACTS=\[[^\]]*'swipe'/);assert.match(h,/await br\(a,args\)/);assert.match(h,/src="phone-bridge.js"/);});

function routingEnv({enabled=true,role=true,decision='phone',request='打开我的QQ',confirmed=false,guess=true}={}){
 const c={id:'role1',taskConfirmed:confirmed?1:0,msgs:[{role:'u',type:'text',content:request}]}, events=[];
 const g={PhoneNative:{postMessage(raw){const m=JSON.parse(raw);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:m.id,result:{ok:true,enabled,connected:enabled}})}));}},xaTaskEntry(){events.push('legacy');},scheduleAutoReply(){events.push('chat');},respond(){events.push('manual-chat');},buildSys(){return 'persona';},xaSkipTask(){}};
 const sandbox={window:g,document:{readyState:'loading',addEventListener(){},getElementById(){return null}},setTimeout,clearTimeout,Map,JSON,cur:c,xaFeedAnswer:()=>false,xaTaskGuess:()=>guess,xaNow:()=>'',save(){},chatVisible:()=>false,renderMsgs(){},activeApi:()=>({}),sendChatRaw:async()=>JSON.stringify({route:decision}),xaTaskOn:()=>role,XA_LIVE:{},xaAskStart(){events.push('real-task-confirm');},xaStart(){events.push('real-task-start');},replyModeOf:()=> 'auto',v1215Char:()=>c};
 vm.runInNewContext(js,sandbox);
 return {g,c,events};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('real QQ command suppresses both normal reply paths and reaches real-task confirmation',async()=>{
 const {g,c,events}=routingEnv();g.xaTaskEntry(c,c.msgs[0].content);g.scheduleAutoReply(c);g.respond();await settle();
 assert.deepEqual(events,['real-task-confirm']);assert.equal(c._taskQ,'打开我的QQ');assert.match(g.buildSys(c),/真实 QQ/);
});
test('missing role permission never fabricates a completed action',async()=>{
 const {g,c,events}=routingEnv({role:false});g.xaTaskEntry(c,c.msgs[0].content);g.scheduleAutoReply(c);await settle();
 assert.deepEqual(events,[]);assert.match(c.msgs[1].content,/办事开关/);
});
test('virtual component chat stays in the normal chat lane',async()=>{
 const {g,c,events}=routingEnv({decision:'chat'});g.xaTaskEntry(c,'打开虚拟QQ');g.scheduleAutoReply(c);await settle();
 assert.deepEqual(events,['chat']);
});

function executionEnv(){
 const c={id:'role1',msgs:[]}, calls=[];
 const g={PhoneNative:{postMessage(raw){const m=JSON.parse(raw);calls.push(m.command.action);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:m.id,result:m.command.action==='status'?{ok:true,enabled:true,connected:true}:{ok:true,screen:'fresh screen',image:'data:image/jpeg;base64,AAAA'}})}));}},xaLoop(){},xaExec(t,c,st){calls.push(st.action);return 'break';},xaTaskSys(){return 'task';},xaTaskAsk(){return 'goal';}};
 vm.runInNewContext(js,{window:g,document:{readyState:'loading',addEventListener(){},getElementById(){return null}},setTimeout,clearTimeout,Map,JSON,xaStopped:()=>false,xaTaskOn:()=>true,XA_ACTS:['open_app','screenshot','tap_text']});
 return {g,c,calls};
}
test('completion without action evidence is rejected before calling legacy executor',async()=>{
 const {g,c,calls}=executionEnv(), t={steps:[],state:'run'};
 assert.equal(await g.xaExec(t,c,{action:'done',args:{}}),'go');
 assert.equal(t.steps[0].a,'done_rejected');assert.deepEqual(calls,[]);
});
test('capture returns observation but does not persist image bytes in task history',async()=>{
 const {g,c,calls}=executionEnv(), t={steps:[],state:'run'};
 assert.equal(await g.xaExec(t,c,{action:'capture_window',args:{}}),'go');
 assert.deepEqual(calls,['status','capture_window']);assert.equal(t.steps[0].screen,'fresh screen');assert.equal(t.steps[0].ok,true);
 assert.ok(!JSON.stringify(t).includes('data:image'));
});

test('natural requests reach task route even if the old keyword detector misses them',async()=>{
 for(const request of ['帮我看一下QQ','帮我打开一下小红书','帮我发个消息','帮我发个朋友圈']){
  const {g,c,events}=routingEnv({request,confirmed:true,guess:false});
  g.xaTaskEntry(c,request);g.scheduleAutoReply(c);await settle();
  assert.deepEqual(events,['real-task-start'],request);
 }
});
test('outbound task cannot claim done merely because an app was opened',async()=>{
 const {g,c,calls}=executionEnv(),t={q:'帮我发个朋友圈',steps:[{a:'open_app',ok:true,screen:'微信'}],state:'run'};
 assert.equal(await g.xaExec(t,c,{action:'done',args:{}}),'go');
 assert.equal(t.steps.at(-1).a,'done_rejected');assert.deepEqual(calls,[]);
});
test('social handoff requires actual successful input evidence',async()=>{
 const {g,c,calls}=executionEnv(),t={q:'帮我发个消息',steps:[],state:'run'};
 assert.equal(await g.xaExec(t,c,{action:'handoff',args:{}}),'go');
 assert.equal(t.steps.at(-1).a,'handoff_rejected');assert.deepEqual(calls,[]);
});
