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

**Earshot (desk)**:
The check-in-tick snapshot set for a guest's room assignment: the receiver plus
every live lobby-floor player within `DESK_EARSHOT_TILES` of the desk. The
assignment is transmitted exactly once, to exactly that set — never repeated,
never logged. The `deskEarshot` recipient policy encodes it; spectators are
deliberately excluded.
_Avoid_: overhear radius, hearing range, broadcast range

**Holding area**:
The lobby-lane stub east of the desk where checked-in guests wait (3.B) until
their suitcase first rests; replaced by the 3.C mezzanine restaurant. Guests
there are patient — impatience times only the check-in wait.
_Avoid_: waiting room, lobby queue (the queue is the unchecked line)

**Rider session**:
The client's single derivation of the local player's in-car state — car,
occupants, press queue, last press — reduced purely from the ViewAction
stream. The rider chip renders from it and the world scene consumes it (press
keymap gate, rider visibility). Derived once, never per-consumer.
_Avoid_: riding state, rider chip state
