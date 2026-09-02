import { TUNING } from '@turnover/shared'

/**
 * The complaint-budget HUD presenter (cycle 3.3, FR-31/FR-14): a pure counter
 * over the public `guest:discovered` stream — the trash-discovery desk reports
 * — mirrored after the ScoreHud presenter (AD-038 pattern): no state home of
 * its own, no transport knowledge. Wrong-delivery door complaints
 * (`guest:complained`) never reach it — they count toward nothing (AD-039).
 */
export class ComplaintHud {
  /** FR-14: the counter pulses red when nearing the budget — a UI threshold
   *  from the prd's HUD contract, not a §7 dial (derived from the budget so
   *  the tuning denylist is not tripped). */
  static readonly PULSE_AT = TUNING.COMPLAINT_BUDGET - 2

  private _count = 0
  private readonly budget: number
  private frozen = false

  constructor(budget: number) {
    this.budget = budget
  }

  /** One trash-discovery complaint — ignored once the round has ended. */
  onDiscovered(): void {
    if (this.frozen) return
    this._count += 1
  }

  /** Reconnect re-store (round:resumed): re-seed to the server's truth. */
  seed(count: number): void {
    if (this.frozen) return
    this._count = count
  }

  /** Fresh deal: zero the count against the §7 budget. */
  reset(): void {
    this._count = 0
    this.frozen = false
  }

  /** Round over — the counter freezes at its final value. */
  freeze(): void {
    this.frozen = true
  }

  get count(): number {
    return this._count
  }

  /** FR-14: red pulse from the 6th complaint on. */
  get pulsing(): boolean {
    return this._count >= ComplaintHud.PULSE_AT
  }

  render(): string {
    return `Complaints ${this._count} / ${this.budget}`
  }
}

/** The §7 budget for the HUD's construction site. */
export const COMPLAINT_BUDGET = TUNING.COMPLAINT_BUDGET
