---
name: turnover-client-harness
description: Headless-Chromium client harness (Gate 3) — window.__TURNOVER__ debug hook contract, scenario format, running pnpm test:client. Use when writing client playtest scenarios or debugging "compiles but black screen".
---

# Client harness (Gate 3)

Adapted from the phaser4-gamedev playtest harness (installed globally via
`npx skills add Yakoub-ai/phaser4-gamedev`). Boots the real client + server in
headless Chromium, drives scripted input, asserts on live state, exits non-zero on
failure. Run: `pnpm test:client` (needs `npx playwright install chromium` once per
machine).

It catches what Gate 1 cannot: black screens, unregistered scenes, asset 404s
disguised as `200 text/html`, uncaught exceptions in `create()`, dead message
handlers, FPS collapse.

## `window.__TURNOVER__` contract (dev/harness builds ONLY — stripped from prod)

```ts
window.__TURNOVER__ = {
  events: MessageEvent[],        // every message THIS client received = its legitimate view
  local: { playerId, roomId },   // the local player's own state
  scene(name): SceneHandle,      // Phaser scene accessor
};
```

It exposes exactly what this client already knows — never more. Anything beyond the
`turnover-protocol` leak rules is a bug here too. Production builds tree-shake the
hook; the harness always runs against a dev-mode bundle.

## Scenario format

```js
export default [
  { name: 'join lobby', action: 'goto', url: 'http://localhost:5173/?room=E2E' },
  { name: 'move right', action: 'key', key: 'ArrowRight', duration: 600 },
  { name: 'movement echoed', action: 'expect',
    expect: { expression: `__TURNOVER__.events.some(e => e.type === 'player:moved')`, equals: true } },
  { name: 'prep a room', action: 'key', key: 'e', duration: 5500 },
  { name: 'prep event arrived', action: 'expect',
    expect: { expression: `__TURNOVER__.events.some(e => e.type === 'room:prepped')`, equals: true } },
];
```

Flake triage: `--repeat N` classifies a failure as clean / intermittent / consistent;
`--seed` separates an RNG bug from a timing bug. "It only happens sometimes" becomes
actionable.

What Gate 3 cannot verify: audio audibility, real-device performance, whether the game
is fun — that is Gate 4 (human), and the harness says so plainly rather than implying
coverage.
