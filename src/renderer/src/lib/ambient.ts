import { useEffect, useState } from 'react'

// generated live: no audio files, never loops audibly. warm detuned pads (PS4 menu)
// under a high shimmer and the odd soft bell, in a long reverb (space)

// open voicings, no minor-key turns: calm, not cinematic
const CHORDS = [
  [50, 57, 64, 66], // D add9
  [47, 54, 62, 64], // Bm add11
  [43, 50, 57, 66], // G maj7
  [45, 52, 59, 61], // A add9
  [48, 55, 62, 64] // C add9 (borrowed, the "space" colour)
]
// D major pentatonic, two octaves up
const BELL_NOTES = [74, 76, 78, 81, 83, 86, 88, 90]

const CHORD_SECONDS: [number, number] = [26, 40]
const ATTACK = 7
const FIRST_ATTACK = 1.5
const PAD_LEVEL = 0.11
const RELEASE = 10
const BELL_GAP: [number, number] = [12, 30]
const FADE_IN = 1.5
const FADE_OUT = 2.5
const DUCK_OUT = 0.35
const DUCK_IN = 3
// the slider is decibels: equal steps sound equal. 0 is silence, 100 is MAX_GAIN
const VOLUME_RANGE_DB = 24
const MAX_GAIN = 2

// the engine's output, for the visualiser: it shows Vitra's own ambience from
// here instead of from all PC audio. null while silent (a suspended context
// freezes an analyser on its last frame)
export const ambientAnalyser: { current: AnalyserNode | null } = { current: null }

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)
const between = ([lo, hi]: [number, number]): number => lo + Math.random() * (hi - lo)

// stereo noise with an exponential tail, darkened as it decays
function impulse(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let low = 0
    for (let i = 0; i < length; i++) {
      const t = i / length
      // one-pole lowpass that closes over the tail
      const k = 0.5 - 0.42 * t
      low += k * (Math.random() * 2 - 1 - low)
      data[i] = low * (1 - t) ** 2.4
    }
  }
  return buffer
}

class Ambient {
  private context: AudioContext
  private master: GainNode
  private dry: GainNode
  private wet: GainNode
  private timers: ReturnType<typeof setTimeout>[] = []
  private suspendTimer: ReturnType<typeof setTimeout> | undefined
  private chord = 0
  private running = false
  private ducked = false
  private volume = 0.4
  private analyser: AnalyserNode

  constructor() {
    this.context = new AudioContext()
    const ctx = this.context
    this.master = ctx.createGain()
    this.master.gain.value = 0

    // a ceiling only: at -24/3 it flattened the top half of the volume slider
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -8
    compressor.ratio.value = 2
    compressor.attack.value = 0.5
    compressor.release.value = 1
    this.master.connect(compressor).connect(ctx.destination)
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.72
    compressor.connect(this.analyser)

    const reverb = ctx.createConvolver()
    reverb.buffer = impulse(ctx, 7)
    this.wet = ctx.createGain()
    this.wet.gain.value = 0.75
    this.wet.connect(reverb).connect(this.master)
    this.dry = ctx.createGain()
    this.dry.gain.value = 0.35
    this.dry.connect(this.master)

    this.drone()
    this.air()
  }

  onState(listener: (state: string) => void): void {
    this.context.onstatechange = () => listener(this.context.state)
    listener(this.context.state)
  }

  setVolume(volume: number): void {
    const v = Math.max(0, Math.min(100, volume)) / 100
    this.volume = v === 0 ? 0 : MAX_GAIN * 10 ** ((-VOLUME_RANGE_DB * (1 - v)) / 20)
    if (this.running && !this.ducked) this.ramp(this.volume, 0.4)
  }

  // out of the way of another sound (big picture's), then back
  duck(on: boolean): void {
    if (on === this.ducked) return
    this.ducked = on
    if (this.running) this.ramp(on ? 0 : this.volume, on ? DUCK_OUT : DUCK_IN)
  }

  play(): void {
    if (this.running) return
    this.running = true
    clearTimeout(this.suspendTimer)
    this.context.resume().catch((err: Error) => console.warn('[ambient] could not start:', err.message))
    ambientAnalyser.current = this.analyser
    this.ramp(this.ducked ? 0 : this.volume, FADE_IN)
    // resumed mid-fade: the chords are still going
    if (this.timers.length) return
    // the first chord arrives quickly, so switching it on is heard straight away
    this.nextChord(FIRST_ATTACK)
    this.timers.push(setTimeout(() => this.nextBell(), between(BELL_GAP) * 300))
  }

  // fades, then suspends: a suspended context costs nothing. also from a
  // never-played engine, so a fresh context doesn't sit rendering silence
  pause(): void {
    if (this.running) this.ramp(0, FADE_OUT)
    this.running = false
    clearTimeout(this.suspendTimer)
    this.suspendTimer = setTimeout(() => {
      this.timers.forEach(clearTimeout)
      this.timers = []
      if (ambientAnalyser.current === this.analyser) ambientAnalyser.current = null
      void this.context.suspend()
    }, FADE_OUT * 1000 + 200)
  }

  close(): void {
    this.context.onstatechange = null
    if (ambientAnalyser.current === this.analyser) ambientAnalyser.current = null
    this.timers.forEach(clearTimeout)
    clearTimeout(this.suspendTimer)
    void this.context.close()
  }

  private ramp(to: number, seconds: number): void {
    const gain = this.master.gain
    const now = this.context.currentTime
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(to, now + seconds)
  }

