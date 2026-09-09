/**
 * Tutorial completion store (first-run tutorial): one localStorage key marks
 * that this browser finished (or skipped) the guided tutorial — once done, the
 * cards stay away for good (the help button still covers re-reading). Pure
 * functions with an injectable storage so the node-env vitest project can pin
 * the contract without a browser — the audio/prefs.ts precedent.
 */

const TUTORIAL_KEY = 'turnover.tutorial'

/** Read the stored flag; anything but 'done' reads as not-done. */
export function loadTutorialDone(storage: Storage | null): boolean {
  try {
    return storage?.getItem(TUTORIAL_KEY) === 'done'
  } catch {
    return false
  }
}

/** Persist the flag; storage failures are silently ignored (best-effort). */
export function storeTutorialDone(storage: Storage | null): void {
  try {
    storage?.setItem(TUTORIAL_KEY, 'done')
  } catch {
    // localStorage unavailable (privacy mode, headless): the tutorial simply
    // runs again on the next visit.
  }
}
