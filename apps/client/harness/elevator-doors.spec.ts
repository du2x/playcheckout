import { expect, type Page, test } from '@playwright/test'

// Spec ELAN-01..04 (P1) + P2 AC1 (gate scenario client:elevator_doors): the
// new door-open/close and hide-during-transit visuals layered on the
// existing press-model elevator machine (`elevator-riders` cycle, AD-013/
// AD-014) — single client, no round start needed (fast entry point, mirrors
// elevatorLobby.spec.ts). P2 AC2's arrival tween/fade math is unit-tested
// (elevatorPresenter.test.ts); this scenario proves the DOM/Phaser
// integration: the harness ART children contract survives, and a real
// browser actually renders/hides the car per the presenter's phase clock.

interface CarRead {
  rectCount: number
  visibleCarCount: number
}

async function readCars(page: Page): Promise<CarRead> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: {
              list: { type: string; visible: boolean; texture?: { key?: string } }[]
            }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    if (scene === null) throw new Error('world scene missing')
    const list = scene.children.list
    return {
      // ART contract (cycle 2.10): the player is a staff-walk Sprite.
      rectCount: list.filter((c) => c.type === 'Sprite' && c.texture?.key === 'staff-walk').length,
      // ART contract (cycle 2.10): cars are elevator-car Sprites.
      visibleCarCount: list.filter(
        (c) => c.type === 'Sprite' && c.texture?.key === 'elevator-car' && c.visible,
      ).length,
    }
  })
}

test.describe('client:elevator_doors', () => {
  test('doors open on arrival, then close and hide before any further move (ELAN-01..04, P2 AC1)', async ({
    browser,
  }) => {
    test.setTimeout(30_000)
    const host = await browser.newContext().then((c) => c.newPage())
    await host.goto('/')
    await host.fill('#join-name', 'ada')
    await host.click('#create-button')
    await host.waitForSelector('#lobby-view')
    await host.waitForTimeout(200) // let the scene mount and tick at least once

    // Harness rendering contract, unchanged by this cycle (spec Goal 4): one
    // player sprite for the lone player, and the single car starts parked
    // shut at the east landing — the car Sprite renders visible before any
    // call happens (ELAN-01 AC1/AC3; cycle 3.E AD-040 collapsed the pair).
    const baseline = await readCars(host)
    expect(baseline.rectCount).toBe(1)
    expect(baseline.visibleCarCount).toBe(1)

    // Walk to the east landing and board with the call press (AD-025), then
    // press floor1 in-car. A rider-triggered departure never announces
    // `elevator:called` on the wire (AD-013) — this also exercises the
    // presenter's documented SPEC_DEVIATION path (ground truth
    // `elevator:moved` alone drives the arrival animation).
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowRight')
    await host.keyboard.press('ArrowUp')
    await host.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 5000 },
    )
    await host.keyboard.press('1')
    await host.waitForFunction(
      () => document.querySelector('#panel-floor')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )

    // Exit right after the arrival: the ride plus the stop's dwell tail and
    // closing swing (AD-026) run before the moved lands, then the doors
    // reopen — the own player-moved event flips viewFloor to floor1
    // (ELAN-04) while the doors are open, inside the 1 s dwell
    // (TUNING.ELEVATOR_DWELL_SECONDS) before the presenter closes them.
    await host.keyboard.down('ArrowRight')
    await host.waitForFunction(
      () => document.querySelector('#panel-floor')?.textContent === 'floor1',
    )
    await host.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (n: string) => {
                children: {
                  list: { type: string; visible: boolean; texture?: { key?: string } }[]
                }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        if (scene === null) return false
        return (
          scene.children.list.filter(
            (c) => c.type === 'Sprite' && c.texture?.key === 'elevator-car' && c.visible,
          ).length === 1
        )
      },
      undefined,
      { timeout: 2000 },
    )
    // Clear the boarding radius so nothing re-boards car1 (AD-014 — the
    // door-open-episode guard would otherwise hold her aboard).
    await host.waitForTimeout(300)
    await host.keyboard.up('ArrowRight')

    // Still exactly one player sprite while car1's door is open (Goal 4
    // preserved through the new visual).
    expect((await readCars(host)).rectCount).toBe(1)

    // No further stop is ever reported at floor1 (the panel never changes
    // again below) and no call waits anywhere — AD-027: car1 KEEPS its doors
    // open at this stop instead of closing away. A stable terminal state
    // (car1 never departs again in this scenario), so a generous bound is
    // not flaky.
    await host.waitForTimeout(2500)
    const terminal = await readCars(host)
    expect(terminal.visibleCarCount).toBe(1)
    expect(await host.textContent('#panel-floor')).toBe('floor1')

    await host.context().close()
  })
})
