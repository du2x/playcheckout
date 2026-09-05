import { expect, type Page, test } from '@playwright/test'

// Spec LIGHT-09..12 (gate scenario client:round_start): player sprites with roster
// labels, client-side countdown, own role card only. Buzzer coverage joins in
// the round.spec extension once the 5 s test shift is wired (T6).

async function join(page: Page, code: string, name: string) {
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

test.describe('client:round_start', () => {
  test('renders four labeled player sprites with a counting-down clock (LIGHT-09, LIGHT-10)', async ({
    browser,
  }) => {
    test.setTimeout(90_000) // 4-page setup + round start can exceed 30 s under load
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    await fourPlayerRound(pages)

    for (const page of pages) {
      const world = await page.evaluate(() => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: { list: { type: string; text?: string; texture?: { key?: string } }[] }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        if (scene === null) return null
        return {
          // ART contract (cycle 2.10): players are staff-walk Sprites.
          players: scene.children.list.filter(
            (c) => c.type === 'Sprite' && c.texture?.key === 'staff-walk',
          ).length,
          labels: scene.children.list.filter((c) => c.type === 'Text').map((c) => c.text),
        }
      })
      expect(world).not.toBeNull()
      expect(world?.players).toBe(4)
      expect(world?.labels).toEqual(['ada', 'bruno', 'caro', 'dina'])

      const clockStart = await page.textContent('#clock')
      // The first displayed second may already have ticked under worker load
      // (250 ms interval); the countdown CONTRACT is pinned by the decrease
      // assertion below — the entry window admits 05:00..04:58.
      expect(clockStart).toMatch(/^05:00|04:5[89]$/)
    }

    // LIGHT-10: decreases by ~1 s per wall-clock second. The first sample may
    // land on any of 05:00..04:58 under load, so gate on reaching a fixed
    // later mark (04:57) instead of re-assuming the entry value, then sample
    // one second later — deterministic regardless of mount latency.
    await pages[0]?.waitForFunction(
      () => document.querySelector('#clock')?.textContent === '04:57',
      undefined,
      { timeout: 10000 },
    )
    await pages[0]?.waitForTimeout(1000)
    const clockLater = await pages[0]?.textContent('#clock')
    expect(clockLater).toBe('04:56')

    await Promise.all(pages.map((p) => p.context().close()))
  })

  test('each page sees only its own role, and exactly one saboteur exists (LIGHT-11)', async ({
    browser,
  }) => {
    test.setTimeout(90_000) // 4-page setup under parallel workers exceeds 30 s
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    await fourPlayerRound(pages)

    let saboteurs = 0
    for (const page of pages) {
      const { roleCard, dealtRole, eventCount } = await page.evaluate(() => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              events: { type: string; payload: { type?: string; role?: string } }[]
            }
          }
        ).__TURNOVER__
        const dealt = t.events.filter((e) => e.type === 'role:dealt')
        return {
          roleCard: document.querySelector('#role-card')?.textContent ?? null,
          dealtRole: dealt[0]?.payload.role ?? null,
          // exactly one private deal event arrives per page — never others'
          eventCount: dealt.length,
        }
      })
      expect(eventCount).toBe(1)
      expect(dealtRole).toMatch(/^staff$|^saboteur$/)
      // The rendered card equals the page's own private payload — nothing else.
      expect(roleCard).toBe(dealtRole)
      if (dealtRole === 'saboteur') saboteurs++
    }
    expect(saboteurs).toBe(1)

    await Promise.all(pages.map((p) => p.context().close()))
  })

  // Spec LIGHT-13..14: the server runs the 30 s test shift (AD-004 seam,
  // widened in cycle 2.5 for the work-channel choreography), so a real
  // round:buzzer arrives after the start — the client must return to the lobby
  // and support a fresh re-deal.
  test('buzzer returns all pages to the lobby; re-start deals fresh (LIGHT-13, LIGHT-14)', async ({
    browser,
  }) => {
    test.setTimeout(100_000) // the test shift (60 s, AD-004 seam at 3.C) plus the re-deal
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    await fourPlayerRound(pages)

    // Buzzer (cycle 2.9): every page lands in the RESULTS view — zero preps
    // means the coverage check fails and the saboteur wins with a traitor
    // reveal (FR-21). The round HUD is gone with the round.
    for (const page of pages) {
      await page.waitForSelector('#results-view', { timeout: 90_000 })
      expect(await page.$('#round-hud')).toBeNull()
      expect(await page.textContent('#results-banner')).toBe('SABOTEUR WINS')
      expect(await page.textContent('#results-traitor')).toMatch(/^The saboteur was /)
    }

    // Host re-deals from results: fresh round view, clock reset, new deal.
    // The read can land one tick into the fresh shift, so accept 05:00 or
    // 04:59 — the reset (not the exact string) is the assertion.
    await pages[0]?.click('#start-button')
    for (const page of pages) {
      await page.waitForSelector('#round-hud', { timeout: 10_000 })
      // The reset (not the exact string) is the assertion: the fresh shift's
      // clock read can land anywhere in the first two displayed minutes.
      expect(await page.textContent('#clock')).toMatch(/^0[45]:[0-5][0-9]$/)
    }
    let secondSaboteurs = 0
    for (const page of pages) {
      const role = await page.textContent('#role-card')
      if (role === 'saboteur') secondSaboteurs++
      expect(role).toMatch(/^staff$|^saboteur$/)
    }
    expect(secondSaboteurs).toBe(1)

    await Promise.all(pages.map((p) => p.context().close()))
  })
})
