/**
 * FR-23 telemetry event schema (server-authoritative JSONL, internal only — never
 * client-bound). Mirrors the emitted event stream 1:1: if it isn't an event, it isn't
 * logged (protocol conventions).
 */

/** Nothing here is ever sent to a client — file-internal telemetry sink only. */
export type TelemetryEventKind =
  | 'room-transition'
  | 'elevator-call'
  | 'elevator-ride'
  | 'walk-in-catch'
  | 'accusation'
  | 'coverage-sample'

export interface TelemetryEvent {
  readonly kind: TelemetryEventKind
  /** Server simulation time (ms since round start). */
  readonly time: number
  /** Actor player id — present for all kinds except coverage-sample. */
  readonly actor?: string
  /** Room id for room-transition; target room of an elevator call/ride. */
  readonly room?: string
  /** Floor id for elevator events. */
  readonly floor?: string
  /** walk-in-catch: saboteur caught mid-un-prep. */
  readonly caughtPlayer?: string
  /** accusation only — prd FR-23 flags. */
  readonly wasTargetSaboteur?: boolean
  /** accusation only — did the accused actually commit a crime. */
  readonly crimeOccurred?: boolean
  /** coverage-sample only, 0..1, sampled once per second (FR-23). */
  readonly coverage?: number
}
