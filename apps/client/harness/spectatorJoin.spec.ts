import { expect, type Page, test } from '@playwright/test'

// Dev spectator from t=0 (server:spectator_*, client half): the join form's
// "watch (spectator)" checkbox seats the browser in the room WITHOUT a
// player slot — the round renders the full-building overview lanes and the
// wire never deals it a role. Not a production feature: the server refuses
// spectator joins under NODE_ENV=production (the harness bundle is dev-mode).
// Distinct from spectator.spec.ts, which drives the FIRED-player path into
// the same overview.

async function join(page: Page, code: string, name: string, spectator: boolean) {
  await page.goto('/')
  await page.fill('#join-code', code)
  await page.fill('#join-name', name)
  if (spectator) await page.check('#join-spectator')
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

test.describe('client:spectator_join', () => {
  test('spectator watches the round: no start control, no role card, overview lanes', async ({
    browser,
  }) => {
    test.setTimeout(100_000)
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')
    const guests: Page[] = []
    for (const name of ['bruno', 'caro', 'dina']) {
      const guest = await browser.newContext().then((c) => c.newPage())
      await join(guest, code, name, false)
      await guest.waitForSelector('#lobby-view')
      guests.push(guest)
    }
    const watcher = await browser.newContext().then((c) => c.newPage())
    await join(watcher, code, 'watcher', true)

    // Lobby: the watcher sees the roster but never the start control.
    await watcher.waitForSelector('#lobby-view')
    await watcher.waitForSelector('#roster li')
    await expect(watcher.locator('#start-button')).toBeHidden()
    const roster = await watcher.$$eval('#roster li', (items) => items.map((li) => li.textContent))
    // Plain names — the "(host)" marker renders on the SELF entry only, and
    // the watcher is nobody's host. Spectators hold no roster entry.
    expect(roster).toEqual(['ada', 'bruno', 'caro', 'dina'])

    // The round starts; the watcher's wire carries the spectator baseline and
    // the building-wide stream — never the private role card.
    await host.click('#start-button')
    for (const page of [host, watcher, ...guests]) await page.waitForSelector('#round-hud')
    const wire = await watcher.evaluate(() => {
      const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } }).__TURNOVER__
      return t.events.map((e) => e.type)
    })
    expect(wire).toContain('spectator:snapshot')
    expect(wire).toContain('round:started')
    expect(wire).not.toContain('role:dealt')

    // The overview is live in the scene (stacked lanes) and it is
    // full-building: an upstairs door lane renders from the baseline.
    const spectatorMode = await watcher.evaluate(() => {
      const scene = (
        window as unknown as {
          __TURNOVER__: { scene: (name: string) => { spectator: boolean } | null }
        }
      ).__TURNOVER__.scene('Round')
      return scene?.spectator
    })
    expect(spectatorMode).toBe(true)
    await watcher.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: { list: { name: string; visible: boolean; type: string }[] }
              } | null
            }
          }
        ).__TURNOVER__
        return (t.scene('Round')?.children.list ?? []).some(
          (c) => c.type === 'Image' && c.name === 'door:floor3:1' && c.visible,
        )
      },
      undefined,
      { timeout: 5000 },
    )

    host.close()
    for (const guest of guests) guest.close()
    watcher.close()
  })
})
