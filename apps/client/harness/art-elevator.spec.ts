import { type Page, expect, test } from '@playwright/test'

// Gate scenario client:art_elevator (cycle 2.10, ART-15/16; the ART-17 panel
// half lands with T5): elevator cars render as elevator-car Sprites —
// doors-open cage frame while parked/dwelling, closed slab frame once the
// doors close, hidden in transit (ELAN semantics unchanged).

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

function readCarSprites(page: Page): Promise<CarSpriteRead[]> {
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
      .map((c) => ({ frame: Number(c.frame.name), visible: c.visible }))
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

    // Both cars parked at the lobby render the doors-open cage frame.
    const parked = await readCarSprites(host)
    expect(parked).toHaveLength(2)
    expect(parked.every((c) => c.visible && c.frame === 0)).toBe(true)

    // Walk to the west landing (auto-boards, AD-014) and press floor1: the
    // presenter closes the doors (frame 1) before any departure.
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowLeft')
    await host.keyboard.press('1')
    await host.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: {
                  list: {
                    type: string
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
            Number(c.frame.name) === 1,
        )
      },
      undefined,
      { timeout: 5000 },
    )

    // Transit hides the departing car (ELAN-04): at most the parked far car
    // remains visible while car1 rides to floor1.
    await host.waitForTimeout(600)
    const inTransit = await readCarSprites(host)
    expect(inTransit.filter((c) => c.visible).length).toBeLessThanOrEqual(1)

    // A rider has no floor stream (AD-009) — the arrival is not visible from
    // inside the car. Step out through the open doors INSIDE the 1 s dwell
    // window (press→close 300 ms + transit 2000 ms → arrival ≈ 2.3 s): the
    // exit snapshot moves the view to floor1, where the parked car shows its
    // cage frame before the dwell elapses and the car closes away.
    await host.waitForTimeout(1900)
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(400)
    await host.keyboard.up('ArrowRight')
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
