import { expect, type Page, test } from '@playwright/test'

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
  if (code === undefined) throw new Error(`no room code in heading: ${heading}`)
  for (const [index, name] of ['bruno', 'caro', 'dina'].entries()) {
    await join(pages[index + 1] as Page, code, name)
  }
  await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)
  await host.click('#start-button')
  for (const page of pages) {
    await page.waitForSelector('#round-hud', { timeout: 5000 })
  }
}
async function readComplaintHud(page: Page): Promise<string> {
  return (await page.textContent('#complaint-hud')) ?? ''
}
async function readWalkie(page: Page): Promise<string> {
  return (await page.textContent('#walkie-log')) ?? ''
}
async function readAngerCues(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __TURNOVER__: {
        scene: (name: string) => {
          children: { list: { type: string; text?: string; visible: boolean }[] } | null
        }
      }
    }
    const scene = w.__TURNOVER__.scene('Round')
    const list = scene?.children?.list ?? []
    return list.filter((c) => c.type === 'Text' && c.text === '!' && c.visible).length
  })
}
test.describe('client:complaint_cues', () => {
  test('synthetic discovery increments the counter + walkie, and the anger cue is sameFloor (COMP-20..23)', async ({
    browser,
  }) => {
    test.setTimeout(60000)
    const pages = await Promise.all([0, 1, 2, 3].map(async () => await (await browser.newContext()).newPage()))
    try {
      await fourPlayerRound(pages)
      const host = pages[0]!
      const floor1Witness = pages[1]!
      // Move the witness to floor1 via the robust ride helper is heavy for a
      // synthetic test — instead, set the witness's viewFloor to floor1 by
      // riding is not needed: the anger cue's sameFloor gate is server-side,
      // but the synthetic applyAction bypasses the transport gate. To keep the
      // harness honest, dispatch the cue via the scene's own applyAction on
      // each page: only the pages whose viewFloor matches the cue's floor
      // will render it visible (the per-frame visibility filter).
      // First, assert the initial HUD.
      expect(await readComplaintHud(host)).toBe('Complaints 0 / 8')
      // Put the witness on floor1 so the sameFloor cue is visible there
      // (the server would have gated delivery; here we gate via the scene's
      // own visibility filter).
      await pages[1]!.evaluate(() => {
        const w = window as unknown as {
          __TURNOVER__: { scene: (name: string) => unknown | null }
        }
        const scene = w.__TURNOVER__.scene('Round') as unknown as Record<string, unknown>
        if (scene !== null) (scene as Record<string, unknown>)['viewFloor'] = 'floor1'
      })
      // Dispatch a synthetic trash-discovery complaint (the server would have
      // sent guest:discovered + guest:angered in the same flush; here we
      // dispatch them as the scene would receive them — one scene action at
      // a time, anger cue first).
      for (const p of pages) {
        await p.evaluate(() => {
          const w = window as unknown as {
            __TURNOVER__: { scene: (name: string) => { applyAction: (a: unknown) => void } | null }
          }
          const scene = w.__TURNOVER__.scene('Round')
          scene?.applyAction({ type: 'guest-angered', guestId: 'guest:99', floor: 'floor1', room: 3 })
        })
      }
      // Let the per-frame visibility settle.
      await host.waitForTimeout(300)
      const hostCues = await readAngerCues(host)
      const witnessCues = await readAngerCues(pages[1]!)
      expect(hostCues).toBe(0)
      expect(witnessCues).toBe(1)
      // Dispatch the desk report on every page — the walkie + HUD are building-wide.
      for (const p of pages) {
        await p.evaluate(() => {
          const w = window as unknown as {
            __TURNOVER__: { scene: (name: string) => { applyAction: (a: unknown) => void } | null }
          }
          const scene = w.__TURNOVER__.scene('Round')
          scene?.applyAction({
            type: 'guest-discovered',
            guestId: 'guest:99',
            floor: 'floor1',
            room: 3,
            fresh: true,
          })
        })
      }
      await host.waitForTimeout(300)
      const hud = await readComplaintHud(host)
      expect(hud).toBe('Complaints 1 / 8')
      for (const p of pages) expect(await readComplaintHud(p)).toBe('Complaints 1 / 8')
      const walkie = await readWalkie(host)
      expect(walkie).toMatch(/a guest reports: someone hit floor1:3 — maybe a minute ago/)
      // Wrong-delivery inertness: a door complaint must not move the counter.
      for (const p of pages) {
        await p.evaluate(() => {
          const w = window as unknown as {
            __TURNOVER__: { scene: (name: string) => { applyAction: (a: unknown) => void } | null }
          }
          const scene = w.__TURNOVER__.scene('Round')
          scene?.applyAction({ type: 'guest-complained', guestId: 'guest:100', floor: 'floor2', room: 5 })
        })
      }
      await host.waitForTimeout(300)
      expect(await readComplaintHud(host)).toBe('Complaints 1 / 8')
      const walkie2 = await readWalkie(host)
      expect(walkie2).toMatch(/complained about the suitcase/)
    } finally {
      for (const p of pages) await p.close()
    }
  })
})
