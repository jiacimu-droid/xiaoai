const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('app/src/main/assets/speech-input.js','utf8');
test('native STT requires explicit input and never invokes chat send',()=>{
  assert.match(source,/rpc\('record'\)/);
  assert.match(source,/originalRole===null\|\|role\(\)!==originalRole/);
  assert.match(source,/fields\.length===1/);
  assert.doesNotMatch(source,/sendChat\(|sendMessage\(/);
  assert.match(source,/rpc\('copy'/);
});

test('call input shares STT configuration and the existing call turn, with mute and session guards',()=>{
  assert.match(source,/rpc\('callRecord'\)/);
  assert.match(source,/rpc\('cancelCall'\)/);
  assert.match(source,/callPhase==='connected'&&!callMuteOn&&!document.hidden/);
  assert.match(source,/job.session!==callLog/);
  assert.match(source,/callSay\(\)/);
  assert.match(source,/callBusy\|\|!!callAudio/);
  const native=fs.readFileSync('app/src/main/java/com/xiaoai/phone/SpeechInput.java','utf8');
  assert.match(native,/active.call="callRecord".equals\(action\)/);
  assert.match(native,/if\(!spoke&&now-callStarted>=12000\)/);
  assert.match(native,/if\(req.cancelled\)/);
});
