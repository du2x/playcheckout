import { expect, type Page, test } from '@playwright/test'

// Spec JUST-04/15/16/18/20 (gate scenario client:accuse_ui, cycle 2.8): the
// real server boots via the webServer hook (30 s test shift, AD-004). The
// whole cast spawns at the lobby center — same floor, zero distance — so a
// staff page has an in-range candidate the moment the round starts.
//
// Choreography: tap E still calls the elevator and opens no menu (JUST-17);
// hold E opens the confirm menu naming a nearby player; cancel sends nothing;
// confirm sends the accuse intent. The accusation is deliberately WRONG (or
// in-grace — indistinguishable), so the ACCUSER is fired: every page shows the
// name-only toast, the fired rectangle disappears everywhere, the fired page
// shows the banner, and the round CONTINUES (win checks are cycle 2.9).

const NAMES = ['ada', 'bruno', 'caro', 'dina'] as const

async function join(page: Page, code: string, name: string) {
  await page.goto('/')
  await page.fill('#join-code', code)
  await page.fill('#join-name', name)
  await page.click('#join-submit')
}

async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto('/')
  await page.fill('#join-name', name)
  await page.click('#create-button')
  await page.waitForSelector('#lobby-view')
  const heading = await page.textContent('#lobby-view h2')
  const code = heading?.match(/room ([A-Z]{4})/)?.[1]
  if (code === undefined) throw new Error(`no room code in lobby heading: ${heading}`)
  return code
}

interface TurnoverHandle {
  events: { type: string; payload?: Record<string, unknown> }[]
  local: { playerId: string | null; roomId: string | null }
  scene: (name: string) => {
    children: { list: { type: string; text?: string; visible: boolean }[] }
  } | null
}

async function turnover(page: Page): Promise<TurnoverHandle> {
  return page.evaluate(() => (window as unknown as { __TURNOVER__: TurnoverHandle }).__TURNOVER__)
}

async function roleOf(page: Page): Promise<string> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __TURNOVER__: TurnoverHandle }).__TURNOVER__.events.some(
        (e) => e.type === 'role:dealt',
      ),
    undefined,
    { timeout: 5000 },
  )
  const t = await turnover(page)
  const event = t.events.find((e) => e.type === 'role:dealt')
  const role = (event?.payload as { role?: string } | undefined)?.role
  if (role === undefined) throw new Error('role:dealt payload missing')
  return role
}

/**
 * Burst-walk the own player into the accuse band — a half-tile east of the
 * spawn row's east slots (12.0 / 10.5, one vacated by the accuser's own walk,
 * so a candidate stands within ACCUSATION_RANGE_TILES=2 whichever role dealt)
 * and clear of the 1-tile desk zone [14,16] where the hold is suppressed.
 * Short key bursts with a position read between them: standing still
 * lets the moved-event stream catch up, so lag can never hide an overshoot
 * (the 3.C single held walk drifted out of the band under parallel-worker
 * load, one level deeper: even a gated walk reads a stale event mid-stride).
 */
async function seekAccuseBand(page: Page): Promise<void> {
  const newestOwnMove = () =>
    page.evaluate(() => {
      const t = (
        window as unknown as {
          __TURNOVER__: {
            events: { type: string; at?: number; payload?: { playerId?: string; x?: number } }[]
            local: { playerId: string | null }
          }
        }
      ).__TURNOVER__
      const own = t.local.playerId
      for (let i = t.events.length - 1; i >= 0; i--) {
        const e = t.events[i]
        if (e === undefined || e.type !== 'player:moved') continue
        if (e.payload?.playerId !== own) continue
        return {
          x: typeof e.payload.x === 'number' ? e.payload.x : null,
          ageMs: typeof e.at === 'number' ? Date.now() - e.at : Number.POSITIVE_INFINITY,
        }
      }
      return null
    })
  let bandSeen = false
  for (let i = 0; i < 60; i++) {
    const move = await newestOwnMove()
    // Settled read: in band AND the newest move is ≥250 ms old (the stream
    // caught up — the true position cannot be further down the last walk).
    if (move !== null && move.ageMs >= 250 && move.x !== null && move.x >= 10.9 && move.x <= 11.5) {
      return
    }
    // Degraded read: under heavy load the stream can freeze entirely. If the
    // position was ever seen in band, proceed anyway — the menu wait after
    // the hold is the real arbiter.
    if (move !== null && move.x !== null && move.x >= 10.9 && move.x <= 11.5) bandSeen = true
    const key = move === null || move.x === null || move.x < 10.9 ? 'ArrowRight' : 'ArrowLeft'
    await page.keyboard.down(key)
    await page.waitForTimeout(60)
    await page.keyboard.up(key)
    await page.waitForTimeout(40)
  }
  if (bandSeen) return
  throw new Error('seekAccuseBand: own player never settled in x ∈ [10.9, 11.5]')
}

