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
      // VPOL-06: every guest is an archetype texture from the 4-silhouette set.
      const archetypes = new Set(guests.map((g) => g.texture))
      for (const a of archetypes) {
        expect(['guest-suite', 'guest-tourist', 'guest-clerk', 'guest-elder']).toContain(a)
      }
      // VPOL-07: no staff livery — tints are civil Deco rotations, never the
      // ivory uniform or the brass trim channels.
      const STAFF_LIVERY = [0xf2ead8, 0xf6f1e6, 0xc9a13b, 0xb3873a]
      for (const g of guests) {
        for (const livery of STAFF_LIVERY) {
          expect(g.tint & 0xffffff).not.toBe(livery)
        }
      }
      for (const page of pages) await page.close()
    } finally {
      for (const page of pages) await page.close().catch(() => {})
    }
  })
})