  // slow sine wobble on a param, seconds per cycle
  private lfo(param: AudioParam, depth: number, period: number): OscillatorNode {
    const ctx = this.context
    const osc = ctx.createOscillator()
    osc.frequency.value = 1 / period
    const amount = ctx.createGain()
    amount.gain.value = depth
    osc.connect(amount).connect(param)
    osc.start(ctx.currentTime + Math.random() * period)
    return osc
  }

  private nextChord(attack = ATTACK): void {
    // a step to a neighbour, never a jump across the set
    const step = Math.random() < 0.5 ? 1 : CHORDS.length - 1
    this.chord = (this.chord + step) % CHORDS.length
    const hold = between(CHORD_SECONDS)
    for (const note of CHORDS[this.chord]) this.padVoice(note, hold, attack)
    this.timers.push(setTimeout(() => this.nextChord(), hold * 1000))
  }

  private padVoice(note: number, hold: number, attack: number): void {
    const ctx = this.context
    const now = ctx.currentTime
    const end = now + attack + hold + RELEASE

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 650 + Math.random() * 250
    filter.Q.value = 0.6
    const filterLfo = this.lfo(filter.frequency, 280, 18 + Math.random() * 14)

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0, now)
    envelope.gain.linearRampToValueAtTime(PAD_LEVEL, now + attack)
    envelope.gain.setValueAtTime(PAD_LEVEL, now + attack + hold)
    envelope.gain.linearRampToValueAtTime(0, end)

    const pan = ctx.createStereoPanner()
    pan.pan.value = Math.random() * 1.2 - 0.6
    const panLfo = this.lfo(pan.pan, 0.25, 24 + Math.random() * 20)

    filter.connect(envelope).connect(pan)
    pan.connect(this.dry)
    pan.connect(this.wet)

    // two saws a few cents apart: the slow chorus is most of the warmth
    const oscillators = [-6, 6].map((cents) => {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = hz(note)
      osc.detune.value = cents + Math.random() * 3
      osc.connect(filter)
      osc.start(now)
      osc.stop(end)
      return osc
    })

    // the shimmer: the same note two octaves up, quiet, reverb only
    const shimmer = ctx.createOscillator()
    shimmer.type = 'sine'
    shimmer.frequency.value = hz(note + 24)
    const shimmerGain = ctx.createGain()
    shimmerGain.gain.setValueAtTime(0, now)
    shimmerGain.gain.linearRampToValueAtTime(0.012, now + attack * 1.5)
    shimmerGain.gain.linearRampToValueAtTime(0, end)
    this.lfo(shimmerGain.gain, 0.004, 9 + Math.random() * 6).stop(end)
    shimmer.connect(shimmerGain).connect(this.wet)
    shimmer.start(now)
    shimmer.stop(end)

    filterLfo.stop(end)
    panLfo.stop(end)
    oscillators[0].addEventListener('ended', () => {
      filter.disconnect()
      envelope.disconnect()
      pan.disconnect()
      shimmerGain.disconnect()
    })
  }

  private nextBell(): void {
    const ctx = this.context
    const now = ctx.currentTime
    const note = BELL_NOTES[Math.floor(Math.random() * BELL_NOTES.length)]
    const pan = ctx.createStereoPanner()
    pan.pan.value = Math.random() * 1.4 - 0.7
    const bus = ctx.createGain()
    bus.gain.value = 0.9
    bus.connect(pan)
    pan.connect(this.wet)
    pan.connect(this.dry)

    // soft partials, nothing inharmonic: a glass tone, not a gong
    for (const [ratio, level, decay] of [
      [1, 0.09, 5.5],
      [2, 0.022, 3.5],
      [3, 0.007, 2]
    ]) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = hz(note) * ratio
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(level, now + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decay)
      osc.connect(gain).connect(bus)
      osc.start(now)
      osc.stop(now + decay + 0.1)
    }
    setTimeout(() => {
      bus.disconnect()
      pan.disconnect()
    }, 6000)
    this.timers.push(setTimeout(() => this.nextBell(), between(BELL_GAP) * 1000))
  }

  // a low sine an octave under the key, always there, breathing slowly
  private drone(): void {
    const ctx = this.context
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = hz(38)
    const gain = ctx.createGain()
    gain.gain.value = 0.05
    this.lfo(gain.gain, 0.02, 30)
    osc.connect(gain).connect(this.dry)
    osc.start()
  }

  // filtered noise drifting through the highs: the "space" in the room
  private air(): void {
    const ctx = this.context
    const length = ctx.sampleRate * 4
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    noise.loop = true
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 2400
    band.Q.value = 1.2
    this.lfo(band.frequency, 1200, 40)
    const gain = ctx.createGain()
    gain.gain.value = 0.006
    this.lfo(gain.gain, 0.004, 26)
    noise.connect(band).connect(gain).connect(this.wet)
    noise.start()
  }
}

// plays while `active`; the engine is only built once it's first wanted.
// returns the audio context's state ('running' = audible), for Settings
export function useAmbient(
  enabled: boolean,
  active: boolean,
  volume: number,
  ducked = false
): string | undefined {
  const [engine, setEngine] = useState<Ambient | null>(null)
  const [state, setState] = useState<string>()

  useEffect(() => {
    if (!enabled) return
    const next = new Ambient()
    next.onState(setState)
    setEngine(next)
    return () => {
      next.close()
      setEngine(null)
      setState(undefined)
    }
  }, [enabled])

  useEffect(() => engine?.setVolume(volume), [engine, volume])
  useEffect(() => engine?.duck(ducked), [engine, ducked])

  useEffect(() => {
    if (!engine) return
    if (active) engine.play()
    else engine.pause()
  }, [engine, active])

  return state
}

// visible = not minimised or in the tray; focus doesn't matter, it plays under other windows
export function useWindowVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const update = (): void => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}
