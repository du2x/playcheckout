import { describe, expect, it } from 'vitest'
import { roomCodeFromSearch, roomShareUrl, sanitizeRoomCode } from './shareLink'

// ?room=CODE share links (LIGHT-04 grammar): pure URL helpers only — the DOM
// side (prefill focus, clipboard) is gate-3 harness territory.

describe('sanitizeRoomCode', () => {
  it('uppercases, strips non-letters, caps at 4 (LIGHT-04)', () => {
    expect(sanitizeRoomCode('ab1!xy')).toBe('ABXY'.slice(0, 4))
    expect(sanitizeRoomCode('abcd')).toBe('ABCD')
    expect(sanitizeRoomCode('abcde')).toBe('ABCD')
    expect(sanitizeRoomCode('123')).toBe('')
  })
})

describe('roomCodeFromSearch', () => {
  it('reads the room param, sanitized', () => {
    expect(roomCodeFromSearch('?room=ab3x')).toBe('ABX')
    expect(roomCodeFromSearch('?room=QQQQ&x=1')).toBe('QQQQ')
  })

  it('is empty for absent, empty, or junk params', () => {
    expect(roomCodeFromSearch('')).toBe('')
    expect(roomCodeFromSearch('?room=')).toBe('')
    expect(roomCodeFromSearch('?other=1')).toBe('')
    expect(roomCodeFromSearch('?room=9999')).toBe('')
  })
})

describe('roomShareUrl', () => {
  it('builds origin + path + ?room=CODE', () => {
    expect(roomShareUrl('ABCD', { origin: 'https://turnover.fly.dev', pathname: '/' })).toBe(
      'https://turnover.fly.dev/?room=ABCD',
    )
    expect(roomShareUrl('QJKX', { origin: 'http://localhost:5173', pathname: '/index.html' })).toBe(
      'http://localhost:5173/index.html?room=QJKX',
    )
  })
})
