# Justice Specification (cycle 2.8)

## Problem Statement

The evidence layer (2.7) makes sabotage observable, but nothing punishes: a
walk-in catch changes nothing, and the accusation loop FR-17–FR-19 does not
exist. The game's two-tier justice — direct evidence convicts automatically,
circumstantial evidence goes through risky personal accusation — is the last
missing round-scoped mechanic before win conditions (2.9).

## Goals

- [ ] Entering a room during an active un-prep channel instantly fires the
      saboteur (FR-15), verified by the `sim:walkin_conviction` gate scenario.
- [ ] A staff player can accuse a nearby player; wrong accusations fire the
      accuser, accusing the saboteur before his first un-prep (grace) also
      fires the accuser, and a correct accusation fires the saboteur
      (FR-17–FR-19), verified by `sim:accuse`.
- [ ] Every firing is announced as a name-only toast — never a role, a reason,
      or a validity verdict (FR-18), verified by `sim:firing_toast` and the
      client harness.

## Out of Scope

| Feature | Reason |
|---|---|
| Win checks, results screen, recap timeline (FR-21/FR-22) | Cycle 2.9 `round-end`; the round continues after any firing this cycle |
| Spectator overview camera + room interiors for fired players (FR-20) | Cycle 2.9 (fired players arrive there); 2.8 removes them from live play only |
| Staff-reduced-to-1 loss check (§6.6) | A win condition — cycle 2.9 |
| Telemetry flags (`wasTargetSaboteur`, FR-23) | Cycle 2.10; the sim event's internal `reason` field is designed so 2.10 can consume it without protocol changes |
| Reconnection / disconnect mid-round (FR-25) | Cycle 2.9 |
| Un-accuse / accusation cancel after the confirm menu closes | FR-17 has no cancel semantics; menu cancel is client-side only (no intent sent) |
| Work-channel durations and the action matrix | Locked in cycle 2.5; untouched |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Grace-window end | The tick the saboteur's first un-prep channel COMPLETES (`room:trashed` emitted); starting-but-incomplete un-prep stays inside grace | FR-18 keys grace to "his first un-prep" — a completed un-prep is the committed crime the accusation would be "correct" about; a mid-channel accusation would otherwise convict on an act that may still be walked out of. Recorded here rather than editing the locked prd | n (agent default, autonomous run) |
| Walk-in conviction trigger | A player ENTERS a room's segment (segment-change detection, pass-through included) while an un-prep channel is ACTIVE in that room, on any player other than the channel's owner — instant, on the entry tick | FR-15: "entering a room during an active un-prep channel instantly fires the saboteur". Entry = the same `room:entered` trigger as FR-10; the channel owner cannot trigger it themselves (walking out cancels their channel first — FR-16, already shipped in 2.5) | n (agent default) |
| Conviction evaluated against channels live at the entry tick | Tick order inside the work tick: walk-out cancels → walk-in conviction → completions → settle → segment observation. An entrant arriving on the tick the un-prep completes still convicts (the channel was active that tick); an un-prep that completed on an earlier tick does not | FR-15 says "during an active channel"; instant per FR-15 — completions must not preempt the entry check | n (agent default) |
| Who can be convicted by walk-in | Only the saboteur running the un-prep channel (there is exactly one saboteur); the entrant's identity does not matter beyond being live and not the channel owner | FR-15 convicts the saboteur, not the entrant; any staff walk-in catches | n (agent default) |
| Fired = removed from live play | The sim drops the fired player (`movement.leave` + channel cancel, WORK-12 reuse); their rectangle is removed client-side on the fired event; the Router naturally drops them from all positional policies (no position/floor exists anymore) | FR-20's spectator overview is 2.9; 2.8 only needs them out of live play without leaking anything. They stay connected in the room and keep receiving `'all'` broadcasts | n (agent default) |
| Firing feedback payload | `player:fired {playerId}` — name-only, `'all'` policy; the sim event carries a server-internal `reason` ('walkin' \| 'wrong-accusation' \| 'correct-accusation') that the projection strips and 2.10's telemetry consumes | FR-18: "live firing feedback is a name-only toast — validity is revealed only on the recap"; reason/grace/role must never reach the wire | y (protocol rule) |
| Round continues after any firing | Yes — no win check fires this cycle; the shift runs to the buzzer (or the test-shortened buzzer, AD-004) | Win conditions are §6.6, deferred to 2.9 by the roadmap cycle table | n (agent default) |
| Accusation eligibility (server-side) | Round active; accuser live and staff (the saboteur cannot accuse); target live, not the accuser; distance ≤ TUNING.ACCUSATION_RANGE_TILES × 1000 millitiles on the same floor (movement-layer positions, inclusive range) | FR-17 + §7 tuning row "Accusation range ~2 tiles, same floor" (constant already pinned in `TUNING`); the server never trusts the client's menu | n (agent default) |
| Accusation validity | Correct = target is the saboteur AND the grace window has ended. Everything else (innocent staff, saboteur-in-grace) is wrong: the ACCUSER is fired | FR-18 letter; grace state is fully hidden — no payload ever distinguishes "innocent" from "in grace" | y (protocol rule) |
| Firing event flush timing | Intent handlers run between ticks; the resolution (firing + cleanup) is recorded at intent time and the `player:fired` event flushes on the next simulated tick (≤50 ms, the `work:started` announce pattern) | Keeps the sim's "events come from tick()" invariant; "on that tick" in the ACs reads as the resolution tick | n (agent default) |
| Simultaneous accusations | Intents process sequentially in arrival order; the first valid accusation resolves, later ones targeting a player fired on the same tick are rejected (target-not-live) | Deterministic single-resolution; no double-fire | n (agent default) |
| Hold-E disambiguation with the elevator key | Tap E (< 400 ms) = elevator call (unchanged); holding E ≥ 400 ms with a valid candidate on the own floor within range opens the confirm menu. The 400 ms threshold is a UI affordance constant, not §7 tuning | E is the elevator key since 2.4; FR-17 says "hold E → confirm menu", so the press duration is the disambiguator. Threshold lives in client code, never in TUNING | n (agent default, playtest may revisit via AD) |
| Accuse-menu candidate selection | The nearest live player on the own floor within ACCUSATION_RANGE_TILES (client mirror of the server rule); the menu shows their name; confirm sends `accuse {targetId}` | One candidate per menu keeps the gray-box UI honest; server re-validates everything | n (agent default) |
| Justice is round-scoped | Accusation intents are rejected in the lobby phase and after the buzzer; no justice state exists pre-round | The sim owns the round only (AD-002) | n (agent default) |
| Deferred room-shell/first-light gap assertions | The three room-shell PASS gaps (LOBBY-02 no-create clause, reject-then-start mutant, LOBBY-05 roster-after-name-rejection) and three first-light gaps (LIGHT-02/LIGHT-04/LIGHT-08) fold into this cycle per STATE's deferred notes — this cycle touches both `TurnoverRoom` and the client | STATE handoff directive | y (recorded directive) |

