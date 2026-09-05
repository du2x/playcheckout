import { GUEST_FLOOR_IDS, roomIndexAtMilli } from '@turnover/shared'

/**
 * Room-zoom presenter (work-channel camera focus): the pure math behind the
 * camera's integer 2× ease WHILE the own player runs a work channel inside a
 * room segment — prep, un-prep, or fake prep (FR-7/8/9) — and the exact
 * restore to the identity view when the channel ends or is walked out
 * (FR-16). No Phaser, no DOM: the scene consumes these readouts per frame
 * the same way `climbPresenter`/`elevatorPresenter` feed their visuals.
 *
 * The corridor stays visible and populated while zoomed (FR-10/FR-15/FR-16
 * untouched) — the far ends of the floor merely leave the frame. The zoom is
 * presentation-only: no sim, protocol, or tuning surface (AD-053/054
 * precedent); the integer target honors the AD-049 presentation contract.
 * The policy lives HERE (one home, the AD-037 pinch rule) and is consumed
 * by the scene per frame.
 */

/** Presentation-only constants (see module docstring for why they live here). */
export const ROOM_ZOOM = {
  /** The eased-in zoom level — integer per the AD-049 contract. */
  level: 2,
  /** Exponential approach rate per second (99 % in ~0.5 s). */
  easeRatePerSec: 9,
  /** Zoom distance at which the ease snaps exactly onto its target. */
  zoomSnap: 0.002,
  /** Scroll distance (px) at which the ease snaps exactly onto its target. */
  scrollSnapPx: 0.25,
} as const

/** The camera transform the scene owns: zoom plus world-space scroll. */
export interface ZoomView {
  readonly zoom: number
  readonly scrollX: number
  readonly scrollY: number
}

/** The identity view — the DOM overlay alignment contract at rest (R3). */
export const REST_ZOOM: ZoomView = { zoom: 1, scrollX: 0, scrollY: 0 }

/**
 * The scene-side facts the zoom policy reads. `floor`/`xTiles` are null when
 * the own display is unknown this frame; `riding` and `inStairBox` are the
 * floorless states whose full-screen interiors must not be zoomed under;
 * `channeling` is a live work channel of the own player (the self
 * `work:started` → `work:ended` window).
 */
export interface ZoomFacts {
  readonly spectator: boolean
  readonly riding: boolean
  readonly inStairBox: boolean
  readonly channeling: boolean
  readonly floor: string | null
  readonly xTiles: number | null
}

/**
 * The zoom trigger (R1/R2): active exactly while a live, non-floorless own
 * player runs a work channel inside a room segment on a guest floor. A
 * channel exists only inside a segment (the server validates `work:start`
 * against the room's segment), so `channeling` alone would suffice — the
 * floor/segment predicates stay as the one-home guarantee that the zoom
 * never fires outside a room (and that it restores the instant the player
 * walks out, ahead of the `work:ended` echo). Segment membership is the
 * shared `roomIndexAtMilli` predicate — no mirrored expression — and the
 * guest-floor gate is `GUEST_FLOOR_IDS` (the lobby and mezzanine have no
 * rooms; the predicate alone is x-only and must not fire there).
 */
export function roomZoomActive(facts: ZoomFacts): boolean {
  if (facts.spectator || facts.riding || facts.inStairBox || !facts.channeling) return false
  if (facts.floor === null || facts.xTiles === null) return false
  if (!(GUEST_FLOOR_IDS as readonly string[]).includes(facts.floor)) return false
  return roomIndexAtMilli(Math.round(facts.xTiles * 1000)) !== 0
}

/** The camera framing the ease converges onto for a frame's desire. */
export interface ZoomTarget {
  readonly active: boolean
  readonly zoom: number
  readonly scrollX: number
  readonly scrollY: number
}

/**
 * The frame's target view: rest (the exact identity) or the zoom level
 * centered on the own player, clamped so the view never leaves the world
 * (scroll = clamped center − half viewport). At rest the target is exactly
 * REST_ZOOM, so the eased scroll converges on exactly (0, 0).
 */
export function zoomTarget(
  active: boolean,
  centerXPx: number,
  centerYPx: number,
  viewportW: number,
  viewportH: number,
): ZoomTarget {
  if (!active) return { active: false, zoom: REST_ZOOM.zoom, scrollX: 0, scrollY: 0 }
  const halfW = viewportW / (2 * ROOM_ZOOM.level)
  const halfH = viewportH / (2 * ROOM_ZOOM.level)
  const centerX = Math.min(viewportW - halfW, Math.max(halfW, centerXPx))
  const centerY = Math.min(viewportH - halfH, Math.max(halfH, centerYPx))
  return {
    active: true,
    zoom: ROOM_ZOOM.level,
    scrollX: centerX - viewportW / 2,
    scrollY: centerY - viewportH / 2,
  }
}

/**
 * One eased step from `current` toward `target`. Exponential approach with a
 * per-component snap, so the rest landing is EXACT (R3: zoom 1, scroll 0, 0 —
 * never a lingering 0.999… that would blur pixels and drift the DOM
 * contract). `dtSec ≤ 0` yields the current view unchanged.
 */
export function advanceZoom(current: ZoomView, target: ZoomTarget, dtSec: number): ZoomView {
  const k = Math.min(1, Math.max(0, dtSec) * ROOM_ZOOM.easeRatePerSec)
  const zoom = easeComponent(current.zoom, target.zoom, k, ROOM_ZOOM.zoomSnap)
  const scrollX = easeComponent(current.scrollX, target.scrollX, k, ROOM_ZOOM.scrollSnapPx)
  const scrollY = easeComponent(current.scrollY, target.scrollY, k, ROOM_ZOOM.scrollSnapPx)
  if (zoom === target.zoom && scrollX === target.scrollX && scrollY === target.scrollY) {
    return { zoom: target.zoom, scrollX: target.scrollX, scrollY: target.scrollY }
  }
  return { zoom, scrollX, scrollY }
}

/** Exponential approach with an exact snap inside `snap` of the target. */
function easeComponent(value: number, target: number, k: number, snap: number): number {
  if (Math.abs(target - value) < snap) return target
  return value + (target - value) * k
}

/**
 * The CSS transform that puts the world-anchored DOM marker layer in lockstep
 * with the camera: screen = (world − scroll) × zoom, origin top-left (the
 * scene sets `transform-origin: 0 0` once at layer creation). Empty string at
 * the exact rest view — the layer's untransformed default (R3).
 */
export function zoomLayerTransform(view: ZoomView): string {
  if (view.zoom === 1 && view.scrollX === 0 && view.scrollY === 0) return ''
  return `translate(${-view.scrollX}px, ${-view.scrollY}px) scale(${view.zoom})`
}
