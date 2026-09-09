import { describe, expect, it } from 'vitest'
import { loadTutorialDone, storeTutorialDone } from './prefs'

/** A minimal in-memory stand-in for localStorage (node env has none). */
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

describe('tutorial prefs (first-run tutorial)', () => {
  it('defaults to not-done with no storage and with no stored value', () => {
    expect(loadTutorialDone(null)).toBe(false)
    expect(loadTutorialDone(fakeStorage())).toBe(false)
  })

  it('reads a stored done as done (browser persistence)', () => {
    const storage = fakeStorage()
    expect(loadTutorialDone(storage)).toBe(false)
    storeTutorialDone(storage)
    expect(loadTutorialDone(storage)).toBe(true)
  })

  it('treats corrupt values as not-done', () => {
    const storage = fakeStorage()
    storage.setItem('turnover.tutorial', 'seen')
    expect(loadTutorialDone(storage)).toBe(false)
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
    expect(loadTutorialDone(throwing)).toBe(false)
    expect(() => storeTutorialDone(throwing)).not.toThrow()
  })
})
