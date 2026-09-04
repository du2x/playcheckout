import { expect, type Page, test } from '@playwright/test'

// Gate scenario client:breath_sprite (breath-sprites, BR-01/02/03): during
// the own arrival breath a looping fx-breath sprite floats above the own
// body; it is gone when the breath ends. The breathChip countdown keeps
// ticking throughout. Own-viewer only — other breathers render nothing new.

async function join(page: Page, code: string, name: string) {
  await page.goto('/')
  await page.fill('#join-code', code)
  await page.fill('#join-name', name)
  await page.click('#join-submit')
  await page.waitForSelector('#lobby-view')
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

/** Walk to the west wall — the stairwell mouth (x clamps at 0). */
async function walkToMouth(page: Page): Promise<void> {
  await page.keyboard.down('ArrowLeft')
  await page.waitForTimeout(4200)
  await page.keyboard.up('ArrowLeft')
  await page.waitForTimeout(200)
}

type SceneList = {
  type: string
  name?: string
  visible: boolean
  texture?: { key?: string }
}[]

async function sceneList(page: Page): Promise<SceneList> {
  return page.evaluate(() => {
    const hook = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => { children: { list: SceneList } } | null
        }
      }
    ).__TURNOVER__
    return hook.scene('Round')?.children.list ?? []
  })
}

test.describe('client:breath_sprite', () => {
  test('pant-puffs over the own body during the breath, gone after (BR-01/02/03)', async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    const host = pages[0] as Page
    const code = await createRoom(host, 'ada')
    for (const [index, name] of ['bruno', 'caro', 'dina'].entries()) {
      await join(pages[index + 1] as Page, code, name)
    }
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)

    // Pre-round stairs ride (phase-free): lobby → mezzanine, 3 s transit
    // then the 2 s breath on the destination floor.
    const bruno = pages[1] as Page
    await walkToMouth(bruno)
    await bruno.keyboard.press('ArrowUp')
    await bruno.waitForFunction(
      () => document.querySelector('.stair-screen-phase')?.textContent === 'catching breath',
      undefined,
      { timeout: 10_000 },
    )
    // BR-01: exactly one looping breath sprite, live-visible…
    await bruno.waitForFunction(
      () => {
        const hook = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => { children: { list: SceneList } } | null
            }
          }
        ).__TURNOVER__
        const list = hook.scene('Round')?.children.list ?? []
        return list.filter((c) => c.texture?.key === 'fx-breath' && c.visible).length === 1
      },
      undefined,
      { timeout: 3000 },
    )
    // …while the chip countdown ticks (BR-02).
    const clockText = await bruno.textContent('.stair-screen-clock')
    expect(clockText?.endsWith('s')).toBe(true)
    // BR-01 end: the breath expires — sprite destroyed, never lingering.
    await bruno.waitForFunction(
      () => {
        const hook = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => { children: { list: SceneList } } | null
            }
          }
        ).__TURNOVER__
        const list = hook.scene('Round')?.children.list ?? []
        return !list.some((c) => c.texture?.key === 'fx-breath')
      },
      undefined,
      { timeout: 8000 },
    )
    // BR-03: nobody else's screen gained a breath sprite — caro idled in
    // the lobby the whole ride and renders none.
    const caro = pages[2] as Page
    expect((await sceneList(caro)).some((c) => c.texture?.key === 'fx-breath')).toBe(false)
    for (const page of pages) await page.close()
  })
})
