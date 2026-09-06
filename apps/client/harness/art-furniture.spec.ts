import { expect, type Page, test } from '@playwright/test'

// Gate scenario client:art_furniture (lobby/mezzanine furnishing slice): the
// lobby renders its reception desk + Deco seating, the mezzanine renders the
// restaurant dining set (chairs pinned to the sim's dining-slot formula,
// shared tables between the pairs), and a checked-in guest dining on the
// mezzanine renders SEATED — sit texture, seat-top lift, flipped on
// west-facing slots — then stands again once its suitcase rests (SUI-13).
// Furniture adds no top-level Rectangles (LIGHT-09 harness contract).

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

interface FurnitureRead {
  name: string
  visible: boolean
  x: number
  depth: number
  flipX: boolean
}

function readFurniture(page: Page): Promise<FurnitureRead[]> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: {
              list: {
                type: string
                name: string
                visible: boolean
                x: number
                depth: number
                flipX: boolean
              }[]
            }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    if (scene === null) return []
    return scene.children.list
      .filter((c) => c.type === 'Image' && c.name.startsWith('furniture:'))
      .map((c) => ({ name: c.name, visible: c.visible, x: c.x, depth: c.depth, flipX: c.flipX }))
  })
}

interface GuestRead {
  texture: string
  visible: boolean
  y: number
  depth: number
  flipX: boolean
  tint: number
}

/** The guest sprite rendered at lane x (px), or null. */
function readGuestAt(page: Page, xPx: number): Promise<GuestRead | null> {
  return page.evaluate((x) => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: {
              list: {
                type: string
                visible: boolean
                x: number
                y: number
                depth: number
                flipX: boolean
                tint: { color: number }
                texture: { key: string }
              }[]
            }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    if (scene === null) return null
    const found = scene.children.list.find(
      (c) => c.type === 'Sprite' && (c.texture?.key ?? '').startsWith('guest-') && c.x === x,
    )
    return found
      ? {
          texture: found.texture.key,
          visible: found.visible,
          y: found.y,
          depth: found.depth,
          flipX: found.flipX,
          tint: found.tint?.color ?? 0xffffff,
        }
      : null
  }, xPx)
}

// The synthetic diner sits at slot 7 (tile 25) — the least-occupied chair,
// since real diners fill the slots FIFO from slot 0.
const SLOT7_PX = 25 * 32

