/**
 * Tuning values — single source of truth, verbatim from prd §7 (v1.2, decisions locked).
 * Changing a value is a recorded decision in .specs/STATE.md (AD-NNN), never an
 * incidental edit.
 */
export const TUNING = {
  PLAYERS_MIN: 4,
  PLAYERS_MAX: 6,
  /** 5:00 shift */
  SHIFT_SECONDS: 300,
  PREP_SECONDS: 5,
  UNPREP_SECONDS: 3,
  /** Reserve dial: un-prep → 2s if saboteur weak */
  RE_TRASH_LIMIT: Number.POSITIVE_INFINITY,
  /** 80% of rooms prepped at buzzer */
  COVERAGE_TARGET: 0.8,
  /** Reserve dial: scale by lobby size later */
  STAFF_ATTRITION_FLOOR: 1,
  FRESHNESS_WINDOW_SECONDS: 75,
  RUSTLE_RANGE_TILES: 3,
  ELEVATOR_ARRIVE_SECONDS: 3,
  ELEVATOR_RIDE_SECONDS_PER_FLOOR: 2,
  ELEVATOR_CAPACITY: 2,
  PLAYER_SPEED_TILES_PER_SEC: 6,
  /** Boarding range around a car's landing x (cycle 2.4, AD-007 — new constant, not in prd §7). */
  ELEVATOR_LANDING_TILES: 1,
  /** ~2 tiles, same floor; card-read range later */
  ACCUSATION_RANGE_TILES: 2,
} as const
