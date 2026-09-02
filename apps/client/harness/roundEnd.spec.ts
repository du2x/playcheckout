import { expect, type Page, test } from '@playwright/test'

// Spec REND-03/06..11 (gate scenario client:round_end, cycle 2.9): a short
// round with zero preps runs to the buzzer — the coverage check fails and the
// SABOTEUR wins. Every page shows the winner banner, names the saboteur by
// roster name (FR-21), and renders the recap timeline (FR-22) — here with at
// least one ride entry from the host's choreographed elevator trip. The
// host's start control (results is lobby-like) begins a fresh round.
//
// Choreography: ada rides the west car to floor1 pre-round (AD-011: elevators
// run from room creation), so the recap carries a real ride leg.

const NAMES = ['ada', 'bruno', 'caro', 'dina'] as const

/** AD-028: guests are elevator citizens, so the car a player means to board
 * may be away on ambient traffic. The landing press BOARDS when the car
 * stands here (AD-025) and summons/pins otherwise — keep pressing until the
 * rider chip shows, exactly what a real player does. */
async function pressUntilRiderChip(page: Page, attempts = 15): Promise<void> {
  const chipShown = () =>
    page.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 2000 },
    )
  for (let i = 0; i < attempts; i++) {
    await page.keyboard.press('ArrowUp')
    try {
      await chipShown()
      return
    } catch {
      // The summoned car is still en route — press again when it arrives.
    }
  }
  await chipShown()
}

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

test.describe('client:round_end', () => {
  test('buzzer with zero preps: saboteur banner, traitor reveal, recap, next start', async ({
    browser,
  }) => {
    test.setTimeout(170_000) // the 60 s test shift (AD-004 seam at 3.C) plus choreography
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

    // Ride west to floor1 DURING the round: walk to the landing and board the
    // parked car with the call press (AD-025) — one real ride leg for the
    // recap (rides are journaled while a round is active — cycle 2.9 scope).
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowRight')
    await pressUntilRiderChip(host)
    await host.keyboard.press('1')
    await host.waitForFunction(
      () => document.querySelector('#panel-floor')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )
    // Exit through the open doors and park on floor1.
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(600)
    await host.keyboard.up('ArrowRight')

    // Zero preps → at the buzzer the coverage check fails: saboteur win.
    for (const page of pages) {
      await page.waitForSelector('#results-view', { timeout: 90_000 })
      await expect(page.locator('#results-banner')).toHaveText('SABOTEUR WINS')
    }
    // The traitor reveal names a roster player on every page (FR-21).
    for (const page of pages) {
      const traitor = await page.textContent('#results-traitor')
      expect(traitor).toMatch(new RegExp(`^The saboteur was (${NAMES.join('|')})$`))
    }
    // The recap timeline renders and carries the choreographed ride (FR-22).
    await host.waitForSelector('#recap-list li.recap-ride')
    const rideText = await host.textContent('#recap-list li.recap-ride')
    expect(rideText).toContain('ada')

    // Results is lobby-like: the host's start control begins the next round.
    await host.click('#start-button')
    for (const page of pages) await page.waitForSelector('#round-hud', { timeout: 10_000 })
  })
})
