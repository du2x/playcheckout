import type { Role } from '@turnover/shared'
import type { ViewAction } from '../state'

/**
 * Tutorial session (first-run onboarding): the single client-side home for the
 * guided-tutorial step machine — a pure reducer over the same ViewAction
 * stream as riderSession/accuseSession, plus a few local UI facts. It consumes
 * only what the local player legitimately knows (own-id wire facts and own
 * intents emitted by the App's send closures): no protocol change, nothing
 * hidden crosses the wire. Step progress persists across lobby→round→results
 * within the page; across visits it is the one localStorage flag in
 * tutorial/prefs.ts.
 */

export type TutorialStepId =
  | 'walk'
  | 'elevator'
  | 'checkin'
  | 'deliver'
  | 'work'
  | 'saboteur'
  | 'goal'

/** Steps completed by their card's button instead of a wire fact. */
const CONFIRM_STEPS: readonly TutorialStepId[] = ['saboteur', 'goal']

export interface TutorialSession {
  /** True until every step is done or the player skips; survives view changes. */
  readonly active: boolean
  /** Steps satisfied by wire fact or card confirm, in any order. */
  readonly done: readonly TutorialStepId[]
  /** The guest whose suitcase the local player carries (deliver-step trigger). */
  readonly carryingGuestId: string | null
  /** The player's OWN dealt role — never anyone else's (protocol rule). */
  readonly role: Role | null
  /** Mirror of the self-fired gate: the card hides while spectating. */
  readonly selfFired: boolean
  /** The static help panel (how-to-play button), open or closed. */
  readonly helpOpen: boolean
}

/** ViewActions plus the tutorial's local facts (accuseSession precedent). */
export type TutorialAction =
  | ViewAction
  | { type: 'local-move' }
  | { type: 'local-elevator-call' }
  | { type: 'step-confirm' }
  | { type: 'tutorial-skip' }
  | { type: 'help-toggle' }

export function initialTutorialSession(done: boolean): TutorialSession {
  return {
    active: !done,
    done: [],
    carryingGuestId: null,
    role: null,
    selfFired: false,
    helpOpen: false,
  }
}

/**
 * The step sequence for a role: everyone learns the shared mechanics; the
 * saboteur's private card (own role:dealt is self-policy) slots in before the
 * goal card.
 */
export function tutorialSteps(role: Role | null): readonly TutorialStepId[] {
  const steps: TutorialStepId[] = ['walk', 'elevator', 'checkin', 'deliver', 'work']
  if (role === 'saboteur') steps.push('saboteur')
  steps.push('goal')
  return steps
}

/** The step to show now (first not-done) — null when finished, skipped, or fired. */
export function currentStep(session: TutorialSession): TutorialStepId | null {
  if (!session.active || session.selfFired) return null
  return tutorialSteps(session.role).find((id) => !session.done.includes(id)) ?? null
}

/** Mark one step done; the tutorial completes when its sequence is exhausted. */
function withDone(session: TutorialSession, step: TutorialStepId): TutorialSession {
  if (session.done.includes(step)) return session
  const done = [...session.done, step]
  const finished = tutorialSteps(session.role).every((id) => done.includes(id))
  return { ...session, done, active: finished ? false : session.active }
}

/**
 * Reduce one action into the next session. Returns the SAME reference when
 * nothing changed (identity-check discipline, riderSession precedent).
 * `ownId` routes the own-fact triggers.
 */
export function reduceTutorial(
  session: TutorialSession,
  action: TutorialAction,
  ownId: string | undefined,
): TutorialSession {
  switch (action.type) {
    case 'local-move':
      return withDone(session, 'walk')
    case 'player-moved':
      // The wire mirror of the own prediction — either signal proves walking.
      return action.playerId === ownId ? withDone(session, 'walk') : session
    case 'local-elevator-call':
      return withDone(session, 'elevator')
    case 'elevator-riders':
      // Riders-policy payload: its arrival proves the local player is aboard.
      return withDone(session, 'elevator')
    case 'suitcase-carried':
      if (action.carrierId === ownId) {
        return withDone({ ...session, carryingGuestId: action.guestId }, 'checkin')
      }
      return session.carryingGuestId === action.guestId
        ? { ...session, carryingGuestId: null } // someone else took the leg
        : session
    case 'suitcase-picked-up':
      if (action.carrierId === ownId) {
        return { ...session, carryingGuestId: action.guestId } // a regrab counts toward delivery
      }
      return session.carryingGuestId === action.guestId
        ? { ...session, carryingGuestId: null }
        : session
    case 'suitcase-placed':
      if (action.guestId === session.carryingGuestId) {
        return withDone({ ...session, carryingGuestId: null }, 'deliver')
      }
      return session
    case 'work-started':
      return action.playerId === ownId ? withDone(session, 'work') : session
    case 'role-dealt':
      return session.role === action.role ? session : { ...session, role: action.role }
    case 'step-confirm': {
      const step = currentStep(session)
      if (step === null || !CONFIRM_STEPS.includes(step)) return session
      return withDone(session, step)
    }
    case 'tutorial-skip':
      return session.active ? { ...session, active: false } : session
    case 'help-toggle':
      return { ...session, helpOpen: !session.helpOpen }
    case 'player-fired':
      if (action.playerId !== ownId) return session
      return session.selfFired ? session : { ...session, selfFired: true }
    case 'round-started':
      // A fresh deal resets round-scoped facts; step progress persists across
      // rounds until the tutorial completes.
      if (session.carryingGuestId === null && session.role === null && !session.selfFired) {
        return session
      }
      return { ...session, carryingGuestId: null, role: null, selfFired: false }
    case 'round-resumed':
      return action.ownFired === session.selfFired
        ? session
        : { ...session, selfFired: action.ownFired }
    case 'buzzer':
      // Roles die with the sim (AD-002): the card sequence reverts to staff
      // until the next deal lands.
      return session.role === null ? session : { ...session, role: null }
    default:
      return session
  }
}
