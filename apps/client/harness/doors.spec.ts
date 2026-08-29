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

function visibleDoorRooms(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('#doors-layer [data-door-room]')]
      .filter((el) => getComputedStyle(el as HTMLElement).visibility === 'visible')
      .map((el) => el.getAttribute('data-door-room') as string),
  )
}

test.describe('client:doors_pre_round', () => {
  test('door frames hide in the lobby and show on a guest floor before any round starts', async ({
    browser,
  }) => {
    const page = await browser.newContext().then((c) => c.newPage())
    await createRoom(page, 'ada')

    // Lobby view: the layer exists with all 8 frames but every one is hidden
    // (the grand lobby floor has no rooms).
    await page.waitForSelector('#doors-layer')
    expect((await visibleDoorRooms(page)).length).toBe(0)
    const frameCount = await page.evaluate(
      () => document.querySelectorAll('#doors-layer [data-door-room]').length,
    )
    expect(frameCount).toBe(8)

    // Pre-round ride west (no host start — the world is phase-free), then exit
    // onto floor1: the own floor stream flips the view and the frames show.
    await page.keyboard.down('ArrowLeft')
    await page.waitForTimeout(3000)
    await page.keyboard.up('ArrowLeft')
    await page.waitForTimeout(200)
    await page.keyboard.press('1')
    await page.waitForFunction(
      () => document.querySelector('#panel-west')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )
    // Step out of the car: the exit snapshot moves the view to floor1.
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(400)
    await page.keyboard.up('ArrowRight')
    await page.waitForFunction(
      () => {
        const doors = document.querySelectorAll('#doors-layer [data-door-room]')
        return (
          doors.length === 8 &&
          [...doors].every((el) => getComputedStyle(el as HTMLElement).visibility === 'visible')
        )
      },
      undefined,
      { timeout: 10_000 },
    )
    expect(await visibleDoorRooms(page)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    await page.context().close()
  })
})
