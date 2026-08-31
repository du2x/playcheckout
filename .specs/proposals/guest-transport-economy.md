# Proposal: Guest-transport economy (v1.4)

> Status: DRAFT v2 for review — nothing here touches `prd.md`,
> `.specs/STATE.md`, or code until accepted. On acceptance: PRD deltas land in
> `prd.md` (bump to v1.4), the AD lands in `.specs/STATE.md`, roadmap re-plans.
>
> v2 supersedes the v1 auto-fire model: wrong delivery no longer fires; the
> suitcase is a re-grabbable physical object and the guest follows its final
> resting room.

## Motivation

v1.3 (AD-022) parks one staff member at the front desk and gives the walkie-lie
no verification surface. The suitcase model fixes both: the receiver becomes a
mobile carrier, the assignment becomes overhearable (verifiable), and the
suitcase itself becomes contested physical evidence — the saboteur can
mis-place it, staff can correct it, and the guest's arrival is the tribunal.

## Core loop (one guest)

1. **Arrival & queue** — unchanged (§7 cadence, queue slots, lobby lane;
   impatience now times only the check-in wait).
2. **Check-in** — a staff member at the desk receives the guest (E) and takes
   the suitcase immediately. Receiver = first carrier; one suitcase per
   player. The guest **states their assigned room** diegetically ("I'm in
   305"). Assignment is server-truth, seeded at check-in.
3. **Earshot** — the assignment is transmitted only to the receiver and to
   staff within `DESK_EARSHOT_TILES` of the desk **at the check-in tick**
   (snapshot, never repeated, no log). Latecomers never learn it.
4. **Restaurant** — the guest leaves for the new **mezzanine floor** (directly
   above the lobby) and dwells there. The guest never follows the carrier.
5. **Walkie** — the building's walkie log is **server-generated truthful
   chatter** about guest-lifecycle facts: a guest is waiting at the desk,
   "«Ada» took a guest's suitcase", "suitcase picked up by «Bao»", a guest
   settled/left/complained. **Placement is silent** — no walkie line fires
   when a suitcase comes to rest; the room it rests at is learnable only by
   being on that floor and seeing it (or by the guest's later complaint or
   settle line). Players cannot author lines — there is no claim, and no
   lie. Assignment is never on the walkie before a settle; overhearing at
   check-in stays the only pre-placement source.
6. **Carry** — the suitcase moves with the carrier's position (elevator
   citizen, same movement rules). **Carrying blocks work channels** (no
   cleaning/prep while holding); accusation (hold-E) stays available.
7. **Place** — E at a room door sets the suitcase down at that doorway
   (resting). E near a resting suitcase picks it up (becomes the new carrier).
   Any staff can pick up any resting suitcase — interception is legal for
   everyone, saboteur included. Self-regrab is allowed.
8. **Guest follows the suitcase** — when the suitcase first comes to rest in
   a room, the guest leaves the restaurant and walks toward that room,
   **tracking its last resting room**: if it is picked up again mid-walk, the
   guest continues to the old room and waits at the door until it rests
   somewhere again (then re-targets).
9. **Outcome — at guest arrival at the suitcase's current resting room**
   ("final state"):
   - **room == assignment** → guest enters, settles; dwell → checkout churn
     unchanged (FR-29 economy intact).
   - **room != assignment** → the guest complains at the door: building-wide
     broadcast "the guest of room X complained about the suitcase"; the
     complaint **counts toward the team budget** (8 = loss). No personal
     penalty is attached to the placement.
10. **Checkout** — unchanged.

## Fouls & pressure

| Mechanism | Trigger | Consequence |
| --- | --- | --- |
| Complaint budget (team) | Wrong-room arrival; mid-prep entry (unchanged FR-30 path) | Counts toward 8-complaint instant loss |
| Carry clock | 60s from check-in to first placement; **fresh 60s per pickup**; expiry fires the **current carrier** | The only personal foul; bounds stalls and infinite interception loops; harsh on honest slow carries — 60s is chosen generous |
| Mid-prep entry | Guest enters a room during active un-prep | Flee + complaint (team) — guests never convict here (FR-30 preserved) |

Fired/ghosted/disconnect while carrying: the suitcase comes to rest at the
desk, the guest returns to the queue front, assignment void (re-assigned at
re-check-in). Buzzer/round end: teardown as today.

## The trash race (intended core, not a leak)

Anyone in earshot learns the assignment at check-in. The saboteur's strongest
line: hover, overhear "305", beat the suitcase to 305's door, place it there
— a *legal-looking* placement, guest arrives at trash → complaint. With no
personal penalty attached, mis-placement is **free** for the saboteur: the
only costs are exposure (they were seen at the door) and staff interception
before the guest arrives. Staff counter-play: hover to overhear, escort or
shadow suitcases, intercept and correct mis-placements — correction before
arrival is the *only* defense. Listening is vital *and* dangerous.

## E-key semantics (priority ladder)

Context resolves top-down; no menus:

1. **Desk zone** — receive next queued guest (suppressed accuse hold, as today)
2. **Near an elevator landing** — elevator call (tap), **carrying or not** —
   the carrier's transport affordance; a carrier must always be able to call
   a car without putting the suitcase down
