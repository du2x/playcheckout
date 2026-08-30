import { expect, type Page, test } from '@playwright/test'

// Spec MOVE-01..19 (gate scenario client:movement) + ELR-01..06 (gate scenario
// client:elevator_riders): keyboard-driven movement on real tabs — own
// prediction, others following, lobby bounds, building unlock at start,
// press-model elevator rides with position-only panels, the rider-exclusive
// chip, post-buzzer re-confinement, and a leaver's rectangle disappearing.

const TILE = 832 / 30
const SPEED = 6 // tiles per second (prd §7)

interface SceneRead {
  labels: { text: string; x: number; visible: boolean }[]
  carCount: number
  rectCount: number
}

async function readScene(page: Page): Promise<SceneRead> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: {
          list: {
            type: string
            text?: string
            x: number
            visible: boolean
            texture?: { key?: string }
          }[]
        }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    if (scene === null) throw new Error('world scene missing')
    const list = scene.children.list
    return {
      labels: list
        .filter((c) => c.type === 'Text')
        .map((c) => ({ text: String(c.text), x: c.x, visible: c.visible })),
      // ART contract (cycle 2.10): players are staff-walk Sprites.
      rectCount: list.filter(
        (c) => c.type === 'Sprite' && c.texture?.key === 'staff-walk',
      ).length,
      carCount: list.filter((c) => c.type === 'Ellipse').length,
    }
  })
}

interface ChipRead {
  hidden: boolean
  names: string
  lit: string[]
  press: string
}

/** The rider-exclusive DOM chip beside the panel (AD-013). */
async function readChip(page: Page): Promise<ChipRead> {
  return page.evaluate(() => {
    const chip = document.querySelector('#elevator-riders')
    if (chip === null) throw new Error('rider chip missing')
    return {
      hidden: chip.hasAttribute('hidden'),
      names: chip.querySelector('#elevator-riders-names')?.textContent ?? '',
      lit: [...chip.querySelectorAll('.floor-indicator.lit')].map(
        (e) => (e as HTMLElement).dataset.floor ?? '',
      ),
      press: chip.querySelector('#elevator-press')?.textContent ?? '',
    }
  })
}

/** Wire audit: occupancy/queue must never reach a non-rider (ELR-03/ELR-06 AC9). */
async function wireAudit(page: Page): Promise<{ occupancyCount: number; panelShapes: string[][] }> {
  return page.evaluate(() => {
    const events = (
      window as unknown as { __TURNOVER__: { events: { type: string; payload?: object }[] } }
    ).__TURNOVER__.events
    const occupancyKeys = ['carOccupants', 'riders', 'queue']
    const occupancyCount = events.filter((e) => {
      const payload = e.payload
      return payload !== undefined && occupancyKeys.some((k) => k in payload)
    }).length
    const panelShapes = events
      .filter((e) => e.type === 'elevator:called' || e.type === 'elevator:moved')
      .map((e) => Object.keys(e.payload as Record<string, unknown>).sort())
    return { occupancyCount, panelShapes }
  })
}

function labelX(scene: SceneRead, name: string): number {
  const label = scene.labels.find((l) => l.text === name)
  if (label === undefined) throw new Error(`no label for ${name}`)
  return label.x
}

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

