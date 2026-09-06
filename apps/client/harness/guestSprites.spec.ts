import { expect, type Page, test } from '@playwright/test'

// Gate scenario client:guest_sprites (Phase 4.1, VPOL-06..09): guests render
// as archetype Sprites tinted from the decorrelated guest seed — never staff
// ivory/brass (VPOL-07), dining tint differs from the queue tint (VPOL-08),
// and guest:left destroys the view (VPOL-09).
// Guest timing rides the AD-028 test seam (scale 0.1 in playwright.config).

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

interface GuestRead {
  texture: string
  tint: number
  visible: boolean
  x: number
}

function readGuests(page: Page): Promise<GuestRead[]> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: {
              list: {
                type: string
                visible: boolean
                x: number
                tint: { color: number }
                texture: { key: string }
              }[]
            }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    if (scene === null) return []
    return scene.children.list
      .filter((c) => c.type === 'Sprite' && (c.texture?.key ?? '').startsWith('guest-'))
      .map((c) => ({
        texture: c.texture.key,
        tint: c.tint?.color ?? 0xffffff,
        visible: c.visible,
        x: c.x,
      }))
  })
}

test.describe('client:guest_sprites', () => {
  test('guests are archetype sprites with civil palettes, never staff livery (VPOL-06/07)', async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    try {
      await fourPlayerRound(pages)
      const own = pages[0] as Page
      await own.waitForFunction(
        () =>
          (
            window as unknown as {
              __TURNOVER__: {
                scene: (name: string) => {
                  children: {
                    list: { type: string; visible: boolean; texture: { key: string } }[]
                  }
                } | null
              }
            }
          ).__TURNOVER__
            .scene('Round')
            ?.children.list.some(
              (c) =>
                c.type === 'Sprite' && (c.texture?.key ?? '').startsWith('guest-') && c.visible,
            ) === true,
        undefined,
        { timeout: 25000 },
      )
      const guests = await readGuests(own)
      expect(guests.length).toBeGreaterThan(0)
      // VPOL-06: every guest is an archetype texture from the 10-silhouette
      // set. Seated diners (furnishing slice) render the per-archetype `-sit`
      // variant of the same silhouette — normalize before the allowlist read.
      const archetypes = new Set(guests.map((g) => g.texture.replace(/-sit$/, '')))
      for (const a of archetypes) {
        expect([
          'guest-suite',
          'guest-tourist',
          'guest-clerk',
          'guest-elder',
          'guest-dandy',
          'guest-diva',
          'guest-flapper',
          'guest-merchant',
          'guest-professor',
          'guest-child',
        ]).toContain(a)
      }
      // VPOL-07: no staff livery — tints are civil Deco rotations, never the
      // ivory uniform or the brass trim channels.
      const STAFF_LIVERY = [0xf2ead8, 0xf6f1e6, 0xc9a13b, 0xb3873a]
      for (const g of guests) {
        for (const livery of STAFF_LIVERY) {
          expect(g.tint & 0xffffff).not.toBe(livery)
        }
      }
      // VPOL-09: guest:left destroys the view. Synthetic injection (the
      // complaints.spec precedent): a fake guest with a seed mapping to the
      // `elder` archetype (seed % 10 === 3 — the original four keep their
      // historical order) arrives — one more elder sprite — then leaves —
      // the count returns to baseline (destroyed, not hidden).
      const elderCount = () =>
        own.evaluate(() => {
          const t = (
            window as unknown as {
              __TURNOVER__: {
                scene: (name: string) => {
                  children: { list: { type: string; texture: { key: string } }[] }
                } | null
              }
            }
          ).__TURNOVER__
          return (t.scene('Round')?.children.list ?? []).filter(
            (c) => c.type === 'Sprite' && c.texture?.key === 'guest-elder',
          ).length
        })
      const baseElders = await elderCount()
      await own.evaluate(() => {
        const w = window as unknown as {
          __TURNOVER__: { scene: (name: string) => { applyAction: (a: unknown) => void } | null }
        }
        const scene = w.__TURNOVER__.scene('Round')
        scene?.applyAction({ type: 'guest-arrived', guestId: 'guest:vx' })
        scene?.applyAction({ type: 'cosmetic-guest', guestId: 'guest:vx', seed: 3 })
      })
      await own.waitForFunction(
        (base) => {
          const t = (
            window as unknown as {
              __TURNOVER__: {
                scene: (name: string) => {
                  children: { list: { type: string; texture: { key: string } }[] }
                } | null
              }
            }
          ).__TURNOVER__
          const now = (t.scene('Round')?.children.list ?? []).filter(
            (c) => c.type === 'Sprite' && c.texture?.key === 'guest-elder',
          ).length
          return now === (base as number) + 1
        },
        baseElders,
        { timeout: 5000 },
      )
      await own.evaluate(() => {
        const w = window as unknown as {
          __TURNOVER__: { scene: (name: string) => { applyAction: (a: unknown) => void } | null }
        }
        const scene = w.__TURNOVER__.scene('Round')
        scene?.applyAction({ type: 'guest-left', guestId: 'guest:vx' })
      })
      await own.waitForFunction(
        (base) => {
          const t = (
            window as unknown as {
              __TURNOVER__: {
                scene: (name: string) => {
                  children: { list: { type: string; texture: { key: string } }[] }
                } | null
              }
            }
          ).__TURNOVER__
          const now = (t.scene('Round')?.children.list ?? []).filter(
            (c) => c.type === 'Sprite' && c.texture?.key === 'guest-elder',
          ).length
          return now === (base as number)
        },
        baseElders,
        { timeout: 5000 },
      )
      for (const page of pages) await page.close()
    } finally {
      for (const page of pages) await page.close().catch(() => {})
    }
  })
})