3. **Carrying + at a room door** — place the suitcase
4. **Not carrying + near a resting suitcase** — pick it up
5. **Otherwise** — elevator call (tap) / accuse (hold ≥400ms, unchanged)

Note: room doors and elevator landings are distinct positions in the layout,
so 2–4 are spatially disjoint in practice — the ladder order only matters as
a tie-breaker for edge placements.

### Innocent-placer affordance (anti-paralysis)

Placing a suitcase in a room you never overheard is a gamble — if staff learn
"never place", the pipeline deadlocks at the restaurant. The client therefore
shows, diegetically, what the placer legitimately knows: rooms whose
assignments they overheard render as a confident placement; unknown rooms
show a one-step confirm ("You haven't heard this guest's room") before
sending `suitcase:place`. This is knowledge-about-own-knowledge, not the
assignment itself — message-only legal (the server never sends the room;
the client tracks which `assignment` overhears it received). The confirm
costs one click, not a refusal: gambling stays possible, blind placing
becomes deliberate.

## New content & tuning (§7)

- **Restaurant floor**: mezzanine above the lobby, served by both elevators;
  breaks the pinned AD-010 layout (`layout.ts`, `layout.test.ts`); new art
  manifest entries (floor, suitcase, restaurant furniture) BEFORE authoring.
- **Suitcase**: carried-item entity; resting marker at doorways; public
  visibility (sameFloor positional rules as everything else).
- **New dials**:   `DESK_EARSHOT_TILES`, `CARRY_CLOCK_SECONDS` (60),
  restaurant dwell 15–30s seeded (wait buffer, not a
  schedule — a guest whose suitcase rests leaves immediately), `DESK_RANGE_TILES`
  unchanged. **Balance gate**: the complaint-budget exchange rates are NOT
  final until the 3.5-style bot sims prove (a) staff interception can
  realistically beat the saboteur's free mis-placements (interception-before-
  arrival is the only defense — if it can't keep up, the budget burns), and
  (b) honest staff survive congestion-speed carries at the 6p cadence. §7
  locks only after that proof.

## Protocol impact (registry-first)

- `assignment` overhear message — positional earshot policy (receiver +
  desk-earshot staff at the check-in tick only). Hidden-by-position, not by
  role: message-only legal; players outside earshot must never receive it.
- Suitcase events (`suitcase:carried`, `suitcase:placed`, `suitcase:picked-up`)
  — sameFloor positional policy; **`suitcase:placed` has no walkie line** —
  cross-floor staff learn a placement only via later lifecycle facts
  (settle/complaint), never at placement time.
- Walkie feed — all-policy, server-generated only: guest-lifecycle facts
  (arrival/check-in/placement/pickup/settle/complaint/checkout). The player
  intent `walkie:broadcast` is **removed**; no client can author a line.
- `guest:complained` (wrong-room arrival) — all-policy broadcast; carries
  room + guest, never the assignment (post-hoc inference is the players' job).
- Fired events (carry-clock expiry, accusation) — all-policy, reusing the
  justice teardown path.
- Guest phases gain `dining`; `guest:moved` (`sameFloor`) machinery reused;
  the walkie feed is the delivery surface for the lifecycle facts above
  (one log entry per registry-declared event, `#walkie-log` keeps last 5).

## FR rewrites (on acceptance)

- **FR-26** — lifecycle gains suitcase + restaurant dwell + suitcase-following.
- **FR-27** — receiver = carrier; the walkie is the building's automatic,
  server-generated log of guest-lifecycle facts (no player claims, no lies);
  the suitcase's resting room at guest arrival is the ground truth.
- **FR-29** — discovery: guests enter only the suitcase's final resting room,
  only on arrival; wrong-room arrival = door complaint (no entry, no
  discovery of that room's interior).
- **FR-30** — guests never convict: wrong arrival and mid-prep both end in
  complaints (team budget); firing stays human via carry-clock expiry and
  accusation.
- **FR-10 amendment** — carrying blocks work channels.

## Sim architecture

- `GuestSim`: `held` → `checkedIn` (suitcase out, guest dining);
  assignment store; guest `toRoom` target = suitcase's last resting room.
- New `Suitcase` entity (carrier id or resting room + door position);
  pickup/place intents; rolling carry clock.
- `RoundSim`: desk receive gains suitcase handout; new `suitcase:place` /
  `suitcase:pickup` intents; outcome resolution on guest arrival tick;
  fired-on-clock reuses justice teardown.
- `MovementSim`: suitcase rides carrier position — presentation-level, no
  new movement authority.

## Shipped cycles touched

Split into **two cycles** — the interaction matrix is too wide for one:

- **3.2R `suitcase-transport`** — suitcase entity, place/pickup intents,
  carry clock, earshot overhear, guest-follows-suitcase outcome,
  client affordances. Restaurant floor stubbed (guests wait in a holding
  area on the lobby lane where the queue was).
- **3.2R2 `restaurant-floor`** — mezzanine above the lobby (AD-010 revision,
  `layout.ts` + pins, elevator economy, art manifest first), `dining` phase,
  dwell tuning, balance re-proof of the §7 dials.

Also touched: 3.1 `guest-flow` (queue/impatience re-scope), 3.2 `front-desk`
(route flow rewritten; walkie becomes the server-generated lifecycle log —
its shipped surface shrinks), 3.3+ shapes unchanged. Roadmap re-plan required.