test.describe('client:movement', () => {
  test('walking: own prediction, others follow, bounds clamp (MOVE-01..05)', async ({
    browser,
  }) => {
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')
    const guest = await browser.newContext().then((c) => c.newPage())
    await join(guest, code, 'bruno')
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 2)

    // Both see exactly two player sprites plus two car ellipses.
    for (const page of [host, guest]) {
      const scene = await readScene(page)
      expect(scene.rectCount).toBe(2)
      expect(scene.carCount).toBe(2)
    }

    // Own prediction: hold right for 1 s → ~6 tiles of displacement.
    const before = (await readScene(guest)).labels.find((l) => l.text === 'bruno')?.x ?? 0
    await guest.keyboard.down('ArrowRight')
    await guest.waitForTimeout(1000)
    await guest.keyboard.up('ArrowRight')
    await guest.waitForTimeout(150)
    const ownAfter = labelX(await readScene(guest), 'bruno')
    const ownDeltaPx = ownAfter - before
    expect(ownDeltaPx).toBeGreaterThan((SPEED - 2) * TILE)
    expect(ownDeltaPx).toBeLessThan((SPEED + 2) * TILE)

    // The other tab follows the server position within ~2 ticks.
    await guest.waitForTimeout(200)
    const hostSees = labelX(await readScene(host), 'bruno')
    expect(hostSees - before).toBeGreaterThan((SPEED - 2) * TILE)
    expect(Math.abs(hostSees - ownAfter)).toBeLessThan(2 * 0.3 * TILE + 6)

    // Bounds clamp: hold left long enough to pin at the west wall (MOVE-04).
    await guest.keyboard.down('ArrowLeft')
    await guest.waitForTimeout(4000)
    await guest.keyboard.up('ArrowLeft')
    await guest.waitForTimeout(200)
    expect(labelX(await readScene(guest), 'bruno')).toBeLessThanOrEqual(1)

    await guest.context().close()
    await host.context().close()
  })

  test('round: press-model ride, rider invisibility, position-only panels (MOVE-10..17, ELR-05/14)', async ({
    browser,
  }) => {
    test.setTimeout(90_000) // the test shift (30 s, AD-004) plus choreography
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    const host = pages[0] as Page
    const code = await createRoom(host, 'ada')
    for (const [index, name] of ['bruno', 'caro', 'dina'].entries()) {
      await join(pages[index + 1] as Page, code, name)
    }
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)

    // Walk to the west landing PRE-ROUND (AD-005: lobby walking + position
    // persistence): the parked car auto-boards ada (AD-014 boarding rule) and
    // her rider-exclusive chip appears with her own name.
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowLeft')
    await host.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 5000 },
    )
    expect((await readChip(host)).names).toContain('ada')

    await host.click('#start-button')
    for (const page of pages) await page.waitForSelector('#round-hud')

    // In-car press (Digit1 → floor1): the car departs at 2 s per floor — no
    // call, no destination at call time (AD-014).
    await host.keyboard.press('1')
    await host.waitForFunction(
      () => document.querySelector('#panel-west')?.textContent === 'floor1',
      undefined,
      { timeout: 8000 },
    )
    const panel = await host.textContent('#elevator-panel')
    // Position-only: the panel names floors, never player ids or names, and
    // the chip's rider data never leaks into it (MOVE-16/17 preserved).
    expect(panel).not.toContain('ada')
    expect(panel).not.toContain('bruno')

    // While aboard (doors open at floor1, queue empty) the own rectangle is
    // invisible — riders are on no floor and have no floor stream (AD-009).
    await host.waitForTimeout(300)
    const hostScene = await readScene(host)
    expect(hostScene.labels.find((l) => l.text === 'ada')?.visible).toBe(false)

    // Exit through the open doors: the own floor stream resumes at the car's
    // landing (ELR P3 AC6) and she walks right along floor1.
    await host.keyboard.down('ArrowRight')
    await host.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (n: string) => {
                children: { list: { type: string; text?: string; visible: boolean }[] }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        if (scene === null) return false
        return (
          scene.children.list.find((c) => c.type === 'Text' && c.text === 'ada')?.visible === true
        )
      },
      undefined,
      { timeout: 5000 },
    )
    await host.waitForTimeout(500) // keep walking while held
    await host.keyboard.up('ArrowRight')
    await host.waitForTimeout(200)
    const afterExit = await readScene(host)
    const adaX = labelX(afterExit, 'ada')
    expect(adaX).toBeGreaterThan(TILE) // she left the landing
    expect(adaX).toBeLessThan(5 * TILE) // ~500 ms of walking

    // Buzzer (30 s test shift, AD-004 seam): the results view covers the
    // world (cycle 2.9) — ada keeps floor1 beneath it.
    for (const page of pages) await page.waitForSelector('#results-view', { timeout: 45_000 })

    // Post-buzzer movement is no longer confined to the lobby (AD-015): ada
    // remains on floor1 and can keep walking there.
    const beforeHold = labelX(await readScene(host), 'ada')
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(600)
    await host.keyboard.up('ArrowRight')
    await host.waitForTimeout(200)
    const afterHold = labelX(await readScene(host), 'ada')
    expect(afterHold).toBeGreaterThan(beforeHold + TILE)

    // A leaver's rectangle disappears everywhere (MOVE-19).
    await (pages[3] as Page).context().close()
    await host.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (n: string) => { children: { list: { type: string; texture?: { key?: string } }[] } } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        if (scene === null) return false
        return (
          scene.children.list.filter(
            (c) => c.type === 'Sprite' && c.texture?.key === 'staff-walk',
          ).length === 3
        )
      },
      undefined,
      { timeout: 5000 },
    )

    for (const page of pages.slice(0, 3)) await page.context().close()
  })
})

