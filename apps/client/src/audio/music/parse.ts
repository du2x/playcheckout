/**
 * Minimal Standard MIDI File reader for the ambient music loop
 * (`public/audio/turnover-night-shift.mid`). Pure TypeScript — no
 * dependencies, no DOM, node-testable. Supports what an SMF legally
 * contains: formats 0/1, running status, meta and sysex events, a tempo
 * map (tick → seconds), per-channel program tracking, and note pairing
 * (note-off or velocity-0 note-on closes the oldest matching note-on on
 * the same channel+pitch). Drum tracks that never send note-offs (the
 * GM channel 10 convention) get a fixed default duration instead of
 * hanging forever.
 */

export interface MidiNote {
  readonly midi: number
  readonly velocity: number
  readonly channel: number
  /** GM program of the note's channel at its start tick (0 when absent). */
  readonly program: number
  readonly startSec: number
  readonly durSec: number
}

export interface MidiSong {
  readonly notes: readonly MidiNote[]
  /** The last audible note moment (max start + duration), in seconds. */
  readonly lengthSec: number
  /** The notes' span snapped UP to a whole beat — the seamless loop length. */
  readonly loopSec: number
  readonly ticksPerQuarter: number
}

export const EMPTY_SONG: MidiSong = {
  notes: [],
  lengthSec: 0,
  loopSec: 0,
  ticksPerQuarter: 480,
}

/** Default length for note-ons never closed (drums short, pitched one beat). */
const DEFAULT_DRUM_TICKS = 0.25
const DEFAULT_PITCHED_TICKS = 1

interface RawEvent {
  readonly tick: number
  /** Stable tiebreak at equal ticks: tempo → program → off → on. */
  readonly order: number
  readonly status: number
  readonly d1: number
  readonly d2: number
}

interface TempoSpan {
  readonly startTick: number
  readonly usPerQuarter: number
}

const eventPriority = (status: number): number => {
  if (status === 0xff) return 0
  if ((status & 0xf0) === 0xc0) return 1
  if ((status & 0xf0) === 0x80 || status === 0x90) return 2
  return 3
}

export function parseMidi(data: Uint8Array): MidiSong {
  try {
    return parseMidiUnsafe(data)
  } catch {
    return EMPTY_SONG
  }
}

function parseMidiUnsafe(data: Uint8Array): MidiSong {
  if (data.length < 14) return EMPTY_SONG
  if (ascii(data, 0, 4) !== 'MThd') return EMPTY_SONG
  const format = u16be(data, 8)
  const division = u16be(data, 12)
  // SMPTE timing (high bit set) and format 2 (independent tracks) are out
  // of scope — the engine treats them as silence rather than mis-timing.
  if (format > 1 || (division & 0x8000) !== 0 || division === 0) return EMPTY_SONG

  const events: RawEvent[] = []
  const tempos: TempoSpan[] = []
  let offset = 14
  let order = 0
  while (offset + 8 <= data.length) {
    const type = ascii(data, offset, offset + 4)
    const chunkLength = u32be(data, offset + 4)
    const body = offset + 8
    if (body + chunkLength > data.length) break
    if (type === 'MTrk') {
      offset = readTrack(data, body, body + chunkLength, events, tempos, () => order++)
    } else {
      offset = body + chunkLength
    }
  }
  if (events.length === 0) return EMPTY_SONG

  events.sort(
    (a, b) =>
      a.tick - b.tick || eventPriority(a.status) - eventPriority(b.status) || a.order - b.order,
  )
  tempos.sort((a, b) => a.startTick - b.startTick)
  if (tempos[0]?.startTick !== 0) tempos.unshift({ startTick: 0, usPerQuarter: 500000 })

  const tickToSec = makeTickToSec(tempos, division)
  const { notes, maxEndTick } = pairNotes(events, division, tickToSec)
  if (notes.length === 0) return EMPTY_SONG

  const loopTicks = Math.ceil(maxEndTick / division) * division
  return {
    notes,
    lengthSec: tickToSec(maxEndTick),
    loopSec: tickToSec(loopTicks),
    ticksPerQuarter: division,
  }
}

