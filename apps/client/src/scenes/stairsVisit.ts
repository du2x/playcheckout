import { type FloorId, type MovementSnapshotStairs, TUNING } from '@turnover/shared'
import { FLOOR_ORDER } from '../ui/carScreen'

/**
 * Stairs visit (AD-040 client mirror, deepened 2026-09-09): the single home of
 * the own stairwell visit — the anchor clock, its transitions, and the FX
 * timeline bases. Facts in (personal `movement:snapshot` stairs row, private
 * `stairs:ambushed`), readouts + transitions out; the world scene only applies
 * them to sprites/DOM/audio. Own-facts only — the stairwell interior is a
 * black box to everyone else (FR-34), so nothing here ever names a co-transit.
 *
 * The clock math (`stairPhaseReadout`, `stairDirection`, `StairAnchor`) moved
 * here from `ui/stairScreen.ts`: the visit owns the clock, the DOM screen and
 * the climb canvas are consumers. Before this module the anchor was a scene
 * field written from five sites with the readout derived three times per
 * frame; now one `tick()` derives it once and publishes the edges the scene
 * used to mirror inline (breath arrival, stun resume, visit end).
 */

export type StairPhase = 'transit' | 'breath' | 'stunned'

/**
 * One anchor of the own stairs clock: a personal snapshot's stairs row (or a
 * `stairs:ambushed` stun override), stamped with the wall-clock moment it
 * landed. `remainingMs` is what the payload said was left of `phase`.
 */
export interface StairAnchor {
  readonly from: FloorId
  readonly to: FloorId
  readonly phase: StairPhase
  readonly remainingMs: number
  /** `Date.now()` when the anchor landed. */
  readonly anchoredAtMs: number
}

/** The live phase countdown; `null` = the current stair visit is over. */
export type StairReadout = { readonly phase: StairPhase; readonly remainingMs: number } | null

/**
 * The phase + countdown at `nowMs`, derived purely from the anchor and
 * TUNING: the anchored phase counts down, an expired transit rolls into the
 * breath (STAIRS_BREATH_SECONDS), and an expired breath or stun ends the
 * visit (the resumed floor stream re-anchors the truth).
 */
export function stairPhaseReadout(anchor: StairAnchor, nowMs: number): StairReadout {
  const remaining = anchor.remainingMs - (nowMs - anchor.anchoredAtMs)
  if (remaining > 0) return { phase: anchor.phase, remainingMs: remaining }
  const overshoot = -remaining
  if (anchor.phase === 'transit') {
    const breathMs = TUNING.STAIRS_BREATH_SECONDS * 1000
    if (overshoot < breathMs) return { phase: 'breath', remainingMs: breathMs - overshoot }
  }
  return null
}

/** The visit direction from the building order (always one stride apart). */
export function stairDirection(from: FloorId, to: FloorId): 'up' | 'down' {
  return FLOOR_ORDER.indexOf(to) > FLOOR_ORDER.indexOf(from) ? 'up' : 'down'
}

/** The edges `tick()` publishes — what the scene mirrors, one output each. */
export type StairsTransition =
  /** The local clock rolled a transit into the breath: the own display
   *  stands at the destination mouth (AD-040 amendment — the breath happens
   *  ON the `to` floor at STAIRS_ARRIVAL_X_TILES). */
  | { readonly type: 'breath-entered'; readonly floor: FloorId }
  /** An ambush's stun ended: the interrupted transit resumes with its
   *  preserved remainder; the climb's resume lurch takes its t0 here. */
  | { readonly type: 'stun-resumed' }
  /** The visit is over: apply the arrival — floor `to`, STAIRS_ARRIVAL_X_TILES
   *  east of the mouth (the sameFloor stream resumed while the client was
   *  floorless, so the event never reached us). */
  | { readonly type: 'visit-ended'; readonly floor: FloorId }

/** The per-frame visit readout — one derivation, every consumer's slice. */
export interface StairsVisitReadout {
  readonly phase: StairPhase
  readonly remainingMs: number
  readonly from: FloorId
  readonly to: FloorId
  readonly direction: 'up' | 'down'
  /** Elapsed since the stun began (the FX timeline's t0 basis); null unless
   *  stunned. Falls back to TUNING.STAIRS_STUN_SECONDS when the stun was
   *  anchored by a snapshot instead of the ambush message. */
  readonly elapsedStunMs: number | null
  /** Elapsed since the resume lurch's t0; null when no lurch is armed. */
  readonly lurchElapsedMs: number | null
}

