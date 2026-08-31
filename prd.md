# PRD — Turnover

Version: 1.3 · Status: Gray-box + stack decisions locked · Owner: —
Name: **Turnover** (codename during docs: "Grand Hotel") · Domains reserved: turnover.game, playturnover.com
Companion docs: `roadmap.md` (build plan)

> v1.3 changelog: guest-traffic economy (AD-022) — NPC guests, walkie routing,
> complaint budget. New §6.9; FR-14/FR-22/§5/§6.6/§7/§9 amended.

---

## 1. Vision

**Among Us with the meetings deleted and the evidence made physical.**
A 5-minute, browser-based social deduction game for 4–6 friends. Staff prepare hotel
rooms for a stream of NPC guests while one hidden saboteur quietly ruins them; guests
who find trash file complaints, and the complaint budget — not just the saboteur —
can lose the shift. No corpses, no meetings, no chat logs —
the hotel itself leaks traces (door cards, mess freshness, elevator panels), and spoken
testimony over Discord turns those traces into accusations. Wrong accusations get you
fired. The results screen exposes every lie after the fact.

## 2. Problem & Opportunity

- Social deduction is proven demand (Among Us et al.) but the market is saturated with
  murder-based clones that died post-hype.
- **Underserved wedge:** non-violent deduction — family/school/streamer-safe property
  crime instead of killing.
- **Cold-start problem** of party games is attacked directly: browser links (no installs),
  5-minute rounds, external voice assumed where players already are (Discord).
- Differentiation must be mechanical, not cosmetic: *physical evidence + testimony*,
  not vote meetings.

## 3. Target Audience & Platform

| | |
|---|---|
| Audience | Friend groups 13+, Discord communities, streamers needing advertiser-safe content |
| Platform MVP | Desktop browser (Chrome/Firefox/Edge), keyboard controls |
| Voice | External (Discord) — load-bearing dependency, testimony is the evidence currency |
| Session | 4–6 players · ~5 min rounds · drop-in lobby via room code |

Minimum-fun lobby is **6 players**; below 5 the attrition math and testimony pool degrade.

## 4. Goals & Non-Goals

### Goals (MVP)
1. A complete, winnable round loop with hidden saboteur in the browser.
2. Evidence layer dense enough that accusations can be *argued*, not guessed.
3. Full telemetry so playtests evaluate themselves against kill criteria.
4. Zero-install access: send a URL, play in seconds.

### Non-Goals (MVP)
- ❌ Art/audio polish (gray-box rectangles; Elevator Action pixel style comes later)
- ❌ Integrated or spatial voice, text-chat systems
- ❌ Matchmaking, accounts, progression, monetization
- ❌ Mobile/touch support
- ❌ Multiple maps, extra roles, saboteur utility tools beyond pure vandalism

## 5. Core Loop

```
Lobby gather-up → secret roles → SHIFT (5:00)
  Guests:   arrive ~1 per cadence · queue at desk · routed by walkie broadcast ·
            dwell 45–90s · check out (re-trashing their room) ·
            complain when they find trash inside a room
  Staff:   desk duty + walkie routing · prep rooms (5s) · patrol hallways ·
           read door cards · spot-check · testify on voice · accuse
  Saboteur: un-prep (3s) · re-trash · fake prep · decoy elevator calls ·
            walkie lies · voice lies
→ Buzzer / firing / coverage / budget exhausted → Results: winner + traitor reveal
  + event recap
→ post-round argument (retention engine)
```

Design pillars:
1. **Position is evidence** — linear halls force proximity; being seen matters.
2. **Information has travel cost** — room states only inside rooms; every trace must be walked to.
3. **Diegetic traces only** — the hotel leaks data through objects (cards, cars, noise, guests),
   never through UI oracles (HUD exceptions: coverage %, timer, complaint counter).
4. **Two-tier justice** — direct evidence (walk-in) convicts automatically;
   circumstantial evidence goes through risky personal accusation.

## 6. Functional Requirements

### 6.1 Session & Lobby
- FR-1 Create/join room by code, display names, max 6 players. The lobby persists across
       rounds: results screen → same room code, host re-deals on start. Fresh codes only
       for new groups.
- FR-2 Host starts round when ≥4 players. Roles assigned secretly at lobby gather-up spawn:
       everyone spawns in the grand lobby; exactly **one** saboteur, always; each player
       sees only their own private role card. No saboteur-count signal exists anywhere.

