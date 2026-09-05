import type { SfxPref } from './prefs'

/**
 * Procedural SFX engine (night-juice): every cue is synthesized WebAudio —
 * no asset files, no licensing, and nothing to load. (The ambient music
 * loop is the one asset-backed sound, but it renders through this engine's
 * master bus — see `audio/music.ts`.) The engine is silent by
 * construction in environments without `AudioContext` (the vitest node env,
 * headless runs) — every entry point no-ops instead of throwing, so callers
 * never gate on availability. Cues are presentation-only: they never carry
 * game state and never name hidden information.
 *
 * Loops (ride rumble, footsteps, heartbeat) are idempotent: `start` while
 * running and `stop` while stopped are both no-ops, so phase-transition
 * watchers can call them every frame.
 */

/** Half a heartbeat (lub-dub gap) — the pair repeats at the caller's period. */
const HEARTBEAT_PAIR_MS = 190

/** Footstep cadence while climbing (presentation-only; ~7 steps / 3 s transit). */
const FOOTSTEP_MS = 430

export class SfxEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private muted = false
  private rumbleSource: AudioBufferSourceNode | null = null
  private rumbleGain: GainNode | null = null
  private footstepTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  private ensure(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null
    try {
      if (this.ctx === null) {
        this.ctx = new AudioContext()
        this.master = this.ctx.createGain()
        this.master.gain.value = this.muted ? 0 : 0.5
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended')
        this.ctx.resume().catch(() => {
          // Autoplay policy: the context runs after the first user gesture.
        })
      return this.ctx
    } catch {
      this.ctx = null
      return null
    }
  }

  private noise(): AudioBuffer | null {
    const ctx = this.ensure()
    if (ctx === null) return null
    if (this.noiseBuffer === null) {
      const len = Math.floor(ctx.sampleRate)
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = this.noiseBuffer.getChannelData(0)
      let last = 0
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1
        last = (last + 0.02 * white) / 1.02
        data[i] = last * 3.5
      }
    }
    return this.noiseBuffer
  }

  /** One enveloped oscillator voice through the master bus. */
  private tone(
    freq: number,
    seconds: number,
    peak: number,
    type: OscillatorType = 'sine',
    atSec = 0,
    endFreq?: number,
  ): void {
    const ctx = this.ensure()
    if (ctx === null || this.master === null) return
    try {
      const t0 = ctx.currentTime + atSec
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.setValueAtTime(freq, t0)
      if (endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + seconds)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds)
      osc.connect(gain)
      gain.connect(this.master)
      osc.start(t0)
      osc.stop(t0 + seconds + 0.05)
    } catch {
      // Synthesis failure stays silent — cues are never load-bearing.
    }
  }

  /** One enveloped filtered-noise voice through the master bus. */
  private hiss(
    seconds: number,
    peak: number,
    filterHz: number,
    atSec = 0,
    endFilterHz?: number,
    kind: BiquadFilterType = 'bandpass',
  ): void {
    const ctx = this.ensure()
    const buffer = this.noise()
    if (ctx === null || this.master === null || buffer === null) return
    try {
      const t0 = ctx.currentTime + atSec
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.loop = true
      const filter = ctx.createBiquadFilter()
      filter.type = kind
      filter.frequency.setValueAtTime(filterHz, t0)
      if (endFilterHz !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(endFilterHz, t0 + seconds)
      }
      filter.Q.value = 1.2
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds)
      src.connect(filter)
      filter.connect(gain)
      gain.connect(this.master)
      src.start(t0)
      src.stop(t0 + seconds + 0.05)
    } catch {
      // Silent on failure.
    }
  }

  /** Master mute (the DOM toggle); safe before first audio use. */
  setMuted(muted: boolean): void {
    this.muted = muted
    try {
      this.master?.gain.setValueAtTime(muted ? 0 : 0.5, this.ctx?.currentTime ?? 0)
    } catch {
      // No live context yet: the flag applies at first ensure().
    }
  }

  applyPref(pref: SfxPref): void {
    this.setMuted(pref === 'off')
  }

  /**
   * Bus for the ambient music loop (`audio/music.ts`): the shared context
   * and master gain, so the mute toggle governs music and cues together.
   * Returns null outside browsers.
   */
  musicBus(): { context: AudioContext; destination: AudioNode } | null {
    const ctx = this.ensure()
    if (ctx === null || this.master === null) return null
    return { context: ctx, destination: this.master }
  }

  // --- Elevator cues (the arcade-confident half of the hybrid tone) ---

  /** Hall call accepted anywhere in the building: a short two-note blip. */
  callBlip(): void {
    this.tone(880, 0.09, 0.05)
    this.tone(1320, 0.12, 0.05, 'sine', 0.1)
  }

  /** Car arrived at a floor: the two-partial bell ding. */
  arrivalDing(): void {
    this.tone(1568, 0.65, 0.11)
    this.tone(1568 * 2.76, 0.4, 0.03)
  }

  /** Door swing open: a soft rising whoosh a beat after the ding. */
  doorWhoosh(): void {
    this.hiss(0.32, 0.07, 420, 0, 1500)
  }

  /** Door close: low thunk + a tiny mechanical click. */
  doorThunk(): void {
    this.tone(82, 0.16, 0.14)
    this.hiss(0.05, 0.05, 2400, 0.02, undefined, 'highpass')
  }

  /** In-car floor button: a crisp click. */
  buttonClick(): void {
    this.tone(2000, 0.045, 0.045, 'square')
  }

  // --- Stairwell cues (the dread half) ---

  /** One footfall: a dull band-passed knock with slight random pitch. */
  private footstep(): void {
    const hz = 140 + Math.random() * 70
    this.hiss(0.07, 0.11, hz, 0, hz * 0.55)
    this.tone(hz * 0.5, 0.06, 0.05)
  }

  footstepNow(): void {
    this.footstep()
  }

  footstepStart(): void {
    if (this.footstepTimer !== null) return
    this.ensure()
    if (this.ctx === null) return
    this.footstep()
    this.footstepTimer = setInterval(() => this.footstep(), FOOTSTEP_MS)
  }

  footstepStop(): void {
    if (this.footstepTimer === null) return
    clearInterval(this.footstepTimer)
    this.footstepTimer = null
  }

  /** Arrival breath: a soft filtered exhale. */
  breathExhale(): void {
    this.hiss(0.55, 0.055, 900, 0, 260, 'lowpass')
  }

  /** The ambush lands: a dissonant detuned-beat sting plus an impact burst. */
  ambushSting(): void {
    this.tone(98, 0.55, 0.13, 'sawtooth')
    this.tone(103.5, 0.55, 0.13, 'sawtooth')
    this.hiss(0.18, 0.16, 310, 0, 90, 'lowpass')
    this.tone(55, 0.3, 0.16)
  }

  /** Repeating lub-dub heartbeat while stunned; `periodMs` is the repeat gap. */
  heartbeatStart(periodMs: number): void {
    if (this.heartbeatTimer !== null) return
    this.ensure()
    if (this.ctx === null) return
    const beat = () => {
      this.tone(58, 0.12, 0.1)
      this.tone(52, 0.14, 0.09, 'sine', HEARTBEAT_PAIR_MS / 1000)
    }
    beat()
    this.heartbeatTimer = setInterval(beat, periodMs)
  }

  heartbeatStop(): void {
    if (this.heartbeatTimer === null) return
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  // --- Loops ---

  /** Car ride rumble: a looped low-passed noise bed, riders only. */
  rumbleStart(): void {
    if (this.rumbleSource !== null) return
    const ctx = this.ensure()
    const buffer = this.noise()
    if (ctx === null || this.master === null || buffer === null) return
    try {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.loop = true
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 110
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.25)
      src.connect(filter)
      filter.connect(gain)
      gain.connect(this.master)
      src.start()
      this.rumbleSource = src
      this.rumbleGain = gain
    } catch {
      // Silent on failure.
    }
  }

  rumbleStop(): void {
    const src = this.rumbleSource
    const gain = this.rumbleGain
    this.rumbleSource = null
    this.rumbleGain = null
    if (src === null || gain === null || this.ctx === null) return
    try {
      gain.gain.cancelScheduledValues(this.ctx.currentTime)
      gain.gain.setValueAtTime(gain.gain.value, this.ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.2)
      src.stop(this.ctx.currentTime + 0.25)
    } catch {
      // The source may already be stopped.
    }
  }

  /** The saboteur's private confirmation: one sub-bass thump, felt not heard. */
  subThump(): void {
    this.tone(50, 0.35, 0.18)
  }

  /** Halt every loop (visit ended, round ended, scene shutdown). */
  stopAll(): void {
    this.footstepStop()
    this.heartbeatStop()
    this.rumbleStop()
  }
}

/** The app-wide engine singleton (silent no-op outside browsers). */
export const sfx = new SfxEngine()
