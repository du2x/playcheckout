# Art-Swap Design (cycle 2.10)

## Fixed frame (from spec assumptions — not re-litigated here)

Rendering-only; zero protocol/sim/server/tuning changes. Viewport stays
832×576 (AD-020 viewport decision stays open). Assets load in BootScene
already; `elevator-car` and `elevator-panel` switch from `load.image` to
`load.spritesheet` (48×64 / 16×32 frames).

## The count contract (the cycle's central mechanism)

The AD-005 contract ("scene children are exactly one labeled Rectangle per
player plus one Ellipse per car") is replaced by the ART contract:

| Primitive | Old object | New object | Harness filter (via `window.__TURNOVER__` children list) |
|---|---|---|---|
| Player | `Rectangle` 26×60 | `Sprite` texture `staff-walk`, origin (0.5, 1) at `(x·TILE_PX, laneY)` | `c.type === 'Sprite' && c.texture?.key === 'staff-walk'` |
| Player label | `Text` | unchanged | `c.type === 'Text'` |
| Elevator car | `Ellipse` | `Sprite` texture `elevator-car`, origin (0.5, 0.5) at `(carPx, laneY + 30)` | `c.type === 'Sprite' && c.texture?.key === 'elevator-car'` |
| Room door | DOM `#doors-layer [data-door-room]` | `Image` texture `door-closed`/`door-open`, origin (0.5, 1) at `(roomCenterPx, laneY)` | texture-key filter `door-closed`/`door-open` |
| Room interior | (none) | `Image` per allowed render (see below), origin (0, 1) at segment start | texture-key filter `room-*` |
| Landing panel flash | DOM background pulse on `#elevator-panel` | `Image` per landing, texture `elevator-panel` frames idle/flash | texture-key filter `elevator-panel` |
| Card glyphs, cue text nodes, progress bar, room-state label, in-car screen | DOM | unchanged (not in swap scope) | existing DOM selectors |
| Corridor band, wall fill, rustle FX | TileSprite/Graphics/Sprite (AD-020 slice) | unchanged | existing |

Role-blind by construction: texture-key filters cannot leak a role they cannot
see (FR-9 audit is "all player sprites share texture/anim/timing", asserted on
the visible set, not on any role knowledge).

## Component changes

### WorldScene (all swaps land here; logic untouched, presentation swapped)

1. **Players** — `PlayerDisplay.rect` → `sprite`; add `facing: 'left' | 'right'`.
   Own player: facing follows `ownMoving`; others: `player-moved`'s `facing`
   field (already on the wire, previously ignored). Per frame in `update()`:
   moving (own predicted movement live, or a non-settled lerp target) → play
   the 8-frame walk anim (created in `create()`, `repeat: -1`); settled → stop
   + frame 0. `flipX` = facing left (sheet faces right).
2. **Doors** — `buildDoorsLayer`/`syncDoors` rewrite: one `door-closed` Image
   per room segment per guest floor (Map `floor:room`), visibility follows
   `viewFloor`/spectator exactly as the DOM frames did; phase-free (ART-06/11).
   Gray-box state tints die (ART-10): `syncDoors` stops reading `roomStates`.
   `#doors-layer` DOM is deleted.
3. **Door-open + interiors** —
   - Own room: while the own player stands inside the observed segment
     (`this.interior` + `roomIndexAtMilli(own.x)` — the exact predicate
     `updateRoomLabel` already uses), that doorway renders `door-open` with the
     interior Image behind it, texture mapped `prepped|fresh → room-prepped`,
     `trashed → room-trash-fresh`, `settled → room-trash-settled`
     (ART-08). One Image slot ⇒ structurally ≤1 interior for live players
     (ART-14).
   - Hallway: a live `entered` cue (kind `'door'`, existing TTL window) flips
     that room's door texture to `door-open` for the cue duration — no interior
     Image exists for it (ART-07/09).
   - Spectator: per the FR-20 baseline (`roomStates` seeded building-wide),
     each known room renders `door-open` + its interior Image on its lane
     (ART-12/13). Unknown-state rooms stay closed.
4. **Cars** — `cars` map value `{ellipse, floor}` → `{sprite, floor}`;
   `ElevatorPresenter`'s `EllipseLike` gains `setFrame(frame: number)`; frame =
   `doorsOpenAmount(clock, cfg) > 0 ? 0 : 1` (open dwell → cage with bars,
   closing-from-halfway → closed slab, transit → hidden, unchanged). The
   presenter's gray-box door Graphics (`drawDoors`, `GraphicsLike`, `DOOR_*`)
   are deleted — the sprite owns its doors. All presenter readouts
   (`carVisible`/`carAlpha`/`carY`/phase model) unchanged (ART-15/16).
5. **Panel flash** — two `elevator-panel` Images (west/east landing walls at
   `(carPx ± offset, laneY - 60)`, visible on any viewed floor incl. lobby).
   `flashPanel(floor)` stores `{floor, until}`; per frame, panels on a floor
   inside the flash window render frame 1 (flash), others frame 0 (idle). The
   DOM background pulse on `#elevator-panel` is removed; the DOM panel keeps
   its text readouts + hall-call lights (data-only AD-012/AD-019 semantics
   unchanged — decoys flash identically, ART-17).

### ElevatorPresenter

- `EllipseLike` → `CarViewLike { x, y, setVisible, setAlpha, setY, setFrame }`.
- `tick()` sets the frame from `doorsOpenAmount`; door Graphics plumbing
  removed. Unit tests (`elevatorPresenter.test.ts`) updated: fake car gains
  `setFrame` spy/record; door-drawing assertions → frame assertions. Pure
  clock logic (phases, readouts) untouched.

### Harness migration (ART-18/19)

Texture-based filters replace `type === 'Rectangle'/'Ellipse'` in `round`,
`movement`, `work`, `spectator`, `elevator-doors`; `doors.spec` moves from DOM
`#doors-layer` queries to door-Image counts via `__TURNOVER__`. Behavioral
assertions (labels, positions, counts, visibility, ELAN door episodes, rider
flows) keep their semantics — only the counted object type changes. Three new
scenario files assert the new presentation: `art-players`, `art-doors`,
`art-elevator`.

## Swap order (gate-green per task)

Each swap task amends exactly the harness specs that count its primitive, in
the same commit — the suite stays green at every task boundary:

```
players (round/movement/work/spectator filters + art-players)
  → cars (elevator-doors/movement filters + art-elevator car half)
  → doors (doors.spec migration + art-doors phase-free half)
  → interiors (spectator.spec + art-doors interior half)
  → panel flash (elevatorLobby check + art-elevator panel half)
  → approval bookkeeping (manifest approved, STATE, Gate 4 evidence)
```

## Risks

- **Panel flash DOM assertions**: `elevatorLobby.spec` may pin the DOM pulse —
  checked before T5; the sprite flash must satisfy the same "a call always
  looks registered" semantics (AD-012).
- **`__TURNOVER__` scene access for texture filters**: `debug.ts` already
  exposes scene children to the harness (specs list `children.list` today);
  texture keys ride on the same objects — no debug-surface expansion, and the
  prod strip check (`check-prod-strip.mjs`) still guards the hook out of
  production builds.
- **Sprite y-anchoring vs gray-box y-anchoring**: rectangles were center-anchored
  at `GROUND_Y`; sprites anchor bottom-center — label offsets and lane
  arithmetic unchanged, one-time visual offset (intended: feet on the ground).
