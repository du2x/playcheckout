/**
 * FR-23/FR-24 telemetry schema (server-authoritative JSONL, internal only — never
 * client-bound). Widened in cycle 3.6 from the 6-kind placeholder to the post-guest
 * 14+ kind union + guest rows + tenancy + carry-clock + round-ended marker.
 * Mirrors the emitted sim/movement event stream 1:1: if it isn't a domain fact,
 * it isn't logged (protocol rule), except for the synthetic 1/s coverage-sample.
 */

import type { RoomState } from '../roomState.js'
import type { CarId, FloorId, RoomIndex } from './messages.js'

/** Nothing here is ever sent to a client — file-internal telemetry sink only. */
export type TelemetryEventKind =
  | 'room-transition'
  | 'elevator-call'
  | 'elevator-ride'
  | 'elevator-doors'
  | 'walk-in-catch'
  | 'accusation'
  | 'coverage-sample'
  // guest extension (cycle 3.6, roadmap 3.6 guest rows)
  | 'guest-arrived'
  | 'guest-assigned'
  | 'guest-self-assigned'
  | 'suitcase-carried'
  | 'suitcase-placed'
  | 'suitcase-picked-up'
  | 'guest-settled'
  | 'guest-checked-out'
  | 'guest-left'
  | 'guest-angered'
  | 'guest-discovered'
  | 'guest-complained'
  | 'tenancy'
  | 'carry-clock-expiry'
  | 'round-ended'

export interface TelemetryEvent {
  readonly kind: TelemetryEventKind
  /** Server simulation tick (0-based). */
  readonly tick: number
  /** Server simulation time (ms since round start, tick * 50). */
  readonly time: number
  /** Actor player id — present for room-transition (prep actor), elevator-call, walk-in-catch (entrant), accusation (accuser), carry-clock-expiry (carrier). Omitted for churn transitions, coverage-sample, and guest-only rows where guestId is the subject. */
  readonly actor?: string
  /** Room id for room-transition; target room of an elevator call/ride; carried alongside floor/roomIdx for readability. */
  readonly room?: string // "floor1:3" for room-transition
  /** Floor id for elevator/room/guest events. */
  readonly floor?: FloorId
  /** Room index for room/guest events. */
  readonly roomIdx?: RoomIndex
  /** Car id for elevator events. */
  readonly car?: CarId
  /** Guest subject for guest rows. */
  readonly guestId?: string
  /** Suitcase carrier for suitcase-carried / picked_up. */
  readonly carrierId?: string
  /** walk-in-catch: saboteur caught mid-un-prep. */
  readonly caughtPlayer?: string
  /** accusation: target player id. */
  readonly targetId?: string
  /** accusation only — prd FR-23 flags. */
  readonly wasTargetSaboteur?: boolean
  /** accusation only — did the accused actually commit a crime (Justice.didSabotage). */
  readonly crimeOccurred?: boolean
  /** coverage-sample only, 0..1, sampled once per second (FR-23). */
  readonly coverage?: number
  /** Elevator-doors only. */
  readonly open?: boolean
  /** Guest-discovered: freshness the discoverer observed. */
  readonly fresh?: boolean
  /** Guest-discovered / room-transition: author dimension. Churn vs sabotage (FR-32) or none. */
  readonly provenance?: 'sabotage' | 'churn' | 'none'
  /** For sabotage provenance on guest-discovered: the saboteur's playerId. */
  readonly actorId?: string
  /** Room-transition: resulting state. */
  readonly state?: RoomState
  /** tenancy only: Occupied vs Vacant flip-sign. */
  readonly occupied?: boolean
  /** round-ended only: machine-readable close marker. */
  readonly winner?: 'staff' | 'saboteur' | 'aborted'
  readonly reason?: string
  readonly saboteurId?: string | null
}

/** JSONL line — alias kept for the widened shape; every line is one TelemetryEvent. */
export type TelemetryLine = TelemetryEvent

/** KPI aggregation over one or more rounds' JSONL lines (FR-24 + guest bleed-vs-throughput). */
export interface Kpis {
  readonly rounds: number
  readonly abortedRounds: number
  readonly malformedLines: number
  // v1.2 five
  readonly saboteurWinRate: number
  readonly correctAccusationRate: number
  readonly catchesPerHour: number
  readonly meanTimeToFirstCrimeSeconds: number | null
  readonly decoyCallRate: number
  // guest bleed-vs-throughput four + provenance split
  readonly meanSettleScore: number
  readonly meanComplaintsPerRound: number
  readonly carryClockFiresPerRound: number
  readonly provenanceSplit: { readonly sabotage: number; readonly churn: number }
  readonly settlesPerMinute: number
}
