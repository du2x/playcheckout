import { describe, expect, it } from 'vitest'
import { TUNING } from './tuning'

// Expected values copied verbatim from prd §7 (single source of truth, locked).
describe('tuning table', () => {
  it('matches prd §7 player and shift values', () => {
    expect(TUNING.PLAYERS_MIN).toBe(4)
    expect(TUNING.PLAYERS_MAX).toBe(6)
    expect(TUNING.SHIFT_SECONDS).toBe(300)
  })

  it('matches prd §7 work-channel durations', () => {
    expect(TUNING.PREP_SECONDS).toBe(5)
    expect(TUNING.UNPREP_SECONDS).toBe(3)
    expect(TUNING.RE_TRASH_LIMIT).toBe(Number.POSITIVE_INFINITY)
  })

  it('matches prd §7 win-condition and freshness thresholds', () => {
    expect(TUNING.COVERAGE_TARGET).toBe(0.8)
    expect(TUNING.STAFF_ATTRITION_FLOOR).toBe(1)
    expect(TUNING.FRESHNESS_WINDOW_SECONDS).toBe(75)
  })

  it('matches prd §7 evidence and justice ranges', () => {
    expect(TUNING.RUSTLE_RANGE_TILES).toBe(3)
    expect(TUNING.ACCUSATION_RANGE_TILES).toBe(2)
  })

  it('matches prd §7 elevator cycle values', () => {
    expect(TUNING.ELEVATOR_ARRIVE_SECONDS).toBe(3)
    expect(TUNING.ELEVATOR_RIDE_SECONDS_PER_FLOOR).toBe(2)
    expect(TUNING.ELEVATOR_CAPACITY).toBe(2)
  })

  it('pins the AD-026/027 door stages (not in §7 — recorded decisions)', () => {
    expect(TUNING.ELEVATOR_DWELL_SECONDS).toBe(3)
    expect(TUNING.ELEVATOR_DOOR_SECONDS).toBe(0.5)
  })

  it('matches prd §7 movement speed', () => {
    expect(TUNING.PLAYER_SPEED_TILES_PER_SEC).toBe(6)
  })

  it('matches prd §7 v1.3 guest cadence, dwell, and impatience (AD-022)', () => {
    expect(TUNING.GUEST_CADENCE_SECONDS[4]).toBe(30)
    expect(TUNING.GUEST_CADENCE_SECONDS[5]).toBe(24)
    expect(TUNING.GUEST_CADENCE_SECONDS[6]).toBe(18)
    expect(TUNING.GUEST_DWELL_MIN_SECONDS).toBe(45)
    expect(TUNING.GUEST_DWELL_MAX_SECONDS).toBe(90)
    expect(TUNING.GUEST_IMPATIENCE_SECONDS).toBe(20)
  })

  it('pins the AD-028 desk/queue geometry (not in §7 — recorded decisions)', () => {
    expect(TUNING.DESK_X_TILES).toBe(15)
    expect(TUNING.GUEST_QUEUE_SPACING_TILES).toBe(1)
  })
})
