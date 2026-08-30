# Round-End Specification (cycle 2.9)

## Problem Statement

The justice layer (2.8) fires players, but nothing ever ends a round early or
declares a winner: firings leave the shift running to the buzzer, the buzzer
dumps everyone back to the lobby with no result, and the game's actual
win/lose contract (§6.6) plus its payoff (§6.7: winner banner, traitor reveal,
recap timeline) do not exist. Fired players (2.8) are removed from live play
but have no spectator view (FR-20), and a mid-round disconnect simply deletes
the player (no reconnection window, no ghost, no abort — FR-25).

## Goals

- [x] The round ends with a winner exactly per §6.6: saboteur fired → staff
      win; live staff reduced to 1 → saboteur win; buzzer coverage ≥80% →
      staff win, else saboteur win — verified by the `sim:win_checks` gate.
- [x] Every round end produces a results view: winner banner, traitor identity
      reveal, and the FR-22 recap timeline (crimes with freshness, rides,
      catches, accusations + validity), verified by `client:round_end`.
- [x] Fired players get the FR-20 spectator overview — all floors, all
      players, door cards, and room interiors — until round end, verified by
      `client:spectator_view`.
- [x] Mid-round disconnects hold a 60 s reconnection seat with exact role
      restore; after the window a staff leaver ghosts and a saboteur leaver
      aborts the round (FR-25), verified by the `server:reconnect` gate.

## Out of Scope

