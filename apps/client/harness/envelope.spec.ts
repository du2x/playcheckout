import { expect, type Page, test } from '@playwright/test'

// Spec REG-16/REG-17 (gate scenario client:envelope_gap): a forced seq gap is
// recorded in the dev hook, the client leaves through the existing
// connection-loss path, and a fresh rejoin restarts seq tracking at 1 with a
// fresh lobby snapshot.

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

test.describe('client:envelope_gap', () => {
  test('forced gap is recorded, connection-loss fires, rejoin starts seq at 1', async ({
    browser,
  }) => {
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')

    const guest = await browser.newContext().then((c) => c.newPage())
    await join(guest, code, 'bruno')
    await guest.waitForSelector('#lobby-view')

    // Corrupt the guest's seq expectation: the next real message breaks continuity.
    await guest.evaluate(() => {
      const t = (window as unknown as { __TURNOVER__: { forceGap: () => void } }).__TURNOVER__
      t.forceGap()
    })

    // A third player joining triggers lobby snapshots to everyone — the guest's
    // next message. The guest must record the gap and leave on its own.
    const third = await browser.newContext().then((c) => c.newPage())
    await join(third, code, 'caro')

    await guest.waitForSelector('#lost-view', { timeout: 5000 })
    const gaps = await guest.evaluate(() => {
      const t = (
        window as unknown as { __TURNOVER__: { gaps: { expected: number; actual: number }[] } }
      ).__TURNOVER__
      return t.gaps
    })
    expect(gaps).toHaveLength(1)
    // forceGap shifted the expectation by exactly 1000.
    expect(gaps[0]?.expected).toBe((gaps[0]?.actual ?? 0) + 1000)
    await guest.context().close()
    await third.context().close()

    // REG-17: a fresh join restarts seq tracking with the new connection —
    // the first message of the new connection carries seq 1 and renders a
    // fresh lobby snapshot.
    const rejoined = await browser.newContext().then((c) => c.newPage())
    await join(rejoined, code, 'bruno')
    await rejoined.waitForSelector('#lobby-view')
    const firstEvent = await rejoined.evaluate(() => {
      const t = (
        window as unknown as {
          __TURNOVER__: { events: { type: string; seq: number; payload: { ownName?: string } }[] }
        }
      ).__TURNOVER__
      return t.events[0]
    })
    expect(firstEvent?.type).toBe('lobby:snapshot')
    expect(firstEvent?.seq).toBe(1)
    expect(firstEvent?.payload.ownName).toBe('bruno')

    await rejoined.context().close()
    await host.context().close()
  })
})
