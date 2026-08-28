# First-Light Validation

**Date**: 2026-08-28
**Spec**: `.specs/features/first-light/spec.md`
**Diff range**: `f27db60..b4ce31a` (9 commits). Note: mid-session the user ran a
`git filter-branch` author-identity rewrite producing `bccc29a` — `git diff b4ce31a bccc29a`
is empty (tree-identical), so the diff surface is unchanged.
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1   | ✅ Done | Sim `totalTicks` seam + room env guard; both unit-tested |
| T2   | ✅ Done | Pure reducer, 15 unit tests, no DOM/net imports |
| T3   | ✅ Done | Join slice + `client:lobby_join` (includes recorded SPEC_DEVIATION: room-creation UI) |
| T4   | ✅ Done | Multi-tab lobby coverage |
| T5   | ✅ Done | Round view + `client:round_start` (LIGHT-12 via unit test, per task's explicit allowance) |
| T6   | ✅ Done | Buzzer → lobby → fresh re-deal |
| T7   | ✅ Done | Lost-connection wiring, room-full sweep, close-out |

---

## Spec-Anchored Acceptance Criteria

### P1: Join a room from the browser

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| LIGHT-01: submit code+name → connect, lobby with own name + roster | Lobby view, roster from personal snapshot, own identity set | `apps/client/harness/lobby.spec.ts:54` — `expect(roster.map(r => r.text)).toEqual(['ada', 'bruno'])`; `:45-46` — `expect(identity.playerId).toBeTruthy()` / `expect(identity.roomId).toBe(code)`; unit `apps/client/src/state.test.ts:56` — `expect(s.view).toBe('lobby')` | ✅ PASS |
| LIGHT-02: join rejected → server reason on join screen, no lobby view | Rejection reason visible; stays on join | `apps/client/harness/lobby.spec.ts:88` — `expect(await guest.textContent('#join-error')).toMatch(/name taken/i)`; `:77-78` — `#join-view` present, `#lobby-view` null; unit `state.test.ts:69` — `expect(s.error).toBe('room not found')` | ✅ PASS (⚠️ precision gap: unknown-code path at `lobby.spec.ts:76` asserts only `error.length > 0`, not the server's reason text) |
| LIGHT-03: lowercase code → uppercased before join | Lowercase joins the same room | `apps/client/harness/lobby.spec.ts:100-103` — `join(guest, code.toLowerCase(), 'bruno')` → roster `toHaveLength(2)`; client uppercases at `apps/client/src/ui/joinView.ts:20-26` + `apps/client/src/app.ts:44` | ✅ PASS |
| LIGHT-04: code field letters-only max 4; name 1–16 client-side | Input-sanitized values | `apps/client/harness/lobby.spec.ts:115` — `expect(await page.inputValue('#join-code')).toBe('ABXY')` (typed `ab1!xy`); `:118` — name 20 chars → `expect(...).toBe('0123456789abcdef')` | ✅ PASS (⚠️ precision gap: the 1-char minimum (`joinView.ts:67`) is asserted nowhere) |

### P1: Lobby view and host start

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| LIGHT-05: lobby renders roster + own name + host marker, updating on every snapshot | Roster grows/shrinks on all clients without reload | `apps/client/harness/lobby.spec.ts:199` — `expect(names).toEqual(['ada (host)', 'bruno', 'caro'])`; `:203-212` — host AND guest pages `waitForFunction(roster length === 2)` after a leave (no reload) | ✅ PASS |
| LIGHT-06: start control only for host | Host-only start button | `apps/client/harness/lobby.spec.ts:175-176` — `expect(await host.isVisible('#start-button')).toBe(true)` / `expect(await guest.isVisible('#start-button')).toBe(false)` | ✅ PASS |
| LIGHT-07: `round:started` replaces lobby with round view | All pages enter round view on host start | `apps/client/harness/lobby.spec.ts:254-257` — all 4 pages `waitForSelector('#round-hud')` after `host.click('#start-button')` | ✅ PASS |
| LIGHT-08: rejected start → error shown, stays in lobby | "need more players" rejection, all pages remain in lobby | `apps/client/harness/lobby.spec.ts:231-234` — `expect(await host.textContent('#lobby-error')).toMatch(/need at least 4/i)` + all 3 pages `isVisible('#lobby-view')` true | ✅ PASS (⚠️ precision gap: spec also lists "round already active" — that rejection path is asserted nowhere) |

### P1: Round view — rectangles, clock, own role

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| LIGHT-09: `round:started` → one labeled rectangle per playerId + clock 05:00 | 4 rectangles, roster labels, 05:00 | `apps/client/harness/round.spec.ts:61-62` — `expect(world?.rectangles).toBe(4)`, `expect(world?.labels).toEqual(['ada', 'bruno', 'caro', 'dina'])`; `:65` — `expect(clockStart).toBe('05:00')` | ✅ PASS |
| LIGHT-10: clock decreases 1 s/s, displays 00:00 at zero, never negative | 05:00 → 04:59 after ~1.5 s; clamp at 0 | `apps/client/harness/round.spec.ts:70-71` — after 1.5 s `expect(clockLater).toBe('04:59')`; unit `apps/client/src/state.test.ts:104` — `expect(clockRemainingMs(s, TUNING.SHIFT_SECONDS * 1000 * 10)).toBe(0)` (display math `roundHud.ts:19-22` ceils → `00:00`) | ✅ PASS (e2e covers the decrease; the zero-clamp is covered by the unit per the design's display-only clock) |
| LIGHT-11: `role:dealt` → own role card only, never others' roles | One private deal per client; card == own payload | `apps/client/harness/round.spec.ts:102-108` — `expect(eventCount).toBe(1)`, `expect(roleCard).toBe(dealtRole)`, `expect(saboteurs).toBe(1)` (cross-tab over 4 pages) | ✅ PASS |
| LIGHT-12: missing roster name → raw player id label | Raw-id fallback | `apps/client/src/state.test.ts:143-146` — `expect(roundPlayers(['p1', 'ghost-id'], snapshot())).toEqual([{ id: 'p1', name: 'ada' }, { id: 'ghost-id', name: 'ghost-id' }])` (and `:147` null-snapshot → raw id) | ✅ PASS (unit-level, explicitly allowed by task T5: "verified by labeling logic unit test … if e2e is not reachable without movement; mark which was used") |

### P2: Buzzer returns to lobby

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| LIGHT-13: `round:buzzer` → lobby view, role card and clock cleared | All pages back in lobby, HUD/role gone | `apps/client/harness/round.spec.ts:127-129` — `waitForSelector('#lobby-view')`, `expect(await page.$('#round-hud')).toBeNull()`, `expect(await page.$('#role-card')).toBeNull()`; unit `state.test.ts:109-112` — view `'lobby'`, role null, roundStartedAt null, roster survives | ✅ PASS (via real 8 s test-shift buzzer, AD-004 seam) |
| LIGHT-14: host re-start after buzzer → fresh round view, clock reset 05:00 | Fresh deal, clock reset | `apps/client/harness/round.spec.ts:135-136` — `waitForSelector('#round-hud')`, `expect(await page.textContent('#clock')).toBe('05:00')`; `:144` — `expect(secondSaboteurs).toBe(1)` (fresh deal) | ✅ PASS |

**Status**: ✅ All 14 LIGHT requirements have evidence · 4 spec-precision gaps flagged (none missing evidence entirely)

---

## Edge Cases

- [x] **Connection drop → static "connection lost" notice, no reconnect**: unit `state.test.ts:132-136` (lost view from lobby/round, never from join); wiring `app.ts:74-77` (`onDisconnect` → `connection-lost`) and `app.ts:147` (renders `#lost-view` "connection lost"); no retry/reconnect code exists in `connection.ts` (code inspection). ⚠️ No browser-level kill — explicitly deferred to Gate 4 human territory by task T7's done-when. Gate 4 remains pending (recorded in STATE.md handoff).
- [x] **7th player → "room full" surfaced on join screen**: `lobby.spec.ts:157-158` — `expect(await seventh.textContent('#join-error')).toMatch(/room full/i)`, `#lobby-view` null.
- [x] **Mid-lobby join/leave updates all clients without reload**: `lobby.spec.ts:182-216` (join to 3 names, leave back to 2, asserted on host and guest pages).
- [x] **Duplicate submit while in flight is ignored**: e2e `lobby.spec.ts:130-137` (two synchronous clicks → roster exactly 2); unit `state.test.ts:46-49` (`reduce(inFlight, {type:'submit-join'}).toBe(inFlight)`).

---

## Protocol Audit (hard rules)

- **No message catalog changes**: `git diff f27db60..b4ce31a -- packages/shared` → 0 lines. ✅
- **Only the recipient's own role can render**: the reducer stores a single own role (`state.ts:90-91`); `roundHud.ts:12` renders only `state.role`; no other view touches roles; `role:dealt` arrives per-connection only (e2e cross-tab: exactly 1 deal event per page, `round.spec.ts:102-108`). ✅
- **Production strip check**: `pnpm --filter @turnover/client build` exit 0 → `check-prod-strip.mjs --expect-absent` **exit 0** (`strip check ok (1 bundles, hook absent)`); harness bundle `--expect-present` exit 0. ✅

---

## T1 Seam Evidence (AD-004)

- `packages/sim/src/roundSim.test.ts:84-91` — override `totalTicks: 100`: no buzzer for ticks 1–99, `expect(sim.tick()).toEqual([{ type: 'round:buzzer' }])` at exactly tick 100; `:94-96` 1 s → `TICK_HZ` ticks; `:99-103` rejects 0 / −5 / 2.5.
- `apps/server/src/rooms/TurnoverRoom.test.ts:312-355` — `NODE_ENV=test` + 1 s override buzzes after tick 20; `NODE_ENV=production` + same env var: still in round after 20 ticks (`expect(instance?.__phase()).toBe('round')`).

---

## Discrimination Sensor

Scratch: `git worktree add /tmp/opencode/fl-sensor HEAD` (node_modules symlinked; all mutations inside the worktree). Baseline porcelain captured before sensor; worktree removed after.

| Mutation | File:line | Description | Discriminating test | Killed? |
| -------- | --------- | ----------- | ------------------- | ------- |
| (a) | `apps/client/src/state.ts:93` | Buzzer action keeps `role` (drops `role: null`) | `state.test.ts` LIGHT-13 test → 1 failed / 14 passed | ✅ Killed |
| (b) | `apps/client/src/app.ts:68` | `beginConnection` returns `true` unconditionally (duplicate-submit guard removed) | e2e `lobby.spec.ts:121` duplicate-submit → fails at `:135` (`#lobby-view` never appears); passes after restore (attribution confirmed) | ✅ Killed |
| (c) | `apps/client/src/state.ts:52` | `roundPlayers` raw-id fallback → `?? ''` | `state.test.ts` LIGHT-12 test → 1 failed / 14 passed | ✅ Killed |
| (d) | `apps/server/src/rooms/TurnoverRoom.ts:26` | Removed `NODE_ENV === 'production'` guard in `testShiftTicks` | `TurnoverRoom.test.ts` "ignores the env var in production" → 1 failed / 1 passed (the non-prod seam test still passes, as expected) | ✅ Killed |

**Sensor depth**: lightweight (4 targeted mutants — the default 1–3 plus one, matching the 4 requested fault classes)
**Result**: 4/4 killed — PASS ✅

**Isolation note**: post-sensor porcelain differed from baseline by two entries **not caused by the sensor**: (1) the user's mid-session `git filter-branch` author-identity rewrite (`git diff b4ce31a bccc29a` = 0 lines — tree identical), (2) concurrent user WIP (`M AGENTS.md`, `?? docs/` — docs/issue-tracker setup). Root-caused; no sensor leakage: all mutations and test artifacts lived in the removed worktree, and every feature file is clean vs HEAD. Pre-existing baseline (`M package.json`, `?? scripts/`) is the user's recorded dev-boot WIP (STATE.md handoff).

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ |
| Surgical changes | ✅ (27 files, all spec-scoped; shared/server untouched except the AD-004 seam) |
| No scope creep | ✅ (room-creation UI is a recorded SPEC_DEVIATION, spec Assumptions table) |
| Matches patterns | ✅ (BootScene registration, existing test styles) |
| Spec-anchored outcome check | ✅ (4 precision gaps flagged, none unverifiable) |
| Per-layer coverage | ✅ (sim/room/reducer unit 1:1; e2e happy+edge+error per view) |
| Every test maps to a requirement | ✅ |
| Guidelines followed | ✅ (AGENTS.md gate ladder; turnover-protocol rules respected) |

---

## Gate Check (re-run by verifier, real tree at bccc29a tree == b4ce31a)

| Gate | Command | Exit code | Detail |
| ---- | ------- | --------- | ------ |
| 1 | `pnpm typecheck` | **0** | 4/4 workspace projects clean |
| 1 | `pnpm lint` | **0** | Biome, 63 files, no issues |
| 2 | `pnpm test:sim` | **0** | 11 files, **75 passed**, 0 failed, 0 skipped |
| 3 | `pnpm test:client` | **0** | **15 passed** (34.9 s), 0 failed, 0 skipped — real server + headless Chromium (`TURNOVER_TEST_SHIFT_SECONDS=8`) |
| — | `pnpm --filter @turnover/client build` | **0** | prod bundle, hook absent (strip check exit 0) |

Gate 4 (human 5-minute round): **not rerun** — human-only gate; pending per STATE.md handoff.

---

## Requirement Traceability

| Requirement | Status |
| ----------- | ------ |
| LIGHT-01..LIGHT-14 | ✅ Verified (evidence table above) |
| Edge cases (4/4) | ✅ Covered (connection-lost e2e deferred to Gate 4 by design) |

---

## Summary

**Overall**: ✅ Ready (PASS)

**Spec-anchored check**: 14/14 ACs matched spec outcome · 4 spec-precision gaps flagged
**Sensor**: 4/4 mutations killed
**Gate**: 5/5 automated gates exit 0

**What works**: full first-light slice — join/create by code, roster with host marker, host-only start, rejection surfaces (name taken, need-more-players, room full), round view with labeled rectangles, client-side countdown, private own-role card with cross-tab leak check, real buzzer → lobby → fresh re-deal via the AD-004 seam, production debug-hook strip.

**Ranked gaps (all spec-precision; none failing)**:

1. **AD-004 decision-record drift** — design/tasks/STATE record `TURNOVER_TEST_SHIFT_SECONDS=5`; the harness actually boots with **8** (`apps/client/harness/playwright.config.ts:20`, in-code rationale: leave time for the LIGHT-09 clock sampling before the buzzer). The spec AC itself is unaffected (spec says "short"), but the recorded decision value and the code disagree — update AD-004 (or the code) in the next cycle touching the harness.
2. **LIGHT-02 weak reason assertion** — unknown-code path asserts only non-empty error text (`lobby.spec.ts:76`), not the server's reason ("room not found"); the name-taken path does assert the reason. Strengthen to a value matcher.
3. **LIGHT-08 partial rejection coverage** — "round already active" start-rejection path is unasserted (spec lists it beside "need more players").
4. **LIGHT-04 min-length unasserted** — the 1-character name minimum is enforced in `joinView.ts:67` but no test covers it.
5. **Connection-lost has no browser-level kill** — unit + wiring evidence only, explicitly deferred to Gate 4 by T7; Gate 4 itself is still pending.

**Next steps**: route gaps 1–4 as low-severity fix tasks (or fold into cycle 2.3 `movement`); run the Gate-4 human 5-minute round.
