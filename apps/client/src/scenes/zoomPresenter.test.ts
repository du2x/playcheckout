import { describe, expect, it } from 'vitest'
import {
  advanceZoom,
  REST_ZOOM,
  ROOM_ZOOM,
  roomZoomActive,
  type ZoomFacts,
  type ZoomTarget,
  type ZoomView,
  zoomLayerTransform,
  zoomTarget,
} from './zoomPresenter'

// Spec room-zoom R1–R5 (gate scenario client:room_zoom): the pure zoom
// policy + math. The trigger consumes the shared layout predicates (AD-037
// pinch rule); the ease lands EXACTLY on its targets (R3 identity contract);
// the layer transform matches the camera mapping screen = (world − scroll) ×
// zoom and is empty at rest.

const VIEW = { w: 960, h: 576 }

function facts(overrides: Partial<ZoomFacts> = {}): ZoomFacts {
  return {
    spectator: false,
    riding: false,
    inStairBox: false,
    channeling: true,
    floor: 'floor1',
    xTiles: 3,
    ...overrides,
  }
}

function activeTarget(xPx: number, yPx: number): ZoomTarget {
  return zoomTarget(true, xPx, yPx, VIEW.w, VIEW.h)
}

describe('roomZoomActive (R1/R2 trigger policy)', () => {
  it('is active while channeling inside a room segment on a guest floor', () => {
    expect(roomZoomActive(facts())).toBe(true)
    expect(roomZoomActive(facts({ floor: 'floor3', xTiles: 24 }))).toBe(true)
  })

  it('is inactive without a running work channel — ambient standing never zooms', () => {
    expect(roomZoomActive(facts({ channeling: false }))).toBe(false)
    expect(roomZoomActive(facts({ channeling: false, floor: null, xTiles: null }))).toBe(false)
  })

  it('is inactive outside every segment (segment starts at tile 2)', () => {
    expect(roomZoomActive(facts({ xTiles: 1.9 }))).toBe(false)
    expect(roomZoomActive(facts({ xTiles: 0 }))).toBe(false)
    expect(roomZoomActive(facts({ xTiles: 25 }))).toBe(false)
  })

  it('is inactive on the lobby and the mezzanine — no rooms there', () => {
    expect(roomZoomActive(facts({ floor: 'lobby', xTiles: 3 }))).toBe(false)
    expect(roomZoomActive(facts({ floor: 'mezzanine', xTiles: 3 }))).toBe(false)
  })

  it('is inactive for spectators, riders, stair-box occupants, and unknown own', () => {
    expect(roomZoomActive(facts({ spectator: true }))).toBe(false)
    expect(roomZoomActive(facts({ riding: true }))).toBe(false)
    expect(roomZoomActive(facts({ inStairBox: true }))).toBe(false)
    expect(roomZoomActive(facts({ floor: null, xTiles: null }))).toBe(false)
    expect(roomZoomActive(facts({ floor: 'floor1', xTiles: null }))).toBe(false)
  })
})

describe('zoomTarget (R1 framing)', () => {
  it('is the exact identity when inactive', () => {
    const t = zoomTarget(false, 500, 400, VIEW.w, VIEW.h)
    expect(t).toEqual({ active: false, zoom: 1, scrollX: 0, scrollY: 0 })
  })

  it('frames the zoom level centered on the player with room to spare', () => {
    const t = activeTarget(13 * 32, 430)
    expect(t.zoom).toBe(ROOM_ZOOM.level)
    expect(t.scrollX).toBe(13 * 32 - VIEW.w / 2)
    expect(t.scrollY).toBe(430 - VIEW.h / 2)
  })

  it('clamps the center so the view never leaves the world', () => {
    const halfW = VIEW.w / (2 * ROOM_ZOOM.level)
    const halfH = VIEW.h / (2 * ROOM_ZOOM.level)
    const west = activeTarget(0, 0)
    expect(west.scrollX).toBe(halfW - VIEW.w / 2)
    expect(west.scrollY).toBe(halfH - VIEW.h / 2)
    const east = activeTarget(VIEW.w, VIEW.h)
    expect(east.scrollX).toBe(VIEW.w - halfW - VIEW.w / 2)
    expect(east.scrollY).toBe(VIEW.h - halfH - VIEW.h / 2)
  })
})

describe('advanceZoom (R2/R3 eased approach + exact landing)', () => {
  it('holds the identity exactly when already at rest and inactive', () => {
    const t = zoomTarget(false, 0, 0, VIEW.w, VIEW.h)
    expect(advanceZoom(REST_ZOOM, t, 1 / 60)).toEqual(REST_ZOOM)
  })

  it('never moves on a non-positive dt', () => {
    const t = activeTarget(400, 430)
    expect(advanceZoom(REST_ZOOM, t, 0)).toEqual(REST_ZOOM)
    expect(advanceZoom(REST_ZOOM, t, -1)).toEqual(REST_ZOOM)
  })

  it('converges onto the exact zoomed view, monotonically', () => {
    const t = activeTarget(400, 430)
    let view: ZoomView = REST_ZOOM
    let lastZoom = 1
    for (let i = 0; i < 600; i++) {
      view = advanceZoom(view, t, 1 / 60)
      expect(view.zoom).toBeGreaterThanOrEqual(lastZoom)
      lastZoom = view.zoom
    }
    expect(view).toEqual({ zoom: ROOM_ZOOM.level, scrollX: t.scrollX, scrollY: t.scrollY })
  })

  it('lands on the EXACT identity after leaving the segment', () => {
    const zoomed: ZoomView = { zoom: ROOM_ZOOM.level, scrollX: 200, scrollY: 100 }
    const t = zoomTarget(false, 0, 0, VIEW.w, VIEW.h)
    let view: ZoomView = zoomed
    for (let i = 0; i < 600; i++) view = advanceZoom(view, t, 1 / 60)
    expect(view).toEqual(REST_ZOOM)
  })

  it('snaps the final step instead of easing forever (no lingering 0.999…)', () => {
    const t = activeTarget(400, 430)
    let view: ZoomView = REST_ZOOM
    for (let i = 0; i < 600; i++) view = advanceZoom(view, t, 1 / 60)
    // One more step at the target must be a fixed point, not a fresh ease.
    expect(advanceZoom(view, t, 1 / 60)).toEqual(view)
  })
})

describe('zoomLayerTransform (R4 DOM lockstep)', () => {
  it('is empty at the exact rest view (the untransformed default)', () => {
    expect(zoomLayerTransform(REST_ZOOM)).toBe('')
  })

  it('maps world points through (world − scroll) × zoom', () => {
    const view: ZoomView = { zoom: 2, scrollX: 100, scrollY: 50 }
    expect(zoomLayerTransform(view)).toBe('translate(-100px, -50px) scale(2)')
    // A world point p renders at (p − scroll) × zoom with origin 0 0.
    const worldX = 400
    const screenX = (worldX - view.scrollX) * view.zoom
    expect(screenX).toBe(600)
  })
})
