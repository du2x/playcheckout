import { TUNING } from '@turnover/shared'

/**
 * Climb presenter (night-juice): the pure math behind the stairwell interior —
 * "the climb". No Phaser, no DOM: the scene consumes these readouts per frame
 * the same way `elevatorPresenter` feeds the door/ride visuals. Durations that
 * are pure presentation (flash window, heartbeat pulse, resume lurch) live in
 * the `CLIMB` table with provenance comments, per the JUICE-table precedent —
 * they never alter sim timing (transit/breath/stun stay TUNING-derived).
 *
 * Leak rules: everything here renders the recipient's OWN transit (personal
 * `movement:snapshot` stairs row + private `stairs:ambushed`). The geometry
 * never implies co-transitors — the interior publishes nothing (FR-34) — and
 * the ambush FX are abstract (flash frames, a sweeping dark bar, blackout):
 * no silhouette, no identity hint (the victim learns only THAT they were
 * ambushed, never by whom).
 */

/** Presentation-only constants (see module docstring for why they live here). */
export const CLIMB = {
  /** Scroll distance of one floor stride (2 screen-heights of stairwell). */
  stridePx: 1152,
  /** Treads per stride — the bob cadence and the step layout. */
  treads: 7,
  /** Horizontal run of one tread (px, band-local). */
  treadRun: 150,
  /** Sprite bob amplitude per tread (px). */
  bobPx: 7,
  /** Scuffle window at stun start: flash frames + the dark sweep (ms). */
  impactMs: 700,
  /** Blackout fade-in length after the impact window (ms). */
  blackoutFadeMs: 400,
  /** Heartbeat vignette pulse period while stunned (ms) — drives the audio. */
  heartbeatMs: 900,
  /** Resume-lurch kick duration when the interrupted transit resumes (ms). */
  lurchMs: 280,
  /** The lurch kick's peak displacement (px). */
  lurchPx: 9,
} as const

/** The stair surface point (band-local) under the walker at walk-fraction w. */
export function stairPoint(w: number): { x: number; y: number } {
  return { x: -420 + CLIMB.treadRun * 7 * w, y: 120 - CLIMB.stridePx * w }
}

/**
 * Walk fraction 0..1 from a transit readout: `remainingMs` counts down the
 * stride, so elapsed = transit − remaining. Clamped — expired transits (the
 * local clock may overshoot before the next snapshot) pin at the arrival.
 */
export function climbWalkFraction(remainingMs: number): number {
  const transitMs = TUNING.STAIRS_TRANSIT_SECONDS * 1000
  const elapsed = Math.max(0, Math.min(transitMs, transitMs - remainingMs))
  return elapsed / transitMs
}

/** The sprite bob at walk fraction w: zero at the landings, one bump per tread. */
export function climbBobY(w: number): number {
  return Math.abs(Math.sin(w * CLIMB.treads * Math.PI)) * CLIMB.bobPx
}

/** Warm sconce flicker in 0.55..1 — layered slow sines, `seed` desyncs lamps. */
export function sconceAlpha(nowMs: number, seed: number): number {
  const a =
    0.78 + 0.14 * Math.sin(nowMs * 0.011 + seed) + 0.08 * Math.sin(nowMs * 0.037 + seed * 2.7)
  return Math.max(0.55, Math.min(1, a))
}

/** Readouts of the scuffle/blackout ambush sequence at `elapsedStunMs`. */
export interface StunFx {
  /** White impact flash alpha (first slice of the impact window). */
  readonly flashAlpha: number
  /** Red shock-frame alpha (fades across the impact window). */
  readonly redAlpha: number
  /** Normalized sweep position -1..1 of the abstract dark bar; null = hidden. */
  readonly sweepX: number | null
  /** Blackout overlay alpha (eases to full after the impact window). */
  readonly blackoutAlpha: number
  /** Red vignette pulse alpha (heartbeat), zero during the impact window. */
  readonly vignetteAlpha: number
}

/**
 * The victim-only ambush sequence: impact (`CLIMB.impactMs`) → blackout with
 * a heartbeat-pulsing vignette for the rest of the stun. `nowMs` drives the
 * continuous pulse so the rhythm survives frame-time jitter.
 */
export function stunFx(elapsedStunMs: number, nowMs: number): StunFx {
  const inImpact = elapsedStunMs >= 0 && elapsedStunMs < CLIMB.impactMs
  const flashAlpha = inImpact ? Math.max(0, 1 - elapsedStunMs / (CLIMB.impactMs * 0.45)) * 0.85 : 0
  const redAlpha = inImpact ? Math.max(0, 0.32 * (1 - elapsedStunMs / CLIMB.impactMs)) : 0
  let sweepX: number | null = null
  if (inImpact && elapsedStunMs > CLIMB.impactMs * 0.15) {
    const p = (elapsedStunMs - CLIMB.impactMs * 0.15) / (CLIMB.impactMs * 0.85)
    sweepX = -1 + 2 * Math.min(1, p)
  }
  const blackoutT = Math.max(
    0,
    Math.min(1, (elapsedStunMs - CLIMB.impactMs) / CLIMB.blackoutFadeMs),
  )
  const blackoutAlpha = 0.94 * blackoutT
  const pulse = Math.max(
    0,
    Math.sin((2 * Math.PI * (nowMs % CLIMB.heartbeatMs)) / CLIMB.heartbeatMs),
  )
  const vignetteAlpha = blackoutT >= 1 ? 0.16 + 0.34 * pulse * pulse : 0
  return { flashAlpha, redAlpha, sweepX, blackoutAlpha, vignetteAlpha }
}

/**
 * The resume lurch: a decaying double-kick of the band's y when the
 * interrupted transit resumes. Zero outside the lurch window.
 */
export function lurchKickY(elapsedLurchMs: number): number {
  if (elapsedLurchMs < 0 || elapsedLurchMs >= CLIMB.lurchMs) return 0
  const t = elapsedLurchMs / CLIMB.lurchMs
  return Math.sin(t * Math.PI * 2) * CLIMB.lurchPx * (1 - t)
}
