// Optional actuation of mouth channels present in the imported Cubism rig.
// Audio amplitude is not phoneme recognition: preserve selected smile/face.
// Imported profile values are bounded before entering a per-frame actuator.
export function normalizeSpeechMouthProfile(value) {
  if (!value || typeof value !== 'object' || !value.parameters ||
      typeof value.parameters !== 'object') return null
  const result = { parameters: Object.create(null) }
  for (const [key, bounds] of Object.entries({
    attackMs: [1, 5000], releaseMs: [1, 5000], restMs: [1, 5000],
    jawAttackMs: [1, 5000], jawReleaseMs: [1, 5000], jawGain: [0, 4],
    widthGain: [0, 30], funnelGain: [0, 4], shrugGain: [0, 4],
    fallbackBase: [0, 1], fallbackBeat: [0, 1],
  })) {
    const n = value[key]
    if (typeof n === 'number' && Number.isFinite(n) && n >= bounds[0] && n <= bounds[1])
      result[key] = n
  }
  for (const key of ['open', 'jaw', 'width', 'funnel', 'shrug']) {
    const id = value.parameters[key]
    if (typeof id === 'string' && id.length > 0 && id.length <= 128)
      result.parameters[key] = id
  }
  return result.parameters.open ? result : null
}
export function createSpeechMouthRuntime({ has, write }) {
  let open = 0, jaw = 0, width = 0, funnel = 0, shrug = 0, alive = false
  const clamp = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
  const follow = (value, goal, dt, rise, fall) =>
    value + (goal - value) * (1 - Math.exp(-dt / (goal > value ? rise : fall)))
  function reset() { open = jaw = width = funnel = shrug = 0; alive = false }
  function update(core, { deltaMs = 16, speaking = false, pcmAvailable = false,
    level = 0, elapsedMs = 0, seed = 0, blocked = false,
    jawOverride = null, poutOverride = null, skinProfile = null } = {}) {
    // The previous 50ms/frame cap slowed lip attack and release on 15Hz
    // native video mirrors. Exact exponential smoothing already remains
    // stable for long frames; use the full real elapsed render time.
    const dt = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0
    const profile = skinProfile
    const beat = Math.pow(Math.sin(Math.max(0, elapsedMs) * .0105 + seed), 2)
    const fallback = (profile?.fallbackBase ?? .24) +
      (profile?.fallbackBeat ?? .34) * beat
    const target = speaking && !blocked ? (pcmAvailable ? clamp(level) : fallback) : 0
    if (speaking || blocked || (Number.isFinite(jawOverride) && jawOverride > 0)) alive = true
    if (!alive) return
    // Exponential, frame-rate-independent attack and release.
    open = blocked ? 0 : follow(open, target, dt,
      profile?.attackMs ?? 54, speaking ? (profile?.releaseMs ?? 112) :
        (profile?.restMs ?? 175))
    jaw = follow(jaw, Math.max(open * (profile?.jawGain ?? .72),
      Number.isFinite(jawOverride) ? clamp(jawOverride) : 0), dt,
    profile?.jawAttackMs ?? 105, profile?.jawReleaseMs ?? 180)
    width = follow(width, speaking && !blocked ?
      open * (profile?.widthGain ?? .17) : 0, dt, 115, 170)
    funnel = follow(funnel, speaking && !blocked ?
      (profile?.funnelGain ?? .055) * (1 - open) : 0, dt, 135, 190)
    shrug = follow(shrug, speaking && !blocked ?
      open * (profile?.shrugGain ?? .045) : 0, dt, 120, 160)
    const ids = skinProfile ? skinProfile.parameters : {
      open: 'ParamMouthOpenY', jaw: 'ParamJawOpen', width: 'ParamMouthPuckerWiden',
      shrug: 'ParamMouthShrug', funnel: 'ParamMouthFunnel',
    }
    const outputs = [
      [ids.open, open], [ids.jaw, jaw], [ids.width, width], [ids.shrug, shrug],
    ]
    // The character's explicit pout beats speech articulation.
    if (poutOverride == null) outputs.push([ids.funnel, funnel])
    else if (speaking && !blocked)
      outputs.push([ids.funnel, Math.max(funnel, clamp(poutOverride))])
    for (const [id, value] of outputs) if (id && has(core, id)) write(core, id, value)
    if (!speaking && !blocked && !(jawOverride > 0) &&
        Math.max(open, jaw, width, funnel, shrug) < .007) reset()
  }
  return { update, reset }
}
