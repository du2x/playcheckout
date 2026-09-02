# Provenance Signs Specification (cycle 3.4)

## Problem Statement

The guest-traffic economy ships guests, suitcases, and complaints (3.1–3.E/3.3) but the building leaks no *who* and no durable *who-lives-where*: trash has no author dimension, complaint recaps carry no provenance, and every guest door looks the same from the hallway. Without FR-32 trash provenance the churn-vs-sabotage laundering game has no ground truth; without FR-33 tenancy signs the suitcase-delivery outcomes have no hallway-verifiable footprint and the PRD-mandated verification clause for FR-27 claims is missing.

## Goals

- [ ] Trash has an author dimension on top of freshness — churn spawns `settled` with churn provenance, sabotage spawns `fresh` with sabotage provenance, and re-trashing resets the author to sabotage so churn can be laundered but sabotage can never be hidden.
- [ ] Every complaint in the recap carries provenance — each complaint line states sabotage naming the actor vs checkout churn, visible only post-reveal.
- [ ] Every guest door shows a tenancy flip-sign (Occupied/Vacant) operated automatically by the building — Occupied when a guest settles, Vacant when they check out or leave — readable from the hallway as the at-a-distance verifier for suitcase outcomes.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Tenancy sign art / flip animation polish | AD-020 art workstream; gray-box DOM + Phaser door overlay only |
| Guest expressiveness art for tenancy (foot-tap, storm-out sheets) | Same workstream; not this cycle |
| Telemetry tenancy/provenance events (FR-23/24 guest extension) | Cycle 3.6 `telemetry` |
| Coverage % HUD (FR-14 third slot) | Telemetry/KPI only since v1.5; no client work — not this cycle |
| Walkie-lie verification clause | Deleted with v1.4 suitcase redesign (AD-032); out of scope by PRD |
| §7 dial changes | No tuning rows change; FR-32/33 are behavior-only |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Where does authorship live? | Room-scoped provenance: each of the 24 rooms holds `{state, provenance}` where `state ∈ {fresh,prepped,trashed,settled}` and `provenance ∈ {sabotage,churn,none}`; only `trashed` + `settled` carry an author, `prepped`/`fresh` are authorless | PRD FR-22/32: provenance attaches to trash that generated complaints; a clean room has no author to name; keeps payload minimal | n (assumed) |
| Initial 7 trashed rooms provenance | **Sabotage** — the 7 t=0 trashed rooms are seeded as sabotage-trash (fresh tier), not churn | They are sabotage-shaped setup for the first patrols; churn only spawns at checkout (PRD §6.9); no other seed exists | n (assumed) |
| Laundering semantics | Re-trashing any `trashed`/`settled` room resets the room to `trashed` + provenance `sabotage` (overwrites churn provenance) | PRD FR-32: "Churn can be laundered into suspicious by re-trashing; a sabotage hit can never be downgraded to churn" — one-way promotion | n (assumed) |
| Churn cannot overwrite sabotage | `churnTrash` is a no-op on a room already `trashed` with provenance `sabotage`? No — churn still writes `settled`+`churn` per GUEST-09; the overwrite is allowed but the next sabotage re-promotes | Chest-out re-trash is the laundering act; churn overwriting would hide hits without saboteur action — but checkout churn is a deterministic sim path, not a saboteur action; the one-way guarantee is "re-trash always promotes to sabotage", not "churn never overwrites" | n (assumed — see edge cases) |
| Tenancy sign policy | Building-wide (`all`) — every player sees every door's Occupied/Vacant state on their floor lane | PRD FR-33: "Readable from the hallway" — hallway-visible, room-level, no presence, no actor; same as cards `sameFloor` is too narrow (a floor's signs read from that floor), but signs are per-room and clients filter by view floor | n (assumed) |
| Tenancy sign message name | `room:tenancy {floor, room, occupied}` with `sameFloor` policy + `visibility:{floor}` | Follows `room:carded` (`sameFloor`) — hallway-visible per-floor; payload is the tenancy boolean, no guestId | n (assumed) |
| Tenancy snapshot shape | `MovementSnapshot.tenancies?: readonly {floor,room,occupied}[]` scoped to the viewer's floor (fired players get all floors) | Same scoping as `cardedRooms` + `suitcases` — viewer's floor only | n (assumed) |
| Recap complaint provenance kind | New `RecapEntry.kind='complaint'` with `{tick,floor,room,provenance:'sabotage'\|'churn', actorId?:string, fresh:boolean, guestId:string}` OR extended `crime`? Chosen: **new `complaint` recap kind** — complaints are not crimes and need `guestId`+`fresh` | Recap holds crimes/catches/accusations/rides; a complaint is a distinct denormalized beat that must carry its own freshness flag | n (assumed) |
| When is provenance revealed? | Post-reveal only: `room:tenancy` carries no provenance; `guest:discovered` carries `fresh` but not author; the `complaint` recap kind carries `provenance`+`actorId` — sender learns it only from `round:recap` after round:ended | PRD FR-22: "Revealed post-reveal only (v1.3/AD-022)" — hidden until the traitor reveal | n (assumed) |
| Spectator baseline | Tenancies ship in `SpectatorSnapshot.tenancies` (all floors) alongside `rooms`+`cardedRooms` | FR-20 spectators see everything; follows existing baseline pattern | n (assumed) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Trash provenance (FR-32) ⭐ MVP

