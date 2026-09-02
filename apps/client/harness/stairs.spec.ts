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

    // Elevator-only: the stairwell screen stays hidden — the lift is the star.
    // Stairs still work (phase-free), but the fullscreen stair overlay is gone.
    const bruno = pages[1] as Page
    await walkToMouth(bruno)
    await bruno.keyboard.press('ArrowUp')
    await bruno.waitForTimeout(800)
    expect(
      await bruno.evaluate(
        () =>
          document.querySelector('#elevator-stair-screen') === null ||
          document.querySelector('#elevator-stair-screen')?.hasAttribute('hidden') === true,
      ),
    ).toBe(true)
    // Let bruno finish the stair transit off-screen before starting the round
    await bruno.waitForTimeout(5000)

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
    // already rode the stairs pre-round — elevator-only keeps the stair
    // screen hidden, but the ambush still fires.
    if (saboteurIdx === 1) {
      await walkToMouth(victim) // the victim is on the lobby floor
      await victim.keyboard.press('ArrowUp') // lobby → mezzanine
      await victim.waitForTimeout(800)
      await saboteur.keyboard.press('ArrowDown') // mezzanine → lobby
      await saboteur.waitForTimeout(800)
    } else {
      // Both on the lobby: the victim rides up first, frees at the mezzanine
      // mouth, then descends into the saboteur's up-transit.
      await walkToMouth(victim)
      await walkToMouth(saboteur)
      await victim.keyboard.press('ArrowUp') // lobby → mezzanine (3 s + 2 s breath)
      await victim.waitForTimeout(6000)
      await victim.keyboard.press('ArrowDown')
      await victim.waitForTimeout(800)
      await saboteur.waitForTimeout(400)
      await saboteur.keyboard.press('ArrowUp')
      await saboteur.waitForTimeout(800)
    }

    // The victim feels the ambush: the toast counts down (STAIRS-19).
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
