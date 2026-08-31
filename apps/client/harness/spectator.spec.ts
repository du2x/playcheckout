import { expect, type Page, test } from '@playwright/test'

// Spec REND-12..16 (gate scenario client:spectator_view, cycle 2.9): a staff
// page accuses a nearby player before the saboteur's first un-prep (grace,
// FR-18) — the ACCUSER is fired and their client switches to the FR-20
// spectator overview: all four floor lanes render with every live player's
// rectangle at their real floor, and the fired page still receives 'all'
// broadcasts (firing toasts). A live page's own-floor view is unchanged
// (REND-15) — the scene-children contract holds on both.
//
// Choreography (justice.spec pattern): the whole cast spawns at the lobby
// center — same floor, zero distance — so the hold-E menu names a candidate
// immediately.

const NAMES = ['ada', 'bruno', 'caro', 'dina'] as const

async function join(page: Page, code: string, name: string) {
  await page.goto('/')
  await page.fill('#join-code', code)
  await page.fill('#join-name', name)
  await page.click('#join-submit')
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

interface TurnoverHandle {
  events: { type: string; payload?: Record<string, unknown> }[]
  local: { playerId: string | null; roomId: string | null }
}

interface SceneRect {
  visible: boolean
  y?: number
}

/** Read the world scene's player sprites IN-PAGE (functions do not serialize). */
function readRects(page: Page): Promise<SceneRect[]> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __TURNOVER__?: { scene?: (n: string) => unknown } })
      .__TURNOVER__
    const scene = hook?.scene?.('Round') as
      | {
          children: {
            list: { type: string; y: number; visible: boolean; texture?: { key?: string } }[]
          } | null
        }
      | undefined
    return (scene?.children?.list ?? [])
      .filter((c) => c.type === 'Sprite' && c.texture?.key === 'staff-walk')
      .map((c) => ({ visible: c.visible, y: c.y }))
  })
}

async function turnover(page: Page): Promise<TurnoverHandle> {
  return page.evaluate(() => (window as unknown as { __TURNOVER__: TurnoverHandle }).__TURNOVER__)
}

async function roleOf(page: Page): Promise<string> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __TURNOVER__: TurnoverHandle }).__TURNOVER__.events.some(
        (e) => e.type === 'role:dealt',
      ),
    undefined,
    { timeout: 5000 },
  )
  const t = await turnover(page)
  const event = t.events.find((e) => e.type === 'role:dealt')
  const role = (event?.payload as { role?: string } | undefined)?.role
  if (role === undefined) throw new Error('role:dealt payload missing')
  return role
}