**User Story**: As the sim, I want every trash room to carry an author — sabotage vs checkout churn — so that churn can be laundered into suspicious by re-trashing but a sabotage hit can never be hidden as churn, and the recap can name the provenance per complaint.

**Why P1**: FR-32 is the cycle's semantic core — the author dimension the whole economy's deduction game stands on.

**Acceptance Criteria** (EARS):

1. WHEN a saboteur's `room:trashed` transition completes (un-prep) THEN the sim SHALL set the room's state to `trashed` and its provenance to `sabotage` — overwriting any prior churn provenance. <!-- event-driven -->
2. WHEN `churnTrash` runs at checkout (GuestSim `guest:checked_out`) THEN the sim SHALL set the checkout room's state to `settled` and its provenance to `churn`, except when the room is already `trashed` with provenance `sabotage` within the freshness window? No — it SHALL still write `settled`+`churn` — re-trash promotion covers the laundering guarantee. <!-- event-driven -->
3. WHEN a room is `prepped` (staff prep completes) THEN the sim SHALL clear its provenance to `none` — a clean room has no author. <!-- event-driven -->
4. IF a room is `trashed` with provenance `sabotage` and the saboteur re-trashes it THEN the sim SHALL keep the room `trashed` with provenance `sabotage` and a fresh window (overwrites freshness deadline). <!-- unwanted-behavior -->
5. IF a room is `settled` with provenance `churn` and the saboteur re-trashes it THEN the sim SHALL set the room to `trashed` with provenance `sabotage` — laundering churn into suspicious. <!-- unwanted-behavior -->
6. WHERE the building is seeded with 7 t=0 trashed rooms THEN the system SHALL set their provenance to `sabotage` — never churn; until seeded, no initial provenance exists (all rooms start `fresh`+`none`). <!-- optional-feature -->
7. IF a room is `fresh` (never prepped) THEN the sim SHALL treat its provenance as `none` — pristine rooms carry no author. <!-- unwanted-behavior -->
8. WHEN a trash-discovery complaint fires (`guest:discovered`) THEN the sim SHALL record the complaint's provenance from the room's provenance at discovery tick (`sabotage` vs `churn`) alongside the freshness tier. <!-- event-driven -->

**Independent Test**: Scripted sim scenarios — prepped → churn (`settled`+`churn`) → re-trash (`trashed`+`sabotage`); initial 7 rooms are `sabotage`; a complaint from a `churn` room vs a `sabotage` room carries the matching provenance (`sim:trash_provenance`).

---

### P2: Tenancy door signs (FR-33)

**User Story**: As a player standing in the hallway, I want every guest door to show Occupied when a guest settles there and Vacant when they check out or leave complaining, so that suitcase deliveries are verifiable at a distance without entering the room.

**Why P2**: The PRD-mandated at-a-distance verifier for FR-27 suitcase outcomes — the walkie carries lifecycle facts, not placements; the sign is the hallway record.

