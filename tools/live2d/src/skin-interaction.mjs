// Generic data-only interaction interpreter. All model-specific numbers and
// registered motion IDs come from the imported skin, never from its filename.
import { impactEnvelope, touchRestScale } from './touch-reflex.mjs'
const finite = (v, fallback = 0, lo = -10000, hi = 10000) =>
  Number.isFinite(v) && v >= lo && v <= hi ? v : fallback
const clamp = v => Math.max(0, Math.min(1, finite(v)))
const smooth = v => { const t = clamp(v); return t * t * (3 - 2 * t) }
const pair = (v, x) => finite(v?.[0]) + finite(v?.[1]) * x
const ease = (t, v) => smooth((t - finite(v?.[0], 0, 0, 30000)) /
  finite(v?.[1], 1, 1, 30000))
const validMotion = (v, available) => Number.isInteger(v) && v >= 0 && available.has(v)
export function createSkinInteraction(profile, available = new Set()) {
  const group = typeof profile?.motionGroup === 'string' ? profile.motionGroup : ''
  const touch = profile?.touch
  const camera = value => value && validMotion(value.index, available) &&
    Number.isFinite(value.durationMs) && value.durationMs >= 100 && value.durationMs <= 30000 &&
    Number.isFinite(value.peakZoom) && value.peakZoom > 1 && value.peakZoom <= 4 ? value : null
  const kiss = camera(profile?.proximity?.kiss)
  const approach = camera(profile?.proximity?.approach)
  const kissIndex = kiss?.index ?? -1
  const approachIndex = approach?.index ?? -1
  const spec = i => i === kissIndex && kiss ? kiss : i === approachIndex ? approach : null
  const finished = { zoom: 1, finished: true }
  const inTime = (t,p) => p && Number.isFinite(t) && t >= 0 && t < p.durationMs
  const peak = i => spec(i)?.peakZoom ?? 1
  function screenProximityFrame(i,t) {
    const p = spec(i)
    if (!inTime(t,p)) return finished
    const a = ease(t,p.approach), d = 1 - ease(t,p.withdraw)
    const contact = ease(t,p.contactIn) * (1 - ease(t,p.contactOut))
    const gain = i === kissIndex
      ? finite(p.zoomBaseGain, p.peakZoom-1, 0, 3)*a + finite(p.zoomContactGain,0,0,3)*contact
      : (p.peakZoom-1)*a
    return {zoom: Math.min(p.peakZoom,1+gain*d),finished:false}
  }
  function kissFaceFrame(t) {
    if (!inTime(t,kiss)) return null
    const p=kiss, close=ease(t,p.closeIn)*(1-ease(t,p.closeOut))
    const contact=ease(t,p.contactIn)*(1-ease(t,p.contactOut))
    const pucker=ease(t,p.puckerIn)*(1-ease(t,p.puckerOut))*
      clamp(finite(p.puckerBase)+finite(p.puckerContactGain)*contact)
    return {face:{eyeOpen:clamp(pair(p.eyeOpen,close)),eyeSmile:clamp(pair(p.eyeSmile,close)),
      smile:Math.max(-1,Math.min(1,pair(p.smile,pucker))),pout:clamp(pair(p.pout,pucker)),
      jawOpen:clamp(finite(p.jawOpen))},pucker}
  }
  function kissNuzzleFrame(t) {
    if (!inTime(t,kiss)) return null
    const p=kiss, strength=ease(t,p.nuzzleIn)*(1-ease(t,p.nuzzleOut))
    if(strength<=.001)return null
    const phase=2*Math.PI*(t-finite(p.nuzzlePhaseStartMs))/finite(p.nuzzlePeriodMs,1,1,30000)
    return {yaw:finite(p.nuzzleYaw)*Math.sin(phase)*strength,
      roll:finite(p.nuzzleRoll)*Math.sin(phase+finite(p.nuzzleRollPhase))*strength,
      pitch:finite(p.nuzzlePitch)*strength}
  }
  function kissHandoffFrame(startZoom,t) {
    const duration=finite(kiss?.handoffMs,1000,1,30000)
    return !Number.isFinite(startZoom)||startZoom<1||!Number.isFinite(t)||t>=duration
      ? finished : {zoom:1+(startZoom-1)*(1-smooth(t/duration)),finished:false}
  }
  const validBase = b => b && [b.x,b.y,b.width,b.height,b.scale].every(Number.isFinite) &&
    b.width>0 && b.height>0 && b.scale>0
  const validBounds = b => b && [b.x,b.y,b.width,b.height].every(Number.isFinite) && b.width>0 && b.height>0
  const validCoord = x => Number.isFinite(x)&&x>=0&&x<=1
  function kissMouthLocalOffsetX(base,bounds,zone) {
    if(!validBase(base))return 0
    const fallback=base.width*finite(kiss?.fallbackMouthX,0,-.6,.6)/base.scale
    if(!validBounds(bounds)||!validCoord(zone?.u))return fallback
    const offset=bounds.x+zone.u*bounds.width-base.x
    return Math.abs(offset)<base.width*.6?offset/base.scale:fallback
  }
  function screenFaceLocalOffsetX(base,bounds,calibration={}) {
    const eyes=[calibration['eye-left'],calibration['eye-right']].map(z=>z?.u).filter(validCoord)
    if(validBase(base)&&validBounds(bounds)&&eyes.length){
      const offset=bounds.x+eyes.reduce((a,b)=>a+b,0)/eyes.length*bounds.width-base.x
      if(Math.abs(offset)<base.width*.6)return offset/base.scale
    }
    return kissMouthLocalOffsetX(base,bounds,calibration.mouth)
  }
  function kissFaceLocalOffsetY(base,bounds,calibration={}) {
    if(!validBase(base))return 0
    const eyes=[calibration['eye-left'],calibration['eye-right']].map(z=>z?.v).filter(validCoord)
    let y=base.height*.30
    if(validBounds(bounds)){
      const v=eyes.length?eyes.reduce((a,b)=>a+b,0)/eyes.length:
        validCoord(calibration.mouth?.v)?Math.max(0,calibration.mouth.v-finite(kiss?.mouthToEyesOffset,0,0,1)):
          finite(kiss?.fallbackFaceY,.25,0,1)
      y=bounds.y+v*bounds.height
    }
    return (y-base.y)/base.scale
  }
  const closeness=(zoom,peakZoom)=>clamp((zoom-1)/Math.max(.01,peakZoom-1))
  function kissCameraHorizontalPosition(base,zoom,localX,peakZoom=1) {
    if(!validBase(base)||!Number.isFinite(zoom)||zoom<1||!Number.isFinite(localX))return base?.x??0
    const x=base.x+localX*base.scale
    return base.x+(1-zoom)*(x-base.x)+closeness(zoom,peakZoom)*(base.width*.5-x)
  }
  function kissCameraVerticalPosition(base,zoom,localY,peakZoom=1) {
    if(!validBase(base)||!Number.isFinite(zoom)||zoom<1||!Number.isFinite(localY))return base?.y??0
    const y=base.y+localY*base.scale
    return base.y+(1-zoom)*(y-base.y)+closeness(zoom,peakZoom)*(base.height*finite(kiss?.faceTargetY,.5,0,1)-y)
  }
  function enhanceTouch(base,region,gesture,state={},elapsed=0) {
    if(!base||!region||!gesture||!touch)return base
    const pose={...base,body:{...base.body},face:{...base.face},parameters:{...base.parameters}}
    const force=clamp(state.force??.55),rest=touchRestScale(gesture,state.motionIdleMs)
    const right=/-right$/.test(gesture),left=/-left$/.test(gesture)
    const side=region.endsWith('-left')?-1:region.endsWith('-right')?1:0
    const travel=right?1:left?-1:side||1,family=region.replace(/-(?:left|right)$/,'')
    const p=touch.impact
    if(p&&/^slap(?:-(?:left|right))?$/.test(gesture)){
      const envelope=impactEnvelope(elapsed),dir=right||left?travel:family==='cheek'&&side!==0?side:-side||-1
      if(family==='cheek'||family==='mouth'){
        pose.roll=dir*pair(p.headRoll,force)*envelope
        pose.yaw=dir*pair(p.headYaw,force)*envelope
        pose.pitch=pair(p.headPitch,force)*envelope
        pose.body.roll=dir*pair(p.bodyRoll,force)*envelope*
          (finite(p.bodyInitialMix)+finite(p.bodyDelayedMix)*clamp((elapsed-finite(p.bodyDelayMs))/finite(p.bodyRampMs,1,1,30000)))
        pose.body.yaw=dir*pair(p.bodyYaw,force)*envelope
      }
      if(family==='cheek'){
        pose.face.cheekPuff=elapsed<finite(p.cheekInitialMs)?finite(p.cheekPuffInitial):pair(p.cheekPuffRest,force)
        pose.face.mouthX=dir*pair(p.cheekMouthX,force)*envelope
        pose.face[side<0?'browLeftY':'browRightY']=elapsed<finite(p.cheekInitialMs)?finite(p.browInitial):finite(p.browRest)
      }
    }else if(touch.stroke&&['hair','forehead','ear','beast-ear'].includes(family)&&(/^stroke/.test(gesture)||gesture==='hold')){
      const ear=family==='ear'||family==='beast-ear',v=ear?touch.stroke.ear:touch.stroke.hair
      if(v){
        const strength=pair(touch.stroke.strength,force)*rest
        pose.roll=travel*finite(v.headRoll)*strength;pose.yaw=travel*finite(v.headYaw)*strength
        pose.body.roll=travel*finite(v.bodyRoll)*strength;pose.body.yaw=travel*finite(v.bodyYaw)*strength
        if(ear)pose.face[side<0?'browLeftY':'browRightY']=pair(v.brow,force)
      }
    }else if(family==='cheek'&&gesture!=='kiss'&&touch.cheek){
      const v=touch.cheek
      pose.face.cheekPuff=Math.max(pose.face.cheekPuff??0,pair(v.puff,force))
      pose.face.pout=Math.max(pose.face.pout??0,finite(v.pout))
      pose.face.mouthX=(side||travel)*pair(v.mouthX,force)
      pose.roll+=(side||travel)*finite(v.roll)*rest
    }else if(family==='nose'&&gesture!=='kiss'&&touch.nose){
      pose.face.cheekPuff=Math.max(finite(touch.nose.puff),pose.face.cheekPuff??0)
      pose.face.browLeftY=finite(touch.nose.browLeftY)
    }else if(family==='mouth'&&gesture!=='kiss'&&touch.mouth){
      pose.face.cheekPuff=Math.max(finite(touch.mouth.puff),pose.face.cheekPuff??0)
      pose.face.pout=Math.max(finite(touch.mouth.pout),pose.face.pout??0)
      if(right||left)pose.face.mouthX=travel*pair(touch.mouth.mouthX,force)
    }
    return pose
  }
  let angle=0
  const recoil=touch?.displayRecoil
  const impactPresentation={
    reset(model){angle=0;if(model)model.rotation=0},
    update(model,pose,deltaMs){
      if(!model||!recoil)return
      const roll=pose?.impactMotion?finite(pose.roll):0,torso=pose?.impactMotion?finite(pose.body?.roll):0
      const direction=Math.sign(roll||torso),max=finite(recoil.maxRadians,0,0,.1)
      const target=pose?.impactFace&&direction?direction*Math.min(max,Math.abs(roll)/finite(recoil.referenceRoll,30,1,360)*max):0
      const attacking=Math.abs(target)>Math.abs(angle)&&Math.sign(target)===Math.sign(angle||target)
      const tau=attacking?finite(recoil.attackMs,50,1,5000):finite(recoil.releaseMs,260,1,5000)
      angle+=(target-angle)*(1-Math.exp(-finite(deltaMs,0,0,60)/tau))
      if(!target&&Math.abs(angle)<finite(recoil.epsilon,.00025,0,.1))angle=0
      model.rotation=angle
    }
  }
  function touchMotionFor(region,gesture,state={}){
    if(!group||!Array.isArray(profile?.touchMotionRules)||/^slap/.test(gesture))return null
    const family=region?.replace(/-(?:left|right)$/,''),side=region?.endsWith('-left')?-1:region?.endsWith('-right')?1:0
    const travel=gesture?.endsWith('-left')?-1:gesture?.endsWith('-right')?1:side
    for(const rule of profile.touchMotionRules.slice(0,128)){
      if(!Array.isArray(rule?.regions)||!rule.regions.includes(family)||
        !(rule.gesture===gesture||(rule.gesture==='stroke'&&gesture?.startsWith('stroke')))||
        clamp(state.force??.55)<finite(rule.minForce,0,0,1))continue
      const i=rule.index??((travel||side||-1)<0?rule.leftIndex:rule.rightIndex)
      if(validMotion(i,available))return {group,index:i}
    }
    return null
  }
  return {group,kissIndex,approachIndex,lipWidthGain:finite(kiss?.lipWidthGain,0,-30,30),
    screenProximityFrame,screenProximityDuration:i=>spec(i)?.durationMs??0,
    screenProximityPeak:peak,isScreenProximityMotion:i=>!!spec(i),
    kissFaceFrame,kissNuzzleFrame,kissHandoffFrame,kissMouthLocalOffsetX,
    screenFaceLocalOffsetX,kissFaceLocalOffsetY,kissCameraHorizontalPosition,
    kissCameraVerticalPosition,enhanceTouch,touchMotionFor,impactPresentation}
}