test.describe('client:accuse_ui', () => {
  test('tap E calls, hold E accuses, the accuser is fired name-only, the round continues', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    const host = pages[0] as Page
    const code = await createRoom(host, 'ada')
    for (const [index, name] of ['bruno', 'caro', 'dina'].entries()) {
      await join(pages[index + 1] as Page, code, name)
    }
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)

    await host.click('#start-button')
    for (const page of pages) await page.waitForSelector('#round-hud')

    // Private roles (rule 3): each page reads its OWN deal only.
    const roles = await Promise.all(pages.map((p) => roleOf(p)))
    const accuserIndex = roles.indexOf('staff')
    const accuser = pages[accuserIndex]
    if (accuser === undefined) throw new Error('no staff dealt')
    const accuserName = NAMES[accuserIndex]
    if (accuserName === undefined) throw new Error('no accuser name')

    // --- Tap E (< 400 ms): the elevator call fires exactly as before, and no
    // menu opens (JUST-17). The landing gate (AD-022) means the call must be
    // tapped AT a landing: the accuser walks to the east landing at round
    // start — the car still parks there, before the pre-seeded tenants'
    // traffic owns it — and the landing call press BOARDS the parked car
    // (AD-025) while still announcing the call. ---
    await accuser.keyboard.down('ArrowRight')
    // Walk to the east landing position-gated on the own label: the corridor
    // crowd slows a fixed walk-sleep, and every mid-hall press is a decoy.
    await accuser.waitForFunction(
      (name) => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (n: string) => {
                children: { list: { type: string; text?: string; x: number; visible?: boolean }[] }
              } | null
            }
          }
        ).__TURNOVER__
        const label = t
          .scene('Round')
          ?.children.list.find((c) => c.type === 'Text' && c.text === name && c.visible)
        return label !== undefined && label.x >= 920
      },
      accuserName,
      { timeout: 30_000 },
    )
    await accuser.keyboard.up('ArrowRight')
    const calledBefore = await accuser.evaluate(
      () =>
        (
          window as unknown as { __TURNOVER__: { events: { type: string }[] } }
        ).__TURNOVER__.events.filter((e) => e.type === 'elevator:called').length,
    )
    await accuser.keyboard.press('e')
    // The tap fires a NEW call — at the lobby landing with the car parked
    // there, the press boards her (AD-025) and still announces.
    await accuser.waitForFunction(
      (before) =>
        (
          window as unknown as { __TURNOVER__: { events: { type: string }[] } }
        ).__TURNOVER__.events.filter((e) => e.type === 'elevator:called').length > before,
      calledBefore,
      { timeout: 5000 },
    )
    const menuHidden = await accuser.$eval('#accuse-menu', (m) => m.hasAttribute('hidden'))
    expect(menuHidden).toBe(true)

    // --- Back on the floor near the other players: step out of the car she
    // just boarded (the exit intent applies at the open doors — AD-026),
    // then walk home to the spawn cluster west (within
    // ACCUSATION_RANGE_TILES of a candidate). ---
    await accuser.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 8000 },
    )
    await accuser.keyboard.down('ArrowLeft')
    // The rider chip hiding is the truth that she is back on the floor
    // stream; keep the hold until the walk west reads at the spawn cluster.
    await accuser.waitForFunction(
      () => document.querySelector('#elevator-riders')?.hasAttribute('hidden') === true,
      undefined,
      { timeout: 8000 },
    )
    await accuser.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              events: { type: string; payload?: { playerId?: string; x?: number } }[]
              local: { playerId: string | null }
            }
          }
        ).__TURNOVER__
        const own = t.local.playerId
        for (let i = t.events.length - 1; i >= 0; i--) {
          const e = t.events[i]
          if (e === undefined || e.type !== 'player:moved') continue
          if (e.payload?.playerId !== own) continue
          return typeof e.payload.x === 'number' && (e.payload.x ?? 0) <= 12.8
        }
        return false
      },
      undefined,
      { timeout: 15_000 },
    )
    await accuser.keyboard.up('ArrowLeft')
    await seekAccuseBand(accuser)

    // --- Hold E (≥ 400 ms): the confirm menu opens naming a nearby player —
    // never the accuser themselves (JUST-16). Drift can leave the accuser a
    // hair out of range: if the menu doesn't show, re-seek and hold again. ---
    let menuShown = false
    for (let attempt = 0; attempt < 4 && !menuShown; attempt++) {
      if (attempt > 0) await seekAccuseBand(accuser)
      await accuser.keyboard.down('e')
      try {
        await accuser.waitForFunction(
          () => {
            const menu = document.querySelector('#accuse-menu')
            return menu !== null && !menu.hasAttribute('hidden')
          },
          undefined,
          // Interval polling: a stalled rAF can sleep through the menu window.
          { polling: 100, timeout: 4000 },
        )
        menuShown = true
      } catch {
        await accuser.keyboard.up('e')
      }
    }
    if (!menuShown) throw new Error('accuse menu never opened after re-seeks')
    const menuText = (await accuser.$eval('#accuse-menu-text', (m) => m.textContent)) ?? ''
    expect(menuText).toMatch(/^accuse .+\?$/)
    expect(menuText).not.toContain(accuserName)

    // --- Cancel: the menu closes and NO accuse intent is sent (JUST-18). ---
    await accuser.click('#accuse-cancel')
    await accuser.waitForFunction(
      () => document.querySelector('#accuse-menu')?.hasAttribute('hidden') === true,
    )
    await accuser.keyboard.up('e') // release: a real player re-presses for the confirm hold
    await accuser.waitForTimeout(1000) // a stray intent would have fired by now
    const afterCancel = await turnover(accuser)
    expect(afterCancel.events.some((e) => e.type === 'player:fired')).toBe(false)

    // --- Confirm: the accuse intent resolves. The target is innocent or the
    // in-grace saboteur — either way the ACCUSER is fired, and every page
    // sees exactly one name-only toast (FR-18: no reason, no validity). ---
    await accuser.keyboard.down('e')
    await accuser.waitForFunction(
      () => {
        const menu = document.querySelector('#accuse-menu')
        return menu !== null && !menu.hasAttribute('hidden')
      },
      undefined,
      { timeout: 5000 },
    )
    await accuser.click('#accuse-confirm')
    for (const page of pages) {
      await page.waitForFunction(
        (expected: string) => {
          const toasts = [...document.querySelectorAll('.accuse-toast')]
          return toasts.some((t) => t.textContent === `${expected} was fired`)
        },
        accuserName,
        { timeout: 8000 },
      )
    }
    const toastAudit = await accuser.evaluate(() => {
      const t = (window as unknown as { __TURNOVER__: TurnoverHandle }).__TURNOVER__
      const fired = t.events.filter((e) => e.type === 'player:fired')
      return fired.map((e) => Object.keys(e.payload ?? {}).sort())
    })
    expect(toastAudit).toHaveLength(1)
    expect(toastAudit[0]).toEqual(['playerId'])

    // --- The fired page: banner up, intents gated, rectangle gone. ---
    // The fire rides a server broadcast — wait for it rather than reading the
    // banner once (an immediate read races the wire under load).
    await accuser.waitForFunction(
      () => document.querySelector('#fired-banner')?.hasAttribute('hidden') === false,
      undefined,
      { timeout: 15000 },
    )

    for (const page of pages) {
      await page.waitForFunction(
        (expected: string) => {
          const t = (window as unknown as { __TURNOVER__: TurnoverHandle }).__TURNOVER__
          const scene = t.scene('Round')
          if (scene === null) return true
          // The fired rectangle + label are DESTROYED — not merely hidden.
          return !scene.children.list.some((c) => c.type === 'Text' && c.text === expected)
        },
        accuserName,
        { timeout: 5000 },
      )
    }

    // --- The round continues: no results screen, HUD intact (cycle 2.9 scope),
    // and the three survivors still render their labels somewhere. ---
    expect(await accuser.$('#round-hud')).not.toBeNull()
    const alivePages = await Promise.all(
      pages.map((p) =>
        p.evaluate(() => {
          const t = (window as unknown as { __TURNOVER__: TurnoverHandle }).__TURNOVER__
          const scene = t.scene('Round')
          if (scene === null) return 0
          return scene.children.list.filter((c) => c.type === 'Text').length
        }),
      ),
    )
    expect(alivePages).toContain(3)

    await Promise.all(pages.map((p) => p.context().close()))
  })
})