| Feature | Reason |
|---|---|
| Telemetry JSONL + KPI (FR-23/FR-24) | Cycle 2.10; `round:ended` carries `winner`/`reason`/`saboteurId` and the aborted marker so 2.10 consumes results without protocol changes |
| Bot-driven exit-criteria sims | Cycle 2.10 (`sim:exit_a`/`sim:exit_b`) |
| Rematch / roster carry-over UX beyond "host starts the next round" | The results phase is lobby-like; any richer flow is a playtest-driven follow-up |
| Ghost re-joining after the window expires | FR-25 ends the seat at window expiry; a ghosted player re-enters through the normal join-by-code flow in the results/lobby phase |
| Voice/mute enforcement for spectators | FR-20's "fired players stay quiet" is a stated, unenforced social convention (prd letter) |
| Saboteur card reveal DURING the round on abort | Reveal happens only after the round ends; abort shows no traitor identity |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Coverage threshold arithmetic | Staff win iff `preppedCount × 5 ≥ ROOMS_TOTAL × 4` over the 24 rooms (8 × 3 floors) — i.e. ≥ 20 rooms currently in `prepped` state | §6.6 "≥80% rooms prepped at buzzer"; integer-safe (19/24 = 79.2% < 80% ≤ 20/24 = 83.3%). "Prepped" = current room state `prepped` — trashed/settled rooms are not prepped (a trashed room is evidence of sabotage, not coverage) | n (agent default, autonomous run) |
| Saboteur-fired win timing | Resolves on the same tick the firing drains — the `round:ended` event follows its `player:fired` in the same flush | §6.6 grants the win the moment the saboteur is fired; the announce pattern (events flush from `tick()`) already covers same-tick ordering | n (agent default) |
| Staff-reduced arithmetic | Live staff = round players − fired − ghosted − the saboteur; saboteur wins when live staff = 1 | §6.6 letter "staff reduced to 1 player"; FR-25 ghosts are "idle spectator-slot" — out of live play, so they count as reduced. A wrong-accusation cascade can legally end the round this way | n (agent default) |
| Buzzer evaluation order | At `ticksLeft == 0`: `round:buzzer` flushes first, then the coverage check emits `round:ended` in the same tick | The buzzer stays the clock-expiry event (client clock/UI); the result is the §6.6 evaluation of the finished shift | n (agent default) |
| Winner reveal width | `round:ended {winner, reason, saboteurId}` is an `'all'` payload — the traitor reveal is legal ONLY because the round has ended | FR-21 explicitly grants the reveal at results; before the round ends, no payload ever names the saboteur (protocol rule 3, unchanged) | y (protocol rule) |
| Results phase | The room gains a third phase `results` between round and lobby: lobby-like (joins allowed, roster snapshots flow, `lobby:start` accepted for the host), movement persists (phase-free, AD-005/AD-015), sim is dropped (roles die with it per AD-002 — no longer needed, the reveal already happened) | Clients must be able to read the recap; a forced auto-return timer would need a new timing constant. The results view persists until the host starts the next round — recorded as AD-021 | n (agent default) |
| Aborted rounds | Saboteur disconnect ends the round as `round:ended {winner:'aborted', reason:'saboteur-disconnected', saboteurId:null}` — no traitor reveal; the recap still renders; the aborted marker is machine-readable for the 2.10 KPI exclusion | FR-25 letter ("aborted result, excluded from KPI"); revealing the saboteur on an aborted round is not granted by any FR | n (agent default) |
| Abort timing | The saboteur's seat is held for the full reconnection window first; abort fires only when the window expires without reconnection | §11: "exact role restored (incl. saboteur card)" — the window exists precisely so a dropped saboteur can come back | n (agent default) |
| Disconnect seat behavior | On an unconsented mid-round leave the roster entry AND movement slot are kept (frozen — a dead connection sends no intents); one `player:left` broadcasts (rectangle removed); reconnection re-announces the player via a dirty `player:moved` and clients re-add displays for unknown ids | Restoring the exact position beats re-spawning (§11 "exact role restored" spirit); a frozen slot emits no misleading movement | n (agent default) |
| Reconnection restore payload | A room-originated `round:resumed {remainingTicks, playerIds, ownFired}` (self) plus re-sent `role:dealt` (exact role, incl. saboteur card) and the appropriate movement/spectator snapshot | The client clock is receipt-stamped (AD-003); a resumed client cannot reconstruct it from `round:started` alone — `remainingTicks` fixes the clock honestly | n (agent default) |
| Reconnection window seam | `RECONNECT_SECONDS = 60` (prd §11) as a Room static overridable in tests/harness, same pattern as `tickMs` (AD-004 precedent) | A real 60 s window is untestable in vitest or a browser harness | n (agent default) |
| Client auto-reconnect | The client persists `room.reconnectionToken` (sessionStorage) and retries `client.reconnect(token)` on an unconsented drop until the window closes; the lost view shows "reconnecting" and a successful resume restores the round view via `round:resumed` | FR-25's client half; token is per-session storage — a fresh tab rejoins by code | n (agent default) |
| Ghost announcement | Silent — no toast, no event beyond the `player:left` already broadcast at drop time | FR-18 toasts cover firings only; a ghost is not a firing. The recap's roster implicitly shows who vanished | n (agent default) |
| Spectator over-delivery | The Router's `sameFloor`/`occupants`/`earshot` policies additionally deliver to viewers whose context is `spectator` (set for fired sessions); the registry policy declarations are unchanged — the spectator privilege is a view-context fact, sanctioned by FR-20 | FR-20 grants fired players the full building incl. interiors; over-delivery to the prd-sanctioned class needs no new policy enum member, and live players' filtering (AD-008/AD-009) is untouched | n (agent default) |
| Spectator baseline | A room-originated `spectator:snapshot` (self) delivered on firing: all players' positions on all floors, car floors, every room's current state, all carded rooms | Over-delivered events are deltas; the spectator needs a full-building baseline to be current from the moment of firing | n (agent default) |
| Recap assembly | The sim journals crimes/catches/accusations (round-scoped, pure); the room journals rides from the movement events it routes (`elevator:riders` + `elevator:moved`) and emits `round:recap` (all) right after `round:ended` in the same flush | Rides are movement-layer facts (AD-005 seam); the sim never sees them. Post-round reveal of occupancy/validity is exactly what FR-22 grants | n (agent default) |
| Recap entry identity | Entries carry player ids; the client renders roster names (fallback: raw id, LIGHT-12 rule) | Names are roster data the client already has; ids keep payloads name-free and stable | n (agent default) |