/**
 * The visit state machine. Facts arrive on two threads — messages
 * (`onSnapshot`, `onAmbush`) and the frame clock (`tick`) — and every
 * transition rewrite (stun override, resume re-anchor, visit end) happens in
 * here, never in a caller. Pure: `nowMs` is always injected, so the whole
 * machine is unit-testable headless.
 */
export class StairsVisit {
  private anchor: StairAnchor | null = null
  /** The transit remainder captured at the ambush (the resume clock). */
  private stunResumeMs = 0
  /** The stun seconds as ambushed (the FX timeline basis; 0 = snapshot-anchored). */
  private stunTotalMs = 0
  /** `nowMs` the interrupted transit resumed (the lurch window's t0). */
  private lurchAtMs: number | null = null
  /** The derived phase last tick — the breath edge detector's memory. */
  private lastPhase: StairPhase | null = null

  /** A personal snapshot's stairs row re-anchors the clock; absent = the
   *  visit is over server-side (the row's presence IS the stairs truth). */
  onSnapshot(row: MovementSnapshotStairs | null, nowMs: number): void {
    this.anchor =
      row === null
        ? null
        : {
            from: row.from,
            to: row.to,
            phase: row.phase,
            remainingMs: row.remainingSeconds * 1000,
            anchoredAtMs: nowMs,
          }
  }

  /** The private ambush lands on the victim: capture the live transit
   *  remainder, then override the clock with the stun phase. A no-op without
   *  a live visit (the toast still fires in the caller — it is the message's
   *  own UI, not the visit's). */
  onAmbush(stunSeconds: number, nowMs: number): void {
    if (this.anchor === null) return
    this.stunResumeMs = stairPhaseReadout(this.anchor, nowMs)?.remainingMs ?? 0
    this.stunTotalMs = stunSeconds * 1000
    this.lurchAtMs = null
    this.anchor = {
      ...this.anchor,
      phase: 'stunned',
      remainingMs: stunSeconds * 1000,
      anchoredAtMs: nowMs,
    }
  }

  /**
   * Derive the readout once and run every expired-anchor edge: an expired
   * stun with a preserved remainder resumes the transit (re-anchored, lurch
   * armed — the same tick returns the resumed transit, not null), any other
   * expiry ends the visit, and a transit rolling into the breath publishes
   * the arrival edge exactly once per breath window.
   */
  tick(nowMs: number): {
    readonly readout: StairsVisitReadout | null
    readonly transitions: readonly StairsTransition[]
  } {
    const transitions: StairsTransition[] = []
    const anchor = this.anchor
    if (anchor === null) {
      this.lastPhase = null
      return { readout: null, transitions }
    }
    let readout = stairPhaseReadout(anchor, nowMs)
    if (readout === null) {
      if (anchor.phase === 'stunned' && this.stunResumeMs > 0) {
        const resumeMs = this.stunResumeMs
        this.anchor = {
          from: anchor.from,
          to: anchor.to,
          phase: 'transit',
          remainingMs: resumeMs,
          anchoredAtMs: nowMs,
        }
        this.stunResumeMs = 0
        this.lurchAtMs = nowMs
        transitions.push({ type: 'stun-resumed' })
        // An anchor stamped `nowMs` with a positive remainder reads back
        // exactly this — derive it directly instead of re-reading the clock.
        readout = { phase: 'transit', remainingMs: resumeMs }
      } else {
        this.anchor = null
        this.lastPhase = null
        transitions.push({ type: 'visit-ended', floor: anchor.to })
        return { readout: null, transitions }
      }
    }
    if (readout.phase === 'breath' && this.lastPhase !== 'breath') {
      transitions.push({ type: 'breath-entered', floor: anchor.to })
    }
    this.lastPhase = readout.phase
    const elapsedStunMs =
      readout.phase === 'stunned'
        ? Math.max(
            0,
            (this.stunTotalMs > 0 ? this.stunTotalMs : TUNING.STAIRS_STUN_SECONDS * 1000) -
              readout.remainingMs,
          )
        : null
    return {
      readout: {
        phase: readout.phase,
        remainingMs: readout.remainingMs,
        from: anchor.from,
        to: anchor.to,
        direction: stairDirection(anchor.from, anchor.to),
        elapsedStunMs,
        lurchElapsedMs: this.lurchAtMs === null ? null : nowMs - this.lurchAtMs,
      },
      transitions,
    }
  }

  /** Round teardown (round-started / reconnection): the clock and every
   *  captured basis die with the sim's old deal. */
  reset(): void {
    this.anchor = null
    this.stunResumeMs = 0
    this.stunTotalMs = 0
    this.lurchAtMs = null
    this.lastPhase = null
  }
}
