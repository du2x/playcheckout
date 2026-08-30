import type { ViewAction } from './state'

/**
 * Accusation session (cycle 2.8, FR-18): the single client-side home for the
 * justice surface — the hold-E confirm menu, name-only firing toasts, and the
 * self-fired state that gates every movement/work/elevator intent. A pure
 * reducer over the same ViewAction stream as riderSession (one state home per
 * surface; no hidden information arrives: `player:fired` is name-only by
 * protocol). Menu actions are local UI facts, not wire messages.
 */

/** How long a name-only firing toast stays visible. */
export const ACCUSE_TOAST_MS = 4000

/**
 * Hold-E threshold (JUST-17): a tap under this sends the elevator call, a
 * hold past it opens the confirm menu. Client UI affordance — deliberately
 * NOT a TUNING value (prd §7 is gameplay-only).
 */
export const ACCUSE_HOLD_MS = 400

export interface AccuseToast {
  readonly playerId: string
  readonly at: number
}

export interface AccuseMenu {
  readonly targetId: string
  readonly targetName: string
}

export interface AccuseSession {
  /** Open confirm menu (JUST-16) — at most one candidate at a time. */
  menu: AccuseMenu | null
  /** Firing toasts, oldest first (JUST-15) — "X was fired", nothing more. */
  toasts: readonly AccuseToast[]
  /** The local player was fired: every live-play intent is gated off (JUST-04). */
  selfFired: boolean
}

/** ViewActions plus the menu's local UI facts. */
export type AccuseAction =
  | ViewAction
  | { type: 'menu-open'; targetId: string; targetName: string }
  | { type: 'menu-cancel' }
  | { type: 'menu-confirm' }

export function initialAccuseSession(): AccuseSession {
  return { menu: null, toasts: [], selfFired: false }
}

/**
 * Reduce one action into the next session. Returns the SAME reference when
 * nothing changed (identity-check discipline, riderSession precedent).
 * `now` timestamps toasts; `ownId` routes the self-fired flip.
 */
export function reduceAccuse(
  session: AccuseSession,
  action: AccuseAction,
  ownId: string | undefined,
  now: number,
): AccuseSession {
  switch (action.type) {
    case 'player-fired':
      return {
        ...session,
        toasts: [...session.toasts, { playerId: action.playerId, at: now }],
        selfFired: ownId !== undefined && action.playerId === ownId ? true : session.selfFired,
      }
    case 'round-started':
    case 'buzzer':
      // A fresh deal resets every session (justice is round-scoped); the
      // buzzer ends the round and with it the fired state.
      return session.menu === null && session.toasts.length === 0 && !session.selfFired
        ? session
        : initialAccuseSession()
    case 'menu-open':
      return { ...session, menu: { targetId: action.targetId, targetName: action.targetName } }
    case 'menu-cancel':
    case 'menu-confirm':
      // Confirm's intent send is the App's job — the session only closes.
      return session.menu === null ? session : { ...session, menu: null }
    case 'intent-error':
      // JUST-18: a server rejection surfaces through the view state and closes
      // the menu — the mirror was wrong (target moved, already fired, …).
      return session.menu === null ? session : { ...session, menu: null }
    default:
      return session
  }
}

/** Drop expired toasts; identity-preserving when nothing expired. */
export function pruneToasts(session: AccuseSession, now: number): AccuseSession {
  const toasts = session.toasts.filter((t) => now - t.at < ACCUSE_TOAST_MS)
  return toasts.length === session.toasts.length ? session : { ...session, toasts }
}
