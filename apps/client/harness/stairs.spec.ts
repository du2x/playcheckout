import { expect, type Page, test } from '@playwright/test'

// Spec STAIRS-04/17/18/19 (gate scenario client:stairs): the stairwell marker
// at the west landing, the climb scene through transit (night-juice: the
// fullscreen stairwell canvas owns the transit/stun readouts — the DOM stair
// bar is retired to the breath window), the ambush toast with its stun
// countdown plus the saboteur's private confirmation, and the single-car
// panel set (no two-car DOM remnants). AD-051: during the breath the own body
// renders on the destination floor (chip up, fullscreen canvas hidden).

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

/** Walk to the west wall — the stairwell mouth (x clamps at 0). */
async function walkToMouth(page: Page): Promise<void> {
  await page.keyboard.down('ArrowLeft')
  await page.waitForTimeout(4200)
  await page.keyboard.up('ArrowLeft')
  await page.waitForTimeout(200)
}

interface ClimbChild {
  name?: string
  text?: string
  visible?: boolean
  list?: ClimbChild[]
}

/** Read a named Text child of the fullscreen climb canvas (stairCanvas). */
async function climbText(page: Page, name: string): Promise<string | null> {
  return page.evaluate((childName) => {
    const hook = (
      window as unknown as {
        __TURNOVER__?: {
          scene: (name: string) => { children: { list: ClimbChild[] } } | null
        }
      }
    ).__TURNOVER__
    const scene = hook?.scene('Round')
    if (scene === null || scene === undefined) return null
    const canvas = scene.children.list.find((c) => c.name === 'stairCanvas')
    const child = canvas?.list?.find((c) => c.name === childName)
    return child?.text ?? null
  }, name)
}

/** The climb canvas's visibility (transit/stun only). */
async function climbVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const hook = (
      window as unknown as {
        __TURNOVER__?: {
          scene: (name: string) => { children: { list: ClimbChild[] } } | null
        }
      }
    ).__TURNOVER__
    const scene = hook?.scene('Round')
    if (scene === null || scene === undefined) return false
    const canvas = scene.children.list.find((c) => c.name === 'stairCanvas')
    return canvas?.visible === true
  })
}

/** Wait until a climb-canvas Text reads `want` (the transit staging sync). */
function climbTextWait(page: Page, name: string, want: string, timeout = 10_000) {
  return page.waitForFunction(
    ([childName, wantText]) => {
      const hook = (
        window as unknown as {
          __TURNOVER__?: {
            scene: (name: string) => { children: { list: ClimbChild[] } } | null
          }
        }
      ).__TURNOVER__
      const scene = hook?.scene('Round')
      if (scene === null || scene === undefined) return false
      const canvas = scene.children.list.find((c) => c.name === 'stairCanvas')
      return canvas?.list?.find((c) => c.name === childName)?.text === wantText
    },
    [name, want] as const,
    { timeout },
  )
}

/**
 * Press a direction key and wait for the climb route to read `route`. A
 * rejected stairs enter is silent on the wire (the sim ignores an enter
 * while it still holds the previous visit's row), so one retry after a
 * 2.5 s settle keeps the staging race-proof under load.
 */
async function pressToRoute(page: Page, key: string, route: string): Promise<void> {
  await page.keyboard.press(key)
  try {
    await climbTextWait(page, 'stairRoute', route, 4000)
  } catch {
    await page.waitForTimeout(2500)
    await page.keyboard.press(key)
    await climbTextWait(page, 'stairRoute', route)
  }
}

