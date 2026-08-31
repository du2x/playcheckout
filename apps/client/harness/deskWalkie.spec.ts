import { expect, type Page, test } from '@playwright/test'

// Spec DESK-11/12/13 (gate scenario client:desk_walkie, cycle 3.2): the desk
// flow end-to-end against the real server — the receive hint and menu at the
// desk, the two-step send with a LYING announce, the named walkie line on
// every page, and the guest's observable walk as the only destination truth.
// Guest timing rides the AD-028 test seam (scale 0.1 in playwright.config).

async function join(page: Page, code: string, name: string): Promise<void> {
  await page.goto('/')
  await page.fill('#join-code', code)
  await page.fill('#join-name', name)
  await page.click('#join-submit')
}

async function fourPlayerRound(pages: Page[]): Promise<void> {
  const host = pages[0] as Page
  await host.goto('/')
  await host.fill('#join-name', 'ada')
  await host.click('#create-button')
  await host.waitForSelector('#lobby-view')
  const heading = await host.textContent('#lobby-view h2')
  const code = heading?.match(/room ([A-Z]{4})/)?.[1]
  if (code === undefined) throw new Error(`no room code in lobby heading: ${heading}`)
  for (const [index, name] of ['bruno', 'caro', 'dina'].entries()) {
    await join(pages[index + 1] as Page, code, name)
  }
  await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)
  await host.click('#start-button')
  for (const page of pages) {
    await page.waitForSelector('#round-hud', { timeout: 5000 })
  }
}

test.describe('client:desk_walkie', () => {
  test('receive at the desk, send with a lying announce, the walkie line names the claim on all pages', async ({
    browser,
  }) => {
    test.setTimeout(90000)
    const pages = await Promise.all(
      [0, 1, 2, 3].map(async () => await (await browser.newContext()).newPage()),
    )
    try {
      await fourPlayerRound(pages)
      const own = pages[0] as Page

      // DESK-11: a guest queues (scaled cadence ≈ 2.4s), the desk hint shows
      // at the desk — the host spawns at the lobby center = the desk zone.
      await own.waitForFunction(() => {
        const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } })
          .__TURNOVER__
        return t.events.some((e) => e.type === 'guest:arrived')
      })
      await own.waitForFunction(
        () =>
          (document.querySelector('#desk-hint') as HTMLElement | null)?.style.visibility ===
          'visible',
      )

      // Receive: E opens the two-step send menu.
      await own.keyboard.down('e')
      await own.waitForSelector('#desk-menu', { state: 'visible' })
      await own.keyboard.up('e')
      await own.waitForFunction(
        () =>
          document.querySelector('#desk-menu-title')?.textContent ===
          'send the guest to which room?',
      )

      // The lie: destination floor2:4, announced floor1:8 (DESK-13's
      // two-choice surface; nothing validates the pair).
      await own.click('#desk-menu-rooms button:has-text("floor2:4")')
      await own.waitForFunction(
        () =>
          document.querySelector('#desk-menu-title')?.textContent ===
          'announce which room on the walkie?',
      )
      await own.click('#desk-menu-rooms button:has-text("floor1:8")')

      // The send completes: own guest:routed closes the menu, and every page
      // renders the named walkie line with the CLAIMED room (DESK-12).
      await own.waitForFunction(() => {
        const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } })
          .__TURNOVER__
        return t.events.some((e) => e.type === 'guest:routed')
      })
      await own.waitForSelector('#desk-menu', { state: 'hidden' })
      for (const page of pages) {
        await page.waitForFunction(() =>
          (document.querySelector('#walkie-log')?.textContent ?? '').includes(
            '«ada»: guest going to floor1:8',
          ),
        )
      }

      // Leak rule (DESK-13): between the send and the settle, no client
      // surface names the destination — only the walkie claim text exists.
      const bodyHasDestination = await own.evaluate(() =>
        (document.body.innerText ?? '').includes('floor2:4'),
      )
      expect(bodyHasDestination).toBe(false)

      // Ground truth: the guest's observable walk ends at floor2:4's door.
      await own.waitForFunction(() => {
        const t = (
          window as unknown as {
            __TURNOVER__: { events: { type: string; payload: Record<string, unknown> }[] }
          }
        ).__TURNOVER__
        return t.events.some(
          (e) => e.type === 'guest:settled' && e.payload.floor === 'floor2' && e.payload.room === 4,
        )
      })
      // And the claim itself never carried the destination (payload-level).
      const claims = await own.evaluate(() => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              events: {
                type: string
                payload: Record<string, unknown>
              }[]
            }
          }
        ).__TURNOVER__
        return t.events
          .filter((e) => e.type === 'walkie:broadcast')
          .map((e) => JSON.stringify(e.payload))
      })
      expect(claims.length).toBeGreaterThan(0)
      for (const claim of claims) {
        expect(claim).not.toContain('floor2')
        expect(claim).toContain('"floor":"floor1"')
        expect(claim).toContain('"room":8')
      }
    } finally {
      for (const page of pages) await page.close()
    }
  })
})