**Open questions:** none — all resolved or logged above (autonomous run: agent
defaults stand unless a playtest/AD amends them).

---

## User Stories

### P1: Walk-in conviction — the automatic tier ⭐ MVP

**User Story**: As a staff player, I want walking in on an active un-prep to
instantly fire the saboteur so that catching red-handed needs no argument.

**Why P1**: FR-15 is the direct-evidence tier of §5's two-tier justice — the
rustle (FR-13) and door-open cue (FR-10) exist to enable exactly this catch.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN a live player enters a room's segment while an un-prep channel is active
   in that room (pass-through entry included) THEN the server SHALL fire the
   channel-owning saboteur on that same tick and emit `player:fired {playerId}`
   to all players.
2. IF the entering player is the channel's owner THEN no conviction SHALL occur
   (their walk-out already cancelled the channel on the exit tick, FR-16).
3. WHEN a player enters a room whose un-prep completed on an earlier tick or
   never started THEN no conviction SHALL occur.
4. WHEN the conviction fires THEN the saboteur's pending channels (if any other)
   SHALL be cancelled silently and their movement SHALL stop (no further
   `player:moved` from them), with their rectangle removed client-side on the
   fired event.
5. The system SHALL emit no payload naming the reason, the entrant, or the
   convicted player's role — the wire payload is `{playerId}` exactly.

