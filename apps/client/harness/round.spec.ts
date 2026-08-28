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

    // LIGHT-10: decreases by ~1 s per wall-clock second.
    await pages[0]?.waitForTimeout(1500)
    const clockLater = await pages[0]?.textContent('#clock')
    expect(clockLater).toBe('04:59')

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
})
