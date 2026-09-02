import { expect, type Page, test } from '@playwright/test'

// Gate scenario client:doors_pre_round: the static door frames render on every
// guest floor from the moment the world mounts — phase-free, so pre-round
// free-roam (AD-015) shows room boundaries — and never on the grand lobby
// floor (AD-010: the lobby has no rooms). No host start is needed: the whole
// run happens before any round begins.

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

// ART contract (cycle 2.10): doors are Phaser Images named door:<floor>:<room>.
function visibleDoorRooms(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: { list: { name: string; visible: boolean; type: string }[] }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    if (scene === null) return []
    return scene.children.list
      .filter((c) => c.type === 'Image' && c.name.startsWith('door:') && c.visible)
      .map((c) => c.name.split(':')[2] as string)
  })
}

function doorImageCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: { list: { name: string; type: string }[] }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    if (scene === null) return 0
    return scene.children.list.filter((c) => c.type === 'Image' && c.name.startsWith('door:'))
      .length
  })
}

test.describe('client:doors_pre_round', () => {
  test('door frames hide in the lobby and show on a guest floor before any round starts', async ({
    browser,
  }) => {
    const page = await browser.newContext().then((c) => c.newPage())
    await createRoom(page, 'ada')

    // Lobby view: all 24 door Images exist (8 rooms × 3 guest floors, cycle
    // 2.9's per-floor lanes) but none is visible (the grand lobby floor has
    // no rooms, and the live view shows the own floor only).
    await page.waitForSelector('#round-hud', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(300)
    expect((await visibleDoorRooms(page)).length).toBe(0)
    expect(await doorImageCount(page)).toBe(24)

    // Pre-round ride west (no host start — the world is phase-free): walk to
    // the landing, board the parked car with the call press (AD-025), then
    // exit onto floor1 — the own floor stream flips the view and the frames
    // show.
    await page.keyboard.down('ArrowLeft')
    await page.waitForTimeout(3000)
    await page.keyboard.up('ArrowLeft')
    await page.keyboard.press('ArrowUp')
    await page.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 8000 },
    )
    await page.keyboard.press('1')
    await page.waitForFunction(
      () => document.querySelector('#panel-floor')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )
    // Step out of the car: hold the exit direction past the 0.5 s opening
    // swing (AD-026) — the chip hides once the exit applied and the exit
    // snapshot moves the view to floor1.
    await page.keyboard.down('ArrowRight')
    await page.waitForFunction(
      () => document.querySelector('#elevator-riders')?.hasAttribute('hidden') === true,
      undefined,
      { timeout: 8000 },
    )
    await page.waitForTimeout(300)
    await page.keyboard.up('ArrowRight')
    await page.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: { list: { name: string; visible: boolean; type: string }[] }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        if (scene === null) return false
        const floor1Doors = scene.children.list.filter(
          (c) => c.type === 'Image' && c.name.startsWith('door:floor1:'),
        )
        return floor1Doors.length === 8 && floor1Doors.every((c) => c.visible)
      },
      undefined,
      { timeout: 10_000 },
    )
    expect(await visibleDoorRooms(page)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    await page.context().close()
  })
})