### 6.2 Space & Movement
- FR-3 Building: grand lobby + 3 guest floors × 7–8 rooms (~24 rooms total).
- FR-4 Linear left/right movement only; pass-through bodies (no collision).
- FR-5 Two elevators at opposite ends of each floor. Capacity 2 per car.
       Deterministic cycle: call → car arrives 3s → ride 2s **per floor traveled**.
       One pending destination per car; a call for the floor a car is already heading to
       is ignored, but the panel still flashes (decoys look registered).
- FR-6 Public elevator panels show both cars' current positions only — never occupants
       (decoy calls emerge naturally; "who rode when" stays voice testimony).

### 6.3 Work Actions
- FR-7 Staff prep: channel inside room, 5s, any non-prepped state →prepped (clean or trashed).
- FR-8 Saboteur un-prep: channel, 3s, prepped→trashed. Re-trashing allowed.
- FR-9 Fake prep available to saboteur: animation only, **no state change** — the room
       stays trashed. All work animations identical across roles.
- FR-10 Room state (prepped/trashed/fresh/settled) readable **only while inside the room**.
       Doors auto-open on entry: the opening is visible **and audible from the hallway**,
       so a passerby sees who entered which room. Hallway shows nothing of interiors
       except door cards (FR-11).

### 6.4 Evidence Layer
- FR-11 Door status cards: auto-hung on prep completion, **permanent** (saboteur cannot
       remove). Readable from the hallway; no timestamp. Cards certify "was ever prepped",
       not "is prepped" — a re-trashed room keeps its card, so every carded room may need
       a walk-in verify (core patrol treadmill).
- FR-12 Trash freshness: two visual tiers — fresh ≤75s since sabotage, then settled.
- FR-13 Sabotage rustle audio audible within ~3 tiles **through walls, hallway included** —
       the cue that enables creep-to-door walk-in catches.
- FR-14 HUD shows exactly three things: coverage %, shift timer, complaint counter
        (pulses red at ≥6 — v1.3/AD-022). No feeds, no player list, no other oracles.

### 6.5 Justice System
- FR-15 Walk-in conviction: entering a room during an active un-prep channel instantly
        fires the saboteur. The occupant's only warning is the door-open cue (FR-10) —
        cancel is instant, no lockout; catches come from rustle-masking (FR-13) and
        voice-call inattention.
- FR-16 Voluntary walk-out mid-channel cancels cleanly: room unchanged, no trace, no fire.
- FR-17 Accusation: staff-only, within ~2 tiles on same floor, hold E → confirm menu.
- FR-18 Wrong accusation = accuser fired. Accusing the saboteur **before his first
        un-prep** (grace period) counts as wrong and fires the accuser. The grace state
        is fully hidden; live firing feedback is a name-only toast ("X was fired") —
        validity is revealed only on the recap (FR-22).
- FR-19 Correct accusation fires the saboteur.
- FR-20 Fired players become spectators with a full-building overview camera until round
        end — including room interiors. Spectators stay in voice; "fired players stay
        quiet" is a social honor convention (Among Us ghost rule), stated in-client but
        unenforced.

### 6.6 Win Conditions
| Side | Wins when |
|---|---|
| Staff | Saboteur fired (walk-in or correct accusation) **or** ≥80% rooms prepped at 5:00 buzzer |
| Saboteur | Complaint budget exhausted — 8th guest complaint (instant loss) **or** <80% coverage at buzzer **or** staff reduced to 1 player |

### 6.7 Results & Recap
- FR-21 Winner banner + traitor identity reveal.
- FR-22 Event recap timeline: crimes (with freshness timestamps), rides, catches,
       accusations and their validity, guest complaints **with provenance** — each
       complaint line states whether the trash was sabotage (naming the actor) or
       checkout churn. Revealed post-reveal only (v1.3/AD-022).

### 6.8 Telemetry (internal)
- FR-23 Server-authoritative JSONL log per round: every room transition (actor+time),
      elevator calls/rides, walk-in catches, accusations (`wasTargetSaboteur`,
      `crimeOccurred` flags), coverage sampled once per second.
- FR-24 Post-round KPI computation: saboteur win rate · correct-accusation rate ·
       catches/hour · time-to-first-crime-discovery · decoy-call usage.
- FR-25 Disconnect mid-round: the leaver becomes an idle spectator-slot ghost and play
       continues. Saboteur disconnect ends the round as an **aborted** result, excluded
       from KPI telemetry.

### 6.9 Guest Traffic (v1.3, AD-022)

FR numbering continues here; placement at section end keeps FR-1…FR-25 references
stable across specs and skills.