**Open questions:** none — all resolved or logged above (autonomous run: agent
defaults stand unless a playtest/AD amends them).

---

## User Stories

### P1: Win checks — the round can actually end ⭐ MVP

**User Story**: As a player, I want the round to end the moment §6.6 says it
does so that the table gets a verdict instead of an arbitrary buzzer.

**Why P1**: §6.6 is the entire competitive contract of the game; until it
exists, firings and coverage change nothing.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN the saboteur is fired (walk-in or correct accusation) THEN the server
   SHALL end the round on that same tick with `round:ended {winner:'staff',
   reason:'saboteur-fired', saboteurId}` emitted to all players.
2. WHEN live staff are reduced to 1 (firings and/or ghosts) THEN the server
   SHALL end the round on that tick with `round:ended {winner:'saboteur',
   reason:'staff-reduced', saboteurId}` to all players.
3. WHEN the buzzer fires THEN the server SHALL evaluate coverage: IF
   `preppedCount × 5 ≥ ROOMS_TOTAL × 4` THEN `round:ended {winner:'staff',
   reason:'coverage-met', saboteurId}`, ELSE `round:ended {winner:'saboteur',
   reason:'coverage-failed', saboteurId}` — both to all players, in the same
   tick as `round:buzzer` (buzzer first).
4. IF a win check fires THEN the round SHALL be over: the sim stops accepting
   round-scoped intents, the room enters the results phase, and no further
   work/accusation/firing events are emitted.
5. The system SHALL evaluate each win check exactly once per round — a round
   never emits two `round:ended` events, and no win check fires after the
   round has ended.

**Independent Test**: `sim:win_checks` — walk-in conviction → staff win same
tick; wrong-accusation cascade down to 1 staff → saboteur win; short shift
with zero preps → buzzer → saboteur win (coverage-failed); full-coverage run
→ staff win (coverage-met); staff ghosting to 1 → saboteur win; no double
`round:ended` on any path.

---

### P2: Results & recap — the payoff

**User Story**: As a player, I want a winner banner, the traitor's name, and
a recap timeline so that the round's story is legible and accusations get
their verdict (FR-21/FR-22).

**Why P2**: §6.7 is the reveal that makes the hidden-information game worth
playing; the recap is also the only place firing validity is ever shown.

**Acceptance Criteria**:

1. WHEN `round:ended` (winner staff or saboteur) arrives THEN every client
   SHALL show a results view with a winner banner naming the winning side and
   the traitor identity ("The saboteur was <name>").
2. WHEN `round:ended` (winner aborted) arrives THEN every client SHALL show an
   aborted-results view with no winner banner and no traitor identity.
3. WHEN a round ends (any winner, incl. aborted) THEN the server SHALL emit
   `round:recap {entries}` to all players in the same flush, after
   `round:ended`; the client SHALL render the timeline.
4. The recap SHALL contain, at minimum: one crime entry per `room:trashed`
   (floor, room, tick, and whether the evidence was still fresh at recap
   time), one catch entry per walk-in firing (entrant, saboteur), one
   accusation entry per resolved accusation (accuser, target, correct?),
   and one ride entry per elevator floor-change leg while a round is active
   (car, riders, from floor, to floor).
5. Recap entries SHALL render as a timeline ordered by tick, with roster
   names; an id without a roster name falls back to the raw id (LIGHT-12).
6. The results view SHALL offer the host a start control that begins the next
   round (the results phase is lobby-like); non-hosts see the roster while
   waiting.

**Independent Test**: `client:round_end` — a short round with no preps ends at
the buzzer: every page shows the saboteur-win banner, names the saboteur by
roster name, and renders a recap timeline; the host's start control begins a
new round. Staff-win and aborted banners are covered by unit + room tests.

