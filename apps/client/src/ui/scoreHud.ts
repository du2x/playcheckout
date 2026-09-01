/**
 * The settle-score HUD presenter (cycle 3.D, AD-039): a pure counter over the
 * public `guest:settled` stream — no state home of its own, no transport
 * knowledge. The scene mounts the DOM; App drives reset (fresh deal) and
 * seed (reconnect re-store).
 */
export class ScoreHud {
  private count: number
  private target: number
  private frozen = false

  constructor(target: number) {
    this.count = 0
    this.target = target
  }

  /** One public settle fact — ignored once the round has ended. */
  onSettled(): void {
    if (this.frozen) return
    this.count += 1
  }

  /** Reconnect re-store (round:resumed): re-seed to the server's truth. */
  seed(count: number): void {
    if (this.frozen) return
    this.count = count
  }

  /** Fresh deal: zero the count against the new lobby's target. */
  reset(target: number): void {
    this.count = 0
    this.target = target
    this.frozen = false
  }

  /** Round over — the counter freezes at its final value. */
  freeze(): void {
    this.frozen = true
  }

  get score(): number {
    return this.count
  }

  render(): string {
    return `Settled ${this.count} / ${this.target}`
  }
}