- FR-26 Guest lifecycle: NPC guests arrive at the grand lobby on the §7 cadence, queue
        at the front desk, are routed to a room, dwell there 45–90s (random), then check
        out — their room re-trashes, spawning **settled** trash. Guest traffic is the
        round's renewable workload; staff throughput vs. the churn+bleed rate is the
        core tension. All guest sampling is seeded (deterministic sim).
- FR-27 Routing & walkie: any player standing at the desk can receive the queued guest.
        Sending the guest requires a **walkie broadcast** — a canned room-number menu
        ("«Marco»: guest going to 305") heard building-wide. The broadcast is the
        broadcaster's *claim*, not server-truth: the saboteur may announce a different
        room than the guest is sent to. The guest's actual walk — visible, elevator-using
        (panels stay position-only, FR-6) — is the ground truth; lies are checkable but
        only by someone with eyes on them (tenancy signs, FR-33, make the check possible
        at a distance).
- FR-28 Impatience: an unrouted guest waits ~20s at the desk, visibly foot-tapping with
        a repeated desk bell (no complaint cost), then **self-assigns** a uniform random
        vacant room. Waiting is free; the gamble is the penalty.
- FR-29 Discovery & complaint: guests always **enter** the room they were sent to.
        Finding trash inside: an in-world anger cue fires at the room (room-number
        level, no detail), the guest walks to the desk and delivers a fuzzy-timestamp
        report ("someone hit 305, maybe a minute ago"), **one complaint fires, and the
        guest leaves the hotel** — no retry, assigned or self-assigned alike. Their
        departure flips the tenancy sign Vacant (FR-33); the room stays trashed —
        "vacant but trashed" is the complaint's footprint.
- FR-30 Guests never convict: guest encounters never trigger walk-in conviction
        (FR-15 stays staff-only). A guest entering during an active un-prep flees and
        follows the FR-29 complaint path. Guest complaints are testimony, not justice.
- FR-31 Complaint budget: the Nth complaint (N=8, §7) is **instant staff loss**
        (§6.6). The HUD counter (FR-14) pulses red at ≥6. Every complaint delivers
        information (the FR-29 desk report) — losing ground and gaining leads share
        a beat.
- FR-32 Trash provenance: trash has an author dimension on top of FR-12 freshness —
        checkout churn spawns *settled*; sabotage spawns *fresh*; re-trashing resets to
        fresh. Churn can be laundered into "suspicious" by re-trashing; a sabotage hit
        can never be downgraded to churn. Visible only inside rooms (FR-10 rules); the
        recap exposes authorship post-reveal (FR-22).
- FR-33 Tenancy door sign: every guest door carries an Occupied/Vacant flip-sign that
        the building operates automatically — Occupied when a guest **settles** in the
        room, Vacant when they check out or leave the hotel. The sign shows **tenancy,
        not presence** (presence stays a FR-10 door cue): a guest who flees mid-sabotage
        leaves the sign Occupied while the room sits empty and trashed — the mismatch
        window is a walk-in-quality sabotage tell. Separate channel from FR-11 cards
        (card = prep history, sign = tenancy); neither carries a timestamp. Readable
        from the hallway, and verifies walkie claims at a distance — a broadcast for
        305 leaves 305 Vacant while the actual room flips (FR-27).

## 7. Tuning Values (single source of truth)

| Parameter | Value | Reserve dial order |
|---|---|---|
| Players | 4–6 (target 5–6) | — |
| Shift length | 5:00 | — |
| Rooms | ~24 (3 floors × 7–8) | — |
| Prep / un-prep | 5s / 3s | un-prep → 2s if saboteur weak |
| Re-trash | Unlimited | — |
| Coverage target | 80% | — |
| Attrition loss | Staff down to 1 | scale by lobby size later |
| Freshness window | 75s | — |
| Rustle range | ~3 tiles | — |
| Elevator | arrive 3s / ride 2s per floor / cap 2 | — |
| Player speed | 6 tiles/s (hall ~30 tiles, room ~4 tiles) | — |
| Accusation range | ~2 tiles, same floor | card-read range later |
| Initial trashed rooms | 7 of 24 at t=0 | — |
| Guest cadence | 30s (4p) / 24s (5p) / 18s (6p) | first dial for 4-player slack |
| Guest dwell | 45–90s, random per guest | — |
| Complaint budget | 8 (instant loss) | scale by lobby size |
| Guest impatience | 20s → self-assign | — |
| Peak occupancy | ~10 rooms | — |

All v1.3 rows (AD-022) are provisional pending first playtests; changes are recorded
decisions, never incidental edits.

