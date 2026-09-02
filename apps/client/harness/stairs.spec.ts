import { expect, type Page, test } from '@playwright/test'

// Spec STAIRS-04/17/18/19 (gate scenario client:stairs): the stairwell marker
// at the west landing, the stairs screen through transit→breath, the ambush
// toast with its stun countdown plus the saboteur's private confirmation, and
// the single-car panel set (no two-car DOM remnants).

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
    // the stairs up — the screen shows the transit leg and its countdown
    // (STAIRS-18), rolls into the breath, then frees.
    const bruno = pages[1] as Page
    await walkToMouth(bruno)
    await bruno.keyboard.press('ArrowUp')
    await bruno.waitForFunction(
      () =>
        document.querySelector('#elevator-stair-screen') !== null &&
        !document.querySelector('#elevator-stair-screen')?.hasAttribute('hidden'),
      undefined,
      { timeout: 5000 },
    )
    expect(await bruno.textContent('.stair-screen-route')).toBe('L → M')
    expect(await bruno.textContent('.stair-screen-dir')).toBe('▲ up')
    expect(await bruno.textContent('.stair-screen-phase')).toBe('moving')
    const clockText = await bruno.textContent('.stair-screen-clock')
    expect(clockText?.endsWith('s')).toBe(true)
    // The breath window is 2 s — start waiting for it BEFORE the transit
    // reads finish so slow text round-trips cannot miss it.
    const breathShown = bruno.waitForFunction(
      () => document.querySelector('.stair-screen-phase')?.textContent === 'catching breath',
      undefined,
      { timeout: 10_000 },
    )
    await breathShown
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
      await victim.keyboard.press('ArrowUp') // lobby → mezzanine
      await victim.waitForFunction(
        () => document.querySelector('.stair-screen-route')?.textContent === 'L → M',
        undefined,
        { timeout: 10000 },
      )
      await saboteur.keyboard.press('ArrowDown') // mezzanine → lobby
      await saboteur.waitForFunction(
        () => document.querySelector('.stair-screen-route')?.textContent === 'M → L',
        undefined,
        { timeout: 10000 },
      )
    } else {
      // Both on the lobby: the victim rides up first, frees at the mezzanine
      // mouth, then descends into the saboteur's up-transit.
      await walkToMouth(victim)
      await walkToMouth(saboteur)
      await victim.keyboard.press('ArrowUp') // lobby → mezzanine (3 s + 2 s breath)
      await victim.waitForFunction(
        () =>
          document.querySelector('#elevator-stair-screen') !== null &&
          !document.querySelector('#elevator-stair-screen')?.hasAttribute('hidden'),
        undefined,
        { timeout: 5000 },
      )
      await victim.waitForFunction(
        () => document.querySelector('#elevator-stair-screen')?.hasAttribute('hidden') === true,
        undefined,
        { timeout: 12_000 },
      )
      await victim.waitForTimeout(1000)
      await victim.keyboard.press('ArrowDown')
      await victim.waitForFunction(
        () => document.querySelector('.stair-screen-route')?.textContent === 'M → L',
        undefined,
        { timeout: 10000 },
      )
      await saboteur.waitForTimeout(800)
      await saboteur.keyboard.press('ArrowUp')
      await saboteur.waitForFunction(
        () => document.querySelector('.stair-screen-route')?.textContent === 'L → M',
        undefined,
        { timeout: 10000 },
      )
    }

    // The victim feels the ambush: the toast counts down (STAIRS-19) and the
    // stairs screen reads stunned.
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
    await victim.waitForFunction(
      () => document.querySelector('.stair-screen-phase')?.textContent === 'stunned',
      undefined,
      { timeout: 8000 },
    )
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
