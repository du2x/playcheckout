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

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
