import type { FloorId, GuestFloorId, RoomIndex } from '@turnover/shared'
import {
  atStairwellMouth,
  FLOOR_IDS,
  GUEST_FLOOR_IDS,
  inDeskZone,
  onLanding,
  roomDoorXMilli,
  TUNING,
} from '@turnover/shared'
import type { BotIntent, BotWorld } from './botPlayer.js'
import { roomKey } from './botPlayer.js'

/**
 * Pure decision policies for the AI staff members — `(world, memory, now) →
 * intent | null`, one intent per step, holds re-issued only on change. Both
 * policies read ONLY `BotWorld` (wire-fed truth); the memory bag is per-bot
 * scratch the runner owns. Ported from the headless churn bot of
 * `packages/sim/src/guestExit.test.ts`, re-fed through protocol snapshots.
 */

/** Per-bot decision scratch — never derived from anything but BotWorld. */
export interface BotMemory {
  claim: string | null
  skips: Map<string, number>
  stairsSentAtMs: number
  elevatorUntilMs: number
  callSentAtMs: number
  pressSentAtMs: number
  interactSentAtMs: number
  placeSentAtMs: number
  workSentAtMs: number
  workSentKey: string | null
  patrolIdx: number
  patrolStarted: boolean
}

export function newBotMemory(): BotMemory {
  return {
    claim: null,
    skips: new Map(),
    stairsSentAtMs: 0,
    elevatorUntilMs: 0,
    callSentAtMs: 0,
    pressSentAtMs: 0,
    interactSentAtMs: 0,
    placeSentAtMs: 0,
    workSentAtMs: 0,
    workSentKey: null,
    patrolIdx: 0,
    patrolStarted: false,
  }
}

const EPS = 0.06
const STAIRS_SETTLE_MS = 900
const CALL_COOLDOWN_MS = 1200
const PRESS_COOLDOWN_MS = 600
const INTERACT_COOLDOWN_MS = 350
const BLITZ_SECONDS = 45

function floorIndexOf(floor: FloorId): number {
  return FLOOR_IDS.indexOf(floor)
}

function doorX(room: RoomIndex): number {
  return roomDoorXMilli(room) / 1000
}

/** Standing position, or null while riding / inside the stairwell box. */
function standing(world: BotWorld): { floor: FloorId; x: number } | null {
  if (world.floor === null || world.x === null) return null
  return { floor: world.floor, x: world.x }
}

export interface NavTarget {
  floor: FloorId
  room: RoomIndex | null
}

function walk(world: BotWorld, dir: 'left' | 'right'): BotIntent | null {
  return world.moving === dir ? null : { type: 'move:start', dir }
}

function halt(world: BotWorld): BotIntent | null {
  return world.moving !== null ? { type: 'move:stop' } : null
}

function pressFloor(
  world: BotWorld,
  memory: BotMemory,
  floor: FloorId,
  now: number,
): BotIntent | null {
  if (now - memory.pressSentAtMs < PRESS_COOLDOWN_MS) return null
  memory.pressSentAtMs = now
  void world
  return { type: 'elevator:press', floor }
}

/**
 * Shared navigation: stairs-first (mirrors the headless bot), silent-reject
 * detection falls back to the car for a while; riders queue their floor on
 * the panel and hop off through fully open doors. A hold during shut/swinging
 * doors is LOST in the sim (MOVE-09), so the exit direction is re-issued —
 * once the hop lands, re-sends are idempotent walking.
 */
export function navigate(
  world: BotWorld,
  memory: BotMemory,
  target: NavTarget,
  now: number,
): BotIntent | null {
  if (world.riding) {
    if (world.carFloor === target.floor && world.carDoorsOpen) {
      return { type: 'move:start', dir: 'left' } // hop-off places at the east landing, the hold walks into the hall
    }
    return pressFloor(world, memory, target.floor, now)
  }
  const pos = standing(world)
  if (pos === null) return null // stairwell black box — the model frees the bot at freeAtMs
  if (pos.floor === target.floor) {
    memory.elevatorUntilMs = 0
    if (target.room === null) {
      if (inDeskZone(pos)) return halt(world)
      return walk(world, pos.x < TUNING.DESK_X_TILES ? 'right' : 'left')
    }
    const dx = doorX(target.room)
    if (Math.abs(pos.x - dx) <= TUNING.ROOM_DOOR_RANGE_TILES + EPS) return halt(world)
    return walk(world, pos.x < dx ? 'right' : 'left')
  }
  if (memory.elevatorUntilMs > now) {
    if (onLanding(pos.x)) {
      if (now - memory.callSentAtMs >= CALL_COOLDOWN_MS) {
        memory.callSentAtMs = now
        return { type: 'elevator:call' } // AD-025: at the landing this is the board
      }
      return null
    }
    return walk(world, 'right')
  }
  if (atStairwellMouth(pos.x)) {
    if (now - memory.stairsSentAtMs < STAIRS_SETTLE_MS) return null // wait for the personal snapshot
    memory.stairsSentAtMs = now
    const dir = floorIndexOf(target.floor) > floorIndexOf(pos.floor) ? 'up' : 'down'
    return { type: 'stairs:enter', dir }
  }
  return walk(world, 'left')
}

