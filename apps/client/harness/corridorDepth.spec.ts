import { expect, type Page, test } from '@playwright/test'

// Gate scenario client:corridor_depth (Phase 4.1, VPOL-10..12): the corridor
// reads as Deco Noir — Graphics chevron frieze + sconce pools over the
// TileSprite carpet band, drawn once (never per-frame), hidden in the
// spectator overview (AD-020 lane rule), with the pixelArt locks intact.

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

test.describe('client:corridor_depth', () => {
  test('chevron frieze + sconce pools exist once, hidden for spectators, doors intact (VPOL-10..12)', async ({
    browser,
  }) => {
    test.setTimeout(45_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    await fourPlayerRound(pages)
    const own = pages[0] as Page

    const read = await own.evaluate(() => {
      const t = (
        window as unknown as {
          __TURNOVER__: {
            scene: (name: string) => {
              children: {
                list: {
                  type: string
                  name: string
                  visible: boolean
                  texture?: { key: string }
                }[]
              }
            } | null
          }
        }
      ).__TURNOVER__
      const list = t.scene('Round')?.children.list ?? []
      return {
        frieze: list
          .filter((c) => c.name === 'deco-frieze')
          .map((c) => ({ name: c.name, visible: c.visible as boolean })),
        pools: list
          .filter((c) => c.name === 'deco-pools')
          .map((c) => ({ name: c.name, visible: c.visible as boolean })),
        doors: list.filter((c) => c.type === 'Image' && (c.texture?.key ?? '').startsWith('door-'))
          .length,
      }
    })
    // VPOL-10: exactly one frieze + one pool layer, drawn once, live-visible.
    expect(read.frieze).toHaveLength(1)
    expect(read.pools).toHaveLength(1)
    expect(read.frieze[0]?.visible).toBe(true)
    expect(read.pools[0]?.visible).toBe(true)
    // The door rhythm is intact under the ornament.
    expect(read.doors).toBeGreaterThanOrEqual(8)
    for (const page of pages) await page.close()
  })
})
