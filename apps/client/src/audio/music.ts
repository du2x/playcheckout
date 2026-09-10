import { type MidiNote, type MidiSong, parseMidi } from './music/parse'
import { type MusicTrack, TRACK_URLS } from './music/tracks'
import { sfx } from './sfx'

/**
 * Ambient music loops (user-directed, 2026-09-09): each cue (the night-shift
 * lobby loop, AD-057; the round tension loop) is a MIDI in `public/audio/`
 * parsed, synthesized once through an OfflineAudioContext, and played as a
 * gaplessly looping `AudioBuffer` — after the first render the runtime cost
 * is one buffer source per audible cue, identical in shape to the sfx
 * rumble loop. Every loop routes through the SFX engine's master bus, so the
 * existing mute toggle governs music too. The app requests a track on view
 * changes (tracks.ts) and running cues crossfade; view flips before a track
 * has rendered land when its render finishes. Presentation-only: the files
 * carry no game state. Silent no-op outside browsers and on any failure
 * (fetch, parse, render) — music is never load-bearing.
 */

/** Music gain into the shared sfx master (which itself runs at 0.7). */
const MUSIC_LEVEL = 1.0

/** Crossfade window between the lobby and round cues (500 ms). */
const FADE_SEC = 0.5

const RENDER_SAMPLE_RATE = 44100

/** Notes cut by the loop point fade out over this window to hide the seam. */
const SEAM_FADE_SEC = 0.02

/** Slight stereo placement per MIDI channel (drums stay centered). */
const PAN_BY_CHANNEL: Readonly<Record<number, number>> = { 0: 0, 1: -0.25, 2: 0.35, 3: 0.1, 9: 0 }

const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)

const velocityPeak = (velocity: number, voicePeak: number): number =>
  (velocity / 127) ** 1.5 * voicePeak

/** One attack-decay envelope; notes crossing the loop point fade at the seam. */
function envelope(
  ctx: BaseAudioContext,
  t0: number,
  attackSec: number,
  durSec: number,
  peak: number,
  loopSec: number,
): GainNode {
  const gain = ctx.createGain()
  const end = Math.min(t0 + Math.max(durSec, attackSec + SEAM_FADE_SEC), t0 + loopSec)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attackSec)
  gain.gain.exponentialRampToValueAtTime(0.0001, end)
  return gain
}

/** Connects a voice through a per-channel pan (best effort) to the bus. */
function wireVoice(ctx: BaseAudioContext, dest: AudioNode, channel: number): AudioNode {
  const pan = PAN_BY_CHANNEL[channel] ?? 0
  try {
    const panner = ctx.createStereoPanner()
    panner.pan.value = pan
    panner.connect(dest)
    return panner
  } catch {
    return dest
  }
}

interface OscillatorSpec {
  readonly type: OscillatorType
  /** Frequency as a ratio of the note frequency (detune cents for saw pairs). */
  readonly freqRatio: number
  readonly detuneCents: number
  readonly attackSec: number
  readonly peak: number
  readonly lowpassHz?: number
}

/**
 * GM-ish voice tables: the night-shift file uses acoustic bass (32),
 * e-piano (4), glockenspiel (9), strings (48) and channel-10 drums —
 * everything else falls back to the nearest family below.
 */
function voicesFor(note: MidiNote): OscillatorSpec[] {
  if (note.program >= 32 && note.program <= 39) {
    return [{ type: 'triangle', freqRatio: 1, detuneCents: 0, attackSec: 0.008, peak: 0.3 }]
  }
  if (note.program >= 40 && note.program <= 55) {
    return [
      {
        type: 'sawtooth',
        freqRatio: 1,
        detuneCents: -5,
        attackSec: 0.14,
        peak: 0.07,
        lowpassHz: 1500,
      },
      {
        type: 'sawtooth',
        freqRatio: 1,
        detuneCents: 5,
        attackSec: 0.14,
        peak: 0.07,
        lowpassHz: 1500,
      },
    ]
  }
  if (note.program >= 8 && note.program <= 15) {
    return [
      { type: 'sine', freqRatio: 1, detuneCents: 0, attackSec: 0.004, peak: 0.09 },
      { type: 'sine', freqRatio: 3.01, detuneCents: 0, attackSec: 0.004, peak: 0.03 },
    ]
  }
  if (note.program <= 7) {
    return [
      { type: 'sine', freqRatio: 1, detuneCents: 0, attackSec: 0.006, peak: 0.2 },
      { type: 'sine', freqRatio: 2, detuneCents: 0, attackSec: 0.006, peak: 0.05 },
    ]
  }
  return [{ type: 'triangle', freqRatio: 1, detuneCents: 0, attackSec: 0.008, peak: 0.16 }]
}