// Spec ELR-01..06 (gate scenario client:elevator_riders): two tabs share a car —
// each rider sees both names' chip and the lit press indicator, the press
// redirects the car visibly, the floor tab sees no occupancy anywhere and no
// occupancy/queue/press-target data on the wire, and an exited rider does not
// re-board the same open-door stop (door-open-episode guard, ELR edge).
test.describe('client:elevator_riders', () => {
  test('shared ride: rider-exclusive chip, lit indicator, press redirect, no re-board', async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')
    const rider2 = await browser.newContext().then((c) => c.newPage())
    await join(rider2, code, 'bruno')
    const watcher = await browser.newContext().then((c) => c.newPage())
    await join(watcher, code, 'caro')
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 3)

    // Both riders walk to the west landing together: the parked car auto-boards
    // both (capacity 2, AD-014) and each chip shows BOTH names (ELR-01).
    await host.keyboard.down('ArrowLeft')
    await rider2.keyboard.down('ArrowLeft')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowLeft')
    await rider2.keyboard.up('ArrowLeft')
    for (const page of [host, rider2]) {
      await page.waitForFunction(
        () => {
          const chip = document.querySelector('#elevator-riders')
          if (chip === null || chip.hasAttribute('hidden')) return false
          const names = chip.querySelector('#elevator-riders-names')?.textContent ?? ''
          return names.includes('ada') && names.includes('bruno')
        },
        undefined,
        { timeout: 5000 },
      )
    }
    // The floor tab's chip stays hidden (ELR-01 AC3: non-riders see nothing).
    expect((await readChip(watcher)).hidden).toBe(true)

    // The press redirects the car (ELR-06): ada queues floor1 — the floor1
    // indicator lights on BOTH riders' chips and the last-press line names her.
    await host.keyboard.press('1')
    for (const page of [host, rider2]) {
      await page.waitForFunction(
        () =>
          document.querySelectorAll('#elevator-riders .floor-indicator.lit[data-floor="floor1"]')
            .length === 1,
        undefined,
        { timeout: 5000 },
      )
    }
    expect((await readChip(host)).press).toContain('ada pressed floor1')
    expect((await readChip(rider2)).press).toContain('ada pressed floor1')

    // The car rides to floor1 (2 s): the public panel follows for everyone.
    await watcher.waitForFunction(
      () => document.querySelector('#panel-west')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )

    // Wire purity on the floor (ELR-03, ELR-06 AC9): no occupancy, queue, or
    // press-target data in ANY event caro received; panel payloads stay
    // exactly {car, floor}.
    const audit = await wireAudit(watcher)
    expect(audit.occupancyCount).toBe(0)
    for (const shape of audit.panelShapes) expect(shape).toEqual(['car', 'floor'])

    // Bruno exits through the open doors, stepping only briefly: he stays
    // within the boarding radius (the episode guard must hold him out).
    await rider2.keyboard.down('ArrowRight')
    await rider2.waitForTimeout(150)
    await rider2.keyboard.up('ArrowRight')

    // Ada's chip drops bruno (ELR-01 AC2); bruno's own chip hides — his floor
    // stream resumed (ELR P3 AC6).
    await host.waitForFunction(
      () => (document.querySelector('#elevator-riders-names')?.textContent ?? '') === 'ada',
      undefined,
      { timeout: 5000 },
    )
    await rider2.waitForFunction(
      () => document.querySelector('#elevator-riders')?.hasAttribute('hidden') === true,
      undefined,
      { timeout: 5000 },
    )

    // Door-open-episode guard (ELR edge): bruno stands within the boarding
    // radius while the car idles open-doors at this stop — he is NOT re-boarded.
    await host.waitForTimeout(1500)
    expect((await readChip(host)).names).toBe('ada')
    const brunoScene = await readScene(rider2)
    expect(brunoScene.labels.find((l) => l.text === 'bruno')?.visible).toBe(true)

    await host.context().close()
    await rider2.context().close()
    await watcher.context().close()
  })
})

