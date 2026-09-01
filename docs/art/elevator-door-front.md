# Front-facing elevator landing doors (AD-036 art slice)

Replaces the transverse `elevator-car` sheet with landing doors drawn in the
same billboard perspective as the room doors. Animation logic is untouched —
`ElevatorPresenter` only ever reads frame index, alpha, y, visibility
(AD-026/027), so this is a pure art + loader swap.

## Sheet contract

`apps/client/public/art/elevator/elevator-door.png` — 2-frame horizontal
spritesheet, **128×96** (two 64×96 frames, `frameWidth: 64, frameHeight: 96`):

| Frame | State | Content |
| ----- | ----- | ------- |
| 0 | doors **open** (arrival dwell / boarding) | Front-facing doorway: brass top beam + side posts, charcoal doors parked at the sides, cage bars across the opening, open shaft above the car floor — the open frame stays transparent in the doorway so nothing renders "inside" (privacy: occupants are never drawn, ART-15). |
| 1 | doors **closed** (parked / departing slab) | Solid charcoal double-slab with brass center seam and safety rail, same jamb geometry as room doors. |

Frame order matches the current `elevator-car` sheet (0 = open cage,
1 = closed slab) so `ElevatorPresenter` and its tests keep their semantics
(`elevatorPresenter.test.ts` asserts `frames.at(-1)` 0/1).

## Geometry

- 64 px wide × 96 px tall — origin stays `(0.5, 1)` at `GROUND_Y`, so the
  sprite top sits at the same height as the 72×96 room doors.
- Rendered at `carPx(id)` = x 0 / 960 (hall ends). AD-036 freed a 2-tile
  (64 px) landing at each end: the door spans exactly the clearance and no
  longer hangs off-screen (the old 48 px transverse sheet did).
- The 64 px width sits between the two adjacent room doors (nearest door
  centers at 88 px from the edges, art 72 px wide → ≥ 16 px visual gap).

## Style (Deco Noir, AD-029)

Reuse the existing palette constants from
`scripts/art/generate-doors-elevator.py`: `JAMB` side posts, stepped `BRASS`
lintel mirroring `door_frame()`'s pediment, `CHARCOAL`/`CHARCOAL_SHADE` slabs,
`BRASS_SHADE` cage bars + center seam + safety rail, `IVORY` ceiling light
inside the open frame. The lintel should read as the room-door pediment's
sibling (same stepped-brass motif, slightly heavier to mark it as the shaft).

## Implementation steps

1. Extend `scripts/art/generate-doors-elevator.py`: new `elevator_door(open)`
   author (64×96), stacked via `_hstack` into `elevator-door.png`; keep the
   legacy `elevator-car` output until the swap lands, then drop it.
2. `BootScene`: replace the `elevator-car` spritesheet load with
   `elevator-door` (`frameWidth: 64, frameHeight: 96`).
3. `WorldScene.create()` car loop: load `'elevator-door'` instead of
   `'elevator-car'` (same origin/GROUND_Y mounting).
4. `docs/art/asset-manifest.json`: new `elevator-door` entry, retire
   `elevator-car` (keep the panel entry — it is unchanged).
5. Gates: `pnpm typecheck && pnpm lint && pnpm test:sim` (presenter tests must
   pass unmodified), then `pnpm test:client` — the art harness filters by
   name/texture key, so `art-elevator.spec.ts` needs its texture-key
   assertions updated to `elevator-door`.

## Explicitly out of scope

- No new server messages, no occupant rendering, no interior glimpse of the
  car (message-only protocol; the open frame shows shaft + cage bars only).
- No reposition of the landings (cars stay at x=0/960); in-hall relocation is
  a separate discussion.
