/**
 * SFX preference store (night-juice): the mute state lives in
 * `sessionStorage` under one key — session-persisted per the recorded
 * decision, default ON. Pure functions with an injectable storage so the
 * node-env vitest project can pin the contract without a browser.
 */

export type SfxPref = 'on' | 'off'

const SFX_KEY = 'turnover.sfx'

/** Read the stored pref; anything but 'off' reads as the default 'on'. */
export function loadSfxPref(storage: Storage | null): SfxPref {
  try {
    return storage?.getItem(SFX_KEY) === 'off' ? 'off' : 'on'
  } catch {
    return 'on'
  }
}

/** Persist the pref; storage failures are silently ignored (best-effort). */
export function storeSfxPref(storage: Storage | null, pref: SfxPref): void {
  try {
    storage?.setItem(SFX_KEY, pref)
  } catch {
    // sessionStorage unavailable (privacy mode, headless): the toggle still
    // works for this page, it just does not persist.
  }
}
