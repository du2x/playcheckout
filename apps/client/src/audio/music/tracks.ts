import type { ViewName } from '../../state'

/**
 * The two music loops (user-directed, 2026-09-09): the mellow night-shift
 * cue (AD-057) stays the lobby sound; rounds get their own tension loop.
 * Presentation-only — the files carry no game state.
 */

export type MusicTrack = 'lobby' | 'round'

export const TRACK_URLS: Readonly<Record<MusicTrack, string>> = {
  lobby: 'audio/turnover-night-shift.mid',
  round: 'audio/turnover-suspicion.mid',
}

/** Results is lobby-like (the room re-forms there between rounds) — only
 * the round view itself earns the tension cue. */
export function trackForView(view: ViewName): MusicTrack {
  return view === 'round' ? 'round' : 'lobby'
}
