---
name: turnover-protocol
description: Turnover's message-only network protocol rules — what may never be sent to a client, message naming, personal snapshots vs broadcasts. Use before creating or changing any message type in packages/shared or apps/server, or when reviewing anything client-bound.
---

# Turnover protocol rules

Message-only protocol: per-player event stream + personal snapshots. No Colyseus
Schema state, `patchRate = null`. Message types live in `packages/shared`; the pure sim
(`packages/sim`) emits events, the transport shell (`apps/server`) routes them.

## Leak rules (hard)

1. The server never sends full state. Each message must be derivable from what its
   recipient legitimately knows at that moment.
2. Room interiors (prepped/trashed/fresh/settled) are sent only to players inside the
   room. Hallway-visible info is exactly: positions, door cards, elevator panels
   (position only — never occupants), door-open events, rustle audio within ~3 tiles.
3. Roles are never sent to anyone in any message. Saboteur identity lives in exactly
   one place: the server's role assignment. Even the recap (prd FR-22) is assembled
   server-side after round end.
4. Grace state, per-room coverage breakdowns, and other players' private snapshots are
   never client-bound.
5. Audit rule: the recipient policy of every server→client message is declared
   exactly once in `PROTOCOL_REGISTRY` (`packages/shared/src/protocol/registry.ts`)
   under its `recipients` field — the registry IS the audit surface; read it, do
   not grep. The server's per-room Router (`apps/server/src/rooms/router.ts`) is
   the only module permitted to send, and every message it emits is stamped with
   the `{ seq, time, payload }` envelope (wire name = type tag; payloads carry no
   `type` literal). A bypass denylist test (`router.test.ts`) fails the build if
   any raw `.send(`/`.broadcast(` appears outside the Router. If a task seems to
   require violating a rule above, STOP — it is a spec bug, not an
   implementation problem.

## Conventions

- Message types are past-tense domain events mirroring prd §6 behaviors:
  `room:prepped`, `room:trashed`, `elevator:called`, `player:fired`, … Every
  server→client type is declared once in the protocol registry (payload type +
  recipient policy); sim events need a registry row too — an undeclared sim
  event fails compilation (cycle 2.3, AD-006).
- Per-player snapshots are sent on join and on visibility change (entering/leaving a
  room, floor change) and contain only that player's legitimate view.
- Client→server intents (move, call elevator, start/cancel channel, accuse) go through
  Colyseus 0.18 zod `validate()` handlers. The server rejects; it never trusts.
- Telemetry mirrors the event stream 1:1 (prd FR-23): if it isn't an emitted event, it
  isn't logged.
- Use `sendBytes`/`broadcastBytes` only if MsgPack JSON becomes a measured bottleneck —
  not preemptively.