/** Schedules the whole song (one voice per oscillator spec per note). */
export function scheduleSong(
  ctx: BaseAudioContext,
  dest: AudioNode,
  song: MidiSong,
  loopSec: number,
): void {
  for (const note of song.notes) {
    if (note.channel === 9) {
      scheduleDrum(ctx, wireVoice(ctx, dest, 9), note, loopSec)
      continue
    }
    const bus = wireVoice(ctx, dest, note.channel)
    for (const spec of voicesFor(note)) {
      try {
        const t0 = note.startSec
        const osc = ctx.createOscillator()
        osc.type = spec.type
        osc.frequency.setValueAtTime(midiToHz(note.midi) * spec.freqRatio, t0)
        osc.detune.setValueAtTime(spec.detuneCents, t0)
        const gain = envelope(
          ctx,
          t0,
          spec.attackSec,
          note.durSec,
          velocityPeak(note.velocity, spec.peak),
          loopSec,
        )
        gain.connect(bus)
        let tail: AudioNode = osc
        if (spec.lowpassHz !== undefined) {
          const filter = ctx.createBiquadFilter()
          filter.type = 'lowpass'
          filter.frequency.setValueAtTime(spec.lowpassHz, t0)
          osc.connect(filter)
          tail = filter
        }
        tail.connect(gain)
        osc.start(t0)
        osc.stop(t0 + note.durSec + 0.1)
      } catch {
        // One broken voice stays silent — the rest of the loop still plays.
      }
    }
  }
}

function scheduleDrum(
  ctx: BaseAudioContext,
  dest: AudioNode,
  note: MidiNote,
  loopSec: number,
): void {
  const t0 = note.startSec
  /** Source chain → envelope → the drum bus. */
  const chain = (source: AudioNode, attackSec: number, durSec: number, peak: number): void => {
    const gain = envelope(ctx, t0, attackSec, durSec, peak, loopSec)
    gain.connect(dest)
    source.connect(gain)
  }
  try {
    if (note.midi === 35 || note.midi === 36) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(130, t0)
      osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.1)
      chain(osc, 0.004, 0.13, velocityPeak(note.velocity, 0.5))
      osc.start(t0)
      osc.stop(t0 + 0.2)
      return
    }
    if (note.midi === 38 || note.midi === 40) {
      const noise = noiseSource(ctx)
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.setValueAtTime(1800, t0)
      filter.Q.value = 0.9
      noise.connect(filter)
      chain(filter, 0.003, 0.13, velocityPeak(note.velocity, 0.22))
      noise.start(t0)
      noise.stop(t0 + 0.2)
      return
    }
    if (note.midi === 42 || note.midi === 44 || note.midi === 46) {
      const noise = noiseSource(ctx)
      const filter = ctx.createBiquadFilter()
      filter.type = 'highpass'
      filter.frequency.setValueAtTime(7000, t0)
      noise.connect(filter)
      chain(filter, 0.002, note.midi === 46 ? 0.16 : 0.05, velocityPeak(note.velocity, 0.1))
      noise.start(t0)
      noise.stop(t0 + 0.25)
      return
    }
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(180, t0)
    chain(osc, 0.004, 0.15, velocityPeak(note.velocity, 0.18))
    osc.start(t0)
    osc.stop(t0 + 0.25)
  } catch {
    // Broken drum hit stays silent.
  }
}

/** A one-second white-noise source (created per render context). */
function noiseSource(ctx: BaseAudioContext): AudioBufferSourceNode {
  const seconds = 1
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate) * seconds, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true
  return source
}