**Independent Test**: `sim:walkin_conviction` — staff enters mid-un-prep →
saboteur fired same tick, name-only broadcast; walk-out cancel fires nobody;
entry after completion fires nobody; pass-through entry fires; saboteur's own
entry fires nothing.

---

### P2: Accusation — the risky personal tier

**User Story**: As a staff player, I want to accuse a nearby player of being
the saboteur so that circumstantial evidence can win the round — at personal
risk.

**Why P2**: FR-17–FR-19 turn testimony into a decision with teeth; wrong
accusations firing the accuser is the risk that makes testimony matter.

**Acceptance Criteria**:

1. WHEN a live staff player sends `accuse {targetId}` for a live target within
   TUNING.ACCUSATION_RANGE_TILES on the same floor during an active round THEN
   the server SHALL resolve the accusation on that tick.
2. IF the target is the saboteur AND the saboteur has completed at least one
   un-prep THEN the server SHALL fire the saboteur (correct accusation, FR-19).
3. IF the target is not the saboteur, OR the target is the saboteur still inside
   the grace window (no completed un-prep) THEN the server SHALL fire the
   ACCUSER (wrong accusation, FR-18) — identically, with no payload ever
   distinguishing the two wrong cases.
4. IF the accuser is the saboteur, the accuser is already fired, the round is
   not active, the target is not live, the target is the accuser, or the target
   is out of range / on another floor THEN the server SHALL reject the intent
   with an error and fire nobody.
5. WHEN an accusation resolves (either way) THEN exactly one `player:fired`
   SHALL be emitted — never two, never zero.
6. The system SHALL complete the fired player's cleanup (channels cancelled
   silently, movement stopped) on the resolution tick.

**Independent Test**: `sim:accuse` — correct accusation on post-grace saboteur
fires the saboteur; accusation of an innocent staff fires the accuser;
accusation of the in-grace saboteur fires the accuser with a byte-identical
payload shape; every rejection edge (saboteur accuser, out-of-range, other
floor, lobby phase, fired target, self-target) fires nobody.

---

### P3: Firing feedback — the name-only toast

**User Story**: As a player, I want to see "X was fired" the moment anyone is
fired — and nothing more — so that the table learns the fact without learning
the verdict.

**Why P3**: FR-18 locks the information width of live firing feedback; the
validity reveal belongs to the recap (FR-22, cycle 2.9).

**Acceptance Criteria**:

1. WHEN any firing resolves (walk-in or accusation, either verdict) THEN the
   server SHALL emit exactly one `player:fired {playerId}` to ALL players on
   the resolution tick — including the fired player.
2. The payload SHALL carry the player's id and nothing else — no role, no
   reason, no validity flag, no entrant.
3. The registry SHALL declare `player:fired` under the `'all'` policy with a
   dedicated payload type; no other message type may carry firing information.
4. The client SHALL render the fired player as a toast naming them
   ("X was fired") and remove their rectangle; the fired player's own client
   SHALL additionally show a fired state and stop movement intents.

**Independent Test**: `sim:firing_toast` — walk-in and both accusation verdicts
each emit exactly one all-policy `{playerId}` payload; a payload-shape audit
asserts no extra fields on any firing path.

---

### P4: Accusation UI — hold E, confirm, live with it

**User Story**: As a staff player, I want a hold-E confirm menu near a suspect
so that accusations are deliberate, not key slips.

**Why P4**: FR-17's interaction contract; the menu is the only accusation
surface and must make the risk legible before sending.

