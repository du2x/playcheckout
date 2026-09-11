/**
 * Work-visit presenter (the room work choreography): the pure state machine
 * behind the own player's fine work animation — walk INTO the room's work
 * spot, the door swinging shut behind them (open → ajar → closed), the scrub
 * loop while the channel runs, and the walk back out when it ends. No Phaser,
 * no DOM: the scene consumes the readout per frame exactly like
 * `zoomPresenter`/`climbPresenter` feed theirs.
 *
 * Presentation only (AD-053/054 precedent): the sim's positions, the channel
 * facts, and the protocol are untouched — the readout is a RENDER OFFSET on
 * the own display plus a door-texture override. Every channel kind plays the
 * identical choreography (FR-9: prep, un-prep, and fake prep are visually
 * indistinguishable). The walk-out cancel (FR-16) is the abort path: a fast,
 * walk-free return to sim truth.
 */

/** Presentation-only constants (animation feel, no tuning surface). */
export const WORK_VISIT = {
  /** Enter walk duration (s): the doorway → work spot stride. */
  enterSeconds: 0.55,
  /** Door swing duration (s), close and open alike. */
  doorSeconds: 0.24,
  /** Exit walk duration (s) once the channel completes. */
  exitSeconds: 0.45,
  /** Walk-out cancel: the fast, walk-free return to sim truth (s). */
  abortSeconds: 0.16,
  /** The work spot's depth into the room (px above the lane line). */
  spotDyPx: -14,
  /** The work spot's east bias from the room center (px, onto the rug). */
  spotDxPx: 8,
  /** Dust-puff period while the scrub loop runs (s). */
  dustPeriodSec: 0.9,
  /** Fraction of the swing spent in the ajar frame (close and open). */
  ajarFraction: 0.42,
} as const

/** The room door's visual state under the visit. */
export type WorkDoorState = 'open' | 'ajar' | 'closed'

/** 'idle' only on the final readout, after the exit walk lands. */
export type WorkVisitPhase = 'enter' | 'working' | 'exit' | 'idle'

export interface WorkVisitReadout {
  readonly phase: WorkVisitPhase
  /** Render offset in px — the scene adds it to the own display's sim x. */
  readonly offsetX: number
  readonly offsetY: number
  /** The door override for the visited room this frame. */
  readonly door: WorkDoorState
  /** True while the scrub pose owns the body (texture swap + loop). */
  readonly scrubbing: boolean
  /** True while the walk cycle owns the body (enter/exit strides). */
  readonly walking: boolean
  /** One-frame edges for the scene's one-shot audio. */
  readonly doorJustClosed: boolean
  readonly doorJustOpened: boolean
  /** One-frame edge: spawn a dust puff at the work spot. */
  readonly dustPuff: boolean
  /** The exit walk has landed — the scene may drop the visit. */
  readonly done: boolean
  /** The x direction of this frame's stride (-1 west, +1 east, 0 none). */
  readonly moveDir: -1 | 0 | 1
}

const smooth = (p: number): number => p * p * (3 - 2 * p)

/**
 * One own-player work visit. Constructed the moment the self `work:started`
 * arrives; `complete()`/`abort()` fire on the matching `work:ended` outcome;
 * `step(dtSec, simXPx)` advances everything one frame. `simXPx` is the own
 * display's LIVE sim position in px — the offsets always resolve against it,
 * so a sim-truth shift (the cancel walk racing the echo) can never strand the
 * sprite away from its body.
 */
export class WorkVisit {
  private phase: WorkVisitPhase = 'enter'
  private t = 0
  private fast = false
  private ox = 0
  private oy = 0
  private fromOx = 0
  private fromOy = 0
  private door: WorkDoorState = 'open'
  private dustClock = 0

  constructor(private readonly spotXPx: number) {}

  /** The channel finished its full duration: the unhurried walk back out. */
  complete(): void {
    if (this.phase === 'exit' || this.phase === 'idle') return
    this.beginReturn(false)
  }

  /** The channel was walked out (FR-16): a fast, walk-free snap back. */
  abort(): void {
    if (this.phase === 'exit' || this.phase === 'idle') return
    this.beginReturn(true)
  }

  private beginReturn(fast: boolean): void {
    this.fromOx = this.ox
    this.fromOy = this.oy
    this.fast = fast
    this.t = 0
    this.phase = 'exit'
  }

  step(dtSec: number, simXPx: number): WorkVisitReadout {
    const dt = Math.max(0, dtSec)
    this.t += dt
    const prevDoor = this.door
    let doorJustClosed = false
    let doorJustOpened = false
    let dustPuff = false
    let done = false

    if (this.phase === 'enter') {
      const p = Math.min(1, this.t / WORK_VISIT.enterSeconds)
      const e = smooth(p)
      const tx = this.spotXPx - simXPx
      this.ox = this.fromOx + (tx - this.fromOx) * e
      this.oy = this.fromOy + (WORK_VISIT.spotDyPx - this.fromOy) * e
      this.door = 'open'
      if (p >= 1) {
        this.phase = 'working'
        this.t = 0
        this.fromOx = this.ox
        this.fromOy = this.oy
      }
    } else if (this.phase === 'working') {
      // Hold the spot against live sim truth; the door swings shut.
      this.ox = this.spotXPx - simXPx
      this.oy = WORK_VISIT.spotDyPx
      const ajarFor = WORK_VISIT.doorSeconds * WORK_VISIT.ajarFraction
      this.door = this.t < ajarFor ? 'ajar' : 'closed'
      this.dustClock += dt
      if (this.dustClock >= WORK_VISIT.dustPeriodSec) {
        this.dustClock -= WORK_VISIT.dustPeriodSec
        dustPuff = true
      }
    } else if (this.phase === 'exit') {
      const span = this.fast ? WORK_VISIT.abortSeconds : WORK_VISIT.exitSeconds
      const p = Math.min(1, this.t / span)
      const e = smooth(p)
      this.ox = this.fromOx * (1 - e)
      this.oy = this.fromOy * (1 - e)
      const ajarFor = WORK_VISIT.doorSeconds * WORK_VISIT.ajarFraction
      this.door = this.t < ajarFor ? 'ajar' : 'open'
      if (p >= 1) {
        this.phase = 'idle'
        this.ox = 0
        this.oy = 0
        done = true
      }
    } else {
      // idle: the visit has landed — every further step reports done until
      // the scene drops it (the constructor's body is back on sim truth).
      done = true
    }

    if (prevDoor !== 'closed' && this.door === 'closed') doorJustClosed = true
    if (prevDoor !== 'open' && this.door === 'open' && !done) doorJustOpened = true

    const walking = this.phase === 'enter' || (this.phase === 'exit' && !this.fast)
    const scrubbing = this.phase === 'working'
    // The stride's x direction: enter walks toward the spot, exit walks home.
    const dirOf = (v: number): -1 | 0 | 1 => (Math.abs(v) < 0.5 ? 0 : v < 0 ? -1 : 1)
    const moveDir: -1 | 0 | 1 =
      this.phase === 'enter'
        ? dirOf(this.spotXPx - simXPx - this.fromOx)
        : this.phase === 'exit' && !this.fast
          ? dirOf(-this.fromOx)
          : 0

    return {
      phase: this.phase,
      offsetX: this.ox,
      offsetY: this.oy,
      door: this.door,
      scrubbing,
      walking,
      doorJustClosed,
      doorJustOpened,
      dustPuff,
      done,
      moveDir,
    }
  }
}
