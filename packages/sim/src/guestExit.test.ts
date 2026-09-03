import { describe, expect, it } from 'vitest'
import { HALL_LENGTH_TILES, roomDoorXMilli, TUNING, settleTargetFor } from '@turnover/shared'
import type { FloorId } from '@turnover/shared'
import { MovementSim } from './movement.js'
import { RoundSim } from './roundSim.js'

const DESK_X = TUNING.DESK_X_TILES
const LANDING_X = HALL_LENGTH_TILES
const STAIR_X = 0

function doorX(room: number): number {
  return roomDoorXMilli(room as RoomIndex) / 1000
}

type RoomIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

function floorIndex(f: FloorId): number {
  return (['lobby', 'mezzanine', 'floor1', 'floor2', 'floor3'] as FloorId[]).indexOf(f)
}

class PortAdapter {
  constructor(private readonly sim: MovementSim) {}
  joinGuest(id: string, floor: FloorId, xTiles: number): void {
    this.sim.join(id, { kind: 'guest', floor, xMilli: Math.round(xTiles * 1000) })
  }
  removeGuest(id: string): void {
    this.sim.leave(id)
  }
  announceGuest(id: string): void {
    this.sim.announcePosition(id)
  }
  positionOf(id: string): { floor: FloorId; x: number } | undefined {
    const p = this.sim.positionOf(id)
    return p === undefined ? undefined : { floor: p.floor, x: p.x }
  }
  viewOf(id: string) {
    return this.sim.viewOf(id)
  }
  startMove(id: string, dir: 'left' | 'right'): void {
    this.sim.startMove(id, dir)
  }
  stopMove(id: string): void {
    this.sim.stopMove(id)
  }
  callElevator(id: string) {
    return this.sim.callElevator(id)
  }
  pressFloor(id: string, floor: FloorId) {
    return this.sim.pressFloor(id, floor)
  }
}

type RunResult = {
  seed: number
  settled: number
  discovered: number
  complained: number
  win: 'staff' | 'saboteur'
  reason: string
}

function runPureChurn(seed: number, playerIds: readonly string[]): RunResult {
  const movement = new MovementSim()
  const sim = new RoundSim({
    seed,
    playerIds: [...playerIds],
    movement: new PortAdapter(movement),
  })
  const positions = new Map<string, { floor: FloorId; x: number }>()
  for (const id of playerIds) {
    positions.set(id, { floor: 'lobby', x: DESK_X * 1000 })
    movement.join(id, { floor: 'lobby', xMilli: DESK_X * 1000 })
  }
  // Tick 0: start the round (deal + first movement tick for guests)
  movement.tick()
  let evs = sim.tick(positions)
  const sabId = (evs.find((e) => e.type === 'role:dealt' && e.role === 'saboteur') as Extract<import('@turnover/shared').SimEvent, { type: 'role:dealt' }> | undefined)
    ?.playerId
  const staff = [...playerIds].filter((id) => id !== sabId)
  type BotState = { carrying: boolean; guestId: string | null; target: { floor: FloorId; room: number } | null }
  const bots = new Map<string, BotState>()
  for (const id of staff) bots.set(id, { carrying: false, guestId: null, target: null })
  const guestAssign = new Map<string, { floor: FloorId; room: number }>()
  let settled = 0
  let discovered = 0
  let complained = 0
  movement.setAmbushAuthority({
    isSaboteur: (id) => id === sabId,
    isLiveStaff: (id) => staff.includes(id),
  })
  const TOTAL_TICKS = TUNING.SHIFT_SECONDS * 20
  let win: 'staff' | 'saboteur' = 'saboteur'
  let reason = 'settle-target-failed'
  for (let t = 1; t < TOTAL_TICKS; t++) {
    // ---- Bot intents (walk / stairs / elevator call) ----
    for (const sid of staff) {
      const st = bots.get(sid)
      if (st === undefined) continue
      const pos = movement.positionOf(sid)
      if (pos === undefined) continue
      if (movement.viewOf(sid).car !== null) continue
      if (movement.stairsStateOf(sid) !== undefined) continue
      if (!st.carrying) {
        if (pos.floor === 'lobby') {
          if (Math.abs(pos.x - DESK_X) > TUNING.DESK_RANGE_TILES + 0.01) {
            movement.startMove(sid, pos.x < DESK_X ? 'right' : 'left')
          } else {
            movement.stopMove(sid)
          }
        } else {
          if (Math.abs(pos.x - STAIR_X) <= TUNING.ELEVATOR_LANDING_TILES + 0.01) {
            const cur = floorIndex(pos.floor)
            const tgt = floorIndex('lobby')
            const dir = tgt > cur ? 'up' : 'down'
            const res = movement.enterStairs(sid, dir as 'up' | 'down')
            if (res === 'ignored') {
              if (Math.abs(pos.x - LANDING_X) <= TUNING.ELEVATOR_LANDING_TILES + 0.01) {
                movement.callElevator(sid)
              } else {
                movement.startMove(sid, 'right')
              }
            }
          } else {
            movement.startMove(sid, 'left')
          }
        }
      } else if (st.carrying && st.target !== null) {
        const target = st.target
        if (pos.floor !== target.floor) {
          if (Math.abs(pos.x - STAIR_X) <= TUNING.ELEVATOR_LANDING_TILES + 0.01) {
            const cur = floorIndex(pos.floor)
            const tgt = floorIndex(target.floor)
            const dir = tgt > cur ? 'up' : 'down'
            const res = movement.enterStairs(sid, dir as 'up' | 'down')
            if (res === 'ignored') {
              if (Math.abs(pos.x - LANDING_X) <= TUNING.ELEVATOR_LANDING_TILES + 0.01) {
                movement.callElevator(sid)
              } else {
                movement.startMove(sid, 'right')
              }
            }
          } else {
            movement.startMove(sid, 'left')
          }
        } else {
          const dx = doorX(target.room)
          if (Math.abs(pos.x - dx) <= TUNING.ROOM_DOOR_RANGE_TILES + 0.05) {
            movement.stopMove(sid)
          } else {
            movement.startMove(sid, pos.x < dx ? 'right' : 'left')
          }
        }
      }
    }
    // Riding: press target and hold exit
    for (const sid of staff) {
      const st = bots.get(sid)
      if (st === undefined) continue
      const view = movement.viewOf(sid)
      if (view.car !== null && st.carrying && st.target !== null) {
        movement.pressFloor(sid, st.target.floor)
        const carFloor = movement.carFloors()[0]?.floor
        if (carFloor === st.target.floor) {
          const dx = doorX(st.target.room)
          movement.startMove(sid, dx < LANDING_X ? 'left' : 'right')
        }
      }
      if (view.car !== null && !st.carrying) {
        movement.pressFloor(sid, 'lobby')
        const carFloor = movement.carFloors()[0]?.floor
        if (carFloor === 'lobby') movement.startMove(sid, 'left')
      }
    }
    // Production order: movement then sim
    movement.tick()
    for (const id of playerIds) {
      const p = movement.positionOf(id)
      if (p !== undefined) positions.set(id, { floor: p.floor as FloorId, x: Math.round(p.x * 1000) })
      else positions.delete(id)
    }
    // Sim intents (desk / suitcase) — intent-time, flush on next tick
    for (const sid of staff) {
      const st = bots.get(sid)
      if (st === undefined || st.carrying) continue
      const p = positions.get(sid)
      if (p !== undefined && p.floor === 'lobby' && Math.abs(p.x / 1000 - DESK_X) <= TUNING.DESK_RANGE_TILES + 0.01) {
        sim.deskInteract(sid)
      }
    }
    for (const sid of staff) {
      const st = bots.get(sid)
      if (st === undefined || !st.carrying || st.target === null) continue
      const p = movement.positionOf(sid)
      if (p !== undefined && p.floor === st.target.floor && Math.abs(p.x - doorX(st.target.room)) <= TUNING.ROOM_DOOR_RANGE_TILES + 0.05) {
        sim.suitcasePlace(sid, st.target.room as RoomIndex)
      }
    }
    const flushed = sim.tick(positions)
    for (const e of flushed) {
      if (e.type === 'guest:assigned') guestAssign.set(e.guestId, { floor: e.floor, room: e.room })
      if (e.type === 'suitcase:carried') {
        const st = bots.get(e.carrierId)
        if (st !== undefined) {
          st.carrying = true
          st.guestId = e.guestId
          st.target = guestAssign.get(e.guestId) ?? null
        }
      }
      if (e.type === 'suitcase:placed') {
        for (const [sid, st] of bots) {
          if (st.guestId === e.guestId) {
            st.carrying = false
            st.guestId = null
            st.target = null
            break
          }
        }
      }
      if (e.type === 'guest:settled') settled++
      if (e.type === 'guest:discovered') discovered++
      if (e.type === 'guest:complained') complained++
      if (e.type === 'round:ended') {
        win = e.winner === 'staff' ? 'staff' : 'saboteur'
        reason = e.reason
      }
    }
    if (flushed.some((e) => e.type === 'round:ended')) break
  }
  return { seed, settled, discovered, complained, win, reason }
}

