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

test.describe('client:accuse_ui', () => {
  test('tap E calls, hold E accuses, the accuser is fired name-only, the round continues', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
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
    const accuserIndex = roles.findIndex((r) => r === 'staff')
    const accuser = pages[accuserIndex]
    if (accuser === undefined) throw new Error('no staff dealt')
    const accuserName = NAMES[accuserIndex]
    if (accuserName === undefined) throw new Error('no accuser name')

    // --- Tap E (< 400 ms): the elevator call fires exactly as before, and no
    // menu opens (JUST-17). ---
    await accuser.keyboard.press('e')
    await accuser.waitForFunction(
      () =>
        (window as unknown as { __TURNOVER__: TurnoverHandle }).__TURNOVER__.events.some(
          (e) => e.type === 'elevator:called',
        ),
      undefined,
      { timeout: 5000 },
    )
    const menuHidden = await accuser.$eval('#accuse-menu', (m) => m.hasAttribute('hidden'))
    expect(menuHidden).toBe(true)

    // --- Hold E (≥ 400 ms): the confirm menu opens naming a nearby player —
    // never the accuser themselves (JUST-16). ---
    await accuser.keyboard.down('e')
    await accuser.waitForFunction(
      () => {
        const menu = document.querySelector('#accuse-menu')
        return menu !== null && !menu.hasAttribute('hidden')
      },
      undefined,
      { timeout: 5000 },
    )
    const menuText = (await accuser.$eval('#accuse-menu-text', (m) => m.textContent)) ?? ''
    expect(menuText).toMatch(/^accuse .+\?$/)
    expect(menuText).not.toContain(accuserName)

    // --- Cancel: the menu closes and NO accuse intent is sent (JUST-18). ---
    await accuser.click('#accuse-cancel')
    await accuser.waitForFunction(
      () => document.querySelector('#accuse-menu')?.hasAttribute('hidden') === true,
    )
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
    const banner = await accuser.$eval('#fired-banner', (b) => !b.hasAttribute('hidden'))
    expect(banner).toBe(true)

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
          return t.scene('Round').children.list.filter((c) => c.type === 'Text').length
        }),
      ),
    )
    expect(alivePages).toContain(3)

    await Promise.all(pages.map((p) => p.context().close()))
  })
})
