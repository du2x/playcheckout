# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Denylist/scan tests must be discrimination-tested in the same task: the T4 literal guard initially scanned wrong relative paths and passed vacuously; inject a violation and confirm the scan finds it before committing any file-walking assertion.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: skeleton
- evidence: packages/sim/src/literals.test.ts (pre-commit T4 fix) (tests)
- last seen: 2026-08-28T00:35:14Z

### L-002 - When an implementation value drifts from a recorded AD decision (5s -> 8s test shift), update the AD record in the same commit that changes the value so the decision log never disagrees with the code.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `specs/decision-log` · harmful: 0
- features: first-light
- evidence: AD-004 / apps/client/harness/playwright.config.ts:20 (specs/decision-log)
- last seen: 2026-08-28T11:43:49Z

### L-003 - When a spec AC requires displaying the server's rejection reason, assert a value matcher on the reason text (e.g. /room not found/), not merely that some error text is visible.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `apps/client/harness` · harmful: 0
- features: first-light
- evidence: LIGHT-02 / apps/client/harness/lobby.spec.ts:76 (apps/client/harness)
- last seen: 2026-08-28T11:43:49Z

### L-004 - An AC listing multiple rejection causes needs one test path per cause - 'need more players' and 'round already active' are separate scenarios, not one.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `apps/client/harness` · harmful: 0
- features: first-light
- evidence: LIGHT-08 / apps/client/harness/lobby.spec.ts:218 (apps/client/harness)
- last seen: 2026-08-28T11:43:49Z

### L-005 - The vite dev proxy must forward the colyseus room websocket path /<processId>/<roomId> (SDK Client.buildEndpoint), not a fixed /websocket — the same-origin gate-3 harness cannot catch dev-proxy breakage; verify pnpm boot manually when touching vite.config or the connection layer.
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `client` · harmful: 0
- features: first-light
- evidence: session: create-room dead click report (client)
- last seen: 2026-08-28T11:57:37Z

### L-006 - Assert the exact field values of every event emitted in a multi-event tick, not just the event count
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `sim` · harmful: 0
- features: movement
- evidence: M3 / packages/sim/src/movement.test.ts:255 (sim)
- last seen: 2026-08-28T15:56:44Z

### L-007 - Assert emission silence at clamp boundaries where an intent is active but the value cannot change, not only for fully idle inputs
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `sim` · harmful: 0
- features: movement
- evidence: M5b / packages/sim/src/movement.test.ts:87 (sim)
- last seen: 2026-08-28T15:56:44Z

### L-008 - Test the newly-allowed behavior after a phase transition, not only the confinement directions
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `sim` · harmful: 0
- features: movement
- evidence: MOVE-06 (sim)
- last seen: 2026-08-28T15:56:44Z

### L-009 - Reconcile a mid-cycle STATE.md decision that names the in-flight feature into its spec and design before implementation continues
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `specs` · harmful: 0
- features: movement
- evidence: AD-008 / .specs/STATE.md (specs)
- last seen: 2026-08-28T15:56:44Z

### L-010 - Narrowing a broadcast policy mid-game requires a matching departure event (player:left-floor) or stale rectangles persist on departed floors — routing changes must be client-coherence audited.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `protocol/routing` · harmful: 0
- features: work-channels
- evidence: WORK-17/AD-009, movement.spec.ts:173 ghost rectangle (protocol/routing)
- last seen: 2026-08-28T17:56:28Z

### L-011 - In server tests, intent WS arrival races fixed __driveTicks counts — await events with a drive-until-event loop and never assume a fixed tick offset lands inside a segment.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `server/tests` · harmful: 0
- features: work-channels
- evidence: TurnoverRoom.test.ts server:work_channels choreography (server/tests)
- last seen: 2026-08-28T17:56:28Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
