import { expect, type Page, test } from '@playwright/test'

// Gate scenario client:art_environment (Phase 4.2, ENV-01/02/08/09): the
// corridor wall is authored sheets, not code-drawn Graphics — wall-field
// TileSprite across y48..350, door pediment keys intact, no deco-* fills,
// spectator lanes untouched. (ENV-05/07 sconce beats removed by user ruling
// 2026-09-04 — no candle props render anywhere.)
//
// Reads map to primitives inside evaluate: live Phaser objects do not survive
// structured-clone with all accessors intact, so every asserted field is
// projected in-page (the corridorDepth precedent).

type DoorRead = { name: string; x: number; textureKey: string }

async function readScene(page: Page): Promise<{
  walls: { x: number; y: number; width: number; height: number; visible: boolean }[]
  doors: DoorRead[]
  landingDoorX: number | null
  wallField: boolean
  wallFallbackNull: boolean
  fillNames: string[]
}> {
  return page.evaluate(() => {
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
            wallField?: unknown | null
            wallFallback?: unknown | null
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    const list = scene?.children.list ?? []
    const landing = list.find((c) => c.texture?.key === 'elevator-door')
    return {
      walls: list
        .filter((c) => c.type === 'TileSprite' && c.texture?.key === 'wall-field')
        .map((c) => ({ x: c.x, y: c.y, width: c.width, height: c.height, visible: c.visible })),
      doors: list
        .filter((c) => c.type === 'Image' && c.name.startsWith('door:'))
        .map((c) => ({ name: c.name, x: Math.round(c.x), textureKey: c.texture?.key ?? '' })),
      landingDoorX: landing === undefined ? null : Math.round(landing.x),
      wallField: scene?.wallField !== null && scene?.wallField !== undefined,
      wallFallbackNull: scene?.wallFallback === null || scene?.wallFallback === undefined,
      fillNames: list
        .filter((c) => c.name === 'deco-frieze' || c.name === 'deco-pools')
        .map((c) => c.name),
    }
  })
}

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

test.describe('client:art_environment', () => {
  test('authored wall, no code-drawn fills, no sconce props (ENV-01/02/08/09)', async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    await fourPlayerRound(pages)
    const own = pages[0] as Page

    const first = await readScene(own)
    // ENV-01: wall-field TileSprite covers y48..350, the only wall visual.
    expect(first.walls).toHaveLength(1)
    expect(first.walls[0]).toMatchObject({ x: 0, y: 48, width: 960, height: 302, visible: true })
    expect(first.wallField).toBe(true)
    // Spec edge case: the flat-fill fallback runs only when the texture is
    // missing — with the texture present no fallback object exists.
    expect(first.wallFallbackNull).toBe(true)
    // ENV-02: the 4.1 code-drawn fills are gone from the scene graph.
    expect(first.fillNames).toHaveLength(0)

    // ENV-08/09: pediment keys render (21 doors, all closed at spawn — no
    // cues, nobody inside), spectator lanes keep the plain backdrop (no
    // wall textures mount per lane: exactly one wall tile total). The
    // landing door sprite is present (no candle props anywhere — the
    // sconce set was removed by user ruling 2026-09-04).
    expect(first.landingDoorX).not.toBeNull()
    expect(first.doors).toHaveLength(21)
    expect(first.doors.every((d) => d.textureKey === 'door-closed')).toBe(true)

    // Stability: 5s of ambient guest flow moves nothing architectural.
    await own.waitForTimeout(5000)
    const second = await readScene(own)
    expect(second.doors).toEqual(first.doors)
    expect(second.walls).toEqual(first.walls)
    for (const page of pages) await page.close()
  })
})
