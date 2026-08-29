import { expect, type Page, test } from '@playwright/test'

// Spec EL-01/EL-04 (AD-011, gate scenario client:elevator_lobby) rewritten for
// the press model (AD-014): the full elevator machine runs BEFORE any round
// starts — no host start, no test shift. A call with BOTH cars parked
// open-doors is a decoy flash (AD-019 narrowed the duplicate predicate); a
// single parked car would summon the other one. Walking to a landing
// auto-boards; Digit1/Digit0 press the destination in-car; exit resumes the
// floor stream. This is the fast Playwright entry point for elevator debugging.

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
  test('decoy flash, auto-board, in-car presses ride floor1 and back (EL-01, EL-04, ELR-05/14)', async ({
    browser,
  }) => {
    test.setTimeout(45_000)
    const host = await browser.newContext().then((c) => c.newPage())
    await host.goto('/')
    await host.fill('#join-name', 'ada')
    await host.click('#create-button')
    await host.waitForSelector('#lobby-view')

    // A call with a car parked open-doors at the lobby is a DUPLICATE
    // (AD-014: duplicate predicate = pickup floor only): no dispatch, but the
    // panel pulses — a call always looks registered (AD-012 acknowledgment).
    await host.keyboard.press('ArrowUp')
    await host.waitForFunction(
      () =>
        (document.querySelector('#elevator-panel') as HTMLElement | null)?.style.backgroundColor ===
        'rgb(58, 90, 58)',
      undefined,
      { timeout: 3000 },
    )
    await host.waitForFunction(
      () =>
        (document.querySelector('#elevator-panel') as HTMLElement | null)?.style.backgroundColor ===
        '',
      undefined,
      { timeout: 3000 },
    )
    // The decoy dispatched nothing: the parked car is still at the lobby.
    expect(await host.textContent('#panel-west')).toBe('lobby')

    // Walk to the west landing (15 tiles at 6 tiles/s ≈ 2.5 s): the parked car
    // auto-boards ada (AD-014: board every open-door tick) and her
    // rider-exclusive chip appears.
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowLeft')
    await host.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 5000 },
    )

    // In-car press floor1 (Digit1): the car departs directly — no 3 s arrival,
    // she is already aboard (2 s per floor).
    await host.keyboard.press('1')
    await host.waitForFunction(
      () => document.querySelector('#panel-west')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )

    // Stay-in-car (ELR P2 AC2): press lobby (Digit0) — the car rides back.
    await host.keyboard.press('0')
    await host.waitForFunction(
      () => document.querySelector('#panel-west')?.textContent === 'lobby',
      undefined,
      { timeout: 10_000 },
    )

    // Exit through the open doors: the own floor stream resumes at the lobby
    // landing (ELR P3 AC6) and she walks right — pre-round lobby walking is
    // allowed, so prediction and server agree. Hold long enough to leave the
    // landing before releasing.
    await host.keyboard.down('ArrowRight')
    await host.waitForFunction(
      () => {
        const w = (
          window as unknown as {
            __TURNOVER__: {
              scene: (n: string) => {
                children: { list: { type: string; text?: string; visible: boolean }[] }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = w.scene('Round')
        if (scene === null) return false
        return (
          scene.children.list.find((c) => c.type === 'Text' && c.text === 'ada')?.visible === true
        )
      },
      undefined,
      { timeout: 5000 },
    )
    await host.waitForTimeout(500) // keep walking while held
    await host.keyboard.up('ArrowRight')
    await host.waitForTimeout(300)
    const own = await readOwn(host)
    expect(own.visible).toBe(true)
    expect(own.x).toBeGreaterThan(TILE)

    // The chip hid when she left the car (visible only while riding).
    await host.waitForFunction(
      () => document.querySelector('#elevator-riders')?.hasAttribute('hidden') === true,
      undefined,
      { timeout: 5000 },
    )

    // No round was ever started: the round HUD never mounts.
    expect(await host.$('#round-hud')).toBeNull()

    await host.context().close()
  })
})
