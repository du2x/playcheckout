import type { CarId, FloorId } from '@turnover/shared'
import type { ViewAction } from './state'

/**
 * Rider session (AD-013): the single client-side derivation of the local
 * player's in-car state — car, occupants, press queue, last press testimony.
 * A pure reducer over the same ViewAction stream every other consumer reads,
 * in the shape of state.ts: no DOM, no Phaser, no network. The App owns the
 * instance; the world scene receives it (keymap gate + rider visibility) and
 * the chip renders from it — two consumers, one state home.
 *
 * Press testimony (`lastPress`) is rider-scoped: it exists only while riding,
 * because the chip is hidden otherwise and a fresh boarding clears it. Presses
 * observed off-car are therefore dropped, not buffered.
 */

export interface RiderSession {
  /** The car the local player rides. */
  car: CarId
  /** Who is aboard with us (rider-exclusive knowledge, AD-013). */
  occupants: readonly string[]
  /** The own car's lit press queue (lit = queued or being served). */
  queue: readonly FloorId[]
  /** The last press seen in the own car (`#elevator-press` line). */
  lastPress: { playerId: string; floor: FloorId } | null
}

/** The rider session is `null` whenever the local player is not riding. */
export type RiderUpdate = RiderSession | null

export function initialRiderSession(): RiderUpdate {
  return null
}

/**
 * Reduce one ViewAction into the next rider session. Returns the SAME
 * reference when nothing changed, so callers can skip scene/chip writes with
 * an identity check. `ownId` is the local player's id (undefined before the
 * first lobby snapshot — no rider fact can match).
 */
export function reduceRider(
  session: RiderUpdate,
  action: ViewAction,
  ownId: string | undefined,
): RiderUpdate {
  switch (action.type) {
    case 'elevator-pressed': {
      // Rider-exclusive press testimony (ELR-06): the pressed floor joins the
      // own car's lit set — deduped; the queue is refreshed authoritatively by
      // elevator:riders events. Off-car presses carry no visible knowledge.
      if (session === null) return session
      return {
        ...session,
        queue: session.queue.includes(action.floor)
          ? session.queue
          : [...session.queue, action.floor],
        lastPress: { playerId: action.playerId, floor: action.floor },
      }
    }
    case 'elevator-moved':
      // Arrival serves the floor: it leaves the queue and its indicator
      // unlights (P2 AC4). Other cars' movements are not ours.
      if (session === null || session.car !== action.car) return session
      return { ...session, queue: session.queue.filter((f) => f !== action.floor) }
    case 'elevator-riders': {
      // AD-013: the own id in the occupancy list is the authoritative boarding
      // signal; its absence (for the car we rode) is a walk-off. A fresh
      // boarding clears press testimony; an occupancy refresh keeps it.
      if (ownId === undefined) return session
      if (action.riders.includes(ownId)) {
        return {
          car: action.car,
          occupants: action.riders,
          queue: action.queue,
          lastPress: session === null ? null : session.lastPress,
        }
      }
      if (session !== null && session.car === action.car) return null
      return session
    }
    case 'player-moved':
      // The own floor stream resumes only off a car: exit/walk-off.
      if (session !== null && action.playerId === ownId) return null
      return session
    case 'movement-snapshot': {
      // Join/buzzer resync (AD-013): carOccupants present = riding; the
      // snapshot is authoritative and clears press testimony.
      const own = action.snapshot.carOccupants
      return own ? { car: own.car, occupants: own.riders, queue: own.queue, lastPress: null } : null
    }
    default:
      return session
  }
}
