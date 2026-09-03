# Turnover

Social-deduction browser game: 4–6 players, hidden saboteur, physical evidence.
Message-only protocol: the server never transmits full state, and never sends
anything a player cannot legitimately know.

## Language

**Protocol registry**:
The single catalog declaring every server→client message type once: its payload
type and its recipient policy. Client→server intents are not part of it.
_Avoid_: message catalog, message table

**Recipient policy**:
The closed set of rules for who may receive a message (`all`, `self`; extended
deliberately, e.g. room occupants, nearby players). The security core of the
game: hidden information is the product.
_Avoid_: audience, visibility rule, routing rule

**Envelope**:
The per-connection wrapping the router stamps on every server→client message:
monotonic sequence number plus server time. A sequence gap ends the connection;
the client rejoins and resyncs from a fresh snapshot.
_Avoid_: wrapper, header, frame

**Router**:
The per-room server module that applies recipient policies to sim events and
room-originated sends, and stamps the envelope. Owns the per-connection
sequence counters.
_Avoid_: dispatcher, message switch

**Suitcase**:
The physical object a checked-in guest's delivery revolves around (v1.4,
AD-032): one per checked-in guest, either carried by a player (rides the
carrier's position stream) or resting at a room doorway. E places it at a room
door, E picks a resting one up — by anyone, saboteur included. Carrying blocks
work-channel starts; placement is silent. The guest follows its last resting
room.
_Avoid_: luggage, bag, delivery item

**Carrier**:
The player currently holding a suitcase — set at check-in (receiver = first
carrier), transferred by pickup, lost only to teardown (carry-clock expiry,
firing, ghosting, disconnect). One suitcase per player; carrying is
hands-full.
_Avoid_: holder, bearer, courier

**Room notice (assignment)**:
The building-wide announcement of a guest's room assignment at the check-in
tick (AD-034): every connected player receives `guest:assigned` exactly once
and the walkie renders "a guest announces: I'm in F:R". There is no earshot —
the saboteur learns the assignment for free; the contested gameplay is
physical interception of the suitcase, not information.
_Avoid_: earshot, overhear radius, hearing range, desk-earshot

**Restaurant (mezzanine)**:
The 3.C dining floor directly above the lobby: checked-in guests wait in
deterministic dining slots there (`GUEST_RESTAURANT_START_TILES` eastward,
one per `GUEST_QUEUE_SPACING_TILES`) with a seeded 15–30 s dwell that is a
wait buffer, not a schedule — a guest whose suitcase rests leaves
immediately, and a guest whose dwell elapses simply keeps dining. Replaces
the 3.B lobby holding-area stub.
_Avoid_: holding area, waiting room, lobby queue (the queue is the unchecked line)

**Rider session**:
The client's single derivation of the local player's in-car state — car,
occupants, press queue, last press — reduced purely from the ViewAction
stream. The rider chip renders from it and the world scene consumes it (press
keymap gate, rider visibility). Derived once, never per-consumer.
_Avoid_: riding state, rider chip state

**Affordance (E)**:
The pure spatial module (`packages/shared/src/affordances.ts`, AD-037) behind
every E-key and range-gated interaction: the desk zone, room-door range,
pickup-nearest (ties to lowest guest ordinal), accusation range, and landing
zone predicates, plus the E-keydown ladder and keyup swallow-rule decision
tables. Consumed by BOTH the sim's authority guards and the client's
prediction mirror — range expressions have exactly one home, and a mirrored
expression in a caller is a defect. Nothing that emits, mutates, or knows
about transport crosses this module's interface.
_Avoid_: range mirror, client-side predicate, proximity check

**Stairwell**:
The camera-free transit at the west end of every floor (AD-040): staff-side
only, one floor stride per activation (3 s) plus a 2 s breath catch on the
arrival floor. Entry and arrival are observable; the interior publishes
nothing — no positions, no co-transiting identities, no spectator view
(FR-34). The speed cost is the price of the anonymity; the elevator is the
fast-but-observed alternative.
_Avoid_: west elevator (it no longer exists), back stairs, fire escape

**Ambush**:
The saboteur's stairs power (FR-35): an automatic, anonymous 20 s stun when
the saboteur and a live staff member pass mid-stairs in opposite directions.
No per-round limit; stationary players are inert; guests and fired players
are immune. The victim learns only that they were ambushed — never by whom;
the stun times and places are testimony without identity (the saboteur's
signature trace). Spec-pinned property: an ambush never *creates* a
complaint — it only enables one already set up.
_Avoid_: kill, assassination, capture, neutralization (the shipped word is "stun")

**Breath catch**:
The 2 s immobile window on stairs arrival, for every stairs user. Mechanically
inert: a player catching their breath neither ambushes nor can be ambushed.
_Avoid_: cooldown, rest, recovery (recovery is the stun's end, not the breath)

**Stun**:
The ambush's effect on a staff member: 20 s immobile mid-transit, then the
interrupted transit resumes to the intended floor. A stun pauses, it never
drops a carried suitcase or clears a carry clock (a pause, not a foul).
_Avoid_: knockout, kill, capture

**Complaint budget**:
The building-wide counter of trash-discovery complaints (FR-31, cycle 3.3) —
trash-discovery desk reports only, wrong-delivery door complaints count
toward nothing since v1.5 (AD-039). Eight is instant staff loss, wired into
the §6.6 win checks; the HUD pulses red when nearing the budget.
_Avoid_: fine, penalty points, lives

**Trash discovery**:
The two-stage evidence beat when a guest walks into their assigned room and
finds trash (FR-29b, cycle 3.3): stage 1 is the in-world anger cue at the
room — sameFloor, room-number level, no detail, no actor; stage 2 is the
desk report at the hotel desk — building-wide, with the fuzzy timestamp the
guest observed inside (fresh-tier trash or a witnessed un-prep → "maybe a
minute ago", aged churn → "a while ago now"). One complaint then the guest
leaves the hotel, no retry. A guest who enters mid-un-prep flees along the
same path (FR-30) and the complaint counts.
_Avoid_: complaint creation, trash found, discovered

**Trash provenance**:
The author dimension on trash (FR-32, cycle 3.4): every `trashed`/`settled`
room carries `sabotage` (fresh-tier un-prep, re-trash) or `churn` (checkout
`settled`), `prepped`/`fresh` carry `none`. A `settled`+`churn` room laundered
via staff prep → saboteur un-prep becomes `trashed`+`sabotage` (churn can be
laundered into suspicious); a sabotage hit never downgrades to churn. Visible
only inside the room (FR-10) while the round is live; the recap exposes the
author per complaint post-reveal (sabotage names the actor, churn says checkout
churn) — pre-round messages carry no provenance.
_Avoid_: author tag, trash owner, dirt source

**Tenancy sign**:
The Occupied/Vacant flip-sign per guest door (FR-33, cycle 3.4): the building
operates it automatically — Occupied when a guest settles, Vacant when they
check out or leave after a trash-discovery complaint (the vacant-but-trashed
footprint). Shows tenancy, not presence — a fled guest keeps the sign
Occupied? No, discovery flips Vacant while the room stays trashed. Separate
channel from FR-11 cards (card = prep history, sign = tenancy), neither
timestamped. Hallway-visible sameFloor-public (the at-a-distance verifier for
suitcase outcomes), seeded via the viewer's own `movement:snapshot`
`tenancies` and the `spectator:snapshot` full baseline for fired players.
_Avoid_: occupancy indicator, door occupancy, tenancy tag

**Settle target**:
The §6.6 buzzer win dial (v1.5, AD-039; calibrated 3.5, AD-043; re-proven 3.6,
AD-044): 5 (4p) / 7 (5p) / 9 (6p) settled guests at the 5:00 buzzer. Staff win
iff `settledCount ≥ SETTLE_TARGET` (the `settle-target-met`/`failed` reasons);
the 8-complaint budget is the other instant-loss leg. Locked at 5/7/9 after the
pure-churn 20/20 (6p) and mis-place 17/20 (bot 20–90% band) proofs, re-proven
3.6 `sim:exit_a` 20/20 and `sim:exit_b` 20/20 (relaxed band) under the full
economy. Read only via `settleTargetFor`.
_Avoid_: coverage target (it is telemetry/KPI since v1.5), settle threshold

**Guest exit (balance gate)**:
The 3.5 headless bot proof that §7 holds under the one-car + stairs economy
(AD-043): `sim:guest_exit_a` (staff vs pure churn at 6p/5p/4p) and
`sim:guest_exit_b` (mis-placement saboteur `room+1` on the next guest floor
+ sameFloor correction / building-wide sab steal vs intercepting staff at 6p)
— the v1.4/v1.5 §7 gate before §7 locks. Also re-checks the shrunken
complaint budget's reachability (discovered <8 in pure churn, <8 even under
mis-place, ambush 0 complaints) and the stairs relief headroom (single car
8–12 s per trip, 1.5× at 6p).
_Avoid_: exit criteria (the v1.2 `sim:exit_a`/`exit_b` live in 3.6 as re-proof), bot AI

**Telemetry**:
Server-authoritative JSONL per round, line-delimited, internal only — never
on the wire (FR-23, cycle 3.6). One JSON object per line: room transitions
(actor+time), elevator calls/rides/doors, walk-in catches, accusations
(`wasTargetSaboteur`/`crimeOccurred`), guest lifecycle
(arrived/assigned/self-assigned/suitcase-carried/placed/picked-up/settled/
checked-out/left/angered/discovered/complained + tenancy + carry-clock-expiry),
plus synthetic 1/s `coverage-sample` (`prepped/24`). Closed with a
`round-ended` marker (`staff`/`saboteur`/`aborted`) so the `aborted` file is
machine-readable and excludable from KPIs. KPIs (FR-24) are pure aggregation
over non-aborted files: the 5 v1.2 fields (`saboteurWinRate`,
`correctAccusationRate`, `catchesPerHour`, `meanTimeToFirstCrimeSeconds`,
`decoyCallRate`) plus the 4 guest bleed-vs-throughput fields (`meanSettleScore`,
`meanComplaintsPerRound`, `carryClockFiresPerRound`, `provenanceSplit`,
`settlesPerMinute`); malformed/unknown-kind lines are skipped and counted.
File `data/telemetry/<code>-<idx>.jsonl` is `mkdir -p`'d per round and
git-ignored; `data/telemetry-test-tmp/` is the test seam.
_Avoid_: analytics beacon, client telemetry, wire telemetry
