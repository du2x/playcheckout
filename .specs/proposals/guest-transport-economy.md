# Proposal: Guest-transport economy (v1.4)

> Status: DRAFT for review — nothing here touches `prd.md`, `.specs/STATE.md`,
> or code until accepted. On acceptance: PRD deltas below land in `prd.md`
> (bump to v1.4), the AD lands in `.specs/STATE.md`, and the roadmap re-plans
> the affected cycles.

## Motivation

v1.3 (AD-022) parks one staff member at the front desk: receive at desk →
walkie send → the guest walks off alone. Two problems:

1. Desk camping is dead weight — one player is pinned to the desk zone for the
   whole receive/send window with nothing deductive to do.
2. The walkie-lie has no social verification surface: the broadcast is a
   claim nobody but the broadcaster can check against anything.

The suitcase-carry model fixes both: the receiver becomes a mobile carrier
(desk dwell shrinks to a moment), and the announce becomes a checkable social
lie because the guest's real assignment is overhearable at the desk.

## Revised guest flow

1. **Arrival & queue** — unchanged (§7 cadence, queue slots, lobby lane).
2. **Check-in** — a staff member at the desk receives the guest (E, as today)
   and **immediately takes the guest's suitcase**. Receiver = carrier; no
   handoff step; a carrier holds at most one suitcase. At check-in the guest
   **states their assigned room** diegetically ("I'm in 305").
3. **Assignment** — server-truth, seeded at check-in (same seeded-stream
   pattern as 3.1 self-assign). It is transmitted **only** to the receiver and
   to staff within desk earshot at that moment (positional overhear; new
   per-recipient policy — see Protocol). Nobody else ever receives it.
4. **Announce** — the carrier (or anyone) may send a walkie line
   "«Name»: guest going to F:R", heard by all players as today. It is a
   **claim, unchecked by the server**; it may contradict the assignment.
5. **Guest to restaurant** — on check-in the guest walks to the new
   **restaurant floor** and dwells there (new `dining` phase). The guest does
   not follow the carrier.
6. **Carry** — the carrier walks the suitcase to a room (elevator citizen,
   same movement rules as players).
7. **Delivery** — suitcase arrival at a room is the delivery:
   - **delivery == assignment** → the guest leaves the restaurant, walks to
     the room, enters, settles (dwell → checkout churn unchanged).
   - **delivery != assignment** → the guest **auto-accuses the carrier**;
     the carrier is **fired** (personal foul).
8. **Mid-prep entry** — unchanged: a guest entering a room during an active
   un-prep flees and complains (team foul).

## Foul taxonomy

| Foul | Trigger | Consequence | Who eats it |
| --- | --- | --- | --- |
| Personal | Suitcase delivered to a room != the guest's assignment | Guest auto-accuses → carrier fired | The carrier alone |
| Team | Guest enters a room mid-un-prep | Flee + complaint (budget) | The team (loss pressure) |

This is the **only** carve-out to FR-30: everywhere else guests never convict.

## Walkie-lie becomes social

Announcing a room != the assignment is legal and unchecked — its value is
misdirecting prep labor (staff un-trash the announced room while the real
assigned room stays trashed → complaint). It is catchable only by humans who
overheard the assignment at check-in. The saboteur's toolkit becomes:
announce-lie (social risk), mid-prep (team foul), desk stall, slow carry.

## FR rewrites (on acceptance)

- **FR-26** — guest lifecycle gains the suitcase (taken at check-in), the
  restaurant dwell (`dining` phase), and delivery-coupled room entry.
- **FR-27** — routing & walkie: receiver = carrier; the announce stays a
  claim; the **delivery** is the server-checked ground truth (vs assignment).
- **FR-29** — discovery: guests always enter the room their suitcase was
  delivered to (and only after delivery).
- **FR-30** — guests never convict **except** the wrong-delivery auto-accuse
  (personal foul).
- **§7 tuning** — new dials: restaurant dwell range, desk earshot range,
  carry speed (if differentiated), one-suitcase cap. Cadence/impatience re-fit
  after the flow change (see Open questions).

## Protocol impact (registry-first)

- New `assignment` surface with a **positional earshot recipient policy**
  (receiver + desk-earshot staff only). Leak rule: players outside earshot at
  the check-in tick must never receive it — this is hidden state by position,
  not by role, so it is message-only-legal.
- New delivery events (suitcase `carried`/`delivered`/`auto-accuse`/`fired`)
  with declared recipient policies; `walkie:broadcast` unchanged.
- Guest phases gain `dining`; `guest:moved` (`sameFloor`) machinery reused.

## Content & architecture impact

- **Restaurant floor** — breaks the pinned AD-010 building shape
  (lobby + 3 guest floors × 8 rooms): `packages/shared/src/layout.ts` +
  `layout.test.ts`, elevator economy (4 served floors), client floor view,
  art manifest (new floor + suitcase + restaurant furniture).
- **Suitcase** — new carried-item entity in the sim; rides with the carrier's
  position; visible marker on the carrier.
- **GuestSim** — `held` state reworked into `checkedIn` (suitcase out,
  guest dining); `routeHeld` split into announce (free) and delivery (checked);
  delivery check in the per-tick suitcase position pass.
- **RoundSim / room** — `desk:send` replaced by carry/delivery intents;
  fired-on-delivery reuses the justice teardown path (`releaseAll`, leave).
- **Shipped cycles touched** — 3.1 `guest-flow` (queue/impatience re-scope),
  3.2 `front-desk` (receive/route flow largely rewritten), 3.3+ unchanged in
  shape. Roadmap re-plan required (phase rule: art manifest first).

## Open questions (defaults chosen, veto freely)

1. **Impatience target** — default: the 20s clock now times the *check-in
   wait* (queue → suitcase pickup) only; once checked in, the guest is
   patient at the restaurant and no clock runs on the carrier.
2. **Suitcase drop/abandon** — default: no voluntary drop; walk-out/fired/
   ghosted/disconnect returns the suitcase to the desk and the guest back to
   the queue front (assignment void, re-assigned on re-check-in).
3. **Earshot definition** — default: same-floor lobby, within
   `DESK_EARSHOT_TILES` (new dial) of the desk at the check-in tick; a
   snapshot policy (who is nearby at that instant), not a stream.
4. **Restaurant dwell** — default: 15–30s seeded, shorter than room dwell;
   guests with a delivered suitcase leave immediately (dwell is a wait
   buffer, not a schedule).
5. **Announce author** — default: anyone may send the walkie line (not only
   the carrier), keeping the announce as a coordination/framing tool.