---

### P3: Spectator overview — fired players watch the whole building

**User Story**: As a fired player, I want a full-building overview including
room interiors so that spectating stays interesting and I can testify
afterward (FR-20).

**Why P3**: FR-20 has been deferred twice (2.7, 2.8); 2.8's fired players
currently watch a static own-floor view that no longer updates.

**Acceptance Criteria**:

1. WHEN a player is fired THEN their client SHALL switch to the spectator
   overview until the round ends: all floors rendered (stacked lanes), every
   live player's rectangle at their real position, car floors, door cards on
   all floors, and room interiors (current states) visible.
2. WHILE a player is a spectator THEN the server SHALL deliver the full
   positional stream (all floors), interior transitions (`room:prepped`,
   `room:trashed`, `room:settled`), entries, cards, and rustles — the
   spectator context receives what FR-20 grants and nothing live players
   lose.
3. WHEN the firing resolves THEN the server SHALL send the newly fired player
   a `spectator:snapshot` (self) with the full-world baseline: all players'
   positions, car floors, every room's state, all carded rooms.
4. IF a player is not fired THEN their view SHALL be byte-for-byte the
   cycle-2.8 own-floor experience — no cross-floor stream, no interior
   baseline (AD-008/AD-009 unchanged; the spectator privilege never widens a
   live player's view).
5. WHEN the round ends THEN the spectator view SHALL end with it: the results
   view replaces the overview (results are shown to everyone identically).

**Independent Test**: `client:spectator_view` — a page accuses a nearby player
before the saboteur's first un-prep (grace, FR-18) and is fired; the fired
page renders the all-floor overview (other players' rectangles on other
floors, all door lanes), a live page's own-floor view is unchanged, and both
pages still receive firing toasts.

---

### P4: Disconnect & reconnection — seats are held, then resolved (FR-25)

**User Story**: As a player who loses connection mid-round, I want my seat
held for 60 s with my role intact so that a network blip does not destroy the
round for everyone.

**Why P4**: FR-25 + prd §11 lock the reconnection contract; today a mid-round
drop deletes the player with no way back.

**Acceptance Criteria**:

1. WHEN a connection drops unconsented during a round THEN the room SHALL
   hold the leaver's seat for RECONNECT_SECONDS (60, production): roster slot
   and movement slot kept (frozen), exactly one `player:left` broadcast, and
   the round continues.
2. IF the client reconnects within the window THEN the server SHALL restore
   the seat exactly: re-send the role card (`role:dealt`, incl. the saboteur
   card), `round:resumed {remainingTicks, playerIds, ownFired}` (self), the
   appropriate movement/spectator snapshot, and re-announce the player's
   position so other clients re-add the rectangle.
3. IF the window expires for a staff leaver THEN the leaver SHALL become an
   idle ghost: out of live play (intents rejected, win checks count them
   out), play continues, no additional announcement beyond the existing
   `player:left`.
4. IF the window expires for the saboteur THEN the room SHALL end the round
   as aborted: `round:ended {winner:'aborted', reason:'saboteur-disconnected',
   saboteurId:null}` + recap, and the clients show the aborted results view.
5. WHEN a ghost or firing reduces live staff to 1 THEN the saboteur win check
   SHALL fire (P1 AC2 — ghosts count as reduced).
6. WHEN a connection drops during the lobby or results phase THEN the current
   lobby behavior SHALL be unchanged (immediate removal + roster snapshots);
   no reconnection seat is held outside an active round.
7. The client SHALL auto-reconnect: persist the reconnection token, retry on
   an unconsented drop until the window closes, show a reconnecting state,
   and restore the round view on success.

**Independent Test**: `server:reconnect` — a real SDK client drops mid-round:
seat held (`player:left` exactly once), `client.reconnect(token)` restores
role card + resumed clock + position, others re-add the rectangle; window
expiry for a staff leaver ghosts them (saboteur win if staff hit 1); window
expiry for the saboteur aborts the round. Client retry is covered by unit +
harness assertions on the reconnecting state.

---

## Edge Cases

- IF a player is fired on the same tick the buzzer fires THEN the win check
  (saboteur-fired → staff win) SHALL resolve before the coverage check — the
  fired-flush precedes the buzzer evaluation in the same tick, and the round
  emits exactly one `round:ended`.
- IF the last live staff member is fired by their own wrong accusation THEN
  the staff-reduced check fires the saboteur win on that same tick.
- IF a disconnected player's frozen position sits inside a room when another
  player un-preps there THEN nothing special happens — the frozen player
  enters nothing (dead connections emit no intents), and a later walk-in by a
  live player still convicts normally.
- IF a reconnected client's `round:resumed` arrives after the round ended
  (results phase) THEN the room sends the results/lobby-shaped restore
  instead (no role card — the sim is gone; the client lands in the results
  view like everyone else).
- IF the host disconnects mid-results THEN host migration follows the
  existing earliest-join rule on the next roster snapshot (CHURN-02) — the
  next start control simply appears for the new host.
- IF a spectator reconnects THEN their restore carries `ownFired: true` and
  the spectator snapshot (their privilege survives the blip; FR-20 runs until
  round end).
- IF a ride leg has no riders (ghost trip) THEN the recap ride entry SHALL
  render with an empty rider list — the car's story is still part of the
  timeline.
- IF the recap renders while a name's owner disconnected pre-recap THEN the
  roster name (kept for the round) still resolves; only ids missing from the
  roster fall back to the raw id.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| REND-01 | P1: Win checks | Execute | Done |
| REND-02 | P1: Win checks | Execute | Done |
| REND-03 | P1: Win checks | Execute | Done |
| REND-04 | P1: Win checks | Execute | Done |
| REND-05 | P1: Win checks | Execute | Done |
| REND-06 | P2: Results & recap | Execute | Done |
| REND-07 | P2: Results & recap | Execute | Done |
| REND-08 | P2: Results & recap | Execute | Done |
| REND-09 | P2: Results & recap | Execute | Done |
| REND-10 | P2: Results & recap | Execute | Done |
| REND-11 | P2: Results & recap | Execute | Done |
| REND-12 | P3: Spectator overview | Execute | Done |
| REND-13 | P3: Spectator overview | Execute | Done |
| REND-14 | P3: Spectator overview | Execute | Done |
| REND-15 | P3: Spectator overview | Execute | Done |
| REND-16 | P3: Spectator overview | Execute | Done |
| REND-17 | P4: Disconnect & reconnection | Execute | Done |
| REND-18 | P4: Disconnect & reconnection | Execute | Done |
| REND-19 | P4: Disconnect & reconnection | Execute | Done |
| REND-20 | P4: Disconnect & reconnection | Execute | Done |
| REND-21 | P4: Disconnect & reconnection | Execute | Done |
| REND-22 | P4: Disconnect & reconnection | Execute | Done |
| REND-23 | P4: Disconnect & reconnection | Execute | Done |

**Coverage:** 23 total, mapped in tasks.md, 0 unmapped, 23 Done.

---

## Success Criteria

- [x] `sim:win_checks` passes under `pnpm test:sim`; `client:round_end` and
      `client:spectator_view` pass under `pnpm test:client`; `server:reconnect`
      room tests pass under `pnpm test:sim` (server suite).
- [x] No payload names the saboteur, a role, or an accusation verdict before
      the round has ended (protocol registry audit clean; the only identity
      reveal travels on `round:ended`, post-round).
- [x] Live players' wire view is byte-identical to cycle 2.8 — the spectator
      privilege exists only in the spectator context (fire a player, compare
      a live player's message log before/after).
- [x] No §7 tuning value changed; the only new server constant is
      RECONNECT_SECONDS = 60, which is prd §11's own value (not a §7 table
      row), overridable via the test seam.
