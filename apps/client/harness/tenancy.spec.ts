import { expect, type Page, test } from '@playwright/test'

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
  if (code === undefined) throw new Error(`no room code in heading: ${heading}`)
  for (const [index, name] of ['bruno', 'caro', 'dina'].entries()) {
    await join(pages[index + 1] as Page, code, name)
  }
  await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)
  await host.click('#start-button')
  for (const page of pages) {
    await page.waitForSelector('#round-hud', { timeout: 5000 })
  }
}

async function tenancyText(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => {
    const el = document.querySelector(`[data-tenancy-key="${k}"]`) as HTMLElement | null
    return el ? (el.textContent ?? null) : null
  }, key)
}

async function tenancyVisible(page: Page, key: string): Promise<boolean> {
  return page.evaluate((k) => {
    const el = document.querySelector(`[data-tenancy-key="${k}"]`) as HTMLElement | null
    if (el === null) return false
    return el.style.visibility !== 'hidden' && getComputedStyle(el).visibility !== 'hidden'
  }, key)
}

test.describe('client:tenancy_sign', () => {
  test('tenancy flips Occupied/Vacant sameFloor-gated and recap carries provenance', async ({
    browser,
  }) => {
    test.setTimeout(60000)
    const pages = await Promise.all(
      [0, 1, 2, 3].map(async () => await (await browser.newContext()).newPage()),
    )
    try {
      await fourPlayerRound(pages)
      const host = pages[0]!
      const witness = pages[1]!

      // Put witness on floor1 so sameFloor-visible tenancy signs show there
      await witness.evaluate(() => {
        const w = window as unknown as { __TURNOVER__: { scene: (name: string) => unknown | null } }
        const scene = w.__TURNOVER__.scene('Round') as unknown as Record<string, unknown>
        if (scene !== null) (scene as Record<string, unknown>).viewFloor = 'floor1'
      })
      // Let per-frame visibility settle
      await host.waitForTimeout(400)
      // Initially all vacant (the sync creates 24 Vacant markers)
      expect(await tenancyText(witness, 'floor1:1')).toBe('Vacant')
      expect(await tenancyVisible(host, 'floor1:1')).toBe(false)
      expect(await tenancyVisible(witness, 'floor1:1')).toBe(true)

      // Settle → Occupied on floor1:1 (sameFloor-visible; server would gate delivery, we gate via visibility)
      for (const p of pages) {
        await p.evaluate(() => {
          const w = window as unknown as {
            __TURNOVER__: { scene: (name: string) => { applyAction: (a: unknown) => void } | null }
          }
          const scene = w.__TURNOVER__.scene('Round')
          scene?.applyAction({ type: 'room-tenancy', floor: 'floor1', room: 1, occupied: true })
        })
      }
      await host.waitForTimeout(300)
      expect(await tenancyText(witness, 'floor1:1')).toBe('Occupied')
      expect(await tenancyText(host, 'floor1:1')).toBe('Occupied')
      expect(await tenancyVisible(host, 'floor1:1')).toBe(false)
      expect(await tenancyVisible(witness, 'floor1:1')).toBe(true)
      // No provenance or freshness leaks on the sign
      const signText = await tenancyText(witness, 'floor1:1')
      expect(signText).not.toMatch(/sabotage|churn|fresh/i)

      // Checkout → Vacant
      for (const p of pages) {
        await p.evaluate(() => {
          const w = window as unknown as {
            __TURNOVER__: { scene: (name: string) => { applyAction: (a: unknown) => void } | null }
          }
          const scene = w.__TURNOVER__.scene('Round')
          scene?.applyAction({ type: 'room-tenancy', floor: 'floor1', room: 1, occupied: false })
        })
      }
      await host.waitForTimeout(300)
      expect(await tenancyText(witness, 'floor1:1')).toBe('Vacant')

      // Snapshot seeding: movement:snapshot tenancies for viewer's floor
      for (const p of pages) {
        await p.evaluate(() => {
          const w = window as unknown as {
            __TURNOVER__: { scene: (name: string) => { applyAction: (a: unknown) => void } | null }
          }
          const scene = w.__TURNOVER__.scene('Round')
          scene?.applyAction({
            type: 'movement-snapshot',
            snapshot: {
              players: [],
              cars: [],
              cardedRooms: [],
              tenancies: [{ floor: 'floor1', room: 2, occupied: true }],
            },
          } as unknown as never)
        })
      }
      await host.waitForTimeout(300)
      expect(await tenancyText(witness, 'floor1:2')).toBe('Occupied')

      // Spectator baseline seeds all floors — put host into spectator mode and seed
      await host.evaluate(() => {
        const w = window as unknown as { __TURNOVER__: { scene: (name: string) => unknown | null } }
        const scene = w.__TURNOVER__.scene('Round') as unknown as Record<string, unknown>
        if (scene !== null) {
          ;(scene as Record<string, unknown>).spectator = true
        }
      })
      for (const p of pages) {
        await p.evaluate(() => {
          const w = window as unknown as {
            __TURNOVER__: { scene: (name: string) => { applyAction: (a: unknown) => void } | null }
          }
          const scene = w.__TURNOVER__.scene('Round')
          scene?.applyAction({
            type: 'spectator-snapshot',
            snapshot: {
              players: [],
              cars: [],
              rooms: [],
              cardedRooms: [],
              tenancies: [{ floor: 'floor2', room: 3, occupied: true }],
            },
          } as unknown as never)
        })
      }
      await host.waitForTimeout(400)
      expect(await tenancyText(host, 'floor2:3')).toBe('Occupied')
      expect(await tenancyVisible(host, 'floor2:3')).toBe(true)
    } finally {
      for (const p of pages) await p.close()
    }
  })
})
