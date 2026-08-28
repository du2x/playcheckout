import { Room } from 'colyseus'

/**
 * Phase 1 placeholder: proves the Fastify-hosted transport (AD-001) before Phase 2
 * stacks game logic on it. Message-only — no Schema state, patchRate null (protocol
 * leak rule 1: the server never syncs state).
 */
export class PlaceholderRoom extends Room {
  /** Test hook: tracks created instances so tests can assert message-only config. */
  static instances: PlaceholderRoom[] = []

  override onCreate() {
    this.patchRate = null
    PlaceholderRoom.instances.push(this)
  }

  override onJoin() {
    // Join-only room; Phase 2 replaces this with the real round lifecycle.
  }
}
