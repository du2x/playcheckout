import { expect, type Page, test } from '@playwright/test'

// Gate scenarios client:juice_small + client:camera_juice (Phase 4.1,
// VPOL-13..17): the anger cue pops (Back.Out scale) with dust, and the
// camera shakes exactly for firing/ambush — never for routine movement.
// Juice rides the synthetic scene-action injection (the complaints.spec
// pattern) so no full justice flow is needed to exercise the presentation.

async function join(page: Page, code: string, name: string) {
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

test.describe('client:juice_small', () => {
  test('the anger cue pops with scale and expires by its TTL (VPOL-15)', async ({ browser }) => {
    test.setTimeout(45_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    try {
      await fourPlayerRound(pages)
      const own = pages[0] as Page
      // Route the viewed floor to floor1 and dispatch the synthetic anger cue.
      await own.evaluate(() => {
        const w = window as unknown as {
          __TURNOVER__: { scene: (name: string) => Record<string, unknown> | null }
        }
        const scene = w.__TURNOVER__.scene('Round')
        if (scene !== null) scene.viewFloor = 'floor1'
      })
      await own.evaluate(() => {
        const w = window as unknown as {
          __TURNOVER__: { scene: (name: string) => { applyAction: (a: unknown) => void } | null }
        }
        w.__TURNOVER__.scene('Round')?.applyAction({
          type: 'guest-angered',
          guestId: 'guest:99',
          floor: 'floor1',
          room: 3,
        })
      })
      // The pop: shortly after dispatch the cue's scale is mid-animation
      // (non-1, non-zero) — the Back.Out pop, not a static glyph.
      const popped = await own.waitForFunction(
        () => {
          const t = (
            window as unknown as {
              __TURNOVER__: {
                scene: (name: string) => {
                  children: {
                    list: { type: string; text?: string; visible: boolean; scale?: number }[]
                  }
                } | null
              }
            }
          ).__TURNOVER__
          const list = t.scene('Round')?.children.list ?? []
          return list.some(
            (c) =>
              c.type === 'Text' &&
              c.text === '!' &&
              c.visible &&
              typeof c.scale === 'number' &&
              c.scale > 1.05,
          )
        },
        undefined,
        { timeout: 2000 },
      )
      expect(popped).toBeTruthy()
      // The TTL: the cue is gone within ~2.5 s (1800 ms TTL + pruning).
      await own.waitForTimeout(2400)
      const remaining = await own.evaluate(() => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: { list: { type: string; text?: string; visible: boolean }[] }
              } | null
            }
          }
        ).__TURNOVER__
        return (t.scene('Round')?.children.list ?? []).filter(
          (c) => c.type === 'Text' && c.text === '!',
        ).length
      })
      expect(remaining).toBe(0)
    } finally {
      for (const page of pages) await page.close()
    }
  })
})

test.describe('client:camera_juice', () => {
  test('shake fires for firing/ambush and never for movement (VPOL-16/17)', async ({ browser }) => {
    test.setTimeout(45_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    try {
      await fourPlayerRound(pages)
      const own = pages[0] as Page

      const shakeRunning = (page: Page) =>
        page.evaluate(() => {
          const t = (
            window as unknown as {
              __TURNOVER__: {
                scene: (name: string) => {
                  cameras?: {
                    main?: { shakeEffect?: { isRunning?: boolean } }
                  }[]
                } | null
              }
            }
          ).__TURNOVER__
          const scene = t.scene('Round') as unknown as {
            cameras?: { main?: { shakeEffect?: { isRunning?: boolean } } }
          } | null
          return scene?.cameras?.main?.shakeEffect?.isRunning === true
        })

      // Negative half (VPOL-16): routine movement never shakes. Dispatch a
      // synthetic player-moved and confirm no shake within a frame budget.
      await own.evaluate(() => {
        const w = window as unknown as {
          __TURNOVER__: { scene: (name: string) => { applyAction: (a: unknown) => void } | null }
        }
        w.__TURNOVER__.scene('Round')?.applyAction({
          type: 'player-moved',
          playerId: 'someone-else',
          floor: 'lobby',
          x: 16,
          facing: 'left',
        })
      })
      await own.waitForTimeout(120)
      expect(await shakeRunning(own)).toBe(false)

      // Positive half: a firing shakes the camera (VPOL-16) — the removed
      // display makes the shake the only visible beat.
      await own.evaluate(() => {
        const w = window as unknown as {
          __TURNOVER__: { scene: (name: string) => { applyAction: (a: unknown) => void } | null }
        }
        w.__TURNOVER__.scene('Round')?.applyAction({
          type: 'player-fired',
          playerId: 'someone-else',
        })
      })
      await own.waitForTimeout(60)
      expect(await shakeRunning(own)).toBe(true)
      // Input stays enabled during the shake (VPOL-17).
      const inputOk = await own.evaluate(() => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => { input?: { keyboard?: { enabled?: boolean } } } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round') as unknown as {
          input?: { keyboard?: { enabled?: boolean } }
        } | null
        return scene?.input?.keyboard?.enabled !== false
      })
      expect(inputOk).toBe(true)
    } finally {
      for (const page of pages) await page.close()
    }
  })
})
