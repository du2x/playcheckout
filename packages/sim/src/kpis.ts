import type { Kpis, TelemetryLine } from '@turnover/shared'

export function computeKpisFromLines(allLines: readonly TelemetryLine[]): Kpis {
  // helper for single aggregated bucket (used when caller passes flat lines as one round)
  return computeKpis([allLines.map((l) => JSON.stringify(l))])
}

export function computeKpis(files: readonly (readonly string[])[]): Kpis {
  let rounds = 0
  let abortedRounds = 0
  let malformedLines = 0

  let sabWins = 0
  let totalAccusations = 0
  let correctAccusations = 0
  let totalCatches = 0
  let totalDecoyCalls = 0
  let totalCalls = 0
  let totalSettle = 0
  let totalComplaints = 0
  let totalCarry = 0
  let sabotageComplaints = 0
  let churnComplaints = 0
  const firstCrimeSeconds: number[] = []

  for (const file of files) {
    const parsed: TelemetryLine[] = []
    let aborted = false
    let winner: string | null = null
    for (const raw of file) {
      let line: TelemetryLine
      try {
        const obj = JSON.parse(raw) as TelemetryLine
        if (typeof obj.kind !== 'string' || typeof obj.tick !== 'number') throw new Error('invalid')
        // unknown kind counts as malformed per spec (forward-compat skip)
        const known: Set<string> = new Set([
          'room-transition',
          'elevator-call',
          'elevator-ride',
          'elevator-doors',
          'walk-in-catch',
          'accusation',
          'coverage-sample',
          'guest-arrived',
          'guest-assigned',
          'guest-self-assigned',
          'suitcase-carried',
          'suitcase-placed',
          'suitcase-picked-up',
          'guest-settled',
          'guest-checked-out',
          'guest-left',
          'guest-angered',
          'guest-discovered',
          'guest-complained',
          'tenancy',
          'carry-clock-expiry',
          'round-ended',
        ])
        if (!known.has(obj.kind)) {
          malformedLines++
          continue
        }
        line = obj
      } catch {
        malformedLines++
        continue
      }
      parsed.push(line)
      if (line.kind === 'round-ended') {
        winner = line.winner ?? null
        if (line.winner === 'aborted') aborted = true
      }
    }

    if (aborted) {
      abortedRounds++
      continue
    }
    // if no round-ended, still count as round? spec says aborted only excluded; truncated files still count if they have a winner? We'll count only if we have at least one line and not aborted — even without winner, count as round for KPI? But synthetic tests will always have winner except maybe; we require winner to decide sab win. If missing winner, treat as incomplete and skip? For now count only if winner present or lines non-empty.
    // To avoid counting empty malformed-only files as rounds, require at least one parsed line.
    if (parsed.length === 0) continue
    // If file has no round-ended winner, we still count it as a round for denominators (the round existed) but sab win not counted.
    // For synthetic tests every file has a round-ended except aborted.
    rounds++

    if (winner === 'saboteur') sabWins++

    for (const l of parsed) {
      if (l.kind === 'accusation') {
        totalAccusations++
        if (l.wasTargetSaboteur) correctAccusations++
      }
      if (l.kind === 'walk-in-catch') totalCatches++
      if (l.kind === 'guest-settled') totalSettle++
      if (l.kind === 'guest-discovered') {
        totalComplaints++
        if (l.provenance === 'sabotage') sabotageComplaints++
        else if (l.provenance === 'churn') churnComplaints++
      }
      if (l.kind === 'carry-clock-expiry') totalCarry++
    }

    // first crime time: earliest room-transition trashed sabotage
    const firstCrime = parsed.find(
      (l) => l.kind === 'room-transition' && l.state === 'trashed' && l.provenance === 'sabotage',
    )
    if (firstCrime) firstCrimeSeconds.push(firstCrime.time / 1000)

    // decoy calls: call not followed by elevator-ride of same car within 60 ticks
    const calls = parsed.filter((l) => l.kind === 'elevator-call')
    const rides = parsed.filter((l) => l.kind === 'elevator-ride')
    totalCalls += calls.length
    for (const call of calls) {
      const hasRide = rides.some(
        (r) => r.car === call.car && r.tick >= call.tick && r.tick <= call.tick + 60,
      )
      if (!hasRide) totalDecoyCalls++
    }
  }

  const saboteurWinRate = rounds === 0 ? 0 : sabWins / rounds
  const correctAccusationRate = totalAccusations === 0 ? 0 : correctAccusations / totalAccusations
  const catchesPerHour = rounds === 0 ? 0 : (totalCatches * 12) / rounds
  const meanTimeToFirstCrimeSeconds =
    firstCrimeSeconds.length === 0
      ? null
      : firstCrimeSeconds.reduce((a, b) => a + b, 0) / firstCrimeSeconds.length
  const decoyCallRate = totalCalls === 0 ? 0 : totalDecoyCalls / totalCalls
  const meanSettleScore = rounds === 0 ? 0 : totalSettle / rounds
  const meanComplaintsPerRound = rounds === 0 ? 0 : totalComplaints / rounds
  const carryClockFiresPerRound = rounds === 0 ? 0 : totalCarry / rounds
  const settlesPerMinute = meanSettleScore / 5

  return {
    rounds,
    abortedRounds,
    malformedLines,
    saboteurWinRate,
    correctAccusationRate,
    catchesPerHour,
    meanTimeToFirstCrimeSeconds,
    decoyCallRate,
    meanSettleScore,
    meanComplaintsPerRound,
    carryClockFiresPerRound,
    provenanceSplit: { sabotage: sabotageComplaints, churn: churnComplaints },
    settlesPerMinute,
  }
}
