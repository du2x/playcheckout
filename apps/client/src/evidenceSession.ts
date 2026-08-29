import type { RoomIndex } from '@turnover/shared'

/**
 * Evidence view state (cycle 2.7, EVID-19): the hallway-visible slice a client
 * may render — door cards (floor-public, FR-11), door-open cues, and rustle
 * cues (both delivered server-side within legitimate knowledge, leak rule 2).
 * Pure reducer over the same ViewAction stream as riderSession.ts; no DOM,
 * no Phaser, no clock (time arrives as a parameter).
 */

export type EvidenceCueKind = 'entered' | 'rustle'

export interface EvidenceCue {
  readonly id: number
  readonly kind: EvidenceCueKind
  readonly floor: string
  readonly room: RoomIndex
  readonly at: number
}

export interface EvidenceSession {
  /** `\`${floor}:${room}\`` keys of carded rooms seen on the own floor. */
  readonly cards: ReadonlySet<string>
  /** Unexpired cues, oldest first. */
  readonly cues: readonly EvidenceCue[]
  nextId: number
}

/** How long a cue stays on screen (gray-box flash), per kind. */
export const CUE_TTL_MS: Record<EvidenceCueKind, number> = { entered: 700, rustle: 900 }

export function initialEvidenceSession(): EvidenceSession {
  return { cards: new Set(), cues: [], nextId: 1 }
}

export type EvidenceAction =
  | { type: 'carded'; floor: string; room: RoomIndex }
  | { type: 'entered'; playerId: string; floor: string; room: RoomIndex }
  | { type: 'rustle'; floor: string; room: RoomIndex }

/** Cue kinds prune by their own TTL; the caller passes `now` each frame. */
export function liveCues(session: EvidenceSession, nowMs: number): EvidenceCue[] {
  return session.cues.filter((c) => nowMs - c.at < CUE_TTL_MS[c.kind])
}

/**
 * Reduce one evidence action into the next session. `carded` is idempotent
 * (the server re-emits the card on every prep completion — EVID-01); cues
 * buffer and the scene prunes them via `liveCues` + `dropCue`.
 */
export function reduceEvidence(
  session: EvidenceSession,
  action: EvidenceAction,
  nowMs: number,
): EvidenceSession {
  switch (action.type) {
    case 'carded': {
      const key = `${action.floor}:${action.room}`
      if (session.cards.has(key)) return session
      const cards = new Set(session.cards)
      cards.add(key)
      return { ...session, cards }
    }
    case 'entered':
    case 'rustle': {
      const cue: EvidenceCue = {
        id: session.nextId,
        kind: action.type,
        floor: action.floor,
        room: action.room,
        at: nowMs,
      }
      return { ...session, cues: [...session.cues, cue], nextId: session.nextId + 1 }
    }
  }
}

/** Drop a pruned cue (the scene calls this with the ids `liveCues` removed). */
export function dropCues(session: EvidenceSession, ids: ReadonlySet<number>): EvidenceSession {
  if (ids.size === 0) return session
  return { ...session, cues: session.cues.filter((c) => !ids.has(c.id)) }
}
