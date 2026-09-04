# PRD — Turnover

Version: 1.6 · Status: Gray-box + stack decisions locked · Owner: —
Name: **Turnover** (codename during docs: "Grand Hotel") · Domains reserved: turnover.game, playturnover.com
Companion docs: `roadmap.md` (build plan)

> v1.3 changelog: guest-traffic economy (AD-022) — NPC guests, walkie routing,
> complaint budget. New §6.9; FR-14/FR-22/§5/§6.6/§7/§9 amended.
>
> v1.4 changelog: guest-transport economy (AD-032) — the suitcase redesign:
> check-in hands the guest's suitcase to the receiver, the suitcase is a
> placeable/re-grabbable object, the guest follows its final resting room,
> wrong rooms end in door complaints (no personal penalty), the walkie becomes
> a server-generated truthful lifecycle log, and a mezzanine restaurant floor
> is added. §6.9/FR-3/FR-7–9/FR-33/§5/§7/§9 amended; cycles 3.B/3.C inserted
> in `roadmap.md`. §7 v1.4 dials provisional pending the 3.5 balance gate.
>
> v1.5 changelog: delivery scoring (AD-039) — the settle score: correct
> deliveries settle guests and build a public team score that decides the
> buzzer verdict (§6.6), the wrong-delivery complaint line stops counting
> toward the complaint budget (it informs, it no longer damages — only
> trash-discovery complaints feed the loss leg), and coverage% drops out of
> the win check into telemetry. §6.6/FR-29/FR-31/§5/§7/§8 amended; cycle 3.D
> inserted in `roadmap.md`; SETTLE_TARGET provisional pending 3.5.
>
> v1.6 changelog: stairs & ambush (AD-040) — the west elevator is replaced by a
> camera-free stairwell (3s/floor + 2s breath, staff-side only, interior
> publishes nothing) and the saboteur gains the game's first direct pressure
> tool: an automatic, anonymous 20s stun on an opposite-direction stairs pass.
> One elevator remains (the east car; all two-car machinery collapses, payloads
> keep `car: 1`). §6.2/FR-5/FR-6/§6.10 (FR-34/35)/§7/§8/§9 amended; cycle 3.E
> inserted before 3.3 in `roadmap.md`; the §8 v1.6 recompute holds the v1.3
> cadence dials against the single car.

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
  Guests:   arrive ~1 per cadence · queue at desk · checked in with a suitcase
            carried to a room (anyone may place/re-grab it) · wait at the
            restaurant · enter the suitcase's resting room ·
            dwell 45–90s · check out (re-trashing their room) ·
            complain at the door of a wrong room
  Staff:   desk check-in + suitcase carrying · prep rooms (5s) · patrol hallways ·
           read door cards · shadow suitcases · overhear assignments ·
           spot-check · testify on voice · accuse
  Saboteur: un-prep (3s) · re-trash · fake prep · decoy elevator calls ·
            overhear assignments · mis-place suitcases · voice lies
→ Buzzer / firing / settle target / budget exhausted → Results: winner + traitor reveal
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
- FR-3 Building: grand lobby + mezzanine restaurant floor (v1.4/AD-032) + 3 guest
         floors × 7 rooms (~21 rooms total — AD-046: the 8th room's doorway sat
         flush against the east elevator landing).
- FR-4 Linear left/right movement only; pass-through bodies (no collision).
- FR-5 One elevator at the east end of each floor (v1.6, AD-040 — the west car
       was replaced by the stairwell, FR-34). Capacity 2 per car.
       Deterministic cycle: call → car arrives 3s → ride 2s **per floor traveled**.
       One pending destination; a call for the floor the car is already heading to
       is ignored, but the panel still flashes (decoys look registered).
- FR-6 Public elevator panels show the car's current position only — never occupants
       (decoy calls emerge naturally; "who rode when" stays voice testimony).

### 6.3 Work Actions
- FR-7 Staff prep: channel inside room, 5s, any non-prepped state →prepped (clean or trashed).
- FR-8 Saboteur un-prep: channel, 3s, prepped→trashed. Re-trashing allowed.
- FR-9 Fake prep available to saboteur: animation only, **no state change** — the room
        stays trashed. All work animations identical across roles.
- FR-9a Carrying blocks work (v1.4/AD-032): a player holding a guest suitcase cannot
        start a work channel (FR-7/FR-8). Accusation (FR-17) and elevator calls stay
        available; carrying is hands-full by design — deliver before working.
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