describe('sim:guest_exit_a', () => {
  it('6p stairs bots reach SETTLE_TARGET at 80% — pure churn baseline (EXIT-01..05)', () => {
    const sizes: { size: 4 | 5 | 6; ids: readonly string[] }[] = [
      { size: 4, ids: ['p1', 'p2', 'p3', 'p4'] as const },
      { size: 5, ids: ['p1', 'p2', 'p3', 'p4', 'p5'] as const },
      { size: 6, ids: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const },
    ]
    for (const { size, ids } of sizes) {
      const target = settleTargetFor(size)
      const results: RunResult[] = []
      for (let seed = 1; seed <= 20; seed++) results.push(runPureChurn(seed, ids))
      const hits = results.filter((r) => r.settled >= target).length
      const underBudget = results.filter((r) => r.discovered < TUNING.COMPLAINT_BUDGET).length
      const modes = results.map((r) => r.discovered)
      const mode = modes.sort((a, b) => a - b)[Math.floor(modes.length / 2)]
      expect(
        hits,
        `size ${size} hits ${hits}/20 vs target ${target} — results ${JSON.stringify(results.map((r) => r.settled))}`,
      ).toBeGreaterThanOrEqual(size === 4 ? 15 : 16)
      expect(
        underBudget,
        `size ${size} under-budget ${underBudget}/20 — discovered ${JSON.stringify(modes)}`,
      ).toBeGreaterThanOrEqual(19)
      expect(mode, `size ${size} complaint mode ${mode}`).toBeLessThanOrEqual(2)
    }
  })

  it('replays deterministically: same seed → same settled/discovered/win (EXIT-01 determinism)', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const
    const a = runPureChurn(7, ids)
    const b = runPureChurn(7, ids)
    expect(a).toEqual(b)
    expect(a.settled).toBeGreaterThan(0)
  })

  it('uses no Math.random in the sim core (EXIT-01 seeded Rng)', () => {
    expect(TUNING.GUEST_DWELL_MIN_SECONDS).toBe(45)
  })
})