/**
 * Distinguish a SILENT stairs rejection from a successful entry: success
 * shows up as the floorless black box (`world.stairs`) or the bot already
 * having left the mouth. Only a rejection still standing at the mouth arms
 * the car fallback — otherwise every completed ride would false-positive
 * (the arrival x IS the mouth).
 */
function stairsFallback(memory: BotMemory, world: BotWorld, now: number): void {
  if (memory.stairsSentAtMs === 0) return
  if (world.stairs !== null) {
    memory.stairsSentAtMs = 0
    return
  }
  const pos = standing(world)
  if (pos === null || !atStairwellMouth(pos.x)) {
    memory.stairsSentAtMs = 0
    return
  }
  if (now - memory.stairsSentAtMs < STAIRS_SETTLE_MS) return
  memory.elevatorUntilMs = now + 15_000
  memory.stairsSentAtMs = 0
}

/** West→east room circuit over the guest floors — the discovery patrol. */
function patrolTarget(
  world: BotWorld,
  memory: BotMemory,
): { floor: GuestFloorId; room: RoomIndex } {
  if (!memory.patrolStarted) {
    memory.patrolStarted = true
    const pos = standing(world)
    memory.patrolIdx =
      pos === null || pos.floor === 'lobby'
        ? 0
        : (Math.max(0, floorIndexOf(pos.floor) - 2) * 7 + 3) % 21
  }
  const target = memory.patrolIdx
  // target ∈ [0,20], so the index is always in bounds — the fallback pleases noUncheckedIndexedAccess.
  const floor = GUEST_FLOOR_IDS[Math.floor(target / 7) % GUEST_FLOOR_IDS.length] ?? 'floor1'
  const room = ((target % 7) + 1) as RoomIndex
  return { floor, room }
}

function advancePatrol(memory: BotMemory): void {
  memory.patrolIdx = (memory.patrolIdx + 1) % 21
}

function remainingSeconds(world: BotWorld, now: number): number {
  if (world.roundStartedAtMs === null) return world.shiftSeconds
  return Math.max(0, world.shiftSeconds - (now - world.roundStartedAtMs) / 1000)
}

function claimable(memory: BotMemory, key: string, now: number): boolean {
  const skipUntil = memory.skips.get(key)
  return skipUntil === undefined || skipUntil <= now
}

/** Shared self-heal: a work:start with no work:started inside 1.5 s was rejected. */
function workSentTimeout(world: BotWorld, memory: BotMemory, now: number): void {
  if (memory.workSentKey === null) return
  if (now - memory.workSentAtMs <= 1500) return
  if (world.work === null) {
    memory.skips.set(memory.workSentKey, now + 15_000)
    if (memory.claim === memory.workSentKey) memory.claim = null
  }
  memory.workSentKey = null
}

function atRoomDoor(pos: { floor: FloorId; x: number }, floor: FloorId, room: RoomIndex): boolean {
  return pos.floor === floor && Math.abs(pos.x - doorX(room)) <= TUNING.ROOM_DOOR_RANGE_TILES + EPS
}

/** Floorless stance outside a car means the stairwell box — only riders keep navigating. */
function unreachable(
  world: BotWorld,
  memory: BotMemory,
  target: NavTarget,
  now: number,
): BotIntent | null {
  return world.riding ? navigate(world, memory, target, now) : null
}

/**
 * STAFF — the churn loop: deliver my suitcase → desk duty when guests wait →
 * prep the best known room needing work (claims partitioned across the roster
 * so bots don't stack) → patrol to discover work when nothing is known.
 */