**Acceptance Criteria**:

1. WHILE a live staff player holds E ≥ 400 ms with a live player within
   ACCUSATION_RANGE_TILES on their floor THEN the client SHALL show a confirm
   menu naming that player.
2. IF the player releases E before 400 ms THEN the client SHALL send the
   elevator-call intent exactly as today and show no menu.
3. WHEN the player confirms the menu THEN the client SHALL send
   `accuse {targetId}`; WHEN they cancel THEN the client SHALL send nothing.
4. WHEN an error rejection arrives THEN the client SHALL surface it and close
   the menu without firing.
5. The client SHALL render the name-only toast for every `player:fired`
   (harness gate).

**Independent Test**: `client:accuse_ui` — tap E still calls the elevator;
hold E with a nearby player opens the menu naming them; cancel sends no intent;
confirm fires and both pages see the name-only toast while the round continues.

---

## Edge Cases

- IF a player enters an un-prepping room on the same tick the un-prep completes
  THEN the conviction SHALL fire (the channel was active at the entry tick).
- IF two staff accuse on the same tick THEN the first valid intent SHALL
  resolve; the second SHALL be rejected (its target or accuser is already
  fired).
- IF the saboteur is fired by walk-in while a staff accusation is in flight
  THEN the accusation SHALL be rejected (target not live) — no post-mortem
  accusations.
- IF the accuser walks out of range between menu confirm and server processing
  THEN the server SHALL reject on its own range check (the client menu is a
  mirror, never an authority).
- IF a fired player is present in a room's `occupants` projection THEN they
  SHALL NOT receive it — positional policies require a live position, which a
  fired player no longer has.
- IF the buzzer fires mid-grace THEN the grace dies with the round; the recap
  (2.9) reveals what 2.8 never did.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| JUST-01 | P1: Walk-in conviction | Execute | Pending |
| JUST-02 | P1: Walk-in conviction | Execute | Pending |
| JUST-03 | P1: Walk-in conviction | Execute | Pending |
| JUST-04 | P1: Walk-in conviction | Execute | Pending |
| JUST-05 | P1: Walk-in conviction | Execute | Pending |
| JUST-06 | P2: Accusation | Execute | Pending |
| JUST-07 | P2: Accusation | Execute | Pending |
| JUST-08 | P2: Accusation | Execute | Pending |
| JUST-09 | P2: Accusation | Execute | Pending |
| JUST-10 | P2: Accusation | Execute | Pending |
| JUST-11 | P2: Accusation | Execute | Pending |
| JUST-12 | P3: Firing feedback | Execute | Done |
| JUST-13 | P3: Firing feedback | Execute | Done |
| JUST-14 | P3: Firing feedback | Execute | Done |
| JUST-15 | P3: Firing feedback | Execute | Pending |
| JUST-16 | P4: Accusation UI | Execute | Pending |
| JUST-17 | P4: Accusation UI | Execute | Pending |
| JUST-18 | P4: Accusation UI | Execute | Pending |
| JUST-19 | P4: Accusation UI | Execute | Pending |
| JUST-20 | P4: Accusation UI | Execute | Pending |
| JUST-21 | Deferred gap assertions (STATE notes 1–2) | Execute | Pending |

**Coverage:** 21 total, mapped in tasks.md, 0 unmapped.

---

## Success Criteria

- [ ] `sim:walkin_conviction`, `sim:accuse`, `sim:firing_toast` pass under
      `pnpm test:sim`; `client:accuse_ui` passes under `pnpm test:client`.
- [ ] No grace state, firing reason, or role ever reaches a client-bound
      payload (protocol registry audit clean; firing payloads are
      `{playerId}`-shaped on every path).
- [ ] No tuning constant changed; the only new constant-adjacent value is the
      client's 400 ms hold threshold, which lives in client code, not TUNING.
- [ ] The round continues after every firing; buzzer behavior is byte-identical
      to cycle 2.7's.
