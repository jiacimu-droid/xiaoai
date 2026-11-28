(() => {
  'use strict'
  const APP='https://appassets.androidplatform.net', STAGE='https://live2d.xiaoai.invalid'
  const root=document.getElementById('stage')
  let mode='hand',zone='',initial=null,pointer=null,ready=false
  const call=(name,...args)=>window.LuluLive2D?.[name]?.(...args)
  const post=data=>parent.postMessage(data,APP)
  function viewport(){
    const d=window.devicePixelRatio||1
    const v={width:Math.max(1,Math.round(innerWidth*d)),height:Math.max(1,Math.round(innerHeight*d))}
    window.__luluNativeViewport=v
    call('setViewport',v.width,v.height)
  }
  window.addEventListener('resize',viewport);viewport()
  window.addEventListener('xa-live2d-state',event=>{
    const d=event.detail||{}
    ready=d.phase==='ready'
    if(ready&&initial)call('setTouchCalibration',initial.calibration||{})
    post({type:'xa-live2d-state',phase:d.phase,message:d.message})
  })
  window.addEventListener('xa-live2d-capabilities',event=>{
    if(ready&&Array.isArray(event.detail?.parameters))post({type:'xa-live2d-capabilities',parameters:event.detail.parameters})
  })
  window.addEventListener('message',event=>{
    if(event.origin!==APP||event.source!==parent||!event.data||typeof event.data!=='object')return
    const d=event.data
    switch(d.type){
      case 'init':
        if(typeof d.model!=='string'||!d.model.startsWith(STAGE+'/private/models/'))return
        initial=d;mode=['hand','kiss','pat'].includes(d.mode)?d.mode:'hand';window.__luluStageModelUrl=d.model
        window.__luluFramingMode=d.framing==='call'?'call':'full'
        call('setFramingMode',window.__luluFramingMode)
        viewport()
        if(window.LuluLive2D)call('load',d.model)
        break
      case 'update':call('update',d.state);break
      case 'event':call('onPlaybackEvent',d.event,0,d.sequence,'');break
      case 'perform':call('perform',d.cue,!!d.immediate);break
      case 'motion':{const m=d.motion||d;call('motion',m.group,m.index,true,'manual');break}
      case 'expression':call('expression',d.name,true);break
      case 'mode':mode=String(d.mode||'hand');break
      case 'calibrationMode':zone=String(d.zone||'');call('setCalibrationSelection',zone);call('setCalibrationMode',!!zone);break
      case 'clearCalibration':call('clearTouchCalibration');post({type:'xa-live2d-calibration',calibration:{}});break
      case 'pause':call('setPaused',true);break
    }
  })
  function pos(e){const r=root.getBoundingClientRect();return {x:Math.min(1,Math.max(0,(e.clientX-r.left)/Math.max(1,r.width))),y:Math.min(1,Math.max(0,(e.clientY-r.top)/Math.max(1,r.height)))}}
  root.addEventListener('pointerdown',e=>{
    if(!ready||pointer)return
    e.preventDefault()
    const p=pos(e)
    if(zone){const result=call('calibrateTouch',p.x,p.y,zone);if(result?.calibration)post({type:'xa-live2d-calibration',calibration:result.calibration});return}
    pointer={id:e.pointerId,x:p.x,y:p.y,time:performance.now(),gesture:'tap'}
    try{root.setPointerCapture?.(e.pointerId)}catch(_){}
    call('touch',p.x,p.y,'down',{phase:'start',mode,force:.55})
  })
  root.addEventListener('pointermove',e=>{
    if(!pointer||pointer.id!==e.pointerId)return
    e.preventDefault()
    const p=pos(e),dx=p.x-pointer.x,dy=p.y-pointer.y
    if(Math.hypot(dx,dy)>.025)pointer.gesture=Math.abs(dx)>Math.abs(dy)?(dx>0?'stroke-right':'stroke-left'):(dy>0?'stroke-down':'stroke-up')
    call('touch',p.x,p.y,pointer.gesture==='tap'?'hold':pointer.gesture,{phase:'move',mode,force:.55})
  })
  root.addEventListener('pointerup',e=>{
    if(!pointer||pointer.id!==e.pointerId)return
    const p=pos(e),g=pointer.gesture==='tap'&&performance.now()-pointer.time>520?'hold':pointer.gesture
    const durationMs=Math.round(performance.now()-pointer.time)
    pointer=null
    const hit=call('touch',p.x,p.y,g,{phase:'complete',mode,force:.55})
    if(hit?.hit===true&&typeof hit.region==='string')post({type:'xa-live2d-touch',region:hit.region,gesture:hit.gesture,mode,durationMs})
  })
  const cancel=()=>{if(!pointer)return;pointer=null;call('touch',0,0,'cancel',{mode})}
  root.addEventListener('pointercancel',cancel)
  root.addEventListener('lostpointercapture',cancel)
  window.addEventListener('blur',cancel)
})()
