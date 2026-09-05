import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EMPTY_SONG, type MidiSong, parseMidi } from './parse'

const REAL_ASSET = new URL('../../../public/audio/turnover-night-shift.mid', import.meta.url)

/** One SMF track chunk: MTrk + length + events. */
function track(events: number[]): number[] {
  const header = [0x4d, 0x54, 0x72, 0x6b]
  const length = [
    (events.length >>> 24) & 0xff,
    (events.length >>> 16) & 0xff,
    (events.length >>> 8) & 0xff,
    events.length & 0xff,
  ]
  return [...header, ...length, ...events]
}

function smf(tracks: number[][], ticksPerQuarter = 480): Uint8Array {
  const header = [
    0x4d,
    0x54,
    0x68,
    0x64,
    0,
    0,
    0,
    6,
    0,
    tracks.length > 1 ? 1 : 0,
    (tracks.length >> 8) & 0xff,
    tracks.length & 0xff,
    (ticksPerQuarter >> 8) & 0xff,
    ticksPerQuarter & 0xff,
  ]
  return new Uint8Array([...header, ...tracks.flat()])
}

/** Variable-length quantity encoding (delta times). */
function varlen(value: number): number[] {
  if (value < 0x80) return [value]
  return [0x80 | (value >> 7), value & 0x7f]
}

describe('midi parse (music loop)', () => {
  it('rejects garbage and truncation as silence', () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    expect(parseMidi(junk)).toBe(EMPTY_SONG)
    expect(parseMidi(new Uint8Array(0))).toBe(EMPTY_SONG)
  })

  it('pairs notes across running status, tracks programs, defaults unclosed notes', () => {
    const song: MidiSong = parseMidi(
      smf([
        track([
          0x00,
          0xff,
          0x51,
          0x03,
          0x07,
          0xa1,
          0x20, // tempo 120 bpm
          0x00,
          0xc0,
          0x04, // program 4 (e-piano) on channel 0
          0x00,
          0x90,
          60,
          100, // note on  C4
          ...varlen(80),
          60,
          0, // note off via RUNNING STATUS (no status byte)
          ...varlen(240),
          0x90,
          62,
          90, // note on  D4, never closed
          0x00,
          0xff,
          0x2f,
          0x00, // end of track
        ]),
      ]),
    )
    expect(song.notes).toHaveLength(2)
    const [first, second] = song.notes
    if (first === undefined || second === undefined) throw new Error('expected two notes')
    expect(first.midi).toBe(60)
    expect(first.program).toBe(4)
    expect(first.startSec).toBe(0)
    // 80 ticks at 120 bpm / 480 ppq = 1/6 s.
    expect(first.durSec).toBeCloseTo(80 / 480 / 2, 5)
    // The unclosed note gets one default beat and still lands in the song.
    expect(second.midi).toBe(62)
    expect(second.durSec).toBeCloseTo(0.5, 5)
    expect(second.startSec).toBeCloseTo(320 / 480 / 2, 5)
    // Loop snaps the unclosed note's end (800 ticks) up to the next beat (960).
    expect(song.lengthSec).toBeCloseTo(800 / 480 / 2, 5)
    expect(song.loopSec).toBeCloseTo(1.0, 5)
  })

  it('parses the real night-shift loop: six tracks, drums, snapped seamless loop', () => {
    const song = parseMidi(new Uint8Array(readFileSync(REAL_ASSET)))
    // 32 bass + 24 keys + 9 glock + 24 strings + 96 drum hits.
    expect(song.notes).toHaveLength(185)
    expect(song.ticksPerQuarter).toBe(480)
    // Every note sounds once — no zero/negative durations, nothing hanging.
    for (const note of song.notes) expect(note.durSec).toBeGreaterThan(0)
    // GM channel 10 (index 9) carries the percussion; ch0 is the acoustic bass.
    expect(song.notes.filter((note) => note.channel === 9)).toHaveLength(96)
    const bass = song.notes.filter((note) => note.channel === 0)
    expect(bass.length).toBeGreaterThan(0)
    expect(bass.every((note) => note.program === 32)).toBe(true)
    expect(Math.min(...bass.map((note) => note.midi))).toBe(26)
    // ~21 s of music at 92 bpm; the loop snaps up to the whole 32-beat bar grid.
    expect(song.lengthSec).toBeGreaterThan(20.5)
    expect(song.lengthSec).toBeLessThan(21.2)
    expect(song.loopSec).toBeCloseTo((32 * 60) / 92, 3)
    expect(song.loopSec).toBeGreaterThanOrEqual(song.lengthSec)
  })
})
