import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMidi } from './parse'
import { TRACK_URLS, trackForView } from './tracks'

const assetUrl = (url: string): URL => new URL(`../../../public/${url}`, import.meta.url)

describe('music tracks (lobby vs round cue)', () => {
  it('only the round view maps to the round loop', () => {
    expect(trackForView('round')).toBe('round')
    expect(trackForView('join')).toBe('lobby')
    expect(trackForView('lobby')).toBe('lobby')
    // Results is lobby-like: the room re-forms there between rounds.
    expect(trackForView('results')).toBe('lobby')
    expect(trackForView('lost')).toBe('lobby')
  })

  it('both assets ship and parse as seamless, non-empty loops', () => {
    for (const track of ['lobby', 'round'] as const) {
      const song = parseMidi(new Uint8Array(readFileSync(assetUrl(TRACK_URLS[track]))))
      expect(song.notes.length, track).toBeGreaterThan(0)
      expect(song.loopSec, track).toBeGreaterThanOrEqual(song.lengthSec)
      expect(song.loopSec, track).toBeGreaterThan(10)
      for (const note of song.notes) expect(note.durSec, track).toBeGreaterThan(0)
    }
  })

  it('parses the real suspicion loop: 32 beats at 116 bpm, tension instrumentation', () => {
    const song = parseMidi(new Uint8Array(readFileSync(assetUrl(TRACK_URLS.round))))
    expect(song.ticksPerQuarter).toBe(480)
    expect(song.loopSec).toBeCloseTo((32 * 60) / 116, 3)
    expect(song.notes.filter((note) => note.channel === 9).length).toBeGreaterThan(80)
    const programs = new Set(song.notes.filter((note) => note.channel !== 9).map((n) => n.program))
    expect(programs.has(32)).toBe(true) // acoustic bass ostinato
    expect(programs.has(4)).toBe(true) // e-piano stabs
    expect(programs.has(9)).toBe(true) // glockenspiel motif
    expect(programs.has(48)).toBe(true) // string drones
    // Nothing sounds past the seam — the loop point stays click-free.
    for (const note of song.notes) {
      expect(note.startSec + note.durSec).toBeLessThanOrEqual(song.loopSec + 1e-6)
    }
  })
})
