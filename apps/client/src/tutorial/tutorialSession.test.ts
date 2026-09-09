import { describe, expect, it } from 'vitest'
import type { ViewAction } from '../state'
import {
  currentStep,
  initialTutorialSession,
  reduceTutorial,
  type TutorialAction,
  tutorialSteps,
} from './tutorialSession'

const OWN = 'p-own'
const OTHER = 'p-other'

function reduced(
  session: ReturnType<typeof initialTutorialSession>,
  action: TutorialAction,
  ownId: string | undefined = OWN,
): ReturnType<typeof initialTutorialSession> {
  return reduceTutorial(session, action, ownId)
}

function dealt(role: 'staff' | 'saboteur'): ViewAction {
  return { type: 'role-dealt', role }
}

describe('tutorial session (first-run tutorial)', () => {
  it('starts active unless the browser already completed it, and shows walk first', () => {
    expect(initialTutorialSession(false).active).toBe(true)
    expect(currentStep(initialTutorialSession(false))).toBe('walk')
    expect(initialTutorialSession(true).active).toBe(false)
    expect(currentStep(initialTutorialSession(true))).toBeNull()
  })

  it('completes walk on the own move intent and on the own wire position, not others', () => {
    let session = reduced(initialTutorialSession(false), { type: 'local-move' })
    expect(session.done).toContain('walk')
    session = reduced(initialTutorialSession(false), {
      type: 'player-moved',
      playerId: OTHER,
      floor: 'lobby',
      x: 100,
      facing: 'right',
    })
    expect(session.done).not.toContain('walk')
    session = reduced(session, {
      type: 'player-moved',
      playerId: OWN,
      floor: 'lobby',
      x: 100,
      facing: 'right',
    })
    expect(session.done).toContain('walk')
  })

  it('completes elevator on the local call and on becoming a rider', () => {
    let session = reduced(initialTutorialSession(false), { type: 'local-elevator-call' })
    expect(session.done).toContain('elevator')
    session = reduced(initialTutorialSession(false), {
      type: 'elevator-riders',
      car: 1,
      riders: [OWN],
      queue: [],
    })
    expect(session.done).toContain('elevator')
  })

  it('advances check-in → deliver on the own suitcase legs only', () => {
    let session = reduced(initialTutorialSession(false), { type: 'local-move' })
    session = reduced(session, { type: 'local-elevator-call' })
    // Another carrier's leg teaches nothing.
    session = reduced(session, { type: 'suitcase-carried', guestId: 'g1', carrierId: OTHER })
    expect(session.done).not.toContain('checkin')
    session = reduced(session, { type: 'suitcase-carried', guestId: 'g1', carrierId: OWN })
    expect(session.done).toContain('checkin')
    expect(session.carryingGuestId).toBe('g1')
    expect(currentStep(session)).toBe('deliver')
    // A placed event for a different guest does not complete the delivery…
    session = reduced(session, { type: 'suitcase-placed', guestId: 'g2', floor: 'floor1', room: 3 })
    expect(session.done).not.toContain('deliver')
    // …and a steal (someone else picks the carried suitcase up) drops the leg.
    session = reduced(session, { type: 'suitcase-picked-up', guestId: 'g1', carrierId: OTHER })
    expect(session.carryingGuestId).toBeNull()
    // A fresh own check-in re-arms the deliver trigger; the own placement lands it.
    session = reduced(session, { type: 'suitcase-carried', guestId: 'g2', carrierId: OWN })
    session = reduced(session, { type: 'suitcase-placed', guestId: 'g2', floor: 'floor1', room: 4 })
    expect(session.done).toContain('deliver')
    expect(session.carryingGuestId).toBeNull()
  })

  it('completes work on the own channel start only', () => {
    let session = reduced(initialTutorialSession(false), {
      type: 'work-started',
      playerId: OTHER,
      floor: 'floor1',
      room: 1,
      seconds: 5,
    })
    expect(session.done).not.toContain('work')
    session = reduced(session, {
      type: 'work-started',
      playerId: OWN,
      floor: 'floor1',
      room: 1,
      seconds: 5,
    })
    expect(session.done).toContain('work')
  })

  it('slips the private saboteur card in for the dealt saboteur only, confirmed by button', () => {
    const staff = reduced(initialTutorialSession(false), dealt('staff'))
    expect(tutorialSteps(staff.role)).not.toContain('saboteur')
    const saboteur = reduced(initialTutorialSession(false), dealt('saboteur'))
    expect(tutorialSteps(saboteur.role)).toContain('saboteur')
    expect(currentStep(saboteur)).toBe('walk')
    // The confirm button is inert while a fact step is showing.
    expect(reduced(saboteur, { type: 'step-confirm' })).toBe(saboteur)
    // After the fact steps, the saboteur card waits for its got-it…
    let session = saboteur
    session = reduced(session, { type: 'local-move' }) // walk
    session = reduced(session, { type: 'local-elevator-call' }) // elevator
    session = reduced(session, factFor('checkin'))
    session = reduced(session, factFor('deliver'))
    session = reduced(session, factFor('work'))
    expect(currentStep(session)).toBe('saboteur')
    session = reduced(session, { type: 'step-confirm' })
    expect(currentStep(session)).toBe('goal')
    // …and the goal card's confirm completes the whole tutorial.
    const finished = reduced(session, { type: 'step-confirm' })
    expect(finished.active).toBe(false)
    expect(currentStep(finished)).toBeNull()
  })

  it('skips ahead when fact steps complete out of order', () => {
    let session = initialTutorialSession(false)
    session = reduced(session, {
      type: 'work-started',
      playerId: OWN,
      floor: 'floor1',
      room: 1,
      seconds: 5,
    })
    expect(currentStep(session)).toBe('walk')
    session = reduced(session, { type: 'local-move' })
    expect(currentStep(session)).toBe('elevator')
    session = reduced(session, { type: 'local-elevator-call' })
    session = reduced(session, { type: 'suitcase-carried', guestId: 'g1', carrierId: OWN })
    session = reduced(session, { type: 'suitcase-placed', guestId: 'g1', floor: 'floor2', room: 2 })
    expect(currentStep(session)).toBe('goal')
  })

  it('skip ends the tutorial immediately', () => {
    const session = reduced(initialTutorialSession(false), { type: 'tutorial-skip' })
    expect(session.active).toBe(false)
    expect(currentStep(session)).toBeNull()
  })

  it('hides the card while self-fired and restores progress after the buzzer', () => {
    let session = reduced(initialTutorialSession(false), { type: 'local-move' })
    session = reduced(session, { type: 'player-fired', playerId: OWN })
    expect(session.selfFired).toBe(true)
    expect(currentStep(session)).toBeNull()
    // The round-end reset clears the fired gate; done steps survive.
    session = reduced(session, { type: 'buzzer' })
    session = reduced(session, { type: 'round-started', playerIds: [OWN, OTHER] })
    expect(session.selfFired).toBe(false)
    expect(session.done).toContain('walk')
    expect(currentStep(session)).toBe('elevator')
  })

  it('round-started clears round-scoped facts but never step progress', () => {
    let session = reduced(initialTutorialSession(false), dealt('saboteur'))
    session = reduced(session, { type: 'suitcase-carried', guestId: 'g1', carrierId: OWN })
    session = reduced(session, { type: 'round-started', playerIds: [OWN, OTHER] })
    expect(session.role).toBeNull()
    expect(session.carryingGuestId).toBeNull()
    // Step progress is the part that persists across rounds.
    expect(session.done).toEqual(['checkin'])
    // The next deal re-slots the private card.
    session = reduced(session, dealt('saboteur'))
    expect(tutorialSteps(session.role)).toContain('saboteur')
  })

  it('mirrors the reconnect seat restore (ownFired)', () => {
    let session = reduced(initialTutorialSession(false), {
      type: 'round-resumed',
      remainingTicks: 100,
      playerIds: [OWN],
      ownFired: true,
      settleScore: 0,
      complaints: 0,
    })
    expect(session.selfFired).toBe(true)
    session = reduced(session, {
      type: 'round-resumed',
      remainingTicks: 100,
      playerIds: [OWN],
      ownFired: false,
      settleScore: 0,
      complaints: 0,
    })
    expect(session.selfFired).toBe(false)
  })

  it('toggles the help panel and is identity-preserving on noise', () => {
    let session = initialTutorialSession(false)
    const before = session
    session = reduced(session, {
      type: 'player-moved',
      playerId: OTHER,
      floor: 'lobby',
      x: 0,
      facing: 'left',
    })
    expect(session).toBe(before)
    session = reduced(before, { type: 'help-toggle' })
    expect(session.helpOpen).toBe(true)
    expect(reduced(session, { type: 'help-toggle' }).helpOpen).toBe(false)
  })
})

/** One wire fact that satisfies the named step (walk/elevator use local intents). */
function factFor(step: 'checkin' | 'deliver' | 'work'): TutorialAction {
  switch (step) {
    case 'checkin':
      return { type: 'suitcase-carried', guestId: 'g9', carrierId: OWN }
    case 'deliver':
      return { type: 'suitcase-placed', guestId: 'g9', floor: 'floor1', room: 1 }
    case 'work':
      return { type: 'work-started', playerId: OWN, floor: 'floor1', room: 1, seconds: 5 }
  }
}
