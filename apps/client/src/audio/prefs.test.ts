import { describe, expect, it } from 'vitest'
import { loadSfxPref, storeSfxPref } from './prefs'

/** A minimal in-memory stand-in for sessionStorage (node env has none). */
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: () => null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe('sfx prefs (night-juice)', () => {
  it('defaults to on with no storage and with no stored value', () => {
    expect(loadSfxPref(null)).toBe('on')
    expect(loadSfxPref(fakeStorage())).toBe('on')
  })

  it('reads a stored off as off (session persistence)', () => {
    const storage = fakeStorage()
    storeSfxPref(storage, 'off')
    expect(loadSfxPref(storage)).toBe('off')
    storeSfxPref(storage, 'on')
    expect(loadSfxPref(storage)).toBe('on')
  })

  it('treats corrupt values as the default (on)', () => {
    const storage = fakeStorage()
    storage.setItem('turnover.sfx', 'muted')
    expect(loadSfxPref(storage)).toBe('on')
  })

  it('survives a throwing storage (privacy mode) silently', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage
    expect(loadSfxPref(throwing)).toBe('on')
    expect(() => storeSfxPref(throwing, 'off')).not.toThrow()
  })
})