## 8. Success Metrics & Kill Criteria

Ten recorded playtest sessions (5–6 players, Discord voice, rotating groups) decide:

| Metric | Healthy | Action if missed |
|---|---|---|
| Saboteur win rate | 35–65% | <35% → spend dials in §7 order, retest each |
| Correct accusations | ≥4 per 10 rounds | instrument which conviction-chain link fails first |
| Walk-in catches | ~0.3–0.7 per round | frequent → shrink un-prep window value; never → acceptable, testimony carries |
| Saboteur-reported fun | majority "fun" not "hunted" | power-budget problem even at healthy win rate |
| Panels referenced in voice | organically by staff | never → filtering link not landing |

Travel-budget math (roadmap step 0) verdict: staff re-prep throughput (~9.5 rooms/min/person)
outruns saboteur re-trash (~7/min). The saboteur's win lever at 5–6 players is a **last-60s
trash blitz** + attrition at low counts, not sustained denial. Expect coverage wins at high
counts, catch/accusation wins at low counts. No dial changes pre-build. **v1.3 note: guest
churn adds a third mess source the §8 math never priced; throughput vs. bleed must be
recomputed when the guest-traffic spec is written (AD-022 trade-off).**

## 9. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Saboteur power budget vs 5 info systems | High | Reserve dials §7, watch saboteur fun metric |
| Onboarding weight (5 readable systems) | Medium | Time-to-first-correct-deduction tracked; add tutorial scenario before adding UI |
| Voice dependency caps audience (PC/Discord only) | Medium | Accepted for MVP; spatial voice is retention expansion |
| Cold-start liquidity (<6 players) | High | Browser zero-install distribution; community seeding via Discord |
| Tone drift (cozy → procedural hunt) | Low | Deliberate marketing decision post-playtest |
| Buzzer-ending anticlimax | Medium | Live coverage % + dramatic results screen |
| Desk monopoly (one player pinned at reception all round) | High | v1.3: 20s impatience + bell make neglect visible; desk rotation is social; first-playtest watch-item |
| Passive saboteur (churn bleeds the budget with no crime) | High | v1.3: recap provenance exposes ghost play socially; §7 dials; explicit first-playtest kill check |
| Guest expressiveness underinvested → hotel feels dead, complaints feel like point-loss not story | Medium | v1.3: foot-tap, storm-out, anger cue are load-bearing animations, not polish (art brief scope) |
| Voice floor raised (walkie lies, desk rotation, triage need talk) | Medium | v1.3: Discord dependency goes from load-bearing to near-required; accepted for MVP |

## 10. Post-MVP Backlog (parking lot, unprioritized)

Pullable door cards (saboteur counterplay) · timestamped personal notebook ·
front-desk physical annotation board · integrated/spatial voice · second map ·
extra roles & saboteur tools (DND signs, floor blackout) · mobile/touch ·
tutorial scenario · cosmetics (uniforms, room themes) · attrition scaling by lobby size.

## 11. Tech Stack

- **Monorepo** — pnpm workspaces: `apps/client` (Phaser 4), `apps/server` (Colyseus),
  `packages/sim` (pure round sim), `packages/shared` (message protocol types + tuning table).
- **Client** — Phaser 4 renders the game world only; lobby, HUD, firing toasts, results
  and recap are a plain DOM overlay (no UI framework). Keyboard input.
- **Server** — Node 24 LTS; Colyseus **0.18** rooms, message-only (no Schema state,
  `patchRate = null`) for lifecycle + 60s reconnection; Fastify + `@fastify/static`
  serves the built client (single container, one port). Default `ws` transport
  (no uWebSockets ABI risk).
- **Networking** — authoritative server, 20 Hz tick, client interpolation to 60fps.
  Message-only protocol: per-player event stream + personal snapshots. Full state never
  leaves the server; no Colyseus state sync (cheat-auditable by grepping message types).
- **Sim** — `packages/sim` is pure TypeScript (inputs + time in, events out); the Colyseus
  room is a thin transport shell. Bot-driven sims run in vitest (roadmap Phase 2 gate).
- **Reconnection** — 60s `allowReconnection` window, exact role restored (incl. saboteur
  card); after the window, FR-25 applies (idle ghost / abort).
- **Deploy** — Railway, auto-deploy from git, single container. No auth, no DB —
  JSONL telemetry per round + inline `kpi.json` (FR-23/24).
- **Tooling** — Vite (client), tsx dev / tsup build (server), vitest, Biome.
