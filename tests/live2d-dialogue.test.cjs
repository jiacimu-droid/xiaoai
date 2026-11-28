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
  assert.equal(invalid.reply,'甲 乙');assert.equal(invalid.motion,null);
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
  const api=new Function('callLog','panel','Audio','URL','DB','minimaxSpeak','watchMedia','verifiedCue','send','friendly',setup+between('function activeJob(job)','window.XaLive2D={openPreview')+';return {performSpeechPlan,active:()=>!!performanceJob,choice:a=>speechMotions.get(a),stop:callStopAudio};')(log,panel,AudioMock,{revokeObjectURL:u=>revoked.push(u)},{get:()=>({key:'k',group:'g'})},async text=>{spoken.push(text);return 'blob:'+text;},()=>{},()=>null,()=>{},String);
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  const task=api.performSpeechPlan('first second',{parts});await flush();
  assert.deepEqual(spoken,['first']);assert.equal(api.choice(audioList[0]).id,1);assert.equal(panel.partCaption.textContent,'first');
  audioList[0].ended=true;audioList[0].emit('ended');await flush();
  assert.deepEqual(spoken,['first','second']);assert.equal(api.choice(audioList[1]).id,2);assert.equal(panel.partCaption.textContent,'second');
  api.stop();await task;assert.equal(api.active(),false);assert.equal(panel.partCaption.hidden,true);assert.equal(revoked.length,2);
});
