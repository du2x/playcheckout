/**
 * Tuning values — single source of truth, verbatim from prd §7 (v1.2, decisions locked).
 * Changing a value is a recorded decision in .specs/STATE.md (AD-NNN), never an
 * incidental edit.
 */
export type LobbySize = 4 | 5 | 6

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
  /** Open-door dwell at every stop (cycle 2.6, AD-014 — new constant, not in prd §7).
   *  AD-027: raised to 3 s — the MINIMUM time the doors stay open; they stay
   *  open beyond it until the car has a call to attend. */
  ELEVATOR_DWELL_SECONDS: 3,
  /** Door swing duration, BOTH directions — the opening and closing stages at
   *  every stop (AD-026 — new constant, not in prd §7). Hop-in/hop-off is
   *  impossible while the doors swing; riders may hop only through fully
   *  open doors (the 1 s dwell). */
  ELEVATOR_DOOR_SECONDS: 0.5,
  ELEVATOR_CAPACITY: 2,
  PLAYER_SPEED_TILES_PER_SEC: 6,
  /** Boarding range around a car's landing x (cycle 2.4, AD-007 — new constant, not in prd §7). */
  ELEVATOR_LANDING_TILES: 1,
  /** ~2 tiles, same floor; card-read range later */
  ACCUSATION_RANGE_TILES: 2,
  /** Guest arrival cadence in seconds by lobby size (prd §7 v1.3, AD-022).
   *  Fixed interval, no jitter; first arrival one full interval after round
   *  start. The 4-player value is the designated reserve dial. */
  GUEST_CADENCE_SECONDS: { 4: 30, 5: 24, 6: 18 } as Record<LobbySize, number>,
  /** Settled guest dwell, uniform per guest (prd §7 v1.3, AD-022). */
  GUEST_DWELL_MIN_SECONDS: 45,
  GUEST_DWELL_MAX_SECONDS: 90,
  /** Unrouted guest impatience (prd §7 v1.3, AD-022): foot-tap + bell, then
   *  self-assign. Waiting is free — no complaint cost. */
  GUEST_IMPATIENCE_SECONDS: 20,
  /** Front-desk x in the grand lobby (AD-028 — new constant, not in prd §7):
   *  lobby center of the 30-tile hall; the guest queue extends eastward. */
  DESK_X_TILES: 15,
  /** Gap between consecutive queue slots (AD-028 — new constant, not in prd §7). */
  GUEST_QUEUE_SPACING_TILES: 1,
} as const
