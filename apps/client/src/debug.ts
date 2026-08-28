import type Phaser from 'phaser'

/**
 * Dev/harness-only debug hook (turnover-client-harness contract). Exposes exactly
 * what this client already knows — never more (protocol leak rules). Production
 * builds tree-shake this call away; verified by the gate-3 strip check (SKEL-08).
 */
export function installDebugHook(game: Phaser.Game) {
  if (import.meta.env.MODE === 'production') return

  const w = window as unknown as {
    __TURNOVER__?: {
      events: unknown[]
      gaps: { expected: number; actual: number; at: number }[]
      local: { playerId: string | null; roomId: string | null }
      scene: (name: string) => Phaser.Scene | null
      forceGap: () => void
    }
  }
  w.__TURNOVER__ = {
    events: [],
    gaps: [],
    local: { playerId: null, roomId: null },
    scene: (name: string) => game.scene.getScene(name),
    forceGap: () => {
      gapProbe?.()
    },
  }
}

/** The live connection's gap probe — set by Connection via registerGapProbe. */
let gapProbe: (() => void) | null = null

/**
 * Record a received server message into the hook (harness contract: events are
 * exactly what this client received — its legitimate view). Cycle 2.3: messages
 * arrive enveloped; the hook stores the inner payload plus the envelope fields
 * seq and time (REG-14). Prod builds DCE the body away (strip check).
 */
export function recordServerMessage(type: string, envelope: EnvelopeLike) {
  if (import.meta.env.MODE === 'production') return
  const w = window as unknown as { __TURNOVER__?: { events: unknown[] } }
  w.__TURNOVER__?.events.push({
    type,
    payload: envelope.payload,
    seq: envelope.seq,
    time: envelope.time,
    at: Date.now(),
  })
}

export interface GapRecord {
  expected: number
  actual: number
  at: number
}

/** Record an observed seq gap (REG-16); dev hook only. */
export function recordGap(gap: GapRecord) {
  if (import.meta.env.MODE === 'production') return
  const w = window as unknown as { __TURNOVER__?: { gaps: GapRecord[] } }
  w.__TURNOVER__?.gaps.push(gap)
}

/** Dev hook only: let __TURNOVER__.forceGap() corrupt the live connection's seq expectation. */
export function registerGapProbe(probe: () => void) {
  if (import.meta.env.MODE === 'production') return
  gapProbe = probe
}

interface EnvelopeLike {
  payload: unknown
  seq: number
  time: number
}

/** Store the local player's own identity in the hook after a successful join. */
export function setLocalIdentity(playerId: string | null, roomId: string | null) {
  if (import.meta.env.MODE === 'production') return
  const w = window as unknown as {
    __TURNOVER__?: { local: { playerId: string | null; roomId: string | null } }
  }
  if (w.__TURNOVER__) {
    w.__TURNOVER__.local.playerId = playerId
    w.__TURNOVER__.local.roomId = roomId
  }
}
