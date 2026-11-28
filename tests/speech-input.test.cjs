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
