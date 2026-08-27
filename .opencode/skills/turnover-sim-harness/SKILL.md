---
name: turnover-sim-harness
description: Write vitest bot scenarios against the pure packages/sim — deterministic scripted inputs, event assertions, Phase 2 exit criteria. Use when writing or reviewing Gate 2 tests, sim code, or transport-shell tests.
---

# Sim harness (Gate 2)

`packages/sim` is pure TypeScript: inputs + time in, events out, 20 Hz fixed tick —
no I/O, no Colyseus imports, no randomness without a seed. Tests import it directly:
no sockets, no waits, fully deterministic.

Scenario shape:

```ts
const sim = new Sim({ seed: 1234, players: 5, layout: LAYOUT_24 });
sim.input(t, 'p1', { type: 'move', dir: 1 });
sim.tickUntil(t + 100);
expect(sim.events).toContainEqual(
  expect.objectContaining({ type: 'room:prepped', actor: 'p1', room: 'F1R3' }),
);
```

Rules:

- One behavior per test; assert on emitted events, never on internal fields.
- Pin the seed in every test. A flaky test is a wrong test, not a flaky sim.
- Time is explicit: drive ticks with the fixed-timestep driver. Never real timers.
- Balance numbers in assertions come from prd §7 — if the test hardcodes a magic
  number, it cites the tuning parameter name in a comment.

Exit criteria (roadmap Phase 2) live in `packages/sim/test/exit-criteria.test.ts`:

- (a) 5 staff bots vs. an AFK saboteur reach ≥80% coverage before the buzzer.
- (b) A scripted last-60s trash-blitz saboteur defeats spread bots at plausible rates.

Transport-shell tests (`apps/server`) are the only tests that touch Colyseus, via
`@colyseus/testing`: `boot() → createRoom → connectTo` simulated clients,
`waitForNextTimestep()` for the 20 Hz loop. They assert routing, not game logic: sim
events reach exactly the recipients allowed by the `turnover-protocol` leak rules —
and never reach anyone else.
