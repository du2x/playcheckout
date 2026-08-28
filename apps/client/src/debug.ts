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
      local: { playerId: string | null; roomId: string | null }
      scene: (name: string) => Phaser.Scene | null
    }
  }
  w.__TURNOVER__ = {
    events: [],
    local: { playerId: null, roomId: null },
    scene: (name: string) => game.scene.getScene(name),
  }
}

/**
 * Record a received server message into the hook (harness contract: events are
 * exactly what this client received — its legitimate view). Prod builds DCE the
 * body away (strip check: no `__TURNOVER__` literal in the bundle).
 */
export function recordServerMessage(type: string, payload: unknown) {
  if (import.meta.env.MODE === 'production') return
  const w = window as unknown as { __TURNOVER__?: { events: unknown[] } }
  w.__TURNOVER__?.events.push({ type, payload, at: Date.now() })
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
