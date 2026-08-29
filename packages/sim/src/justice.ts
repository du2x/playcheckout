import type { FireReason, Role, SimEvent } from '@turnover/shared'

/**
 * Pure justice system (cycle 2.8, FR-15/17/18/19): verdicts and the fired set
 * — the game's two-tier justice as inputs in, events out. Composed by
 * RoundSim, which feeds walk-in detections, sabotage notifications, and
 * accusation intents; this module never sees positions, the wire, or clocks.
 *
 * Hidden-information contract: a verdict's `reason` is server-internal
 * telemetry fuel (FR-23, cycle 2.10). The registry projection strips it, so
 * every firing reaches clients as a name-only `{playerId}` payload (FR-18) —
 * validity is revealed only on the recap (FR-22, cycle 2.9).
 */

export class Justice {
  private readonly firedIds = new Set<string>()
  private readonly pending: Extract<SimEvent, { type: 'player:fired' }>[] = []
  /** The single saboteur's id (deal invariant: exactly one per round). */
  readonly saboteurId: string
  /**
   * Grace state (FR-18): true once the saboteur's first un-prep has COMPLETED
   * (`room:trashed` emitted). Fully hidden — it exists only to route accusation
   * verdicts and never leaves the server.
   */
  private saboteurHasUnprepped = false

  constructor(deal: ReadonlyMap<string, Role>) {
    const saboteurs = [...deal.entries()].filter(([, role]) => role === 'saboteur')
    const first = saboteurs[0]
    if (saboteurs.length !== 1 || first === undefined) {
      throw new Error(`deal must contain exactly one saboteur, got ${saboteurs.length}`)
    }
    this.saboteurId = first[0]
  }

  isFired(playerId: string): boolean {
    return this.firedIds.has(playerId)
  }

  /** Grace query for accusation validity (JUST-07). */
  get graceEnded(): boolean {
    return this.saboteurHasUnprepped
  }

  /**
   * Grace end: the saboteur's first un-prep COMPLETED (design: `room:trashed`
   * can only come from a completed un-prep — RoundSim attributes it to the
   * saboteur directly; the deal has exactly one). Idempotent: re-trashing
   * re-notifies, the flag only ever flips false → true.
   */
  noteSabotage(): void {
    this.saboteurHasUnprepped = true
  }

  /**
   * Walk-in conviction (FR-15): the entrant entered the un-prepping room's
   * segment. Fires the channel owner — instantly, per FR-15; the owner can
   * never trigger it themselves (their walk-out cancelled the channel first,
   * FR-16) and fired players cannot enter anything. Returns the fired id or
   * null when no conviction applies.
   */
  walkIn(entrantId: string, channelOwnerId: string | null): string | null {
    if (channelOwnerId === null || channelOwnerId === entrantId) return null
    if (this.isFired(entrantId) || this.isFired(channelOwnerId)) return null
    this.fire(channelOwnerId, 'walkin')
    return channelOwnerId
  }

  /**
   * Accusation validity (JUST-07/08, FR-18/19): correct = the target is the
   * saboteur AND the grace window has ended; everything else — innocent
   * target or saboteur still in grace — is wrong and fires the ACCUSER,
   * indistinguishably. Eligibility (who may accuse, range, live-ness) is the
   * caller's job; this method only routes the verdict. The return value is
   * for tests/telemetry — it must never reach a client-bound payload.
   */
  accuse(accuserId: string, targetId: string): 'correct' | 'wrong' {
    if (targetId === this.saboteurId && this.saboteurHasUnprepped) {
      this.fire(targetId, 'correct-accusation')
      return 'correct'
    }
    this.fire(accuserId, 'wrong-accusation')
    return 'wrong'
  }

  /** Drain the events queued by this tick's verdicts (announce pattern). */
  drainPending(): readonly Extract<SimEvent, { type: 'player:fired' }>[] {
    return this.pending.splice(0)
  }

  fire(playerId: string, reason: FireReason): void {
    if (this.firedIds.has(playerId)) return
    this.firedIds.add(playerId)
    this.pending.push({ type: 'player:fired', playerId, reason })
  }
}
