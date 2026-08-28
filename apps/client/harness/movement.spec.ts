import { expect, type Page, test } from '@playwright/test'

// Spec MOVE-01..19 (gate scenario client:movement): keyboard-driven movement on
// real tabs — own prediction, others following, lobby bounds, building unlock at
// start, elevator rides with position-only panels, post-buzzer re-confinement,
// and a leaver's rectangle disappearing.

const TILE = 832 / 30
const SPEED = 6 // tiles per second (prd §7)

interface SceneRead {
  labels: { text: string; x: number; visible: boolean }[]
  carCount: number
  rectCount: number
}

async function readScene(page: Page): Promise<SceneRead> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: { list: { type: string; text?: string; x: number; visible: boolean }[] }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    if (scene === null) throw new Error('world scene missing')
    const list = scene.children.list
    return {
      labels: list
        .filter((c) => c.type === 'Text')
        .map((c) => ({ text: String(c.text), x: c.x, visible: c.visible })),
      rectCount: list.filter((c) => c.type === 'Rectangle').length,
      carCount: list.filter((c) => c.type === 'Ellipse').length,
    }
  })
}

function onLanding(): boolean {
  const t = (
    window as unknown as {
      __TURNOVER__: {
        scene: (
          n: string,
        ) => { children: { list: { type: string; text?: string; x: number }[] } } | null
      }
    }
  ).__TURNOVER__
  const scene = t.scene('Round')
  if (scene === null) return false
  const ada = scene.children.list.find((c) => c.type === 'Text' && c.text === 'ada')
  return ada !== undefined && ada.x <= 832 / 30
}

function labelX(scene: SceneRead, name: string): number {
  const label = scene.labels.find((l) => l.text === name)
  if (label === undefined) throw new Error(`no label for ${name}`)
  return label.x
}

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

test.describe('client:movement', () => {
  test('walking: own prediction, others follow, bounds clamp (MOVE-01..05)', async ({
    browser,
  }) => {
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')
    const guest = await browser.newContext().then((c) => c.newPage())
    await join(guest, code, 'bruno')
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 2)

    // Both see exactly two player rectangles plus two car ellipses.
    for (const page of [host, guest]) {
      const scene = await readScene(page)
      expect(scene.rectCount).toBe(2)
      expect(scene.carCount).toBe(2)
    }

    // Own prediction: hold right for 1 s → ~6 tiles of displacement.
    const before = (await readScene(guest)).labels.find((l) => l.text === 'bruno')?.x ?? 0
    await guest.keyboard.down('ArrowRight')
    await guest.waitForTimeout(1000)
    await guest.keyboard.up('ArrowRight')
    await guest.waitForTimeout(150)
    const ownAfter = labelX(await readScene(guest), 'bruno')
    const ownDeltaPx = ownAfter - before
    expect(ownDeltaPx).toBeGreaterThan((SPEED - 2) * TILE)
    expect(ownDeltaPx).toBeLessThan((SPEED + 2) * TILE)

    // The other tab follows the server position within ~2 ticks.
    await guest.waitForTimeout(200)
    const hostSees = labelX(await readScene(host), 'bruno')
    expect(hostSees - before).toBeGreaterThan((SPEED - 2) * TILE)
    expect(Math.abs(hostSees - ownAfter)).toBeLessThan(2 * 0.3 * TILE + 6)

    // Bounds clamp: hold left long enough to pin at the west wall (MOVE-04).
    await guest.keyboard.down('ArrowLeft')
    await guest.waitForTimeout(4000)
    await guest.keyboard.up('ArrowLeft')
    await guest.waitForTimeout(200)
    expect(labelX(await readScene(guest), 'bruno')).toBeLessThanOrEqual(1)

    await guest.context().close()
    await host.context().close()
  })

  test('round: building unlocks, elevator rides, panels stay position-only (MOVE-10..17)', async ({
    browser,
  }) => {
    test.setTimeout(60_000) // the test shift (30 s, AD-004) plus choreography
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    const host = pages[0] as Page
    const code = await createRoom(host, 'ada')
    for (const [index, name] of ['bruno', 'caro', 'dina'].entries()) {
      await join(pages[index + 1] as Page, code, name)
    }
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)

    // Walk to the west landing PRE-ROUND (AD-005: lobby walking + position
    // persistence) so the whole elevator cycle fits inside the 8 s test shift.
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowLeft')
    await host.waitForTimeout(300)
    expect(await host.evaluate(onLanding)).toBe(true)

    await host.click('#start-button')
    for (const page of pages) await page.waitForSelector('#round-hud')
    await host.keyboard.press('ArrowUp') // call: pickup here, target floor1

    // The car arrives (3 s), boards, and rides to floor1 (2 s): panels update.
    await host.waitForFunction(
      () => document.querySelector('#panel-west')?.textContent === 'floor1',
      undefined,
      { timeout: 8000 },
    )
    const panel = await host.textContent('#elevator-panel')
    // Position-only: the panel names floors, never player ids or names.
    expect(panel).not.toContain('ada')
    expect(panel).not.toContain('bruno')

    // The rider's view follows the car: their own label now renders on floor1's
    // view, and the car landed at the west edge (x = 0 px).
    await host.waitForTimeout(300)
    const hostScene = await readScene(host)
    expect(labelX(hostScene, 'ada')).toBeLessThanOrEqual(TILE)

    // A player who never called stays on the lobby floor view (bruno's tab still
    // shows the lobby view; ada's rectangle is not on their floor).
    const guestScene = await readScene(pages[1] as Page)
    const adaOnGuest = guestScene.labels.find((l) => l.text === 'ada')
    expect(adaOnGuest?.visible).toBe(false)

    // Buzzer (30 s test shift, AD-004 seam widened for the work-channel cycle):
    // view returns to lobby; the rider keeps floor1.
    for (const page of pages) await page.waitForSelector('#lobby-view', { timeout: 45_000 })

    // Post-buzzer re-confinement (MOVE-08): ada is on floor1; the server refuses
    // her move intent — the OTHER tabs' view of ada stays put.
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(600)
    await host.keyboard.up('ArrowRight')
    await pages[1]?.waitForTimeout(300)
    const after = (await readScene(pages[1] as Page)).labels.find((l) => l.text === 'ada')
    expect(after?.x).toBe(guestScene.labels.find((l) => l.text === 'ada')?.x)

    // A leaver's rectangle disappears everywhere (MOVE-19).
    await (pages[3] as Page).context().close()
    await host.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (n: string) => { children: { list: { type: string }[] } } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        if (scene === null) return false
        return scene.children.list.filter((c) => c.type === 'Rectangle').length === 3
      },
      undefined,
      { timeout: 5000 },
    )

    for (const page of pages.slice(0, 3)) await page.context().close()
  })
})
