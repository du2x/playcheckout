# Restaurant Floor Specification

Cycle 3.C `restaurant-floor` — v1.4 mezzanine (roadmap Phase 3, AD-032/AD-034;
proposal `.specs/proposals/guest-transport-economy.md` §115–130).

## Problem Statement

Since 3.B, checked-in guests wait in a lobby holding-area stub east of the desk.
v1.4 replaces that stub with a real mezzanine restaurant floor directly above the
lobby: guests dine there while their suitcase is carried, breaking the pinned
4-floor layout and growing the elevators to 5 stops. The dining dwell (15–30 s
seeded) is a wait buffer — a guest whose suitcase rests leaves immediately.

## Goals

- [ ] The building has a mezzanine floor above the lobby served by both
  elevators (5 stops), with no rooms.
- [ ] Checked-in guests dine on the mezzanine (deterministic slots, seeded
  15–30 s dwell); a suitcase rest departs them immediately.
- [ ] The client renders the mezzanine floor view with panels, dining cues and
  full rider affordances.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Restaurant furniture art / authored sheets | Art workstream (3.A/AD-029) consumes the manifest entries; gray-box rendering this cycle |
| Walkie line for dining arrival | Roadmap v1.4 walkie set unchanged; lifecycle facts ride existing events |
| §7 balance re-proof of the dials | 3.5 balance gate owns it |
| Rooms or work channels on the mezzanine | FR-3: mezzanine is the restaurant only |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Mezzanine position in `FLOOR_IDS` | `['lobby', 'mezzanine', 'floor1', 'floor2', 'floor3']` — elevator ride cost derives from `indexOf` | "Directly above the lobby" (roadmap/prd FR-3); 5 stops accepted (roadmap line: "elevators serve 5 stops"); lobby↔floor1 ride doubles to 2 strides | n — autonomous default per roadmap |
| Dining slot geometry | Slot i at `GUEST_RESTAURANT_START_TILES + i × GUEST_QUEUE_SPACING_TILES` on the mezzanine, FIFO by check-in; constant renamed from `GUEST_HOLD_START_TILES`, value 18 kept | Mirrors the 3.B stub geometry one floor up; spacing/direction already pinned by AD-033(b) | n — autonomous default |
| Dining dwell semantics | Seeded uniform 15–30 s from the guest Rng stream, starting when the guest reaches its dining slot; a rest event departs the guest immediately; after the dwell elapses the guest REMAINS dining (no event, no foul) | Proposal: "wait buffer, not a schedule — a guest whose suitcase rests leaves immediately"; carry clock bounds carrier stalls | n — autonomous default |
| In-car mezzanine press | `M` (KeyM) presses mezzanine in-car; car screen + HUD indicators gain `M`; `floorLabel('mezzanine') = 'M'` | Digits 1/2/3 and 0 (lobby) are taken; M is mnemonic | n — autonomous default |
| Protocol surface | NO new registry messages; the only protocol change is `FloorId` widening (auto-flows through `FLOOR_ENUM`, `elevator:press`, position events) | `guest:moved` sameFloor machinery already covers mezzanine positions; lifecycle events unchanged | n — autonomous default |
| Suitcase placement on the mezzanine | `suitcase:place` is ignored (no room doors exist there); pickup of nothing likewise no-ops | Rooms only on guest floors; a mezzanine rest would strand the guest target | n — autonomous default |
| Art manifest entries | Added to `docs/art/alternative/asset-manifest.json` (the AD-029 production contract) before this cycle's client work | Phase rule: manifest gains floor/suitcase/restaurant entries BEFORE authoring | n — autonomous default |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: The mezzanine floor exists and is served ⭐ MVP

**User Story**: As a player, I want a mezzanine restaurant floor above the lobby
so that guests have somewhere to dine and the building feels like a hotel.

**Why P1**: The dining phase is meaningless without the floor; the layout break
is the riskiest change (pinned tests, elevator economy).

**Acceptance Criteria**:

1. The system SHALL define `FLOOR_IDS` as `['lobby', 'mezzanine', 'floor1',
   'floor2', 'floor3']` with the mezzanine carrying no rooms, and `layout.test.ts`
   SHALL re-pin the 5-floor layout.
2. WHEN an elevator ride is computed between floors THEN the system SHALL derive
   its duration from the floor order (`indexOf` × `ELEVATOR_RIDE_SECONDS_PER_FLOOR`),
   making a lobby↔floor1 ride 2 strides.
3. WHEN an `elevator:press` intent names any of the 5 floors (mezzanine included)
   THEN the system SHALL accept it, and WHEN it names any other floor THEN the
   system SHALL reject it.
4. WHEN a player or guest walks or rides to the mezzanine THEN the system SHALL
   move them under the exact AD-015/AD-025 rules (phase-free, floors alike).
5. IF a `suitcase:place` intent is issued while the sender stands on the mezzanine
   THEN the system SHALL ignore it.
6. The system SHALL keep room-scoped predicates (work channels, room-at,
   door frames, assignments) bound to the 3 guest floors only.

**Independent Test**: `sim` layout pins + a movement test riding lobby → mezzanine.

### P2: Guests dine while their suitcase is carried

**User Story**: As a player, I want checked-in guests to wait in the mezzanine
restaurant so the lobby desk area stays legible and the guest's wait is visible
from the mezzanine.

**Why P2**: This is the cycle's gameplay payload — it replaces the 3.B holding
stub and gives the trash race its timing texture.