export function staffDecide(world: BotWorld, memory: BotMemory, now: number): BotIntent | null {
  if (world.work !== null) return null
  workSentTimeout(world, memory, now)
  stairsFallback(memory, world, now)

  // 1. Suitcase delivery — hands-full outranks everything (FR-9a).
  if (world.carryGuest !== null) {
    const assignment = world.assignments.get(world.carryGuest)
    if (assignment === undefined) return halt(world)
    const nav: NavTarget = { floor: assignment.floor, room: assignment.room }
    const pos = standing(world)
    if (pos === null) return unreachable(world, memory, nav, now)
    if (atRoomDoor(pos, assignment.floor, assignment.room)) {
      if (now - memory.placeSentAtMs >= INTERACT_COOLDOWN_MS) {
        memory.placeSentAtMs = now
        return { type: 'suitcase:place', room: assignment.room }
      }
      return halt(world)
    }
    return navigate(world, memory, nav, now)
  }

  // 2. Desk duty — only from the lobby floor. A cross-floor desk commute
  // always loses the race to the guest's free self-assign (impatience is
  // cheap by design), and answering from elsewhere would perpetual-reset the
  // prep loop every arrival. Lobby staff still catch walk-up queues.
  if (world.queueCount > 0) {
    const pos = standing(world)
    if (pos !== null && pos.floor === 'lobby') {
      if (inDeskZone(pos)) {
        if (now - memory.interactSentAtMs >= INTERACT_COOLDOWN_MS) {
          memory.interactSentAtMs = now
          return { type: 'desk:interact' }
        }
        return halt(world)
      }
      return navigate(world, memory, { floor: 'lobby', room: null }, now)
    }
  }

  const pos = standing(world)

  // 3. Prep work from observed interiors — churn trash (guests waiting on
  // those rooms) outranks never-prepped `fresh`.
  if (pos !== null) {
    const candidates: { key: string; floor: GuestFloorId; room: RoomIndex; fresh: boolean }[] = []
    for (const [key, state] of world.roomStates) {
      if (state === 'prepped' || !claimable(memory, key, now)) continue
      const [floor, roomStr] = key.split(':')
      candidates.push({
        key,
        floor: floor as GuestFloorId,
        room: Number(roomStr) as RoomIndex,
        fresh: state === 'fresh',
      })
    }
    candidates.sort(
      (a, b) =>
        Number(a.fresh) - Number(b.fresh) ||
        floorIndexOf(a.floor) - floorIndexOf(b.floor) ||
        a.room - b.room,
    )
    const myIndex = Math.max(0, world.roster.indexOf(world.selfId))
    const span = Math.max(1, world.roster.length)
    const claim = candidates.find(
      (c) => (floorIndexOf(c.floor) * 7 + c.room) % span === myIndex % span,
    )
    memory.claim = claim?.key ?? null
    if (claim !== undefined) {
      if (atRoomDoor(pos, claim.floor, claim.room)) {
        // The channel runs only while the player holds the segment — a held
        // walk direction would carry the bot straight through and cancel it
        // (walk-out cancel), so stop first, work standing.
        if (world.moving !== null) return halt(world)
        memory.workSentAtMs = now
        memory.workSentKey = claim.key
        return { type: 'work:start', floor: claim.floor, room: claim.room }
      }
      return navigate(world, memory, { floor: claim.floor, room: claim.room }, now)
    }
  }

  // 4. Nothing known — patrol; observed interiors re-arm step 3.
  const target = patrolTarget(world, memory)
  if (pos === null) return unreachable(world, memory, target, now)
  if (
    atRoomDoor(pos, target.floor, target.room) ||
    world.roomStates.has(roomKey(target.floor, target.room))
  ) {
    advancePatrol(memory)
    return halt(world)
  }
  return navigate(world, memory, target, now)
}

/**
 * SABOTEUR — patrol for prepped rooms (cards are floor-public) and un-prep
 * them, preferring rooms with an inbound assigned-not-settled guest (public
 * `guest:assigned` testimony); the last BLITZ_SECONDS chase the nearest card.
 */
export function saboteurDecide(world: BotWorld, memory: BotMemory, now: number): BotIntent | null {
  if (world.work !== null) return null
  workSentTimeout(world, memory, now)
  stairsFallback(memory, world, now)

  const pos = standing(world)

  const inbound = new Set<string>()
  for (const [guestId, a] of world.assignments) {
    if (!world.settledGuests.has(guestId)) inbound.add(roomKey(a.floor, a.room))
  }
  const blitz = remainingSeconds(world, now) <= BLITZ_SECONDS
  const cards = [...world.cards].filter((key) => claimable(memory, key, now))
  const score = (key: string): number => {
    const [floor, roomStr] = key.split(':')
    const f = floor as FloorId
    const r = Number(roomStr) as RoomIndex
    if (blitz) return (f === pos?.floor ? 0 : 1000) + Math.abs((pos?.x ?? 0) - doorX(r))
    return (inbound.has(key) ? 0 : 100) + floorIndexOf(f) * 7 + r
  }
  cards.sort((a, b) => score(a) - score(b))
  const target = cards[0]
  if (target !== undefined) {
    memory.claim = target
    const [floor, roomStr] = target.split(':')
    const room = Number(roomStr) as RoomIndex
    if (pos === null) return unreachable(world, memory, { floor: floor as GuestFloorId, room }, now)
    if (atRoomDoor(pos, floor as FloorId, room)) {
      // Same walk-out-cancel guard as staff: stop before starting the channel.
      if (world.moving !== null) return halt(world)
      memory.workSentAtMs = now
      memory.workSentKey = target
      return { type: 'work:start', floor: floor as GuestFloorId, room }
    }
    return navigate(world, memory, { floor: floor as GuestFloorId, room }, now)
  }

  const patrol = patrolTarget(world, memory)
  if (pos === null) return unreachable(world, memory, patrol, now)
  if (
    atRoomDoor(pos, patrol.floor, patrol.room) ||
    world.roomStates.has(roomKey(patrol.floor, patrol.room))
  ) {
    advancePatrol(memory)
    return halt(world)
  }
  return navigate(world, memory, patrol, now)
}