test.describe('client:stairs', () => {
  test('marker, stairs screen, ambush toast + confirmation, single panel (STAIRS-04/17/18/19)', async ({
    browser,
  }) => {
    test.setTimeout(150_000) // the 60 s test shift plus the stairs choreography
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    const host = pages[0] as Page
    const code = await createRoom(host, 'ada')
    for (const [index, name] of ['bruno', 'caro', 'dina'].entries()) {
      await join(pages[index + 1] as Page, code, name)
    }
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)

    // Single-car panel set (STAIRS-04): one light + one floor readout; the
    // two-car remnants are gone from the DOM.
    expect(await host.textContent('#panel-floor')).toBe('lobby')
    expect(await host.locator('#panel-light').count()).toBe(1)
    expect(await host.locator('#panel-west').count()).toBe(0)
    expect(await host.locator('#panel-east').count()).toBe(0)

    // The stairwell marker renders at the west landing (STAIRS-17).
    await host.waitForFunction(() => document.querySelector('#stairwell-marker') !== null)

    // Pre-round stairs (phase-free, AD-005/015): bruno walks west and rides
    // the stairs up — the climb canvas shows the transit leg and its
    // countdown (STAIRS-18), rolls into the breath, then frees.
    const bruno = pages[1] as Page
    await walkToMouth(bruno)
    await bruno.keyboard.press('ArrowUp')
    await expect.poll(() => climbVisible(bruno), { timeout: 5000 }).toBe(true)
    expect(await climbText(bruno, 'stairRoute')).toBe('L → M')
    expect(await climbText(bruno, 'stairDir')).toBe('▲ up')
    expect(await climbText(bruno, 'stairPhase')).toBe('moving')
    const clockText = await climbText(bruno, 'stairClock')
    expect(clockText?.endsWith('s')).toBe(true)
    // The breath window is 2 s — start waiting for it BEFORE the transit
    // reads finish so slow text round-trips cannot miss it.
    const breathShown = bruno.waitForFunction(
      () => document.querySelector('.stair-screen-phase')?.textContent === 'catching breath',
      undefined,
      { timeout: 10_000 },
    )
    await breathShown
    // The breath stands ON the destination floor (AD-040 amendment): the own
    // sprite renders at the mezzanine mouth, the fullscreen stair canvas is
    // gone, and the compact breath chip carries the countdown.
    await bruno.waitForFunction(
      () => {
        const hook = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: {
                  list: {
                    type: string
                    name?: string
                    x: number
                    visible: boolean
                    texture?: { key?: string }
                  }[]
                }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = hook.scene('Round')
        if (scene === null) return false
        const list = scene.children.list
        const chip = list.find((c) => c.name === 'breathChip')
        const box = list.find((c) => c.name === 'stairCanvas')
        const ownBody = list.find(
          (c) => c.type === 'Sprite' && c.texture?.key === 'staff-walk' && c.visible,
        )
        return chip?.visible === true && box?.visible === false && ownBody !== undefined
      },
      undefined,
      { timeout: 5000 },
    )
    await bruno.waitForFunction(
      () => document.querySelector('#elevator-stair-screen')?.hasAttribute('hidden') === true,
      undefined,
      { timeout: 6000 },
    )

    // Round: stage an ambush between the dealt saboteur and a staff member.
    await host.click('#start-button')
    await host.waitForSelector('#round-hud')
    await host.waitForFunction(
      () => (document.querySelector('#role-card')?.textContent ?? '').length > 0,
      undefined,
      { timeout: 10_000 },
    )
    const roles: string[] = []
    for (const page of pages) {
      await page.waitForFunction(
        () => (document.querySelector('#role-card')?.textContent ?? '').length > 0,
        undefined,
        { timeout: 10_000 },
      )
      roles.push((await page.textContent('#role-card')) ?? '')
    }
    const saboteurIdx = roles.indexOf('saboteur')
    const victimIdx = roles.findIndex((r, i) => i !== saboteurIdx && r === 'staff')
    expect(saboteurIdx).toBeGreaterThanOrEqual(0)
    expect(victimIdx).toBeGreaterThanOrEqual(0)
    const saboteur = pages[saboteurIdx] as Page
    const victim = pages[victimIdx] as Page
    const victimName = ['ada', 'bruno', 'caro', 'dina'][victimIdx]

    // Opposite transits, staged around who the saboteur is: bruno (pages[1])
    // already rode the stairs pre-round and stands at the mezzanine mouth —
    // everyone else is on the lobby.
    if (saboteurIdx === 1) {
      await walkToMouth(victim) // the victim is on the lobby floor
      await pressToRoute(victim, 'ArrowUp', 'L → M') // lobby → mezzanine
      await pressToRoute(saboteur, 'ArrowDown', 'M → L') // mezzanine → lobby
    } else {
      // Both on the lobby: the victim rides up first, frees at the mezzanine
      // mouth, then descends into the saboteur's up-transit.
      await walkToMouth(victim)
      await walkToMouth(saboteur)
      await victim.keyboard.press('ArrowUp') // lobby → mezzanine (3 s + 2 s breath)
      await expect.poll(() => climbVisible(victim), { timeout: 5000 }).toBe(true)
      // The breath stands on the destination floor (AD-051): the climb canvas
      // yields, the DOM breath bar appears, and the visit ends when the DOM
      // bar hides again — the handoff sequence, waited in order.
      await expect.poll(() => climbVisible(victim), { timeout: 12_000 }).toBe(false)
      await victim.waitForFunction(
        () => !document.querySelector('#elevator-stair-screen')?.hasAttribute('hidden'),
        undefined,
        { timeout: 5000 },
      )
      await victim.waitForFunction(
        () => document.querySelector('#elevator-stair-screen')?.hasAttribute('hidden') === true,
        undefined,
        { timeout: 8000 },
      )
      await victim.waitForTimeout(1000)
      await pressToRoute(victim, 'ArrowDown', 'M → L')
      await saboteur.waitForTimeout(800)
      await pressToRoute(saboteur, 'ArrowUp', 'L → M')
    }

    // The victim feels the ambush: the toast counts down (STAIRS-19) and the
    // climb canvas reads stunned.
    await victim.waitForFunction(
      () => document.querySelector('#ambush-toast') !== null,
      undefined,
      { timeout: 8000 },
    )
    await victim.waitForFunction(
      () =>
        (document.querySelector('#ambush-toast')?.textContent ?? '').includes('you were ambushed'),
      undefined,
      { timeout: 3000 },
    )
    await expect.poll(() => climbText(victim, 'stairPhase'), { timeout: 8000 }).toBe('stunned')
    // The saboteur's private confirmation names the victim.
    await saboteur.waitForFunction(
      () => document.querySelector('#ambush-confirm') !== null,
      undefined,
      { timeout: 8000 },
    )
    expect(await saboteur.textContent('#ambush-confirm')).toContain(`landed on ${victimName}`)

    for (const page of pages) await page.context().close()
  })
})