async function loadAndRender(url: string): Promise<{ buffer: AudioBuffer; loopSec: number }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`music fetch failed: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const song = parseMidi(bytes)
  if (typeof OfflineAudioContext === 'undefined' || !(song.loopSec > 0)) {
    throw new Error('music render unavailable')
  }
  const ctx = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil(song.loopSec * RENDER_SAMPLE_RATE)),
    RENDER_SAMPLE_RATE,
  )
  const master = ctx.createGain()
  master.gain.value = 0.9
  master.connect(ctx.destination)
  scheduleSong(ctx, master, song, song.loopSec)
  const buffer = await ctx.startRendering()
  return { buffer, loopSec: song.loopSec }
}

class MusicEngine {
  private buffers = new Map<MusicTrack, AudioBuffer>()
  private loopSecs = new Map<MusicTrack, number>()
  private loading = new Map<MusicTrack, Promise<void>>()
  private source: AudioBufferSourceNode | null = null
  private gain: GainNode | null = null
  /** The cue that is audible right now (null until the first start). */
  private current: MusicTrack | null = null
  /** The cue the app last asked for — takes over at the next opportunity. */
  private desired: MusicTrack = 'lobby'

  /** True once a looped source is running (used to release the arm listeners). */
  get started(): boolean {
    return this.source !== null
  }

  /** Fetch + parse + offline-render once per track; failures leave it idle. */
  load(track: MusicTrack): Promise<void> {
    let pending = this.loading.get(track)
    if (pending === undefined) {
      pending = loadAndRender(TRACK_URLS[track])
        .then(({ buffer, loopSec }) => {
          this.buffers.set(track, buffer)
          this.loopSecs.set(track, loopSec)
        })
        .catch(() => {
          // No asset, no renderer, no permission: the game stays silent.
        })
      this.loading.set(track, pending)
    }
    return pending
  }

  /**
   * The app's view changed: the requested cue takes over — crossfading now
   * if audio is running, else at the next gesture start. A flip to a track
   * still rendering lands when that render finishes (unless the app has
   * flipped away again first).
   */
  request(track: MusicTrack): void {
    if (track === this.desired) return
    this.desired = track
    if (this.source === null) return
    if (this.buffers.has(track)) {
      this.startTrack(track)
      return
    }
    void this.load(track).then(() => {
      if (this.desired === track && this.source !== null) this.startTrack(track)
    })
  }

  /** Starts the desired loop; idempotent, no-op until a load succeeded. */
  start(): void {
    if (this.source !== null) return
    this.startTrack(this.desired)
  }

  /** Crossfade: fade the audible loop out while the requested one fades in. */
  private startTrack(track: MusicTrack): void {
    if (this.current === track) return
    const buffer = this.buffers.get(track)
    const loopSec = this.loopSecs.get(track) ?? 0
    const bus = sfx.musicBus()
    if (buffer === undefined || bus === null) return
    try {
      const ctx = bus.context
      const now = ctx.currentTime
      if (this.source !== null && this.gain !== null) {
        const oldSource = this.source
        const oldGain = this.gain
        oldGain.gain.cancelScheduledValues(now)
        oldGain.gain.setValueAtTime(oldGain.gain.value, now)
        oldGain.gain.linearRampToValueAtTime(0.0001, now + FADE_SEC)
        oldSource.stop(now + FADE_SEC + 0.05)
      }
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      if (loopSec > 0) source.loopEnd = loopSec
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.linearRampToValueAtTime(MUSIC_LEVEL, now + FADE_SEC)
      source.connect(gain)
      gain.connect(bus.destination)
      source.start()
      this.source = source
      this.gain = gain
      this.current = track
    } catch {
      // A failed switch stays silent rather than half-crossfaded.
      this.source = null
      this.gain = null
      this.current = null
    }
  }
}

/** The app-wide music singleton (silent no-op outside browsers). */
export const music = new MusicEngine()

/**
 * Boot wiring: kick off the lobby render immediately and start it at the
 * first user gesture (autoplay policy keeps the context suspended before
 * that); the round cue renders in the background so the mid-round switch
 * never waits on the wire. The listeners remove themselves once a loop is
 * running.
 */
export function armMusicAutostart(): void {
  void music.load('lobby').then(() => music.start())
  void music.load('round')
  const kick = (): void => {
    music.start()
    if (music.started) {
      window.removeEventListener('pointerdown', kick, true)
      window.removeEventListener('keydown', kick, true)
    }
  }
  window.addEventListener('pointerdown', kick, true)
  window.addEventListener('keydown', kick, true)
}
