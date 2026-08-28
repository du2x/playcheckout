import { expect, type Page, test } from '@playwright/test'

// Spec EL-01/EL-04 (AD-011, gate scenario client:elevator_lobby): the full
// elevator machine runs BEFORE any round starts — no host start, no test shift.
// Walk to a landing, call with ArrowUp, ride to floor1, ride back with
// ArrowDown. This is the fast Playwright entry point for elevator debugging.

const TILE = 832 / 30

async function readOwn(page: Page): Promise<{ x: number; visible: boolean }> {
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
    const ada = scene.children.list.find((c) => c.type === 'Text' && c.text === 'ada')
    if (ada === undefined) throw new Error('no own label')
    return { x: ada.x, visible: ada.visible }
  })
}

test.describe('client:elevator_lobby', () => {
  test('rides floor1 and back before any round starts (EL-01, EL-04)', async ({ browser }) => {
    test.setTimeout(45_000)
    const host = await browser.newContext().then((c) => c.newPage())
    await host.goto('/')
    await host.fill('#join-name', 'ada')
    await host.click('#create-button')
    await host.waitForSelector('#lobby-view')

    // Walk to the west landing (15 tiles at 6 tiles/s ≈ 2.5 s).
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowLeft')
    await host.waitForTimeout(300)
    expect((await readOwn(host)).x).toBeLessThanOrEqual(TILE)

    // Call: ArrowUp from the lobby targets floor1. The car arrives (3 s),
    // boards the caller at the landing, and rides (2 s/floor).
    await host.keyboard.press('ArrowUp')
    await host.waitForFunction(
      () => document.querySelector('#panel-west')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )
    // The arrival switched the rider's view to floor1, standing at the landing.
    await host.waitForTimeout(300)
    expect((await readOwn(host)).x).toBeLessThanOrEqual(TILE)

    // Confinement holds in prediction too (MOVE-08): holding right on floor1
    // pre-round must NOT slide the own rectangle (server refuses the intent).
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(600)
    await host.keyboard.up('ArrowRight')
    await host.waitForTimeout(300)
    expect((await readOwn(host)).x).toBeLessThanOrEqual(TILE)

    // Round-trip: ArrowDown from floor1 targets the lobby.
    await host.keyboard.press('ArrowDown')
    await host.waitForFunction(
      () => document.querySelector('#panel-west')?.textContent === 'lobby',
      undefined,
      { timeout: 10_000 },
    )
    await host.waitForTimeout(300)
    expect((await readOwn(host)).x).toBeLessThanOrEqual(TILE)

    // No round was ever started: the round HUD never mounts.
    expect(await host.$('#round-hud')).toBeNull()

    await host.context().close()
  })
})
