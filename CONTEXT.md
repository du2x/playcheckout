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
