import { expect, type Page, test } from '@playwright/test'

// Spec DLVR-05/06/09/10/11 (gate scenario client:score_hud, cycle 3.D): the
// settle counter ticks on every public guest:settled fact, freezes at the
// buzzer, and the results screen shows the same number against the §7 v1.5
// 4-player target (5). The guest economy rides the AD-028 test seam
// (scale 0.2 in playwright.config). The winner assertion is score-derived:
// whichever side the final count favors is the side the banner must name.
const TARGET = '5'

async function join(page: Page, code: string, name: string): Promise<void> {
  await page.goto('/')
  await page.fill('#join-code', code)
  await page.fill('#join-name', name)
  await page.click('#join-submit')
}

test.describe('client:score_hud', () => {
  test('settles drive the counter, it freezes at the buzzer, and the recap score matches', async ({
    browser,
  }) => {
    test.setTimeout(170_000) // the 60 s test shift plus choreography
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    const host = pages[0] as Page
    await host.goto('/')
    await host.fill('#join-name', 'ada')
    await host.click('#create-button')
    await host.waitForSelector('#lobby-view')
    const heading = await host.textContent('#lobby-view h2')
    const code = heading?.match(/room ([A-Z]{4})/)?.[1]
    if (code === undefined) throw new Error(`no room code in lobby heading: ${heading}`)
    for (const [index, name] of ['bruno', 'caro', 'dina'].entries()) {
      await join(pages[index + 1] as Page, code, name)
    }
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)

    await host.click('#start-button')
    for (const page of pages) await page.waitForSelector('#round-hud')

    // DLVR-09/10: the HUD renders Settled N / T and ticks on public settles.
    for (const page of pages) {
      await page.waitForSelector('#score-hud')
      expect(await page.textContent('#score-hud')).toBe(`Settled 0 / ${TARGET}`)
    }
    await host.waitForFunction(
      () => /^Settled [1-9]/.test(document.querySelector('#score-hud')?.textContent ?? ''),
      undefined,
      { timeout: 40_000 },
    )

    // The round runs to the buzzer; the verdict is score-driven (DLVR-05/06
    // are pinned at Gate 2 by sim:win_checks). Harness guest density can
    // strand boarders at a saturated landing, so the final count is read,
    // not assumed.
    for (const page of pages) {
      await page.waitForSelector('#results-view', { timeout: 90_000 })
    }

    // DLVR-11: the recap names the verdict's inputs — score vs target.
    const recapScore = await host.textContent('#results-score')
    expect(recapScore).toMatch(new RegExp(`^settled (\\d+) of ${TARGET} guests$`))
    const final = recapScore?.match(/settled (\d+) of/)?.[1]
    if (final === undefined) throw new Error(`unparseable recap score: ${recapScore}`)
    const expectedBanner = Number(final) >= Number(TARGET) ? 'STAFF WINS' : 'SABOTEUR WINS'
    for (const page of pages) {
      await expect(page.locator('#results-banner')).toHaveText(expectedBanner)
    }

    // DLVR-09: the HUD froze at exactly the recap's number — one counter,
    // two surfaces, the same public fact stream.
    expect(await host.textContent('#score-hud')).toBe(`Settled ${final} / ${TARGET}`)
  })
})
