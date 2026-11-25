const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const js=fs.readFileSync('app/src/main/assets/phone-bridge.js','utf8');
function env(enabled){const calls=[];const window={PhoneNative:{postMessage(raw){const m=JSON.parse(raw);calls.push(m.command);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:m.id,result:m.command.action==='status'?{ok:true,enabled,connected:enabled}:{ok:true,why:'receipt',screen:'actual nodes'}})}));}}};vm.runInNewContext(js,{window,document:{readyState:'loading',addEventListener(){},getElementById(){return null}},setTimeout,clearTimeout,Map,JSON});return {window,calls};}
test('disabled bridge refuses action',async()=>{const {window,calls}=env(false);const r=await window.__xaAct('swipe',{});assert.equal(r.ok,false);assert.equal(calls.length,1);});
test('enabled bridge routes action and real reply',async()=>{const {window,calls}=env(true);const r=await window.__xaAct('swipe',{startX:.5});assert.equal(r.screen,'actual nodes');assert.equal(calls[1].action,'swipe');assert.equal(calls[1].startX,.5);});
test('HTML uses original settings and task bridge',()=>{const h=fs.readFileSync('app/src/main/assets/index.html','utf8');assert.match(h,/id="xaNativeTg"/);assert.match(h,/var XA_ACTS=\[[^\]]*'swipe'/);assert.match(h,/await br\(a,args\)/);assert.match(h,/src="phone-bridge.js"/);});

function routingEnv({enabled=true,role=true,decision='phone',request='打开我的QQ',guess=true}={}){
 const c={id:'role1',msgs:[{role:'u',type:'text',content:request}]}, events=[];
 const g={PhoneNative:{postMessage(raw){const m=JSON.parse(raw);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:m.id,result:{ok:true,enabled,connected:enabled}})}));}},xaTaskEntry(){events.push('legacy');},scheduleAutoReply(){events.push('chat');},respond(){events.push('manual-chat');},buildSys(){return 'persona';},xaSkipTask(){}};
 const sandbox={window:g,document:{readyState:'loading',addEventListener(){},getElementById(){return null}},setTimeout,clearTimeout,Map,JSON,cur:c,xaFeedAnswer:()=>false,xaTaskGuess:()=>guess,xaNow:()=>'',save(){},chatVisible:()=>false,renderMsgs(){},activeApi:()=>({}),sendChatRaw:async()=>JSON.stringify({route:decision}),xaTaskOn:()=>role,XA_LIVE:{},xaAskStart(){events.push('real-task-confirm');},xaStart(){events.push('real-task-start');},replyModeOf:()=> 'auto',v1215Char:()=>c};
 vm.runInNewContext(js,sandbox);
 return {g,c,events};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('real QQ command suppresses ordinary replies and starts without a second confirmation',async()=>{
 const {g,c,events}=routingEnv();g.xaTaskEntry(c,c.msgs[0].content);g.scheduleAutoReply(c);g.respond();await settle();
 assert.deepEqual(events,['real-task-start']);assert.match(g.buildSys(c),/真实 QQ/);
});
test('missing role permission never fabricates a completed action',async()=>{
 const {g,c,events}=routingEnv({role:false});g.xaTaskEntry(c,c.msgs[0].content);g.scheduleAutoReply(c);await settle();
 assert.deepEqual(events,[]);assert.match(c.msgs[1].content,/办事开关/);
});
test('virtual component chat stays in the normal chat lane',async()=>{
 const {g,c,events}=routingEnv({decision:'chat'});g.xaTaskEntry(c,'打开虚拟QQ');g.scheduleAutoReply(c);await settle();
 assert.deepEqual(events,['chat']);
});

function executionEnv(submission={ok:true,verified:true,submitted:true,why:'已核实',screen:'fresh screen'}){
 const c={id:'role1',msgs:[]}, calls=[];
 const g={PhoneNative:{postMessage(raw){const m=JSON.parse(raw);const a=m.command.action;calls.push(a);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:m.id,result:a==='status'?{ok:true,enabled:true,connected:true}:a==='send_message'||a==='publish_moments'?submission:{ok:true,screen:'fresh screen',image:'data:image/jpeg;base64,AAAA'}})}));}},xaTaskEntry(){},xaLoop(){},xaExec(t,c,st){calls.push(st.action);if(st.action==='open_app')t.steps.push({a:'open_app',ok:true,screen:'front app'});if(st.action==='done')t.state='done';return 'break';},xaTaskSys(){return 'task';},xaTaskAsk(){return 'goal';}};
 vm.runInNewContext(js,{window:g,document:{readyState:'loading',addEventListener(){},getElementById(){return null}},setTimeout,clearTimeout,Map,JSON,xaCharOf:()=>c,xaStopped:t=>['done','fail','stop'].includes(t.state),xaEnd(t,state,note){t.state=state;t.done=note;},xaTaskOn:()=>true,XA_ACTS:['open_app','screenshot','tap_text']});
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
  const {g,c,events}=routingEnv({request,guess:false,decision:'chat'});
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
test('opening Xiaohongshu only needs foreground evidence and no model call',async()=>{
 const {g,calls}=executionEnv(),t={q:'帮我打开一下小红书',steps:[],state:'run'};
 await g.xaLoop(t);
 assert.deepEqual(calls,['open_app','done']);assert.equal(t.state,'done');
});
test('a named message or Moments starts submission and completes on verified Android evidence',async()=>{
 for(const [q,action,args] of [['用微信给小王发消息说我到了','send_message',{recipient:'小王',label:'发送'}],['帮我发个朋友圈：今天放晴','publish_moments',{label:'发表'}]]){
  const {g,c,calls}=executionEnv(),t={q,steps:[],state:'run'};
  assert.equal(await g.xaExec(t,c,{action,args}),'break');
  assert.deepEqual(calls,['status',action]);assert.equal(t.state,'done');
 }
});
test('message recipient must come from the user and the task must request sending',async()=>{
 for(const q of ['帮我发个消息','帮我看看QQ']){
  const {g,c,calls}=executionEnv(),t={q,steps:[],state:'run'};
  assert.equal(await g.xaExec(t,c,{action:'send_message',args:{recipient:'小王',label:'发送'}}),'go');
  assert.deepEqual(calls,[]);assert.equal(t.steps.at(-1).ok,false);
 }
});
test('uncertain submission ends the task without clicking twice',async()=>{
 const {g,c,calls}=executionEnv({ok:false,submitted:true,why:'点击后没有看到回执'}),t={q:'帮我发个朋友圈：今天放晴',steps:[],state:'run'};
 const step={action:'publish_moments',args:{label:'发表'}};
 await g.xaExec(t,c,step);await g.xaExec(t,c,step);
 assert.deepEqual(calls,['status','publish_moments']);assert.equal(t.state,'fail');
});
