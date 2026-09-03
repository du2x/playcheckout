import { describe, expect, it } from 'vitest'
import { TelemetrySink } from './telemetry.js'

describe('sim:telemetry', () => {
  it('maps core kinds with per-event time/actor/room and 1/s coverage cadence', () => {
    const sink = new TelemetrySink('p2', 7)

    // tick 10: prep
    sink.recordRoomTransition('floor1', 1, 'p1', 'prepped', 'none', 10)
    // tick 20: trashed (sabotage)
    sink.recordRoomTransition('floor1', 1, 'p2', 'trashed', 'sabotage', 20)
    // tick 30: churn (no actor)
    sink.recordRoomTransition('floor1', 2, undefined, 'settled', 'churn', 30)

    // elevator
    sink.recordElevatorCall('floor1', 1, 'p3', 40)
    sink.recordElevatorRide(1, 'floor2', 60)
    sink.recordElevatorDoors(1, 'floor2', true, 70)

    // accusation at tick 80
    sink.recordAccusation('p1', 'p2', true, true, 80)

    // walk-in at tick 90
    sink.recordWalkIn('p3', 'p2', 90)

    // coverage samples at 0,20,40,60,80,100 ... simulate 0..100
    for (let t = 0; t <= 100; t++) sink.sampleCoverage(t, t < 20 ? 0 : t < 40 ? 1 : 2)

    const lines = sink.getLines()
    // room-transition count 3
    const rooms = lines.filter((l) => l.kind === 'room-transition')
    expect(rooms).toHaveLength(3)
    expect(rooms[0]!).toMatchObject({
      kind: 'room-transition',
      tick: 10,
      time: 500,
      room: 'floor1:1',
      floor: 'floor1',
      roomIdx: 1,
      state: 'prepped',
      actor: 'p1',
    })
    expect(rooms[1]!).toMatchObject({
      kind: 'room-transition',
      tick: 20,
      time: 1000,
      room: 'floor1:1',
      provenance: 'sabotage',
      actor: 'p2',
    })
    expect(rooms[2]!).toMatchObject({
      kind: 'room-transition',
      tick: 30,
      time: 1500,
      room: 'floor1:2',
      provenance: 'churn',
    })
    expect(rooms[2]!.actor).toBeUndefined()

    // elevator lines
    expect(lines.find((l) => l.kind === 'elevator-call')!).toMatchObject({
      tick: 40,
      time: 2000,
      floor: 'floor1',
      car: 1,
      actor: 'p3',
    })
    expect(lines.find((l) => l.kind === 'elevator-ride')!).toMatchObject({
      tick: 60,
      time: 3000,
      floor: 'floor2',
      car: 1,
    })
    expect(lines.find((l) => l.kind === 'elevator-doors')!).toMatchObject({
      tick: 70,
      time: 3500,
      open: true,
    })

    // accusation flags
    const acc = lines.find((l) => l.kind === 'accusation')!
    expect(acc).toBeDefined()
    expect(acc).toMatchObject({
      tick: 80,
      time: 4000,
      actor: 'p1',
      targetId: 'p2',
      wasTargetSaboteur: true,
      crimeOccurred: true,
    })

    // walk-in
    const wk = lines.find((l) => l.kind === 'walk-in-catch')!
    expect(wk).toMatchObject({ tick: 90, time: 4500, actor: 'p3', caughtPlayer: 'p2' })

    // coverage cadence: samples at 0,20,40,60,80,100 => 6 samples for t 0..100
    const cov = lines.filter((l) => l.kind === 'coverage-sample')
    expect(cov.map((l) => l.tick)).toEqual([0, 20, 40, 60, 80, 100])
    expect(cov[0]!.coverage).toBe(0)
    // time = tick*50 already verified above
    for (const c of cov) expect(c.time).toBe(c.tick * 50)
  })

  it('past round-ended ticks emit zero lines and round-ended carries winner/reason/saboteurId', () => {
    const sink = new TelemetrySink('p2', 7)
    sink.recordRoomTransition('floor1', 1, 'p1', 'prepped', 'none', 10)
    sink.recordRoundEnded('staff', 'saboteur-fired', 'p2', 100)
    const before = sink.getLines().length
    // attempts after ended must be dropped
    sink.recordRoomTransition('floor1', 2, 'p1', 'prepped', 'none', 110)
    sink.sampleCoverage(120, 1)
    sink.recordAccusation('p1', 'p2', true, true, 130)
    expect(sink.getLines()).toHaveLength(before)
    const last = sink.getLines()[sink.getLines().length - 1]!
    expect(last).toMatchObject({
      kind: 'round-ended',
      tick: 100,
      time: 5000,
      winner: 'staff',
      reason: 'saboteur-fired',
      saboteurId: 'p2',
    })
  })

  it('still closes with round-ended for aborted rounds (machine-readable abort marker)', () => {
    const sink = new TelemetrySink('p2', 7)
    sink.recordRoomTransition('floor1', 1, 'p1', 'prepped', 'none', 10)
    sink.recordRoundEnded('aborted', 'saboteur-disconnected', null, 50)
    const lines = sink.getLines()
    expect(lines[lines.length - 1]!).toMatchObject({
      kind: 'round-ended',
      winner: 'aborted',
      saboteurId: null,
    })
  })

  it('replays deterministically: seed 7 same lines twice', () => {
    const run = (): string[] => {
      const sink = new TelemetrySink('p2', 7)
      sink.recordRoomTransition('floor1', 1, 'p1', 'prepped', 'none', 10)
      sink.recordAccusation('p1', 'p2', true, true, 80)
      sink.recordWalkIn('p3', 'p2', 90)
      for (let t = 0; t <= 100; t++) sink.sampleCoverage(t, 1)
      sink.recordRoundEnded('staff', 'saboteur-fired', 'p2', 100)
      return sink.toJSONL()
    }
    expect(run()).toEqual(run())
    // lines are JSON serializable
    const a = run()
    for (const line of a) expect(() => JSON.parse(line)).not.toThrow()
  })

  it('coverage denominator is 24 and time = tick*50', () => {
    const sink = new TelemetrySink('p2', 1)
    sink.sampleCoverage(0, 0)
    sink.sampleCoverage(20, 12)
    sink.sampleCoverage(40, 24)
    const cov = sink.getLines().filter((l) => l.kind === 'coverage-sample')
    expect(cov[1]!.coverage).toBe(12 / 24)
    expect(cov[2]!.coverage).toBe(1)
    expect(cov[0]!.time).toBe(0)
    expect(cov[1]!.time).toBe(1000)
  })
})

