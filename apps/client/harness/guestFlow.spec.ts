import { expect, type Page, test } from '@playwright/test'

// Spec GUEST-12/13 (gate scenario client:guest_flow) + Phase 4.1 VPOL-06/07:
// one guest-* archetype Sprite per guest (tinted from the decorrelated guest
// seed — never a player texture, never staff ivory/brass), the desk queue on
// the lobby lane, the free impatience cue (bouncing marker + desk bell line),
// own-floor-only guest visibility (AD-009 sameFloor policy), and NO complaint
// counter (that UI is cycle 3.3's).
// Guest timing rides the AD-028 test seam (scale 0.1 in playwright.config).

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

interface GuestMarker {
  type: string
  x: number
  y: number
  visible: boolean
}

async function readGuestMarkers(page: Page): Promise<GuestMarker[]> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: {
              list: {
                type: string
                x: number
                y: number
                visible: boolean
                texture?: { key: string }
              }[]
            }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    const list = scene?.children?.list ?? []
    return list
      .filter((c) => c.type === 'Sprite' && (c.texture?.key ?? '').startsWith('guest-'))
      .map((c) => ({ type: c.texture?.key ?? '', x: c.x, y: c.y, visible: c.visible }))
  })
}

test.describe('client:guest_flow', () => {
  test('guest markers queue at the desk, the bell rings, and guests stay own-floor', async ({
    browser,
  }) => {
    test.setTimeout(45000)
    const pages = await Promise.all(
      [0, 1, 2, 3].map(async () => await (await browser.newContext()).newPage()),
    )
    try {
      await fourPlayerRound(pages)
      const own = pages[0] as Page

      // GUEST-12 + VPOL-06: a distinct guest marker appears on the lobby lane
      // — a `guest-*` archetype Sprite, never a player texture or a generic
      // shape, and at least one is visible at the desk.
      await own.waitForFunction(
        () => {
          const t = (
            window as unknown as {
              __TURNOVER__: {
                scene: (name: string) => {
                  children: {
                    list: { type: string; visible: boolean; texture?: { key: string } }[]
                  }
                } | null
              }
            }
          ).__TURNOVER__
          return (t.scene('Round')?.children.list ?? []).some(
            (c) => c.type === 'Sprite' && (c.texture?.key ?? '').startsWith('guest-') && c.visible,
          )
        },
        { timeout: 25000 },
      )
      const markers = await readGuestMarkers(own)
      expect(markers.length).toBeGreaterThan(0)

      // GUEST-13: the desk-bell line appears while a queued guest is
      // impatient (impatience is free — no counter anywhere).
      await own.waitForSelector('#desk-bell', { state: 'visible', timeout: 25000 })

      // GUEST-12: no cross-floor guest delivery — this page never left the
      // lobby, so every guest:moved it received must carry floor 'lobby'.
      const crossFloor = await own.evaluate(() => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              events: { type: string; payload?: { floor?: string } }[]
            }
          }
        ).__TURNOVER__
        return t.events.filter(
          (e) =>
            e.type === 'guest:moved' &&
            e.payload?.floor !== undefined &&
            e.payload.floor !== 'lobby',
        ).length
      })
      expect(crossFloor).toBe(0)

      // Cycle 3.3 staging guard: the complaint counter does not exist yet.
      const complaintCounter = await own.evaluate(
        () => document.querySelector('#complaint-counter') !== null,
      )
      expect(complaintCounter).toBe(false)
    } finally {
      for (const page of pages) await page.close()
    }
  })
})