// AD-017 (protocol rule: personal snapshots on floor change): an exiter's
// picture of the arrival floor is stale — standing occupants emit no stream,
// so without the exit snapshot they stay invisible until they move. Ada rides
// up and stands still; bruno follows later and must see her IMMEDIATELY on
// exit, without ada emitting a single event since before his ride.
test.describe('client:elevator_riders — arrival floor reveal', () => {
  test('an exiter sees standing occupants of the arrival floor immediately (AD-017)', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')
    const follower = await browser.newContext().then((c) => c.newPage())
    await join(follower, code, 'bruno')
    const extra = await Promise.all(
      ['caro', 'dina'].map((name) =>
        browser
          .newContext()
          .then((c) => c.newPage())
          .then((page) => join(page, code, name).then(() => page)),
      ),
    )
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)

    await host.click('#start-button')
    await follower.waitForSelector('#round-hud')

    // Ada rides the WEST car to floor1, exits, and walks ~6 tiles east; then
    // she stands still for the rest of the test — no further events.
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowLeft')
    await host.keyboard.press('1')
    await host.waitForFunction(
      () => document.querySelector('#panel-west')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(1000)
    await host.keyboard.up('ArrowRight')
    const adaScene = await readScene(host)
    expect(adaScene.labels.find((l) => l.text === 'ada')?.visible).toBe(true)
    const adaX = adaScene.labels.find((l) => l.text === 'ada')?.x ?? 0

    // Bruno rides the EAST car (car 1 is away) to the same floor and steps
    // off only briefly — he stays inside the boarding radius (AD-016 guard).
    await follower.keyboard.down('ArrowRight')
    await follower.waitForTimeout(3000)
    await follower.keyboard.up('ArrowRight')
    await follower.keyboard.press('1')
    await follower.waitForFunction(
      () => document.querySelector('#panel-east')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )
    await follower.keyboard.down('ArrowLeft')
    await follower.waitForTimeout(150)
    await follower.keyboard.up('ArrowLeft')

    // THE reveal: ada stands still, yet bruno sees her at her position
    // immediately — seeded by the exit's personal floor snapshot.
    await follower.waitForFunction(
      ({ adaX }) => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (n: string) => {
                children: {
          list: {
            type: string
            text?: string
            x: number
            visible: boolean
            texture?: { key?: string }
          }[]
        }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        if (scene === null) return false
        const ada = scene.children.list.find((c) => c.type === 'Text' && c.text === 'ada')
        return ada?.visible === true && Math.abs(ada.x - adaX) < 2 * (832 / 30)
      },
      { adaX },
      { timeout: 5000 },
    )

    await host.context().close()
    await follower.context().close()
    for (const page of extra) await page.context().close()
  })
})