### 6.6 Win Conditions (v1.5, AD-039)
| Side | Wins when |
|---|---|
| Staff | Saboteur fired (walk-in or correct accusation) **or** the settle score ≥ `SETTLE_TARGET` at the 5:00 buzzer |
| Saboteur | Complaint budget exhausted — 8th guest complaint, trash-discovery complaints only (v1.5; instant loss) **or** settle score < `SETTLE_TARGET` at buzzer **or** staff reduced to 1 player |

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

### 6.9 Guest Traffic (v1.3 AD-022; suitcase redesign v1.4, AD-032)

FR numbering continues here; placement at section end keeps FR-1…FR-25 references
stable across specs and skills.

- FR-26 Guest lifecycle: NPC guests arrive at the grand lobby on the §7 cadence, queue
        at the front desk, are checked in with a **suitcase** carried to a room (v1.4),
        dwell there 45–90s (random), then check out — their room re-trashes, spawning
        **settled** trash. Guest traffic is the round's renewable workload; staff
        throughput vs. the churn+bleed rate is the core tension. All guest sampling is
        seeded (deterministic sim).
- FR-27 Suitcase transport & walkie (v1.4, supersedes the walkie-broadcast flow): any
        player standing at the desk can check in the queued guest and **takes the
        guest's suitcase** — receiver = carrier, one suitcase per player. The suitcase
        is a physical object: E **places** it at a room door, E near a resting suitcase
        **picks it up** — by anyone, saboteur included. The guest waits at the
        restaurant (mezzanine; holding area pre-3.C) and walks to the suitcase's **last
        resting room**; the outcome triggers at guest arrival. The walkie is the
        building's **server-generated truthful log** of guest-lifecycle facts (waiting,
        check-in, pickup, settle, complaint, checkout) — players cannot author lines;
        **placement is silent** (the resting room is learnable only by being on that
        floor, or later via the settle/complaint lines). The guest's **assignment** is
        server-truth seeded at check-in, transmitted only to the receiver and staff in
        desk earshot at the check-in tick — a snapshot, never repeated, never logged;
        overhearing it is the only pre-placement source.
- FR-28 Impatience (v1.4 re-scope): the ~20s clock (foot-tap + repeated desk bell, no
        complaint cost) times only the **check-in wait** — an unchecked guest
        self-assigns a uniform random vacant room. Once checked in, the guest is
        patient; no clock runs on carriers except the §7 carry clock (the only
        personal foul: it **fires the current carrier** on expiry).