**Acceptance Criteria**:

1. WHEN a guest is checked in THEN the guest SHALL be placed in a dining slot on
   the mezzanine (`GUEST_RESTAURANT_START_TILES + slot × GUEST_QUEUE_SPACING_TILES`,
   FIFO by check-in), never in a lobby holding area.
2. WHEN the guest reaches its dining slot THEN the system SHALL seed a uniform
   15–30 s dwell (`GUEST_DINING_MIN/MAX_SECONDS`, guest Rng stream).
3. WHILE a guest is dining, WHEN its suitcase first comes to rest THEN the guest
   SHALL depart the restaurant immediately (existing retarget path) regardless of
   the remaining dwell.
4. WHEN the dining dwell elapses without a rest THEN the guest SHALL remain
   dining — no event, no foul (buffer, not a schedule).
5. IF a guest complains at a wrong door THEN the guest SHALL return to a dining
   slot on the mezzanine (the AD-033(c) holding return moves to dining).
6. IF a dining guest's carrier is lost (fired/ghosted/disconnect) THEN the guest
   SHALL re-queue at the FRONT of the desk queue with its impatience clock
   resumed, exactly as the 3.B teardown does.
7. The system SHALL emit dining positions only through existing messages
   (`guest:moved` sameFloor) — no new registry entries.

**Independent Test**: `sim:dining` scenarios (check-in → slot; rest → immediate
departure; dwell elapsed → stays; wrong-delivery → returns to dining).

### P2: Client mezzanine view + dining cues

**User Story**: As a player, I want to view and ride to the mezzanine with the
same affordances as every floor so the new floor is playable, not decorative.

**Why P2**: A floor the client cannot show is not shipped.

**Acceptance Criteria**:

1. WHEN the mezzanine view is active THEN the client SHALL render the corridor
   lane, both elevator panels with hall-call lights, and NO door frames.
2. WHEN the player presses `M` while riding a car THEN the client SHALL send
   `elevator:press {floor: 'mezzanine'}`, and the rider chip / car screen SHALL
   light `M` while it is queued or served.
3. WHILE a guest is present on the mezzanine THEN the client SHALL render its
   marker with a dining cue (gray-box chip).
4. The system SHALL include the mezzanine lane in the spectator overview and the
   floor indicators (HUD, car screen, floor label `M`).

**Independent Test**: `client:restaurant` harness scenario (mezzanine view, M
press, dining marker visible).

### P3: Art manifest entries precede authoring

**User Story**: As the art workstream, I want manifest entries for the mezzanine
floor, restaurant furniture and suitcase so later sheets stay in-contract.

**Why P3**: Phase rule (roadmap): manifest entries BEFORE authoring; no sheets
are authored this cycle.

**Acceptance Criteria**:

1. The system SHALL add mezzanine floor band, restaurant furniture and suitcase
   sheet entries to `docs/art/alternative/asset-manifest.json` before this
   cycle's client slice merges.

**Independent Test**: Manifest inspection.

---

## Edge Cases

- IF the hotel is full THEN the arrival backlog SHALL be unaffected (rooms only
  on guest floors; the mezzanine adds no vacancy).
- WHEN a dining guest is re-placed after another guest departs THEN the slots
  SHALL compact deterministically (re-place on membership change, NPC teleport).
- WHEN an elevator serves the mezzanine with riders for several floors THEN the
  FIFO press queue SHALL handle the new floor like any other (no priority change).
- IF a harness/sim test pinned the 4-floor layout or lobby↔floor1 ride timing
  THEN it SHALL be re-pinned to the 5-floor reality (not deleted).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| REST-01 | P1: mezzanine exists | Design | Pending |
| REST-02 | P1: ride cost from order | Design | Pending |
| REST-03 | P1: press accepts 5 floors | Design | Pending |
| REST-04 | P1: free-roam movement | Design | Pending |
| REST-05 | P1: mezzanine place rejected | Design | Pending |
| REST-06 | P1: rooms bound to guest floors | Design | Pending |
| REST-07 | P2: check-in → dining slot | Design | Pending |
| REST-08 | P2: seeded dwell | Design | Pending |
| REST-09 | P2: rest departs immediately | Design | Pending |
| REST-10 | P2: dwell is a buffer | Design | Pending |
| REST-11 | P2: wrong-delivery returns to dining | Design | Pending |
| REST-12 | P2: carrier-loss teardown | Design | Pending |
| REST-13 | P2: no new messages | Design | Pending |
| REST-14 | P2: mezzanine view | Design | Pending |
| REST-15 | P2: M press + lit indicator | Design | Pending |
| REST-16 | P2: dining cue | Design | Pending |
| REST-17 | P2: spectator + indicators | Design | Pending |
| REST-18 | P3: manifest entries | Design | Pending |

**Coverage:** 18 total, mapped at Tasks phase, 0 unmapped.

---

## Success Criteria

- [ ] `sim:dining` scenarios pass: check-in→slot, rest→immediate departure,
  dwell-elapsed→stays, wrong-delivery→returns to dining, mezzanine place
  rejected.
- [ ] `client:restaurant` scenario passes: mezzanine view, M press, dining
  marker.
- [ ] Gates 1–3 green (`pnpm typecheck`, `pnpm lint`, `pnpm test:sim`,
  `pnpm test:client`); 4-floor pins re-pinned, none deleted.