describe('sim:telemetry_guests', () => {
  it('emits all 13 guest kinds with verbatim guestId/carrierId/floor/room, carry-clock attributes carrier, discovered carries fresh+provenance, complained never counts as discovered', () => {
    const sink = new TelemetrySink('p2', 9)
    // seed a round delivering 13 guest kinds
    sink.recordGuestArrived('guest:1', 10)
    sink.recordGuestAssigned('guest:1', 'floor1', 3, 20)
    sink.recordSuitcaseCarried('guest:1', 'p1', 21)
    sink.recordSuitcasePlaced('guest:1', 'floor1', 3, 30)
    sink.recordSuitcasePickedUp('guest:1', 'p3', 35)
    sink.recordGuestSettled('guest:1', 'floor1', 3, 40)
    sink.recordGuestCheckedOut('guest:1', 'floor1', 3, 100)
    sink.recordGuestLeft('guest:1', 110)
    sink.recordGuestSelfAssigned('guest:2', 'floor2', 5, 50)
    sink.recordGuestAngered('guest:3', 'floor1', 2, 60)
    // two discovered: sabotage fresh + churn aged
    sink.recordGuestDiscovered('guest:3', 'floor1', 2, true, 'sabotage', 'p2', 70)
    sink.recordGuestDiscovered('guest:4', 'floor2', 1, false, 'churn', undefined, 80)
    sink.recordGuestComplained('guest:5', 'floor1', 1, 90)
    sink.recordTenancy('floor1', 3, true, 40)

    // carry-clock expiry at tick 95
    sink.recordCarryClockExpiry('p1', 95)

    const lines = sink.getLines()
    expect(lines.find((l) => l.kind === 'guest-arrived')!).toMatchObject({ guestId: 'guest:1', tick: 10 })
    expect(lines.find((l) => l.kind === 'guest-assigned')!).toMatchObject({ guestId: 'guest:1', floor: 'floor1', roomIdx: 3 })
    expect(lines.find((l) => l.kind === 'guest-self-assigned')!).toMatchObject({ guestId: 'guest:2', floor: 'floor2', roomIdx: 5 })
    expect(lines.find((l) => l.kind === 'suitcase-carried')!).toMatchObject({ guestId: 'guest:1', carrierId: 'p1' })
    expect(lines.find((l) => l.kind === 'suitcase-placed')!).toMatchObject({ guestId: 'guest:1', floor: 'floor1', roomIdx: 3 })
    expect(lines.find((l) => l.kind === 'suitcase-picked-up')!).toMatchObject({ guestId: 'guest:1', carrierId: 'p3' })
    expect(lines.find((l) => l.kind === 'guest-settled')!).toMatchObject({ guestId: 'guest:1', floor: 'floor1', roomIdx: 3 })
    expect(lines.find((l) => l.kind === 'guest-checked-out')!).toMatchObject({ guestId: 'guest:1', floor: 'floor1', roomIdx: 3 })
    expect(lines.find((l) => l.kind === 'guest-left')!).toMatchObject({ guestId: 'guest:1' })
    expect(lines.find((l) => l.kind === 'guest-angered')!).toMatchObject({ guestId: 'guest:3', floor: 'floor1', roomIdx: 2 })
    expect(lines.find((l) => l.kind === 'tenancy')!).toMatchObject({ floor: 'floor1', roomIdx: 3, occupied: true })

    const discovered = lines.filter((l) => l.kind === 'guest-discovered')
    expect(discovered).toHaveLength(2)
    const sab = discovered.find((l) => l.guestId === 'guest:3')!
    expect(sab).toMatchObject({ fresh: true, provenance: 'sabotage', actorId: 'p2' })
    const ch = discovered.find((l) => l.guestId === 'guest:4')!
    expect(ch).toMatchObject({ fresh: false, provenance: 'churn' })
    expect(ch.actorId).toBeUndefined()

    // carry-clock attributes the carrier
    expect(lines.find((l) => l.kind === 'carry-clock-expiry')!).toMatchObject({ actor: 'p1', tick: 95 })

    // complained never increments discovered count: one complained line exists but discovered stays 2
    expect(lines.filter((l) => l.kind === 'guest-complained')).toHaveLength(1)
    expect(discovered).toHaveLength(2)

    // all 13 guest kinds are present plus the 2 core guest-asked kinds (arrived etc.) – count sanity
    const guestKinds = new Set(lines.map((l) => l.kind))
    expect(guestKinds.has('guest-arrived')).toBe(true)
    expect(guestKinds.has('guest-assigned')).toBe(true)
    expect(guestKinds.has('guest-self-assigned')).toBe(true)
    expect(guestKinds.has('suitcase-carried')).toBe(true)
    expect(guestKinds.has('suitcase-placed')).toBe(true)
    expect(guestKinds.has('suitcase-picked-up')).toBe(true)
    expect(guestKinds.has('guest-settled')).toBe(true)
    expect(guestKinds.has('guest-checked-out')).toBe(true)
    expect(guestKinds.has('guest-left')).toBe(true)
    expect(guestKinds.has('guest-angered')).toBe(true)
    expect(guestKinds.has('guest-discovered')).toBe(true)
    expect(guestKinds.has('guest-complained')).toBe(true)
    expect(guestKinds.has('tenancy')).toBe(true)
    expect(guestKinds.has('carry-clock-expiry')).toBe(true)
  })

  it('core-only sink (no guest calls) emits core kinds only', () => {
    const sink = new TelemetrySink('p2', 1)
    sink.recordRoomTransition('floor1', 1, 'p1', 'prepped', 'none', 10)
    sink.sampleCoverage(0, 1)
    sink.recordAccusation('p1', 'p2', false, false, 20)
    const lines = sink.getLines()
    const guestLines = lines.filter((l) => l.kind.startsWith('guest') || l.kind.startsWith('suitcase') || l.kind === 'tenancy' || l.kind === 'carry-clock-expiry')
    expect(guestLines).toHaveLength(0)
  })
})
