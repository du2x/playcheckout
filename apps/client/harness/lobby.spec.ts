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
    expect(error).toMatch(/not found/i)
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

  test('a 1-character name is the accepted minimum (LIGHT-04 fold)', async ({ browser }) => {
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')

    const guest = await browser.newContext().then((c) => c.newPage())
    await join(guest, code, 'b')
    await guest.waitForSelector('#roster li')
    const roster = await guest.$$eval('#roster li', (items) => items.map((li) => li.textContent))
    // Guest view: plain names — the host marker is self-only (LIGHT-01).
    expect(roster).toEqual(['ada', 'b'])

    await guest.context().close()
    await host.context().close()
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

  test('the 7th join attempt surfaces the room-full rejection (edge case)', async ({ browser }) => {
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'p1')
    const guests = []
    for (let i = 2; i <= 6; i++) {
      const page = await browser.newContext().then((c) => c.newPage())
      await join(page, code, `p${i}`)
      guests.push(page)
    }
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 6)

    const seventh = await browser.newContext().then((c) => c.newPage())
    await join(seventh, code, 'p7')
    await seventh.waitForSelector('#join-error:not([hidden])')
    expect(await seventh.textContent('#join-error')).toMatch(/room full/i)
    expect(await seventh.$('#lobby-view')).toBeNull()

    await seventh.context().close()
    for (const page of guests) await page.context().close()
    await host.context().close()
  })

  // Spec LIGHT-05..08 (gate scenario client:lobby_join, lobby story):
  // roster updates without reload, host-only start control, start rejection.
  test.describe('client:lobby_join — lobby view and host start', () => {
    test('start control is visible only on the host page (LIGHT-06)', async ({ browser }) => {
      const host = await browser.newContext().then((c) => c.newPage())
      const code = await createRoom(host, 'ada')
      const guest = await browser.newContext().then((c) => c.newPage())
      await join(guest, code, 'bruno')
      await guest.waitForSelector('#lobby-view')

      expect(await host.isVisible('#start-button')).toBe(true)
      expect(await guest.isVisible('#start-button')).toBe(false)

      await guest.context().close()
      await host.context().close()
    })

    test('rosters update on every page as players join and leave (LIGHT-05)', async ({
      browser,
    }) => {
      const host = await browser.newContext().then((c) => c.newPage())
      const code = await createRoom(host, 'ada')
      const guest = await browser.newContext().then((c) => c.newPage())
      await join(guest, code, 'bruno')
      await guest.waitForSelector('#lobby-view')

      const third = await browser.newContext().then((c) => c.newPage())
      await join(third, code, 'caro')
      await host.waitForFunction(
        () => document.querySelectorAll('#roster li').length === 3,
        undefined,
        { timeout: 5000 },
      )
      const names = await host.$$eval('#roster li', (items) => items.map((li) => li.textContent))
      expect(names).toEqual(['ada (host)', 'bruno', 'caro'])

      // Leave without reload: remaining rosters shrink everywhere (edge case).
      await third.close()
      await host.waitForFunction(
        () => document.querySelectorAll('#roster li').length === 2,
        undefined,
        { timeout: 5000 },
      )
      await guest.waitForFunction(
        () => document.querySelectorAll('#roster li').length === 2,
        undefined,
        { timeout: 5000 },
      )

      await guest.context().close()
      await host.context().close()
    })

    test('starting with only 3 players shows the rejection and stays in lobby (LIGHT-08)', async ({
      browser,
    }) => {
      const host = await browser.newContext().then((c) => c.newPage())
      const code = await createRoom(host, 'ada')
      const guest = await browser.newContext().then((c) => c.newPage())
      await join(guest, code, 'bruno')
      const third = await browser.newContext().then((c) => c.newPage())
      await join(third, code, 'caro')
      await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 3)

      await host.click('#start-button')
      await host.waitForSelector('#lobby-error:not([hidden])')
      expect(await host.textContent('#lobby-error')).toMatch(/need at least 4/i)
      expect(await host.isVisible('#lobby-view')).toBe(true)
      expect(await guest.isVisible('#lobby-view')).toBe(true)
      expect(await third.isVisible('#lobby-view')).toBe(true)

      await third.context().close()
      await guest.context().close()
      await host.context().close()
    })

    test('with 4 players the host starts and all pages enter the round view (LIGHT-07 smoke)', async ({
      browser,
    }) => {
      const host = await browser.newContext().then((c) => c.newPage())
      const code = await createRoom(host, 'ada')
      const pages = [host]
      for (const name of ['bruno', 'caro', 'dina']) {
        const p = await browser.newContext().then((c) => c.newPage())
        await join(p, code, name)
        pages.push(p)
      }
      await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)

      await host.click('#start-button')
      for (const page of pages) {
        await page.waitForSelector('#round-hud', { timeout: 5000 })
      }

      for (const page of pages.slice(1).reverse()) await page.context().close()
      await host.context().close()
    })
  })
})
