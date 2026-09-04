import { expect, type Page, test } from '@playwright/test'

// Gate scenario client:art_environment (Phase 4.2, ENV-01/02/05/07/08/09):
// the corridor wall is authored sheets, not code-drawn Graphics — wall-field
// TileSprite across y48..350, layout-derived sconce beats per floor, door
// pediment keys intact, no deco-* fills, spectator lanes untouched.
//
// Reads map to primitives inside evaluate: live Phaser objects do not survive
// structured-clone with all accessors intact, so every asserted field is
// projected in-page (the corridorDepth precedent).

type SconceRead = { name: string; x: number; y: number; visible: boolean; textureKey: string }
type DoorRead = { name: string; x: number; textureKey: string }

async function readScene(page: Page): Promise<{
  walls: { x: number; y: number; width: number; height: number; visible: boolean }[]
  sconces: SconceRead[]
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
      sconces: list
        .filter((c) => c.type === 'Image' && c.name.startsWith('sconce:'))
        .map((c) => ({
          name: c.name,
          x: Math.round(c.x),
          y: Math.round(c.y),
          visible: c.visible,
          textureKey: c.texture?.key ?? '',
        })),
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

const sconcesOf = (sconces: SconceRead[], floor: string): SconceRead[] =>
  sconces.filter((c) => c.name.startsWith(`sconce:${floor}:`))

const sortedXs = (sconces: SconceRead[]): number[] => sconces.map((s) => s.x).sort((a, b) => a - b)

test.describe('client:art_environment', () => {
  test('authored wall + layout-derived sconces, no code-drawn fills (ENV-01/02/05/07/08/09)', async ({
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

    // ENV-05/07: guest-floor sconce set = 7 room beats + east landing + west
    // mouth. Room beats sit exactly on the door xs (layout-derivation made
    // observable: sconceXs reads roomCenterPx, never room state).
    const doors1 = first.doors.filter((d) => d.name.startsWith('door:floor1:'))
    expect(doors1).toHaveLength(7)
    const doorXs = new Set(doors1.map((d) => d.x))
    const sconces1 = sconcesOf(first.sconces, 'floor1')
    expect(sconces1).toHaveLength(9)
    expect(sconces1.every((s) => s.textureKey === 'sconce')).toBe(true)
    expect(first.landingDoorX).not.toBeNull()
    // West mouth beat keeps its 48px pool on-canvas (design D-3: x=24).
    const rest = sconces1.map((s) => s.x).filter((x) => x !== first.landingDoorX && x !== 24)
    expect(new Set(rest)).toEqual(doorXs)
    // Spawn view is the lobby: guest-floor sconces exist but stay hidden.
    expect(sconces1.every((s) => s.visible === false)).toBe(true)
    // Lobby beat: west mouth + desk + east landing, live-visible.
    const lobbySconces = sconcesOf(first.sconces, 'lobby')
    expect(lobbySconces).toHaveLength(3)
    expect(lobbySconces.every((s) => s.visible === true)).toBe(true)
    expect(lobbySconces.every((s) => s.y === 336)).toBe(true)

    // ENV-08/09: pediment keys render (21 doors, all closed at spawn — no
    // cues, nobody inside), spectator lanes keep the plain backdrop (no
    // wall/sconce textures mount per lane: exactly one wall tile total).
    expect(first.doors).toHaveLength(21)
    expect(first.doors.every((d) => d.textureKey === 'door-closed')).toBe(true)

    // Stability: 5s of ambient guest flow moves nothing architectural.
    await own.waitForTimeout(5000)
    const second = await readScene(own)
    expect(sortedXs(sconcesOf(second.sconces, 'floor1'))).toEqual(
      sortedXs(sconcesOf(first.sconces, 'floor1')),
    )
    expect(sortedXs(sconcesOf(second.sconces, 'lobby'))).toEqual(
      sortedXs(sconcesOf(first.sconces, 'lobby')),
    )
    for (const page of pages) await page.close()
  })
})
