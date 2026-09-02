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

const TILE = 32
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
    test.setTimeout(150_000)
    const host = await browser.newContext().then((c) => c.newPage())
    await host.goto('/')
    await host.fill('#join-name', 'ada')
    await host.click('#create-button')
    await host.waitForSelector('#lobby-view')
    const heading = await host.textContent('#lobby-view h2')
    const code = heading?.match(/room ([A-Z]{4})/)?.[1]
    if (code === undefined) throw new Error(`no room code in lobby heading: ${heading}`)
    // A second player waits mid-hall at the spawn (x≈15) — their hall call
    // dispatches the single car once it stands on another floor.
    const bruno = await browser.newContext().then((c) => c.newPage())
    await bruno.goto('/')
    await bruno.fill('#join-code', code)
    await bruno.fill('#join-name', 'bruno')
    await bruno.click('#join-submit')
    await bruno.waitForSelector('#lobby-view')

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
      const panel = list.find((c) => c.type === 'Sprite' && c.name === 'panel:east')
      return panel === undefined ? 'missing' : Number(panel.frame.name)
    })
    expect(idleFrame).toBe(0)
    expect(await host.textContent('#panel-floor')).toBe('lobby')

    // Walk to the east landing (15 tiles at 6 tiles/s ≈ 2.5 s — the single
    // car parks there, cycle 3.E AD-040) and board the parked car with the
    // landing call press (AD-025): her rider-exclusive chip appears.
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

    // In-car press floor1 (Digit1): the car departs directly — no 3 s arrival,
    // she is already aboard (2 s per floor).
    await host.keyboard.press('1')
    await host.waitForFunction(
      () => document.querySelector('#panel-floor')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )

    // 3.E: walk off LEFT at the floor1 landing (the car lands at the EAST
    // end), then cross back to the landing (the exit hop leaves her a few
    // tiles west of it).
    await host.keyboard.down('ArrowLeft')
    await host.waitForFunction(ownVisible, undefined, { timeout: 5000 })
    await host.keyboard.up('ArrowLeft')
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(5600)
    await host.keyboard.up('ArrowRight')

    // Board the parked car again and ride UP to floor2: the ride frees the
    // floor1 landing so a hall call can actually dispatch the single car.
    await host.keyboard.press('ArrowUp')
    await host.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 5000 },
    )
    await host.keyboard.press('2')
    await host.waitForFunction(
      () => document.querySelector('#panel-floor')?.textContent === 'floor2',
      undefined,
      { timeout: 15000 },
    )

    // Exit LEFT at the floor2 landing, off the landing zone: her stream
    // resumes and the chip hides.
    await host.keyboard.down('ArrowLeft')
    await host.waitForFunction(ownVisible, undefined, { timeout: 5000 })
    await host.waitForTimeout(800)
    await host.keyboard.up('ArrowLeft')
    await host.waitForFunction(
      () => document.querySelector('#elevator-riders')?.hasAttribute('hidden') === true,
      undefined,
      { timeout: 5000 },
    )

    // A hall call from the OTHER floor dispatches the single car (AD-023's
    // single candidate): bruno walks to the lobby's east landing (the client
    // gates calls to landings, AD-022) and summons; the hall light (AD-024)
    // lights amber until the car arrives.
    await bruno.keyboard.down('ArrowRight')
    await bruno.waitForTimeout(3000)
    await bruno.keyboard.up('ArrowRight')
    await bruno.keyboard.press('ArrowUp')
    // Ambient guest calls may queue ahead of bruno's (AD-028) — the light
    // lights when the single car actually dispatches to the lobby.
    await host.waitForFunction(
      (lit) => (document.querySelector('#panel-light') as HTMLElement | null)?.style.color === lit,
      LIGHT_LIT,
      { timeout: 15000 },
    )
    // The car arrives at the lobby: the readout flips and the light clears
    // (AD-024's arrival-off) — the panel stays dark through the open dwell.
    await host.waitForFunction(
      (off) =>
        document.querySelector('#panel-floor')?.textContent === 'lobby' &&
        (document.querySelector('#panel-light') as HTMLElement | null)?.style.color === off,
      LIGHT_OFF,
      { timeout: 25_000 },
    )

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
    await bruno.context().close()
  })
})