**Acceptance Criteria**:

1. WHEN a guest settles (`guest:settled`) THEN the sim SHALL emit `room:tenancy {floor, room, occupied:true}` to `sameFloor` viewers and flip the door sign to Occupied. <!-- event-driven -->
2. WHEN a guest checks out (`guest:checked_out`) THEN the sim SHALL emit `room:tenancy {floor, room, occupied:false}` and flip the sign to Vacant. <!-- event-driven -->
3. WHEN a guest leaves after a trash-discovery complaint (`guest:discovered` path, `guest:left`) THEN the sim SHALL emit the tenancy Vacant for the complained room in the same flush and the room SHALL stay trashed — the "vacant but trashed" footprint. <!-- event-driven -->
4. WHEN a guest self-assign or suitcase delivery arrives at a pristine `fresh` room that settles THEN the sign SHALL flip Occupied exactly once. <!-- event-driven -->
5. WHILE a guest dwells (`settling` phase) THEN the door sign SHALL stay Occupied — tenancy is not presence, and the sign never flips on a guest walking past. <!-- state-driven -->
6. The system SHALL expose the per-floor tenancy set via the viewer's own `movement:snapshot` (`tenancies`) and via the `spectator:snapshot` full baseline for fired players. <!-- ubiquitous -->
7. IF a guest arrives at a room already Occupied THEN the system SHALL never create double tenancy — such a selection is excluded by vacancy (tenancy+reservation) at assignment time. <!-- unwanted-behavior -->

**Independent Test**: Scripted sim + harness — stage a settle on floor1 room 1, assert the `room:tenancy` message on floor1 viewers and ABSENT on lobby viewers; stage a checkout, assert Vacant; stage a settled room complaint path, assert Vacant with room still `settled`/`trashed` (`sim:trash_provenance` covers the footprint; `client:tenancy_sign` asserts the hallway DOM).

---

### P3: Recap complaint provenance (FR-22 amendment)

**User Story**: As a player looking at the results screen, I want every complaint line in the recap timeline to tell me whether the trash was sabotage (naming the actor) or checkout churn, so that the post-round deduction game is playable.

**Why P3**: The cycle's FR-22 amendment — the reveal that makes the laundering game pay off post-reveal, and the telemetry-adjacent contract the recap must honor.

**Acceptance Criteria**:

1. WHEN the round ends THEN `round:recap` SHALL contain one entry per `guest:discovered` complaint with provenance `churn` where the room was churn trash, and provenance `sabotage` with `actorId` = the saboteur where the room was sabotage trash. <!-- event-driven -->
2. WHEN the recap contains a sabotage provenance entry THEN its `actorId` SHALL be the round's `saboteurId` and SHALL be present only on that entry — never on churn entries. <!-- event-driven -->
3. IF zero complaints fired THEN `round:recap` SHALL contain zero complaint entries — no empty placeholders. <!-- unwanted-behavior -->
4. WHEN a wrong-delivery door complaint fired (`guest:complained`) THEN the recap SHALL NOT contain an entry for it — wrong-delivery complaints never enter the provenance timeline. <!-- unwanted-behavior -->
5. The system SHALL NOT expose provenance on any pre-round message — `guest:discovered.fresh` carries freshness only, never author; the `room:tenancy` payload carries no provenance. <!-- ubiquitous -->
6. WHEN the client renders `round:recap` THEN the results view SHALL render one line per complaint entry naming the provenance (sabotage entry names the actor; churn entry says checkout churn). <!-- event-driven -->

**Independent Test**: Scripted sim — stage one churn-discovery complaint and one sabotage complaint in the same round, end the round, assert `round:recap` carries two complaint entries with the expected `provenance` values and that the sabotage entry's `actorId` matches the saboteur; the harness `client:tenancy_sign` scenario asserts the results view renders both lines (`server:recap_provenance`).

---

### P4: Client tenancy door overlay

**User Story**: As a player on a guest floor, I want every door on my floor lane to show Occupied/Vacant flip-signs so that I can read tenancy from the hallway without opening a room.

