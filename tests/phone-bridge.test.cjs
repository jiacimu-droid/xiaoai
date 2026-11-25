const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const js=fs.readFileSync('app/src/main/assets/phone-bridge.js','utf8');
function env(enabled){const calls=[];const window={PhoneNative:{postMessage(raw){const m=JSON.parse(raw);calls.push(m.command);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:m.id,result:m.command.action==='status'?{ok:true,enabled,connected:enabled}:{ok:true,why:'receipt',screen:'actual nodes'}})}));}}};vm.runInNewContext(js,{window,document:{readyState:'loading',addEventListener(){},getElementById(){return null}},setTimeout,clearTimeout,Map,JSON});return {window,calls};}
test('disabled bridge refuses action',async()=>{const {window,calls}=env(false);const r=await window.__xaAct('swipe',{});assert.equal(r.ok,false);assert.equal(calls.length,1);});
test('enabled bridge routes action and real reply',async()=>{const {window,calls}=env(true);const r=await window.__xaAct('swipe',{startX:.5});assert.equal(r.screen,'actual nodes');assert.equal(calls[1].action,'swipe');assert.equal(calls[1].startX,.5);});
test('HTML uses original settings and task bridge',()=>{const h=fs.readFileSync('app/src/main/assets/index.html','utf8');assert.match(h,/id="xaNativeTg"/);assert.match(h,/var XA_ACTS=\[[^\]]*'swipe'/);assert.match(h,/await br\(a,args\)/);assert.match(h,/src="phone-bridge.js"/);});

function routingEnv({enabled=true,role=true,decision='phone'}={}){
 const c={id:'role1',msgs:[{role:'u',type:'text',content:'打开我的QQ'}]}, events=[];
 const g={PhoneNative:{postMessage(raw){const m=JSON.parse(raw);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:m.id,result:{ok:true,enabled,connected:enabled}})}));}},xaTaskEntry(){events.push('legacy');},scheduleAutoReply(){events.push('chat');},respond(){events.push('manual-chat');},buildSys(){return 'persona';},xaSkipTask(){}};
 const sandbox={window:g,document:{readyState:'loading',addEventListener(){},getElementById(){return null}},setTimeout,clearTimeout,Map,JSON,cur:c,xaFeedAnswer:()=>false,xaTaskGuess:()=>true,xaNow:()=>'',save(){},chatVisible:()=>false,renderMsgs(){},activeApi:()=>({}),sendChatRaw:async()=>JSON.stringify({route:decision}),xaTaskOn:()=>role,XA_LIVE:{},xaAskStart(){events.push('real-task-confirm');},replyModeOf:()=> 'auto',v1215Char:()=>c};
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