- FR-29 Arrival & complaint (v1.4; budget decoupled v1.5): a guest enters **only the room where their suitcase
        rests, only on arrival**. Two complaint paths:
        *(a) wrong room* — room != assignment → the guest complains **at the door**: a
        building-wide line ("the guest of room X complained about the suitcase"),
        **counting toward nothing since v1.5 — the line informs, it no longer damages**
        (the settlement score is untouched, the budget is untouched); no entry, no
        interior discovery, **no personal penalty for the placement** — mis-placement
        costs only time; interception before arrival is the only defense. *(b) trash
        inside* — room == assignment but trashed → the original v1.3 discovery loop:
        in-world anger cue at the room (room-number level, no detail), the guest walks
        to the desk and delivers a fuzzy-timestamp report ("someone hit 305, maybe a
        minute ago"), one complaint fires, and the guest **leaves the hotel** — no
        retry. Their departure flips the tenancy sign Vacant (FR-33); the room stays
        trashed — "vacant but trashed" is the complaint's footprint. A guest settling
        into their assigned room — however it got there — adds **+1 settle score**
        (v1.5), the §6.6 buzzer verdict's input.
- FR-30 Guests never convict: guest encounters never trigger walk-in conviction
        (FR-15 stays staff-only). A guest entering during an active un-prep flees and
        follows the FR-29 complaint path. Guest complaints are testimony, not justice.
- FR-31 Complaint budget (v1.5 scope): only **trash-discovery complaints** (FR-29b)
        count; the Nth complaint (N=8, §7) is **instant staff loss**
        (§6.6). The HUD counter (FR-14) pulses red at ≥6. Every complaint delivers
        information (the FR-29 desk report) — losing ground and gaining leads share
        a beat. Wrong-delivery door complaints (FR-29a) never counted here since
        v1.5 — the budget means "caught sabotaging", not "logistics happened".
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
        from the hallway, it verifies suitcase outcomes at a distance: a guest settling
        into 305 flips 305 Occupied (v1.4 note — the walkie carries lifecycle facts
        only, never placements, so the sign is the at-a-distance record of where a
        guest actually ended up, FR-27).

### 6.10 Stairs & Ambush (v1.6, AD-040)

- FR-34 Stairwell: the west end of every floor is a camera-free stairwell
        (replacing the west elevator). Staff-side only — guests ride the single
        elevator. Entry: direction key at the stairwell mouth; one floor stride
        per activation (3s) then a **2s breath catch** on the arrival floor
        (immobile). Entry and arrival are observable (departure event on the
        origin floor, arrival via the floor stream); the interior publishes
        nothing — no positions, no co-transiting identities, no spectator view.
        Usable in all phases; ambush requires an active round.
- FR-35 Ambush: when the saboteur and a live staff member pass mid-stairs in
        opposite directions, the staff member is **stunned** for 20s —
        automatic, saboteur-only, no per-round limit. Anonymous: the victim
        learns only "you were ambushed" + duration, never the saboteur's
        identity; the saboteur receives a private confirmation. Stationary
        players (breathing, waiting) neither ambush nor can be ambushed;
        same-direction passes are inert; guests and fired players are immune.
        A stunned victim resumes the interrupted transit on recovery and
        finishes their walk.

## 7. Tuning Values (single source of truth)

| Parameter | Value | Reserve dial order |
|---|---|---|
| Players | 4–6 (target 5–6) | — |
| Shift length | 5:00 | — |
| Rooms | ~21 (3 floors × 7 — AD-046) | — |
| Prep / un-prep | 5s / 3s | un-prep → 2s if saboteur weak |
| Re-trash | Unlimited | — |
| Coverage target | 80% | — (telemetry/KPI only since v1.5 — no longer a win check) |
| Settle target (v1.5, AD-039; calibrated 3.5, AD-043; re-proven 3.6, AD-044) | 5 (4p) / 7 (5p) / 9 (6p) settled guests at buzzer | locked after the 3.5 exit-bot gate — pure-churn 6p 20/20 hits, 5p 20/20, 4p 19/20; mis-place vs intercepting staff 17/20 staff wins (bot 20–90% band, human sab expected 35–65%); re-proven 3.6 `sim:exit_a` 20/20 `sim:exit_b` 20/20 (relaxed band, delta 0) |
| Attrition loss | Staff down to 1 | scale by lobby size later |
| Freshness window | 75s | — |
| Rustle range | ~3 tiles | — |
| Elevator | arrive 3s / ride 2s per floor / cap 2 | — |
| Player speed | 6 tiles/s (hall ~30 tiles, room ~4 tiles) | — |
| Accusation range | ~2 tiles, same floor | card-read range later |
| Initial trashed rooms | 7 of 21 at t=0 (AD-046 room count) | — |
| Guest cadence | 30s (4p) / 24s (5p) / 18s (6p) | first dial for 4-player slack |
| Guest dwell | 45–90s, random per guest | — |
| Complaint budget | 8 (instant loss; trash-discovery complaints only since v1.5) | scale by lobby size; harder to reach now — re-examine at the 3.5 gate |
| Guest impatience | 20s → self-assign (v1.4: times the check-in wait only) | — |
| Peak occupancy | ~10 rooms | — |
| Desk earshot range | ~3 tiles, snapshot at the check-in tick | v1.4; widen if overhearing feels scarce |
| Carry clock | 60s per leg (check-in → first placement; fresh 60s per pickup), expiry fires the current carrier | v1.4; the only personal foul — soften to a bell if honest carries fire |
| Restaurant dwell | 15–30s, seeded (wait buffer; a guest whose suitcase rests leaves immediately) | v1.4 |
| Stairs transit / breath | 3s per floor stride / 2s breath catch on arrival | v1.6 (AD-040, §7-external); the stairs' speed cost is the price of their anonymity |
| Stairs stun | 20s (saboteur ambush, anonymous) | v1.6 (AD-040, §7-external); ≈ one guest cadence slot — shorten if ambush pressure starves triage |

All v1.3 rows (AD-022) are provisional pending first playtests; changes are recorded
decisions, never incidental edits. **v1.4 rows (AD-032) are additionally gated: the
carry clock, earshot range, and the free-misplacement economy lock only after the 3.5
balance gate proves interception can keep pace with the saboteur at the 6p cadence — proven 3.5 (AD-043), now locked.** **v1.5 SETTLE_TARGET locks only after the 3.5 gate — proven 3.5 (AD-043), now locked at 5/7/9.**

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
recomputed when the guest-traffic spec is written (AD-022 trade-off).** **v1.5 note: the
buzzer win leg is the settle score, not coverage — the 3.5 exit-bot gate calibrates
SETTLE_TARGET (and re-checks the shrunken complaint budget's reachability) instead.**

**v1.6 recompute (AD-040, one elevator + stairs):**

- **Guest throughput, single car**: a served guest trip costs ≈ 3s arrival + up to 1s door
  stages + 2s/stride ride (lobby→floor1 = 2 strides = 4s; floor3 = 8s) ≈ **8–12s per trip**
  under continuous demand. Against the v1.3 cadence (30/24/18s per arrival at 4/5/6p) the
  single car holds ≈ 1.5× headroom at the 6p worst case — **the cadence dials hold**; the
  v1.4 dwell economy and the 3.5 gate re-prove it under live traffic (AD-043: pure-churn bots 20/20 at 6p, 20/20 at 5p, 19/20 at 4p).
- **Staff–guest car contention is the new pressure**: staff rides now queue behind guests.
  The stairs are the relief valve — a staff stairs hop (3s + 2s breath = 5s/floor, no wait)
  is competitive with the elevator for single-floor trips whenever the car is busy, and
  unobservable. Staff who ride the car remain visible and testifiable (AD-013 co-presence).
- **Ambush economy**: a 20s stun ≈ one guest arrival slot (18s at 6p) — a stunned floor's
  triage gap costs ≈ one cadence slot. **Kill check (pinned in the spec): an ambush never
  creates a complaint — it only enables one the saboteur already set up.** The ambush is
  also the saboteur's signature trace: stun times/places are testimony without identity. **3.5 gate: ambush never creates a complaint (differential 0 guest:discovered), and wrong-delivery lines never move the budget or the score (AD-043).**

## 9. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Saboteur power budget vs 5 info systems | High | Reserve dials §7, watch saboteur fun metric |
| Onboarding weight (5 readable systems) | Medium | Time-to-first-correct-deduction tracked; add tutorial scenario before adding UI |
| Voice dependency caps audience (PC/Discord only) | Medium | Accepted for MVP; spatial voice is retention expansion |
| Cold-start liquidity (<6 players) | High | Browser zero-install distribution; community seeding via Discord |
| Tone drift (cozy → procedural hunt) | Low | Deliberate marketing decision post-playtest |
| Buzzer-ending anticlimax | Medium | Live coverage % + dramatic results screen |
| Desk monopoly (one player pinned at reception all round) | High | v1.3: 20s impatience + bell make neglect visible; desk rotation is social; first-playtest watch-item. v1.4: the suitcase turns check-in into a moment, not a posting — but overhearing assignments makes the desk a *contested* spot instead |
| Innocent placer paralysis (staff learn "never place") → pipeline deadlocks at the restaurant | High (new, v1.4) | One-step diegetic confirm on unheard rooms (own-knowledge, not the assignment); 60s carry clock bounds suitcase hoarding; explicit first-playtest kill check |
| Free mis-placement outpaces interception (budget burns faster than staff correct) | High (new, v1.4) | 3.5 balance gate before §7 v1.4 dials lock; reserve lever: make a wrong placement fire its placer on a second offense |
| Passive saboteur (churn bleeds the budget with no crime) | High | v1.3: recap provenance exposes ghost play socially; §7 dials; explicit first-playtest kill check |
| Ambush-into-complaint chain (stun a floor's staff → guest self-assigns into a trashed room → budget complaint; silent and repeatable) | High (new, v1.6) | Spec-pinned property: an ambush never creates a complaint, it only enables one already set up; reserve lever: a victim immunity window after recovery; the 3.5 balance gate re-checks budget reachability under ambush pressure — first-playtest kill check |
| Single-car bottleneck (guests and staff share the one elevator) | Medium (new, v1.6) | §8 v1.6 recompute holds ≈1.5× headroom at the 6p cadence; the stairs are the staff relief valve — if lobby elevator waits feel miserable in playtests, reserve lever: staff-priority dispatch or a second stairwell |
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
