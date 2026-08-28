import { expect, type Page, test } from '@playwright/test'

// Spec LIGHT-01..04 + join edge cases (gate scenario client:lobby_join):
// the real server boots via the webServer hook (harness bundle, dev-mode
// __TURNOVER__ present); assertions run on the overlay DOM and the hook.

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

test.describe('client:lobby_join', () => {
  test('joining a room shows the lobby with own name and roster (LIGHT-01)', async ({
    browser,
  }) => {
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')

    const guest = await browser.newContext().then((c) => c.newPage())
    await join(guest, code, 'bruno')
    await guest.waitForSelector('#lobby-view')
    await guest.waitForSelector('#roster li')

    const identity = await guest.evaluate(() => {
      const t = (
        window as unknown as {
          __TURNOVER__: { local: { playerId: string | null; roomId: string | null } }
        }
      ).__TURNOVER__
      return t.local
    })
    expect(identity.playerId).toBeTruthy()
    expect(identity.roomId).toBe(code)

    const roster = await guest.$$eval('#roster li', (items) =>
      items.map((li) => ({ id: li.getAttribute('data-player-id'), text: li.textContent })),
    )
    expect(roster).toHaveLength(2)
    // Snapshot carries isHost for SELF only (ids + names for others), so the
    // guest sees plain names; the host page shows the marker on its own entry.
    expect(roster.map((r) => r.text)).toEqual(['ada', 'bruno'])
    expect(roster[1]?.id).toBe(identity.playerId)

    const hostRoster = await host.$$eval('#roster li', (items) => items.map((li) => li.textContent))
    expect(hostRoster).toEqual(['ada (host)', 'bruno'])

    const events = await guest.evaluate(() => {
      const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } }).__TURNOVER__
      return t.events.map((e) => e.type)
    })
    expect(events).toContain('lobby:snapshot')

    await guest.context().close()
    await host.context().close()
  })

  test('an unknown room code stays on the join screen with the server reason (LIGHT-02)', async ({
    page,
  }) => {
    await join(page, 'ZZZZ', 'ada')
    await page.waitForSelector('#join-error:not([hidden])')
    const error = await page.textContent('#join-error')
    expect(error?.length ?? 0).toBeGreaterThan(0)
    expect(await page.$('#join-view')).not.toBeNull()
    expect(await page.$('#lobby-view')).toBeNull()
  })

  test('a taken name is rejected with the server reason (LIGHT-02)', async ({ browser }) => {
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')

    const guest = await browser.newContext().then((c) => c.newPage())
    await join(guest, code, 'ada')
    await guest.waitForSelector('#join-error:not([hidden])')
    expect(await guest.textContent('#join-error')).toMatch(/name taken/i)
    expect(await guest.$('#lobby-view')).toBeNull()

    await guest.context().close()
    await host.context().close()
  })

  test('a lowercase room code joins the same room (LIGHT-03)', async ({ browser }) => {
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')

    const guest = await browser.newContext().then((c) => c.newPage())
    await join(guest, code.toLowerCase(), 'bruno')
    await guest.waitForSelector('#lobby-view')
    const roster = await guest.$$eval('#roster li', (items) => items.map((li) => li.textContent))
    expect(roster).toHaveLength(2)

    await guest.context().close()
    await host.context().close()
  })

  test('code field keeps letters only (max 4, uppercased) and name caps at 16 (LIGHT-04)', async ({
    page,
  }) => {
    await page.goto('/')
    await page.click('#join-code')
    await page.keyboard.type('ab1!xy')
    expect(await page.inputValue('#join-code')).toBe('ABXY')
    await page.click('#join-name')
    await page.keyboard.type('0123456789abcdefghij')
    expect(await page.inputValue('#join-name')).toBe('0123456789abcdef')
  })

  test('a rapid duplicate submit connects exactly once (edge case)', async ({ browser }) => {
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')

    const guest = await browser.newContext().then((c) => c.newPage())
    await guest.goto('/')
    await guest.fill('#join-code', code)
    await guest.fill('#join-name', 'bruno')
    // Two synchronous clicks: the second must hit the joining guard.
    await guest.evaluate(() => {
      const button = document.querySelector('#join-submit') as HTMLButtonElement
      button.click()
      button.click()
    })
    await guest.waitForSelector('#lobby-view')
    const roster = await guest.$$eval('#roster li', (items) => items.length)
    expect(roster).toBe(2) // host + one single guest connection, no duplicate

    await guest.context().close()
    await host.context().close()
  })
})