test.describe('client:art_furniture', () => {
  test('lobby shows desk + seating, mezzanine shows the dining set, no Rectangles', async ({
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
              __TURNOVER__: { scene: (name: string) => { children: { list: unknown[] } } | null }
            }
          ).__TURNOVER__.scene('Round') !== null,
        undefined,
        { timeout: 15000 },
      )
      // LIGHT-09: the furnishing slice adds Images only — the top-level
      // Rectangle count the art contracts pin stays exactly zero.
      const rectangles = await own.evaluate(() => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => { children: { list: { type: string }[] } } | null
            }
          }
        ).__TURNOVER__
        return (t.scene('Round')?.children.list ?? []).filter((c) => c.type === 'Rectangle').length
      })
      expect(rectangles).toBe(0)

      // Lobby view (the round starts there): desk + benches + plants visible;
      // the mezzanine set exists but rides the own-floor visibility rule.
      const lobby = await readFurniture(own)
      const lobbySet = lobby.filter((f) => f.name.startsWith('furniture:lobby:'))
      const named = (name: string) => lobbySet.find((f) => f.name === `furniture:lobby:${name}`)
      expect(named('desk')).toBeDefined()
      expect(named('desk')?.visible).toBe(true)
      expect(named('desk')?.x).toBe(14 * 32) // counter face lands on DESK_X (AD-028/031)
      // The receptionist NPC stands behind the counter, front-facing: within
      // the desk body, drawn BEHIND it (lower depth), never flipped.
      expect(named('receptionist')).toBeDefined()
      expect(named('receptionist')?.visible).toBe(true)
      expect(named('receptionist')?.x).toBe(13.75 * 32)
      expect(named('receptionist')?.depth).toBeLessThan(named('desk')?.depth ?? 0)
      expect(named('receptionist')?.flipX).toBe(false)
      expect(named('bench-west')).toBeDefined()
      expect(named('bench-east')?.flipX).toBe(true)
      expect(named('plant-west')).toBeDefined()
      expect(named('plant-mid')).toBeDefined()
      expect(named('plant-east')).toBeDefined()
      for (const f of lobby.filter((f) => f.name.startsWith('furniture:mezzanine:'))) {
        expect(f.visible).toBe(false)
      }

      // Switch the own view to the mezzanine (synthetic own moved — the
      // view follows the own floor): the restaurant set becomes visible.
      await own.evaluate(() => {
        const w = window as unknown as {
          __TURNOVER__: {
            local: { playerId: string | null }
            scene: (name: string) => { applyAction: (a: unknown) => void } | null
          }
        }
        const scene = w.__TURNOVER__.scene('Round')
        const ownId = w.__TURNOVER__.local.playerId
        scene?.applyAction({
          type: 'player-moved',
          playerId: ownId,
          floor: 'mezzanine',
          x: 10,
          facing: 'right',
        })
      })
      await own.waitForFunction(
        () =>
          (
            window as unknown as {
              __TURNOVER__: {
                scene: (name: string) => {
                  children: { list: { name: string; visible: boolean }[] }
                } | null
              }
            }
          ).__TURNOVER__
            .scene('Round')
            ?.children.list.some((c) => c.name === 'furniture:mezzanine:chair-0' && c.visible) ===
          true,
        undefined,
        { timeout: 5000 },
      )
      const mezz = await readFurniture(own)
      // 8 chairs pinned to the sim's slot formula (18 + slot tiles), 4 shared
      // tables between each pair.
      const chairs = mezz.filter((f) => /:chair-\d$/.test(f.name))
      const tables = mezz.filter((f) => /:table-\d$/.test(f.name))
      expect(chairs).toHaveLength(8)
      expect(tables).toHaveLength(4)
      for (const [slot, chair] of chairs.entries()) {
        expect(chair.x).toBe((18 + slot) * 32)
        expect(chair.flipX).toBe(slot % 2 === 1) // odd slots face west
      }
      expect(tables.find((f) => f.name === 'furniture:mezzanine:table-0')?.x).toBe(18.5 * 32)
      // The kitchen double door hangs west of the restaurant, visible only on
      // this floor (the lobby pass above already proved it hidden there).
      const kitchen = mezz.find((f) => f.name === 'furniture:mezzanine:kitchen-door')
      expect(kitchen).toBeDefined()
      expect(kitchen?.visible).toBe(true)
      expect(kitchen?.x).toBe(16 * 32)
      for (const page of pages) await page.close()
    } finally {
      for (const page of pages) await page.close().catch(() => {})
    }
  })

  test('a checked-in diner sits at its slot and stands when the suitcase rests', async ({
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
              __TURNOVER__: { scene: (name: string) => { children: { list: unknown[] } } | null }
            }
          ).__TURNOVER__.scene('Round') !== null,
        undefined,
        { timeout: 15000 },
      )
      // Ride the view to the mezzanine, then inject a synthetic diner: seed 2
      // → the clerk archetype (seed % 10). guest:assigned is the check-in
      // notice — the moment the guest seats itself in the restaurant.
      await own.evaluate(() => {
        const w = window as unknown as {
          __TURNOVER__: {
            local: { playerId: string | null }
            scene: (name: string) => { applyAction: (a: unknown) => void } | null
          }
        }
        const scene = w.__TURNOVER__.scene('Round')
        const ownId = w.__TURNOVER__.local.playerId
        scene?.applyAction({
          type: 'player-moved',
          playerId: ownId,
          floor: 'mezzanine',
          x: 10,
          facing: 'right',
        })
        scene?.applyAction({ type: 'cosmetic-guest', guestId: 'guest:vx', seed: 2 })
        scene?.applyAction({
          type: 'guest-assigned',
          guestId: 'guest:vx',
          floor: 'floor1',
          room: 2,
        })
        scene?.applyAction({ type: 'guest-moved', guestId: 'guest:vx', floor: 'mezzanine', x: 25 })
      })
      await own.waitForFunction(
        (x) =>
          (
            window as unknown as {
              __TURNOVER__: {
                scene: (name: string) => {
                  children: { list: { type: string; x: number; texture: { key: string } }[] }
                } | null
              }
            }
          ).__TURNOVER__
            .scene('Round')
            ?.children.list.some(
              (c) => c.type === 'Sprite' && c.x === x && c.texture?.key === 'guest-clerk-sit',
            ) === true,
        SLOT7_PX,
        { timeout: 5000 },
      )
      const seated = await readGuestAt(own, SLOT7_PX)
      expect(seated).not.toBeNull()
      expect(seated?.visible).toBe(true)
      // The pose rides the seat-top lift (14 px above the lane line, y 430)
      // and tucks behind the shared table (depth −0.75 between chair −1 and
      // table −0.5). Slot 7 is west-facing — flipped.
      expect(seated?.y).toBe(430 - 14)
      expect(seated?.depth).toBe(-0.75)
      expect(seated?.flipX).toBe(true)
      // The dining tint (VPOL-08) still applies to the sit texture — never
      // the base clerk palette (seed 2 → palette index 0).
      expect(seated?.tint).not.toBe(0x5a9aaa)

      // SUI-13: the suitcase rests → the guest re-targets out of the
      // restaurant and renders standing again (the stream may already walk
      // it east, so read within a drift window).
      await own.evaluate(() => {
        const w = window as unknown as {
          __TURNOVER__: {
            scene: (name: string) => { applyAction: (a: unknown) => void } | null
          }
        }
        w.__TURNOVER__.scene('Round')?.applyAction({
          type: 'suitcase-placed',
          guestId: 'guest:vx',
          floor: 'floor1',
          room: 2,
        })
      })
      await own.waitForFunction(
        (x) => {
          const list =
            (
              window as unknown as {
                __TURNOVER__: {
                  scene: (name: string) => {
                    children: {
                      list: {
                        type: string
                        x: number
                        texture: { key: string }
                      }[]
                    }
                  } | null
                }
              }
            ).__TURNOVER__.scene('Round')?.children.list ?? []
          const near = list.filter(
            (c) => c.type === 'Sprite' && Math.abs(c.x - (x as number)) <= 24,
          )
          return (
            near.some((c) => (c.texture?.key ?? '').endsWith('-sit')) === false &&
            near.some((c) => c.texture?.key === 'guest-clerk')
          )
        },
        SLOT7_PX,
        { timeout: 5000 },
      )
      for (const page of pages) await page.close()
    } finally {
      for (const page of pages) await page.close().catch(() => {})
    }
  })
})