/** Reads one track body, appending channel events; returns the offset after the chunk. */
function readTrack(
  data: Uint8Array,
  start: number,
  end: number,
  events: RawEvent[],
  tempos: TempoSpan[],
  nextOrder: () => number,
): number {
  let p = start
  let tick = 0
  let runningStatus = 0
  while (p < end) {
    const delta = readVarLen(data, p)
    tick += delta.value
    p = delta.next
    const first = byte(data, p)
    if (first === 0xff) {
      const metaType = byte(data, p + 1)
      const length = readVarLen(data, p + 2)
      const dataStart = length.next
      if (metaType === 0x51 && length.value === 3) {
        tempos.push({
          startTick: tick,
          usPerQuarter:
            (byte(data, dataStart) << 16) |
            (byte(data, dataStart + 1) << 8) |
            byte(data, dataStart + 2),
        })
      }
      p = dataStart + length.value
      if (metaType === 0x2f) return end
      runningStatus = 0
    } else if (first === 0xf0 || first === 0xf7) {
      const length = readVarLen(data, p + 1)
      p = length.next + length.value
      runningStatus = 0
    } else {
      let status = first
      if ((first & 0x80) !== 0) {
        status = first
        p += 1
        runningStatus = status
      } else {
        // Running status: the data bytes follow the remembered status.
        status = runningStatus
        if (status === 0) return end
      }
      const kind = status & 0xf0
      if (kind === 0xc0 || kind === 0xd0) {
        events.push({ tick, order: nextOrder(), status, d1: byte(data, p), d2: 0 })
        p += 1
      } else {
        events.push({ tick, order: nextOrder(), status, d1: byte(data, p), d2: byte(data, p + 1) })
        p += 2
      }
    }
  }
  return end
}

function pairNotes(
  events: readonly RawEvent[],
  division: number,
  tickToSec: (tick: number) => number,
): { notes: MidiNote[]; maxEndTick: number } {
  const programs = new Map<number, number>()
  const open = new Map<string, RawEvent[]>()
  const notes: MidiNote[] = []
  let maxEndTick = 0
  const push = (started: RawEvent, endTick: number): void => {
    const channel = started.status & 0x0f
    notes.push({
      midi: started.d1,
      velocity: started.d2,
      channel,
      program: programs.get(channel) ?? 0,
      startSec: tickToSec(started.tick),
      durSec: tickToSec(endTick) - tickToSec(started.tick),
    })
    if (endTick > maxEndTick) maxEndTick = endTick
  }
  const closeOne = (raw: RawEvent): void => {
    const key = `${raw.status & 0x0f}:${raw.d1}`
    const pending = open.get(key)
    const started = pending?.shift()
    if (pending !== undefined && pending.length === 0) open.delete(key)
    if (started === undefined) return
    push(started, raw.tick)
  }
  for (const raw of events) {
    const kind = raw.status & 0xf0
    if (kind === 0xc0) {
      programs.set(raw.status & 0x0f, raw.d1)
    } else if (kind === 0x90 && raw.d2 > 0) {
      const key = `${raw.status & 0x0f}:${raw.d1}`
      const pending = open.get(key) ?? []
      pending.push(raw)
      open.set(key, pending)
    } else if (kind === 0x80 || kind === 0x90) {
      closeOne(raw)
    }
  }
  // Note-ons never closed (drum tracks, truncated files): give a default
  // length so they sound once instead of sustaining across the loop.
  for (const pending of open.values()) {
    for (const started of pending) {
      const channel = started.status & 0x0f
      const defaultTicks =
        channel === 9 ? division * DEFAULT_DRUM_TICKS : division * DEFAULT_PITCHED_TICKS
      push(started, started.tick + defaultTicks)
    }
  }
  return { notes, maxEndTick }
}

function makeTickToSec(tempos: readonly TempoSpan[], division: number): (tick: number) => number {
  return (tick: number): number => {
    let seconds = 0
    let lastTick = 0
    let usPerQuarter = tempos[0]?.usPerQuarter ?? 500000
    for (const span of tempos) {
      if (span.startTick >= tick) break
      if (span.startTick > lastTick) {
        seconds += ((span.startTick - lastTick) * usPerQuarter) / (division * 1_000_000)
        lastTick = span.startTick
      }
      usPerQuarter = span.usPerQuarter
    }
    seconds += ((tick - lastTick) * usPerQuarter) / (division * 1_000_000)
    return seconds
  }
}

function readVarLen(data: Uint8Array, at: number): { value: number; next: number } {
  let value = 0
  let p = at
  for (let guard = 0; guard < 4; guard++) {
    const current = byte(data, p)
    p += 1
    value = (value << 7) | (current & 0x7f)
    if ((current & 0x80) === 0) break
  }
  return { value, next: p }
}

function ascii(data: Uint8Array, from: number, to: number): string {
  let text = ''
  for (let i = from; i < to; i++) text += String.fromCharCode(byte(data, i))
  return text
}

function u16be(data: Uint8Array, at: number): number {
  return (byte(data, at) << 8) | byte(data, at + 1)
}

function u32be(data: Uint8Array, at: number): number {
  return (
    (byte(data, at) << 24) |
    (byte(data, at + 1) << 16) |
    (byte(data, at + 2) << 8) |
    byte(data, at + 3)
  )
}

/** Null-safe byte read: out-of-range indexes read as 0 (defensive on malformed files). */
function byte(data: Uint8Array, at: number): number {
  return data[at] ?? 0
}