**Why P4**: The human gate — FR-33 needs a gray-box surface before the art workstream polishes it, mirroring the card/door-cue pattern.

**Acceptance Criteria**:

1. WHEN `room:tenancy` arrives on the viewer's floor THEN the client SHALL update that door's sign in the hallway lane to Occupied/Vacant accordingly. <!-- event-driven -->
2. WHEN `movement:snapshot` lands THEN the client SHALL seed the viewer's floor-lane signs from the snapshot's tenancies rows. <!-- event-driven -->
3. WHILE the player rides an elevator (no floor stream) THEN the client SHALL retain the last floor's lane signs unchanged — no stale clear. <!-- state-driven -->
4. WHEN the client is a fired spectator (`spectator:snapshot` baseline) THEN all 24 doors SHALL show their tenancy signs (full-building baseline). <!-- event-driven -->
5. The system SHALL NOT show provenance or freshness on a door sign — the sign shows tenancy only, the card shows prep history, the interior holds provenance. <!-- ubiquitous -->

**Independent Test**: Harness `client:tenancy_sign` — four-page round, guest scale 0.2, stage a settle on floor1, assert floor1 viewers show an Occupied sign, lobby viewer shows none; stage checkout, assert Vacant; results view shows complaint provenance lines (`client:tenancy_sign`).

---

## Edge Cases

- IF a checkout `churnTrash` lands on a room already `trashed` with fresh provenance THEN the room becomes `settled` with provenance `churn` — allowed; a subsequent re-trash re-promotes to `sabotage`.
- IF a checkout lands on a `prepped` room THEN the room becomes `settled` with `churn` — routine churn (the common path).
- IF a complaint discovers a `settled`+`churn` vs `trashed`+`sabotage` room THEN the complaint entry carries `fresh` per the trash tier but `provenance` per the author — churn can be fresh if just re-trashed? No — `churn` is never fresh tier, only `settled`; `sabotage` is `trashed` (fresh tier).
- IF a guest self-assign chooses a room THEN its tenancy Vacant at settle becomes Occupied in the same flush as the guest removal from hall view.
- IF the saboteur fires mid-round THEN no new provenance-bearing trash can be created — churn still spawns `settled`+`churn`.
- IF tenancy and card both exist for a room THEN they coexist as independent overlays (Occupied + card) — never merged into one visual.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| PROV-01 | P1 | Design | Pending |
| PROV-02 | P1 | Design | Pending |
| PROV-03 | P1 | Design | Pending |
| PROV-04 | P1 | Design | Pending |
| PROV-05 | P1 | Design | Pending |
| PROV-06 | P1 | Design | Pending |
| PROV-07 | P1 | Design | Pending |
| PROV-08 | P1 | Design | Pending |
| PROV-09 | P2 | Design | Pending |
| PROV-10 | P2 | Design | Pending |
| PROV-11 | P2 | Design | Pending |
| PROV-12 | P2 | Design | Pending |
| PROV-13 | P2 | Design | Pending |
| PROV-14 | P2 | Design | Pending |
| PROV-15 | P2 | Design | Pending |
| PROV-16 | P3 | Design | Pending |
| PROV-17 | P3 | Design | Pending |
| PROV-18 | P3 | Design | Pending |
| PROV-19 | P3 | Design | Pending |
| PROV-20 | P3 | Design | Pending |
| PROV-21 | P3 | Design | Pending |
| PROV-22 | P4 | Design | Pending |
| PROV-23 | P4 | Design | Pending |
| PROV-24 | P4 | Design | Pending |
| PROV-25 | P4 | Design | Pending |
| PROV-26 | P4 | Design | Pending |

**Coverage:** 26 total, 26 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] `sim:trash_provenance`, `server:recap_provenance` suites green; the churn→re-trash→sabotage overwrite and the initial-7-sabotage seed are pinned
- [ ] `client:tenancy_sign` green twice consecutively at `--workers=2` — floor-filtered sign updates, snapshot seeding, and provenance lines in the results view
- [ ] Full ladder green: `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client`
- [ ] A 5-minute human round: settling flips Occupied, checkout/discovery flip Vacant, the recap carries sabotage-vs-churn truth, and no pre-round message leaks provenance
