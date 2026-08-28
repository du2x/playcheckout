import { expect, type Page, test } from '@playwright/test'

// Spec LIGHT-09..12 (gate scenario client:round_start): rectangles with roster
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
  test('renders four labeled rectangles with a counting-down clock (LIGHT-09, LIGHT-10)', async ({
    browser,
  }) => {
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
                children: { list: { type: string; text?: string }[] }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        if (scene === null) return null
        return {
          rectangles: scene.children.list.filter((c) => c.type === 'Rectangle').length,
          labels: scene.children.list.filter((c) => c.type === 'Text').map((c) => c.text),
        }
      })
      expect(world).not.toBeNull()
      expect(world?.rectangles).toBe(4)
      expect(world?.labels).toEqual(['ada', 'bruno', 'caro', 'dina'])

      const clockStart = await page.textContent('#clock')
      expect(clockStart).toBe('05:00')
    }

    // LIGHT-10: decreases by ~1 s per wall-clock second. Wait for the clock to
    // ENTER 04:59 (its display window is exactly 1 s wide), then sample again
    // one second later — deterministic regardless of mount latency.
    await pages[0]?.waitForFunction(
      () => document.querySelector('#clock')?.textContent === '04:59',
      undefined,
      { timeout: 5000 },
    )
    await pages[0]?.waitForTimeout(1000)
    const clockLater = await pages[0]?.textContent('#clock')
    expect(clockLater).toBe('04:58')

    await Promise.all(pages.map((p) => p.context().close()))
  })

  test('each page sees only its own role, and exactly one saboteur exists (LIGHT-11)', async ({
    browser,
  }) => {
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

  // Spec LIGHT-13..14: the server runs the 8 s test shift (AD-004 seam), so a
  // real round:buzzer arrives shortly after the start — the client must return
  // to the lobby and support a fresh re-deal.
  test('buzzer returns all pages to the lobby; re-start deals fresh (LIGHT-13, LIGHT-14)', async ({
    browser,
  }) => {
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    await fourPlayerRound(pages)

    // Buzzer at ~8 s (dom clock still counts a 300 s display shift — accepted,
    // AD-004 trade-off): every page lands back in the lobby view.
    for (const page of pages) {
      await page.waitForSelector('#lobby-view', { timeout: 15000 })
      expect(await page.$('#round-hud')).toBeNull()
      expect(await page.$('#role-card')).toBeNull()
    }

    // Host re-deals: fresh round view, clock reset, new own-role deal.
    await pages[0]?.click('#start-button')
    for (const page of pages) {
      await page.waitForSelector('#round-hud', { timeout: 5000 })
      expect(await page.textContent('#clock')).toBe('05:00')
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
