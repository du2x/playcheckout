import { expect, type Page, test } from '@playwright/test'

// Spec EL-01/EL-04 (AD-011, gate scenario client:elevator_lobby) rewritten for
// the press model (AD-014) + hall-button rules (AD-022/023) + explicit boarding
// (AD-025): the full elevator machine runs BEFORE any round starts — no host
// start, no test shift. The call press at a parked open-doors car's landing
// boards; Digit1/Digit0 press the destination in-car; exit
// resumes the floor stream. A call is only sendable AT a landing (AD-022) and
// pins to that landing's car (AD-023): at the east landing with car 1 parked
// on floor1, the flash names car 2 and car 1 is never summoned. The per-car
// hall-call light (AD-024) lights on a real dispatch and turns off when the
// car arrives; a decoy flash (car already parked here) stays dark. This is
// the fast Playwright entry point for elevator debugging.

const TILE = 832 / 30
const LIGHT_OFF = 'rgb(74, 85, 104)' // #4a5568
const LIGHT_LIT = 'rgb(232, 195, 74)' // #e8c34a

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

function ownVisible(): boolean {
  const t = (
    window as unknown as {
      __TURNOVER__: {
        scene: (n: string) => {
          children: { list: { type: string; text?: string; visible: boolean }[] }
        } | null
      }
    }
  ).__TURNOVER__
  const scene = t.scene('Round')
  if (scene === null) return false
  return scene.children.list.find((c) => c.type === 'Text' && c.text === 'ada')?.visible === true
}

test.describe('client:elevator_lobby', () => {
  test('auto-board, ride, hall-call light lifecycle, landing-pinned decoy (EL-01/04, ELR-05/14, AD-023/024)', async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const host = await browser.newContext().then((c) => c.newPage())
    await host.goto('/')
    await host.fill('#join-name', 'ada')
    await host.click('#create-button')
    await host.waitForSelector('#lobby-view')

    // Landing gate (AD-022): a call from mid-hall (spawn x≈15) is a client
    // no-op — no intent is sent, so the panel never flashes.
    await host.keyboard.press('ArrowUp')
    await host.waitForTimeout(600)
    // ART contract (cycle 2.10): panels are elevator-panel Sprites; no
    // intent means the sprite never leaves its idle frame 0.
    const idleFrame = await host.evaluate(() => {
      const t = (
        window as unknown as {
          __TURNOVER__: {
            scene: (name: string) => {
              children: {
                list: { name: string; type: string; frame: { name: string | number } }[]
              }
            } | null
          }
        }
      ).__TURNOVER__
      const list = t.scene('Round')?.children.list ?? []
      const panel = list.find((c) => c.type === 'Sprite' && c.name === 'panel:west')
      return panel === undefined ? 'missing' : Number(panel.frame.name)
    })
    expect(idleFrame).toBe(0)
    expect(await host.textContent('#panel-west')).toBe('lobby')

    // Walk to the west landing (15 tiles at 6 tiles/s ≈ 2.5 s) and board the
    // parked car with the landing call press (AD-025): her rider-exclusive
    // chip appears.
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowLeft')
    await host.keyboard.press('ArrowUp')
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

    // Walk off LEFT at the floor1 west landing (exit places her at x=0; the
    // door-open-episode guard keeps the parked car from re-boarding her),
    // then cross to the floor1 EAST landing (~30 tiles ≈ 5 s).
    await host.keyboard.down('ArrowLeft')
    await host.waitForFunction(ownVisible, undefined, { timeout: 5000 })
    await host.keyboard.up('ArrowLeft')
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(5600)
    await host.keyboard.up('ArrowRight')

    // A call at the east landing (AD-022 gate passes) pins to car 2 (AD-023):
    // car 2 is idle at the lobby → a real dispatch. The hall-call light
    // (AD-024) lights amber; the floor readout stays 'lobby' until arrival.
    await host.keyboard.press('ArrowUp')
    await host.waitForFunction(
      (lit) =>
        (document.querySelector('#panel-light-east') as HTMLElement | null)?.style.color === lit,
      LIGHT_LIT,
      { timeout: 5000 },
    )
    expect(await host.textContent('#panel-east')).toBe('lobby')

    // Car 2 arrives at floor1 (~3 s): the readout updates and the light turns
    // off — ada presses the call at the landing again to board the parked
    // car (AD-025: no proximity boarding; the chip reappears).
    await host.waitForFunction(
      () => document.querySelector('#panel-east')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )
    expect(
      await host.evaluate(
        () => (document.querySelector('#panel-light-east') as HTMLElement | null)?.style.color,
      ),
    ).toBe(LIGHT_OFF)
    await host.keyboard.press('ArrowUp')
    await host.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 5000 },
    )

    // Press lobby (Digit0): the car rides back (~2 s after its 1 s dwell).
    await host.keyboard.press('0')
    await host.waitForFunction(
      () => document.querySelector('#panel-east')?.textContent === 'lobby',
      undefined,
      { timeout: 10_000 },
    )

    // Exit LEFT at the lobby east landing (placed at x=30). A call pressed
    // here (AD-022 gate passes; AD-023 pins to car 2) now BOARDS the parked
    // open-doors car (AD-025): the chip reappears, the panel pulses (AD-012),
    // nothing is dispatched — the light stays DARK, car 1 is never summoned
    // from the east landing (AD-023), and the panel readout never moves.
    await host.keyboard.down('ArrowLeft')
    await host.waitForFunction(ownVisible, undefined, { timeout: 5000 })
    await host.keyboard.up('ArrowLeft')
    await host.keyboard.press('ArrowUp')
    // ART contract (cycle 2.10): the decoy call flashes the landing panel
    // SPRITE (frame 1) then returns to idle — every call looks registered
    // (AD-012), the light stays dark.
    await host.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: {
                  list: { name: string; type: string; frame: { name: string | number } }[]
                }
              } | null
            }
          }
        ).__TURNOVER__
        const list = t.scene('Round')?.children.list ?? []
        const panel = list.find((c) => c.type === 'Sprite' && c.name === 'panel:west')
        return panel !== undefined && Number(panel.frame.name) === 1
      },
      undefined,
      { timeout: 3000 },
    )
    await host.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: {
                  list: { name: string; type: string; frame: { name: string | number } }[]
                }
              } | null
            }
          }
        ).__TURNOVER__
        const list = t.scene('Round')?.children.list ?? []
        const panel = list.find((c) => c.type === 'Sprite' && c.name === 'panel:west')
        return panel !== undefined && Number(panel.frame.name) === 0
      },
      undefined,
      { timeout: 3000 },
    )
    expect(
      await host.evaluate(
        () => (document.querySelector('#panel-light-east') as HTMLElement | null)?.style.color,
      ),
    ).toBe(LIGHT_OFF)
    expect(
      await host.evaluate(
        () => (document.querySelector('#panel-light-west') as HTMLElement | null)?.style.color,
      ),
    ).toBe(LIGHT_OFF)
    expect(await host.textContent('#panel-west')).toBe('floor1')
    // The landing press boarded the parked car (AD-025): the chip is back.
    await host.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 5000 },
    )

    // Walk right — the held intent EXITS the parked car (door-open exit) and
    // pre-round lobby walking is allowed, so prediction and server agree (she
    // clamps at the east bound).
    await host.keyboard.down('ArrowRight')
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
