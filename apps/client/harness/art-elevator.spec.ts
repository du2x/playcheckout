import { expect, type Page, test } from '@playwright/test'

// Gate scenario client:art_elevator (cycle 2.10, ART-15/16): elevator cars
// render as elevator-car Sprites —
// doors-open cage frame while the doors are open (the AD-026 dwell), closed
// slab frame once the doors close, hidden in transit (ELAN semantics).

interface CarSpriteRead {
  frame: number
  visible: boolean
}

async function createRoom(page: Page, name: string): Promise<void> {
  await page.goto('/')
  await page.fill('#join-name', name)
  await page.click('#create-button')
  await page.waitForSelector('#lobby-view')
}

function readCarSprites(page: Page): Promise<(CarSpriteRead & { x: number })[]> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: {
              list: {
                type: string
                visible: boolean
                frame: { name: string | number }
                texture: { key: string }
              }[]
            }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    if (scene === null) return []
    return scene.children.list
      .filter((c) => c.type === 'Sprite' && c.texture?.key === 'elevator-car')
      .map((c) => ({
        frame: Number(c.frame.name),
        visible: c.visible,
        x: (c as unknown as { x: number }).x,
      }))
  })
}

test.describe('client:art_elevator', () => {
  test('car sprites frame between open cage and closed slab across the ELAN phases (ART-15/16)', async ({
    browser,
  }) => {
    test.setTimeout(30_000)
    const host = await browser.newContext().then((c) => c.newPage())
    await createRoom(host, 'ada')
    await host.waitForTimeout(200)

    // Both cars parked at the lobby render the closed slab (boot = parked
    // with the doors SHUT, AD-026/027 — they open for the first call).
    const parked = await readCarSprites(host)
    expect(parked).toHaveLength(2)
    expect(parked.every((c) => c.visible && c.frame === 1)).toBe(true)

    // Walk to the west landing and board the parked car with the call press
    // (AD-025): the shut doors swing open (AD-026) and the board lands when
    // they finish. Then press floor1 in-car — the minimum dwell (AD-027)
    // elapses, the attend check closes the doors, and the car departs.
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowLeft')
    await host.keyboard.press('ArrowUp')
    await host.waitForSelector('#elevator-riders:not([hidden])', { timeout: 8000 })
    await host.keyboard.press('1')
    // The west car (x ≈ 0) closes: the closed slab frame before any
    // departure (the east car is parked shut too — target the west one).
    await host.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: {
                  list: {
                    type: string
                    visible: boolean
                    x: number
                    frame: { name: string | number }
                    texture: { key: string }
                  }[]
                }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        if (scene === null) return false
        return scene.children.list.some(
          (c) =>
            c.type === 'Sprite' &&
            c.texture?.key === 'elevator-car' &&
            (c as unknown as { x: number }).x < 100 &&
            Number(c.frame.name) === 1,
        )
      },
      undefined,
      { timeout: 15_000 },
    )

    // Transit hides the departing west car (ELAN-04): at most the parked far
    // car remains visible while car1 rides to floor1.
    await host.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: {
                  list: {
                    type: string
                    visible: boolean
                    x: number
                    texture: { key: string }
                  }[]
                }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        if (scene === null) return false
        return !scene.children.list.some(
          (c) =>
            c.type === 'Sprite' &&
            c.texture?.key === 'elevator-car' &&
            (c as unknown as { x: number }).x < 100 &&
            c.visible,
        )
      },
      undefined,
      { timeout: 5000 },
    )
    const inTransit = await readCarSprites(host)
    expect(inTransit.filter((c) => c.visible).length).toBeLessThanOrEqual(1)

    // A rider has no floor stream (AD-009) — the arrival is not visible from
    // inside the car. Anchor the exit on events, never wall-clock: the panel
    // flips to floor1 at the arrival moved (the opening swing starts,
    // AD-026); hold the exit direction until the rider chip hides (the doors
    // are fully open and the pending exit applied).
    await host.waitForFunction(
      () => document.querySelector('#panel-floor')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )
    await host.keyboard.down('ArrowRight')
    await host.waitForFunction(
      () => document.querySelector('#elevator-riders')?.hasAttribute('hidden') === true,
      undefined,
      { timeout: 8000 },
    )
    await host.waitForTimeout(300) // settle inside the open-door window
    // AD-027: no call waits anywhere — the car keeps its doors OPEN at this
    // stop, so the exited rider's view shows the open cage frame (ART-15).
    await host.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: {
                  list: {
                    type: string
                    visible: boolean
                    frame: { name: string | number }
                    texture: { key: string }
                  }[]
                }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        if (scene === null) return false
        return scene.children.list.some(
          (c) =>
            c.type === 'Sprite' &&
            c.texture?.key === 'elevator-car' &&
            c.visible &&
            Number(c.frame.name) === 0,
        )
      },
      undefined,
      { timeout: 10_000 },
    )
    await host.context().close()
  })
})
