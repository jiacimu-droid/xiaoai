const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/live2d-entry.js'),'utf8');
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
test('speech plan keeps each segment text and its own verified motion and expression',()=>{
  const log=[],panel={kind:'call',role:'r',session:log,ready:true,data:{model:'a',motions:[{group:'Tap',index:0,name:'nod'},{group:'Tap',index:1,name:'wave'}],expressions:['smile','sad']},parameters:['ParamEyeBallX']};
  const api=new Function('panel','callLog','callPhase','callPerception',between('const faceChannels=','function showMotion')+between('function callMotionOptions(){',"const style=make('style');")+';return {callMotionOptions,verifiedCue};')(panel,log,'connected',new WeakMap());
  const visual=api.callMotionOptions();
  const encode=speech=>'[L2S]'+JSON.stringify({speech})+'[/L2S]';
  const result=visual.parse(encode([{id:'s1',text:'第一句。',motion:0,expression:0},{id:'s2',text:'第二句。',motion:1,expression:1,face:{gazeX:.4}},{id:'s3',text:'第三句。',motion:99}]));
  assert.equal(result.reply,'第一句。 第二句。 第三句。');
  assert.equal(result.motion.parts[0].choice.motion.index,0);
  assert.equal(result.motion.parts[1].choice.motion.index,1);
  assert.equal(result.motion.parts[1].choice.expression,'sad');
  assert.equal(result.motion.parts[1].choice.face.gazeX,.4);
  assert.equal(result.motion.parts[2].choice,null);
  const invalid=visual.parse(encode([{id:'s1',text:'甲'},{id:'s1',text:'乙'}]));
  assert.equal(invalid.reply,'甲 乙');assert.equal(invalid.motion.parts.length,2);assert.notEqual(invalid.motion.parts[0].id,invalid.motion.parts[1].id);
  const wrapped=visual.parse('好的！\n```json\n'+encode([{text:'親親',motion:'1',expression:'smile'}])+'\n```');
  assert.equal(wrapped.reply,'親親');assert.equal(wrapped.motion.parts[0].choice.motion.index,1);assert.equal(wrapped.motion.parts[0].choice.expression,'smile');
  const raw=visual.parse(JSON.stringify({speech:[{text:'過來呀',motion:'wave'}]}));assert.equal(raw.motion.parts[0].choice.motion.index,1);
  const truncated=visual.parse('[L2S]{"speech":[{"text":"親一下"},');assert.equal(truncated.reply,'親一下');assert.equal(truncated.repair,true);
  const malformed=visual.parse('[L2S]{"speech":[{"motion":0},');assert.equal(malformed.reply,'');assert.equal(malformed.repair,true);
});
test('only actual audio completion advances to the next segment; cancellation releases resources',async()=>{
  const log=[],parts=[{id:'a',text:'first',choice:{id:1}},{id:'b',text:'second',choice:{id:2}}];
  const audioList=[],spoken=[],revoked=[],panel={kind:'call',session:log,ready:true,partCaption:{}};
  class AudioMock{
    constructor(url){this.src=url;this.listeners={};this.ended=false;audioList.push(this);}
    addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
    emit(k){for(const fn of this.listeners[k]||[])fn();}
    play(){this.emit('playing');return Promise.resolve();}
    pause(){this.emit('pause');}
  }
  const setup=`let performanceJob=null,callAudio=null,callSpeechRequest=0,callPhase='connected',callTtsOn=true;const speechMotions=new WeakMap();function callTip(){}function callTipClear(){}function callStopAudio(){cancelPerformance();callSpeechRequest++;if(callAudio){callAudio.pause();callAudio=null;}}`;
  const voice={model:'eleven_v4',voice:'selected-voice'};
  const window={XaSpeechInput:{elevenConfig:()=>voice,elevenSpeak:async(text,config)=>{
    assert.equal(config,voice);spoken.push(text);return 'blob:'+text;
  }}};
  const api=new Function('callLog','panel','Audio','URL','DB','minimaxSpeak','watchMedia','verifiedCue','send','friendly','window',setup+between('function activeJob(job)','window.XaLive2D={openPreview')+';return {performSpeechPlan,active:()=>!!performanceJob,choice:a=>speechMotions.get(a),stop:callStopAudio};')(log,panel,AudioMock,{revokeObjectURL:u=>revoked.push(u)},{get:()=>({key:'k',group:'g'})},()=>assert.fail('used the wrong voice provider'),()=>{},()=>null,()=>{},String,window);
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  const task=api.performSpeechPlan('first second',{parts});await flush();
  assert.deepEqual(spoken,['first']);assert.equal(api.choice(audioList[0]).id,1);assert.equal(panel.partCaption.textContent,'first');
  audioList[0].ended=true;audioList[0].emit('ended');await flush();
  assert.deepEqual(spoken,['first','second']);assert.equal(api.choice(audioList[1]).id,2);assert.equal(panel.partCaption.textContent,'second');
  api.stop();await task;assert.equal(api.active(),false);assert.equal(panel.partCaption.hidden,true);assert.equal(revoked.length,2);
});


test('a rejected playback reports its cause and continues synthesizing later segments',async()=>{
  const log=[],spoken=[],tips=[],revoked=[],audioList=[];
  const panel={kind:'call',session:log,ready:true,partCaption:{}};
  class AudioMock{
    constructor(url){this.src=url;this.listeners={};this.ended=false;audioList.push(this);}
    addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
    emit(k){for(const fn of this.listeners[k]||[])fn();}
    play(){if(this.src==='blob:first')return Promise.reject(Object.assign(new Error('blocked'),{name:'NotAllowedError'}));this.emit('playing');return Promise.resolve();}
    pause(){this.emit('pause');}
  }
  const setup=`let performanceJob=null,callAudio=null,callSpeechRequest=0,callPhase='connected',callTtsOn=true;const speechMotions=new WeakMap();function callTip(x){tips.push(x);}function callTipClear(){}function callStopAudio(){cancelPerformance();callSpeechRequest++;}`;
  const timers=new Map();let next=0;
  const api=new Function('callLog','panel','Audio','URL','DB','minimaxSpeak','watchMedia','verifiedCue','send','friendly','tips','setTimeout','clearTimeout','console','window',setup+between('function activeJob(job)','window.XaLive2D={openPreview')+';return {performSpeechPlan};')(log,panel,AudioMock,{revokeObjectURL:u=>revoked.push(u)},{get:()=>({key:'k',group:'g'})},async text=>{spoken.push(text);return 'blob:'+text;},()=>{},()=>null,()=>{},String,tips,(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},id=>timers.delete(id),{warn(){}},{});
  const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  const task=api.performSpeechPlan('first second',{parts:[{text:'first'},{text:'second'}]});
  await flush();
  assert.deepEqual(spoken,['first']);
  assert.ok(tips.some(t=>t.includes('NotAllowedError')));
  const captionTimer=[...timers.values()].find(t=>t.ms<15000);
  assert.ok(captionTimer);captionTimer.fn();await flush();
  assert.deepEqual(spoken,['first','second']);
  assert.equal(panel.partCaption.textContent,'second');
  audioList[1].ended=true;audioList[1].emit('ended');await task;
  assert.deepEqual(revoked,['blob:first','blob:second']);
  assert.ok(tips.some(t=>t.includes('1 段語音未完整播放')));
});
