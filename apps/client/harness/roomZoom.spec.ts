import { expect, type Page, test } from '@playwright/test'

// Spec room-zoom (gate scenario client:room_zoom): the camera zoom engages
// WHILE the own player runs a work channel (FR-7/8/9 — staff prep or
// saboteur fake prep, both self-visible 5 s channels) inside a room segment,
// and restores to the EXACT identity view (zoom 1, scroll 0,0, empty marker
// layer transform) when the channel is walked out (FR-16 cancel) — R1/R2/R3.
// The world-anchored DOM marker layer transforms in lockstep with the camera
// while zoomed (R4). Staging mirrors client:work_channels: board the parked
// east car pre-round, ride to floor1 at round start, exit west into room 7.
// Assertions read the dev hook's scene accessor — camera state only, no
// hidden info.

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

async function join(page: Page, code: string, name: string) {
  await page.goto('/')
  await page.fill('#join-code', code)
  await page.fill('#join-name', name)
  await page.click('#join-submit')
  await page.waitForSelector('#lobby-view')
}

interface CamState {
  zoom: number
  scrollX: number
  scrollY: number
}

/** Read camera state through the dev hook (null until the scene lives). */
function camRead(page: Page): Promise<CamState | null> {
  return page.evaluate(() => {
    const hook = (
      window as unknown as {
        __TURNOVER__?: {
          scene: (name: string) => {
            cameras: { main: { zoom: number; scrollX: number; scrollY: number } }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = hook?.scene('Round')
    if (scene === null || scene === undefined) return null
    const cam = scene.cameras.main
    return { zoom: cam.zoom, scrollX: cam.scrollX, scrollY: cam.scrollY }
  })
}

/** The zoomed focus: eased to ~2 and the marker layer transforms with it. */
async function awaitZoomed(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const hook = (
        window as unknown as {
          __TURNOVER__?: {
            scene: (name: string) => {
              cameras: { main: { zoom: number; scrollX: number; scrollY: number } }
            } | null
          }
        }
      ).__TURNOVER__
      const scene = hook?.scene('Round')
      return scene !== null && scene !== undefined && scene.cameras.main.zoom > 1.9
    },
    undefined,
    { timeout: 8000, polling: 100 },
  )
  const cam = await camRead(page)
  expect(cam?.zoom).toBeGreaterThan(1.9)
  const layer = await page.evaluate(
    () => (document.querySelector('#evidence-layer') as HTMLElement | null)?.style.transform ?? '',
  )
  expect(layer).not.toBe('')
}

/** The EXACT identity at rest (R3): zoom 1, scroll (0, 0), empty transform. */
async function awaitExactRest(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const hook = (
        window as unknown as {
          __TURNOVER__?: {
            scene: (name: string) => {
              cameras: { main: { zoom: number; scrollX: number; scrollY: number } }
            } | null
          }
        }
      ).__TURNOVER__
      const scene = hook?.scene('Round')
      if (scene === null || scene === undefined) return false
      const cam = scene.cameras.main
      return cam.zoom === 1 && cam.scrollX === 0 && cam.scrollY === 0
    },
    undefined,
    { timeout: 8000, polling: 100 },
  )
  const layer = await page.evaluate(
    () => (document.querySelector('#evidence-layer') as HTMLElement | null)?.style.transform ?? '',
  )
  expect(layer).toBe('')
}

test.describe('client:room_zoom', () => {
  test('zoom engages while channeling and restores on the walk-out cancel (room-zoom R1/R2/R3)', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    const host = pages[0] as Page
    const code = await createRoom(host, 'ada')
    for (const [index, name] of ['bruno', 'caro', 'dina'].entries()) {
      await join(pages[index + 1] as Page, code, name)
    }
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)

    // Pre-round: walk to the east landing and board the parked car with the
    // landing call press (AD-025); the round begins with ada aboard.
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowRight')
    await host.keyboard.press('ArrowUp')
    await host.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 8000 },
    )

    // Round: ride to floor1 (in-car press), exit west through the open
    // doors and along floor1 into room 7's segment [22.5, 26.25).
    await host.click('#start-button')
    for (const page of pages) await page.waitForSelector('#round-hud')
    await host.keyboard.press('1')
    await host.waitForFunction(
      () => document.querySelector('#panel-floor')?.textContent === 'floor1',
      undefined,
      { timeout: 12_000 },
    )
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(1500)
    await host.keyboard.up('ArrowLeft')
    await host.waitForTimeout(300)

    // Space begins the work channel — staff prep or saboteur fake prep, a
    // self-visible 5 s channel either way: the camera eases to the 2× focus
    // and the marker layer follows (R4). Ambient standing never zoomed here.
    await host.keyboard.press('Space')
    await host.waitForFunction(
      () => {
        const bar = document.querySelector('#work-progress')
        return bar !== null && !bar.hasAttribute('hidden')
      },
      undefined,
      { timeout: 5000 },
    )
    await awaitZoomed(host)

    // Walk west out of the segment mid-channel: the FR-16 cancel ends the
    // channel and the ease lands on the EXACT identity — zoom 1, scroll
    // (0, 0), empty layer transform (R3, no lingering 0.999…).
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(1200)
    await host.keyboard.up('ArrowLeft')
    await awaitExactRest(host)

    for (const page of pages) await page.context().close()
  })
})
