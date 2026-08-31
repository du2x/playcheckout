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

### L-012 - When a sim behavior has a room-side trigger (join/leave/lock), the sim test proves the sim half only — the fix/feature task must name a room-level integration test for the trigger itself or the wiring ships untested.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `apps/server,integration` · harmful: 0
- features: elevator-riders
- evidence: ELR-01/ELR-02 room half; apps/server/src/rooms/TurnoverRoom.ts:184 (prior Gap 1) (apps/server,integration)
- last seen: 2026-08-29T02:27:25Z

### L-013 - Before rewriting a large test suite, list its existing pinned behaviors (test titles/ids) and diff that list after the rewrite — wholesale rewrites silently drop pins that only the sensor or verifier catches later.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `packages/sim,test-churn` · harmful: 0
- features: elevator-riders
- evidence: MOVE-13/AD-012#3 pins; c7d79c8:movement.test.ts:303,385 (prior Gaps 2-3) (packages/sim,test-churn)
- last seen: 2026-08-29T02:27:27Z

### L-014 - Kill stale dev servers on :2567/:5173 before running pnpm test:client — the Playwright webServer refuses to boot otherwise and the gate fails at startup, not in any test.
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `apps/client,harness,gate-3` · harmful: 0
- features: elevator-riders
- evidence: apps/client/harness/playwright.config.ts webServer (:2567/:5173), recurred in both verifier rounds (apps/client,harness,gate-3)
- last seen: 2026-08-29T02:27:32Z

### L-015 - When a spec anchors visual timing to a public event, tests must measure from that event receipt rather than from a later local animation phase.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `apps/client` · harmful: 0
- features: elevator-animation
- evidence: ELAN-02 (apps/client)
- last seen: 2026-08-29T15:45:00Z

### L-016 - If an animation spec says timings come from shared TUNING and event timestamps, the presenter API must carry those anchors and tests must prove those constants are actually used.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `apps/client` · harmful: 0
- features: elevator-animation
- evidence: ELAN-08 (apps/client)
- last seen: 2026-08-29T15:45:00Z

### L-017 - Animation tests must observe rendered geometry or an equivalent stable visual signal; visibility-only assertions do not protect open-vs-closed states.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `apps/client` · harmful: 0
- features: elevator-animation
- evidence: M6 (apps/client)
- last seen: 2026-08-29T15:45:00Z

### L-018 - For visual-arrival requirements, assert the player-visible landing-motion outcome, not just an internal alpha or phase proxy.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `apps/client` · harmful: 0
- features: elevator-animation
- evidence: ELAN-06 (apps/client)
- last seen: 2026-08-29T15:45:00Z

### L-019 - Every hidden-information SPEC_DEVIATION needs explicit tests for both the public-event path and the silent ground-truth fallback.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `apps/client` · harmful: 0
- features: elevator-animation
- evidence: apps/client/src/scenes/elevatorPresenter.ts:13 (apps/client)
- last seen: 2026-08-29T15:45:00Z

### L-020 - A negative assertion on a message stream needs a positive control in the same window - make a live player emit the event type and assert IT arrives, or the absence check passes vacuously while nobody sends anything.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `apps/server` · harmful: 0
- features: justice
- evidence: TurnoverRoom.test.ts:1716-1730 (verifier Gap 2) (apps/server)
- last seen: 2026-08-30T01:03:31Z

### L-021 - Pin state-machine timing boundaries against the real transition, not just the endpoints - accuse one tick BEFORE and one tick AFTER the grace-ending event, or a start-vs-completion drift survives.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `packages/sim` · harmful: 0
- features: justice
- evidence: justice.test.ts grace-boundary (verifier Gap 1) (packages/sim)
- last seen: 2026-08-30T01:03:31Z

### L-022 - Dwell tests assert only the [45,90] bounds — pin uniformity (e.g. min<max across a sampled batch) so a constant-dwell mutant cannot survive.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `packages/sim` · harmful: 0
- features: guest-flow
- evidence: guests.ts:283 dwell draw (packages/sim)
- last seen: 2026-08-31T06:24:57Z

### L-023 - Held-arrival tests exercise only one backlog unit; pin multi-unit FIFO release (one guest per tick) and queue-slot x for slot>0 guests.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `packages/sim` · harmful: 0
- features: guest-flow
- evidence: GUEST-02/GUEST-03 (packages/sim)
- last seen: 2026-08-31T06:25:09Z

### L-024 - Edge cases 'room tenanted between choice and arrival' and 'saboteur fired mid-round leaves guests unchanged' have no test; add cheap scripted assertions or record them as structural guarantees.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `packages/sim` · harmful: 0
- features: guest-flow
- evidence: spec Edge Cases 3/5 (packages/sim)
- last seen: 2026-08-31T06:25:09Z

### L-025 - Pin WHICH element a FIFO/queue operation selects (assert the specific guestId/routed event), not just that one was selected — a wrong-end selection is otherwise invisible.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `packages/sim` · harmful: 0
- features: front-desk
- evidence: mutant M1: guests.ts receiveAtDesk queue[0]→queue[end] (packages/sim)
- last seen: 2026-08-31T12:49:54Z

### L-026 - Never inline numeric room/floor lists in client code — derive them from shared layout constants (ROOM_INDEXES) or the §7-numeric denylist test fails the build.
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `apps/client` · harmful: 0
- features: front-desk
- evidence: literals.test.ts denylist vs WorldScene.ts room list (apps/client)
- last seen: 2026-08-31T12:49:54Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
