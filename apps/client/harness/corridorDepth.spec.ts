import { expect, type Page, test } from '@playwright/test'

// Gate scenario client:corridor_depth (Phase 4.1, VPOL-10..12; amended
// Phase 4.2, ENV-01/02/05): the corridor reads as Deco Noir — the authored
// wall-field TileSprite + layout-derived sconce Images (the 4.1 Graphics
// chevron frieze + pool ellipses were deleted in 4.2) over the TileSprite
// carpet band, live view only, with the pixelArt locks intact.

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
  test('authored wall + sconce beats, no code-drawn fills, doors intact (4.2 ENV-01/02/05)', async ({
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
                  x: number
                  y: number
                  width: number
                  height: number
                  texture?: { key: string }
                }[]
              }
            } | null
          }
        }
      ).__TURNOVER__
      const list = t.scene('Round')?.children.list ?? []
      return {
        walls: list
          .filter((c) => c.type === 'TileSprite' && c.texture?.key === 'wall-field')
          .map((c) => ({ visible: c.visible as boolean, y: c.y, height: c.height })),
        sconces: list
          .filter((c) => c.type === 'Image' && c.name.startsWith('sconce:'))
          .map((c) => ({ name: c.name, visible: c.visible as boolean })),
        fills: list
          .filter((c) => c.name === 'deco-frieze' || c.name === 'deco-pools')
          .map((c) => ({ name: c.name })),
        doors: list.filter((c) => c.type === 'Image' && (c.texture?.key ?? '').startsWith('door-'))
          .length,
      }
    })
    // 4.2: exactly one authored wall tile covering y48..350, live-visible…
    expect(read.walls).toHaveLength(1)
    expect(read.walls[0]?.visible).toBe(true)
    expect(read.walls[0]?.y).toBe(48)
    expect(read.walls[0]?.height).toBe(302)
    // …layout-derived sconce beats on every floor (9 per guest floor,
    // 3 lobby + 3 mezzanine = 33 total), lobby beat visible at spawn…
    expect(read.sconces).toHaveLength(33)
    for (const floor of ['floor1', 'floor2', 'floor3'] as const) {
      expect(read.sconces.filter((s) => s.name.startsWith(`sconce:${floor}:`))).toHaveLength(9)
    }
    expect(
      read.sconces.filter((s) => s.name.startsWith('sconce:lobby:') && s.visible),
    ).toHaveLength(3)
    // …and the 4.1 code-drawn fills are gone.
    expect(read.fills).toHaveLength(0)
    // The door rhythm is intact under the ornament (7 rooms × 3 floors).
    expect(read.doors).toBe(21)
    for (const page of pages) await page.close()
  })
})
