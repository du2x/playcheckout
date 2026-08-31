import { expect, type Page, test } from '@playwright/test'

// Gate scenario client:art_players (cycle 2.10, ART-01..05): players render as
// staff-walk Sprites — one per player, walk cycle while moving, frame-0 idle
// when settled, flipX facing, and an identical texture/animation set for every
// player regardless of role (FR-9: no saboteur tell may exist in presentation).

interface PlayerSpriteRead {
  texture: string
  playing: boolean
  frame: number
  flipX: boolean
  visible: boolean
  timeScale: number
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

/** Read every staff-walk sprite on the page IN-PAGE (functions do not serialize). */
function readPlayerSprites(page: Page): Promise<PlayerSpriteRead[]> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: {
              list: {
                type: string
                visible: boolean
                flipX: boolean
                frame: { name: string }
                texture: { key: string }
                anims: {
                  isPlaying: boolean
                  timeScale: number
                  currentAnim?: { key?: string }
                }
              }[]
            }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    if (scene === null) return []
    return scene.children.list
      .filter((c) => c.type === 'Sprite' && c.texture?.key === 'staff-walk')
      .map((c) => ({
        texture: c.texture.key,
        playing: c.anims.isPlaying,
        frame: Number(c.frame.name),
        flipX: c.flipX,
        visible: c.visible,
        timeScale: c.anims.timeScale,
      }))
  })
}

test.describe('client:art_players', () => {
  test('players are staff-walk sprites: walk, idle, facing, one presentation for all roles (ART-01..05)', async ({
    browser,
  }) => {
    test.setTimeout(30_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    await fourPlayerRound(pages)
    const own = pages[0] as Page

    // ART-01: exactly one staff-walk sprite per player, and NO player
    // Rectangle remains (the ART children contract).
    const started = await readPlayerSprites(own)
    expect(started).toHaveLength(4)
    expect(started.every((s) => s.visible)).toBe(true)
    const rectCount = await own.evaluate(() => {
      const t = (
        window as unknown as {
          __TURNOVER__: {
            scene: (name: string) => { children: { list: { type: string }[] } } | null
          }
        }
      ).__TURNOVER__
      return (t.scene('Round')?.children.list ?? []).filter((c) => c.type === 'Rectangle').length
    })
    expect(rectCount).toBe(0)

    // ART-02: walking plays the cycle; stopping settles to frame 0 idle.
    await own.keyboard.down('ArrowRight')
    await own.waitForFunction(
      () =>
        (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: {
                  list: {
                    type: string
                    texture: { key: string }
                    anims: { isPlaying: boolean }
                  }[]
                }
              } | null
            }
          }
        ).__TURNOVER__
          .scene('Round')
          ?.children.list.some(
            (c) =>
              c.type === 'Sprite' && c.texture?.key === 'staff-walk' && c.anims.isPlaying === true,
          ) === true,
      undefined,
      { timeout: 5000 },
    )
    const walking = await readPlayerSprites(own)
    expect(walking[0]).toBeDefined()
    expect(walking[0]?.playing).toBe(true)
    await own.keyboard.up('ArrowRight')
    await own.waitForTimeout(400)
    const idle = await readPlayerSprites(own)
    expect(idle[0]?.playing).toBe(false)
    expect(idle[0]?.frame).toBe(0)

    // ART-02 facing: right-facing sheet, left = flipX.
    await own.keyboard.down('ArrowLeft')
    await own.waitForTimeout(300)
    const left = await readPlayerSprites(own)
    expect(left[0]?.flipX).toBe(true)
    await own.keyboard.up('ArrowLeft')

    // ART-03/FR-9: identical presentation for every player — same texture,
    // same walk cycle availability, and identical animation timing (no
    // per-role timeScale offset anywhere in the sprite set).
    const all = await readPlayerSprites(own)
    expect(all).toHaveLength(4)
    expect(new Set(all.map((s) => s.texture))).toEqual(new Set(['staff-walk']))
    expect(new Set(all.map((s) => s.timeScale))).toEqual(new Set([1]))
  })
})
