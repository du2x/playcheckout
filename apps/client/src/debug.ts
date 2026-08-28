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
