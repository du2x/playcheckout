import { expect, type Page, test } from '@playwright/test'

// Spec REST-14..16 (gate scenario client:restaurant, cycle 3.C): the
// mezzanine is a first-class floor view — the M press rides there, the view
// renders panels with NO door frames (the mezzanine has no rooms), and a
// checked-in guest shows the amber dining cue on the mezzanine lane.
// Guest timing rides the AD-028 seam (scale 0.2 in playwright.config); the
// 60 s shift leaves room for the doubled lobby ride legs.

async function join(page: Page, code: string, name: string): Promise<void> {
  await page.goto('/')
  await page.fill('#join-code', code)
  await page.fill('#join-name', name)
  await page.click('#join-submit')
}

async function fourPlayerRound(pages: Page[]): Promise<void> {
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
  for (const page of pages) {
    await page.waitForSelector('#round-hud', { timeout: 5000 })
  }
}

/** The own player's newest streamed x (backwards scan — see justice.spec). */
async function ownX(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          events: { type: string; payload?: { playerId?: string; x?: number } }[]
          local: { playerId: string | null }
        }
      }
    ).__TURNOVER__
    const own = t.local.playerId
    for (let i = t.events.length - 1; i >= 0; i--) {
      const e = t.events[i]
      if (e === undefined || e.type !== 'player:moved') continue
      if (e.payload?.playerId !== own) continue
      return typeof e.payload.x === 'number' ? e.payload.x : null
    }
    return null
  })
}

async function sceneArcs(
  page: Page,
): Promise<{ fillColor: number; visible: boolean; y: number }[]> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: { list: { type: string; fillColor: number; visible: boolean; y: number }[] }
          } | null
        }
      }
    ).__TURNOVER__
    const list = t.scene('Round')?.children?.list ?? []
    return list
      .filter((c) => c.type === 'Arc')
      .map((c) => ({ fillColor: c.fillColor, visible: c.visible, y: c.y }))
  })
}

test.describe('client:restaurant', () => {
  test('M rides to the mezzanine, the view shows no door frames, and diners render the dining cue', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const pages = await Promise.all(
      [0, 1, 2, 3].map(async () => await (await browser.newContext()).newPage()),
    )
    try {
      await fourPlayerRound(pages)
      const rider = pages[0] as Page
      const clerk = pages[1] as Page

      // The rider walks to the west landing and boards with the call press —
      // guests are elevator citizens (AD-028), so press until the chip shows.
      await rider.keyboard.down('ArrowLeft')
      await rider.waitForTimeout(3000)
      await rider.keyboard.up('ArrowLeft')
      for (let i = 0; i < 15; i++) {
        await rider.keyboard.press('ArrowUp')
        try {
          await rider.waitForFunction(
            () =>
              document.querySelector('#elevator-riders') !== null &&
              !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
            undefined,
            { timeout: 2000 },
          )
          break
        } catch {
          // The car is still en route — press again when it arrives.
        }
      }
      await rider.waitForFunction(
        () =>
          document.querySelector('#elevator-riders') !== null &&
          !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
        undefined,
        { timeout: 8000 },
      )

      // REST-15: press M — the rider chip lights the mezzanine indicator.
      await rider.keyboard.press('m')
      await rider.waitForFunction(
        () =>
          document.querySelectorAll('#elevator-riders .floor-indicator.lit[data-floor="mezzanine"]')
            .length === 1,
        undefined,
        { timeout: 8000 },
      )

      // REST-14: the car serves the mezzanine — the view follows the own
      // floor, so the panel readout switches to 'mezzanine'.
      await rider.waitForFunction(
        () =>
          document.querySelector('#panel-west')?.textContent === 'mezzanine' ||
          document.querySelector('#panel-east')?.textContent === 'mezzanine',
        undefined,
        { timeout: 20000 },
      )

      // The clerk stays at the spawn cluster (the desk zone) and checks the
      // front guest in once one is queued — the desk hint gates the press,
      // and E retries mirror the suitcase-spec pattern (AD-028 play).
      await clerk.waitForFunction(
        () =>
          (
            window as unknown as {
              __TURNOVER__: { events: { type: string }[] }
            }
          ).__TURNOVER__.events.some((e) => e.type === 'guest:arrived'),
        undefined,
        { timeout: 30000 },
      )
      await clerk.waitForFunction(
        () =>
          (document.querySelector('#desk-hint') as HTMLElement | null)?.style.visibility ===
          'visible',
        undefined,
        { timeout: 10000 },
      )
      for (let i = 0; i < 8; i++) {
        await clerk.keyboard.down('e')
        await clerk.keyboard.up('e')
        try {
          await clerk.waitForFunction(
            () =>
              (
                window as unknown as {
                  __TURNOVER__: { events: { type: string }[] }
                }
              ).__TURNOVER__.events.some((e) => e.type === 'suitcase:carried'),
            undefined,
            { timeout: 2000 },
          )
          break
        } catch {
          // The queue may have been momentarily empty — press again.
        }
      }

      // REST-14: exit through the doors at the mezzanine landing (retry the
      // held direction while the opening swing runs), then confirm the view.
      await rider.keyboard.down('ArrowRight')
      for (let i = 0; i < 20; i++) {
        await rider.waitForTimeout(300)
        const x = await ownX(rider)
        if (x !== null && x > 0.5) break
        await rider.keyboard.up('ArrowRight')
        await rider.keyboard.down('ArrowRight')
      }
      await rider.keyboard.up('ArrowRight')
      await rider.waitForFunction(
        () => document.querySelector('#elevator-riders')?.hasAttribute('hidden') === true,
        undefined,
        { timeout: 8000 },
      )

      // REST-14: the mezzanine view renders NO door frames — every door image
      // is hidden (doors exist on guest floors only).
      const visibleDoors = await rider.evaluate(() => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: {
                  list: { type: string; name: string; visible: boolean }[]
                } | null
              }
            }
          }
        ).__TURNOVER__
        const list = t.scene('Round')?.children?.list ?? []
        return list.filter((c) => c.type === 'Image' && c.name.startsWith('door:') && c.visible)
          .length
      })
      expect(visibleDoors).toBe(0)

      // REST-16: the checked-in guest dines on the mezzanine — the amber
      // dining cue (a visible Arc on the mezzanine lane). Poll until the
      // guest lands in its dining slot.
      await rider.waitForFunction(
        () => {
          const t = (
            window as unknown as {
              __TURNOVER__: {
                scene: (name: string) => {
                  children: {
                    list: { type: string; fillColor: number; visible: boolean }[]
                  } | null
                }
              }
            }
          ).__TURNOVER__
          const DINING_FILL = 0xffd27a
          return (t.scene('Round')?.children?.list ?? []).some(
            (c) => c.type === 'Arc' && c.visible && c.fillColor === DINING_FILL,
          )
        },
        undefined,
        { timeout: 20000 },
      )
      const arcs = await sceneArcs(rider)
      expect(arcs.some((a) => a.visible && a.fillColor === 0xffd27a)).toBe(true)
    } finally {
      for (const page of pages) await page.close()
    }
  })
})