test.describe('client:spectator_view', () => {
  test('a wrong accusation fires the accuser into the all-floor overview', async ({ browser }) => {
    test.setTimeout(120_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    const host = pages[0] as Page
    const code = await createRoom(host, 'ada')
    for (const [index, name] of ['bruno', 'caro', 'dina'].entries()) {
      await join(pages[index + 1] as Page, code, name)
    }
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)

    await host.click('#start-button')
    for (const page of pages) await page.waitForSelector('#round-hud')

    const roles = await Promise.all(pages.map((p) => roleOf(p)))
    const accuserIndex = roles.indexOf('staff')
    const accuser = pages[accuserIndex]
    if (accuser === undefined) throw new Error('no staff dealt')
    const accuserName = NAMES[accuserIndex]
    if (accuserName === undefined) throw new Error('no accuser name')

    // Cycle 3.2: everyone spawns inside the desk zone (x=15 = DESK_X), where
    // E is the desk key and the accuse hold is suppressed (spec decision) —
    // accusing at the desk requires stepping out of the zone first. A short
    // walk east clears the 1-tile zone and stays within the 2-tile accuse
    // range of the players still at the desk.
    await accuser.keyboard.down('ArrowRight')
    await accuser.waitForTimeout(260)
    await accuser.keyboard.up('ArrowRight')

    // Hold E → confirm menu → confirm: a WRONG accusation (innocent target or
    // in-grace saboteur — indistinguishable) fires the ACCUSER.
    await accuser.keyboard.down('e')
    await accuser.waitForFunction(
      () => {
        const menu = document.querySelector('#accuse-menu')
        return menu !== null && !menu.hasAttribute('hidden')
      },
      undefined,
      { timeout: 5000 },
    )
    await accuser.click('#accuse-confirm')

    // The fired page: the fired banner + the spectator baseline snapshot.
    await accuser.waitForFunction(
      () => document.querySelector('#fired-banner')?.hasAttribute('hidden') === false,
      undefined,
      { timeout: 10_000 },
    )
    await accuser.waitForFunction(
      () =>
        (window as unknown as { __TURNOVER__: TurnoverHandle }).__TURNOVER__.events.some(
          (e) => e.type === 'spectator:snapshot',
        ),
      undefined,
      { timeout: 10_000 },
    )
    const baseline = await turnover(accuser)
    const snapshot = baseline.events.find((e) => e.type === 'spectator:snapshot')?.payload as {
      players: { playerId: string; floor: string }[]
      rooms: unknown[]
      cardedRooms: unknown[]
    } | null
    if (snapshot === null) throw new Error('no spectator:snapshot')
    expect(snapshot.players).toHaveLength(3) // the fired player excluded
    expect(snapshot.rooms).toHaveLength(24) // every room's state

    // The fired page's SCENE switched to the all-floor overview: one rectangle
    // per live player (scene-children contract), the fired player's own stays
    // gone. Multi-lane proof comes from the door lanes (DOM layer) — at spawn
    // everyone shares the lobby lane.
    const rects = await readRects(accuser)
    expect(rects).toHaveLength(3) // one per live player — the fired one is gone
    // ART contract (cycle 2.10): door lanes are door:<floor>:<room> Images.
    await accuser.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: { list: { name: string; visible: boolean; type: string }[] }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        if (scene === null) return false
        return scene.children.list.some(
          (c) => c.type === 'Image' && c.name === 'door:floor3:1' && c.visible,
        )
      },
      undefined,
      { timeout: 5000 },
    )
    const visibleDoorLanes = await accuser.evaluate(() => {
      const t = (
        window as unknown as {
          __TURNOVER__: {
            scene: (name: string) => {
              children: { list: { name: string; visible: boolean; type: string }[] }
            } | null
          }
        }
      ).__TURNOVER__
      const scene = t.scene('Round')
      const floors = new Set(
        (scene?.children.list ?? [])
          .filter((c) => c.type === 'Image' && c.name.startsWith('door:') && c.visible)
          .map((c) => c.name.split(':')[1] as string),
      )
      return [...floors].sort()
    })
    expect(visibleDoorLanes).toEqual(['floor1', 'floor2', 'floor3'])

    // A LIVE page's own-floor view is unchanged (REND-15): its scene shows
    // exactly the players on its floor (all four spawn together; the fired
    // one removed) and NO spectator:snapshot ever arrived.
    const liveIndex = roles.findIndex((role, i) => role === 'staff' && i !== accuserIndex)
    const live = pages[liveIndex]
    if (live === undefined) throw new Error('no live staff page')
    const liveEvents = await turnover(live)
    expect(liveEvents.events.some((e) => e.type === 'spectator:snapshot')).toBe(false)
    const liveRects = await readRects(live)
    expect(liveRects.length).toBe(3)
    expect(liveRects.every((r) => r.visible)).toBe(true)

    // ART-12/14 (cycle 2.10): the overview renders an interior Image per
    // baseline-known room (24 rooms on the three guest floors), while the
    // LIVE page — standing in the hallway — holds none (its at-most-one slot
    // is empty outside a room segment).
    const firedInteriors = await accuser.evaluate(() => {
      const t = (
        window as unknown as {
          __TURNOVER__: {
            scene: (name: string) => {
              children: { list: { name: string; visible: boolean; type: string }[] }
            } | null
          }
        }
      ).__TURNOVER__
      const list = t.scene('Round')?.children.list ?? []
      return list.filter((c) => c.type === 'Image' && c.name.startsWith('interior:')).length
    })
    expect(firedInteriors).toBe(24)
    const liveInteriors = await live.evaluate(() => {
      const t = (
        window as unknown as {
          __TURNOVER__: {
            scene: (name: string) => {
              children: { list: { name: string; type: string }[] }
            } | null
          }
        }
      ).__TURNOVER__
      const list = t.scene('Round')?.children.list ?? []
      return list.filter((c) => c.type === 'Image' && c.name.startsWith('interior:')).length
    })
    expect(liveInteriors).toBe(0)

    // Both pages still receive the 'all' broadcasts (firing toasts ride both).
    for (const page of [accuser, live]) {
      const events = await turnover(page)
      expect(events.events.some((e) => e.type === 'player:fired')).toBe(true)
    }
    void accuserName
  })
})
