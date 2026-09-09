import { expect, type Page, test } from '@playwright/test'
import { type RoomIndex, roomDoorXMilli } from '@turnover/shared'

// First-run gameplay tutorial (gate scenario client:tutorial): the guided
// card rides the lobby + round HUDs and advances on the player's own facts —
// walking, the landing E press (call/board), the desk check-in, the suitcase
// placement, a work channel — then completes on the goal card's got-it and
// persists as one localStorage flag. The saboteur's private card is NOT
// harnessable (the role deal is server RNG with no hook): it is covered by
// the tutorialSession unit tests, as is the fired-player card hide.

const TILE = 32

async function join(page: Page, code: string, name: string): Promise<void> {
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

async function readLabel(page: Page, who: string): Promise<{ x: number; visible: boolean }> {
  return page.evaluate((name) => {
    const t = (
      window as unknown as {
        __TURNOVER__: {
          scene: (name: string) => {
            children: { list: { type: string; text?: string; x: number; visible: boolean }[] }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    if (scene === null) throw new Error('world scene missing')
    const label = scene.children.list.find((c) => c.type === 'Text' && c.text === name)
    if (label === undefined) throw new Error(`no label for ${name}`)
    return { x: label.x, visible: label.visible }
  }, who)
}

/** Hold a walk key in bursts until the named player's x crosses the predicate. */
async function walkUntil(
  page: Page,
  who: string,
  dir: 'ArrowLeft' | 'ArrowRight',
  done: (xTiles: number) => boolean,
): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const r = await readLabel(page, who)
    if (done(r.x / TILE)) return
    await page.keyboard.down(dir)
    await page.waitForTimeout(450)
    await page.keyboard.up(dir)
    await page.waitForTimeout(50)
  }
  throw new Error(`walkUntil did not converge (${dir})`)
}

/** E press: keydown runs the contextual ladder, keyup ends the hold window. */
async function pressE(page: Page): Promise<void> {
  await page.keyboard.down('e')
  await page.keyboard.up('e')
}

/** Room segment door in tiles — derived from the shared layout, never
 *  hand-mirrored (the suitcase-spec geometry note applies verbatim). */
function doorXTiles(room: number): number {
  return roomDoorXMilli(room as RoomIndex) / 1000
}

/** The tutorial card's current step title. */
async function stepTitle(page: Page): Promise<string> {
  return (await page.textContent('#tutorial-step')) ?? ''
}

async function waitForStep(page: Page, title: string, timeout = 8000): Promise<void> {
  await page.waitForFunction(
    (want) => (document.querySelector('#tutorial-step')?.textContent ?? '').includes(want),
    title,
    // Interval polling: rAF-based polling starves on occluded harness pages
    // (repo-known flake mode) even when the predicate already holds.
    { polling: 100, timeout },
  )
}

/**
 * Hold Space until the own work channel starts — a staff channel is rejected
 * in a prepped room, so the caller picks the room; retries ride the intent
 * flush latency only.
 */
async function pressSpaceUntilWork(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Space')
    try {
      await page.waitForFunction(
        () => {
          const bar = document.querySelector('#work-progress')
          return bar !== null && !bar.hasAttribute('hidden')
        },
        undefined,
        { polling: 100, timeout: 4_000 },
      )
      return
    } catch {
      // Channel did not start — the caller may move to another room.
    }
  }
  throw new Error('no work channel started')
}

test.describe('client:tutorial', () => {
  test('lobby: the card advances on walk and car call, help toggles, skip persists', async ({
    browser,
  }) => {
    const host = await browser.newContext().then((c) => c.newPage())
    await createRoom(host, 'ada')

    // A fresh browser gets the card, first step first.
    await host.waitForSelector('#lobby-view')
    await host.waitForSelector('#tutorial-card:not([hidden])')
    expect(await stepTitle(host)).toContain('walk the hall')

    // The how-to-play panel toggles independently of the guided card.
    await host.click('#help-button')
    expect(await host.isVisible('#help-panel')).toBe(true)
    await host.click('#help-button')
    expect(await host.isVisible('#help-panel')).toBe(false)

    // Walking completes the first step. The car call is landing-gated
    // client-side (callElevator only sends near a car landing), so walk to
    // the EAST landing — the west one is the stairwell mouth, where ↑ enters
    // the stairs instead of calling — and summon the car there. The intent
    // completes the step even while the car is still in flight.
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(600)
    await host.keyboard.up('ArrowRight')
    await waitForStep(host, 'ride the car')
    await walkUntil(host, 'ada', 'ArrowRight', (x) => x >= 29.0)
    await host.keyboard.press('ArrowUp')
    await waitForStep(host, 'work the desk')

    // Skip completes the tutorial and writes the one-time flag.
    await host.click('#tutorial-skip')
    await host.waitForFunction(
      () => document.querySelector('#tutorial-card')?.hasAttribute('hidden') === true,
    )
    expect(await host.evaluate(() => window.localStorage.getItem('turnover.tutorial'))).toBe('done')

    // A later page in the same browser storage never sees the card again —
    // but the help button stays available for re-reading.
    const later = await host.context().newPage()
    await createRoom(later, 'zulu')
    await later.waitForSelector('#lobby-view')
    await later.waitForFunction(
      () => document.querySelector('#tutorial-card')?.hasAttribute('hidden') === true,
    )
    expect(await later.isVisible('#help-button')).toBe(true)

    await later.close()
    await host.context().close()
  })

  test('round: check-in, delivery and work advance the cards; got-it persists', async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    const own = pages[0] as Page
    await fourPlayerRound(pages)
    await own.waitForSelector('#round-hud')

    // The spawn row stands 3 tiles west of the desk (outside its 1-tile
    // range): take the clerk post before the first bell.
    await walkUntil(own, 'ada', 'ArrowRight', (x) => x >= 14.4)

    // Check-in at the desk: the bell rings (scaled cadence) and E takes the
    // suitcase. The hint window can be short (impatience scales with the
    // guest clock) and a follow-up guest re-rings it, so poll through
    // arrivals instead of single-shotting the hint. The desk walk already
    // completed the walk step, so the check-in is asserted on its wire fact;
    // the card's next-undone title is then "ride the car".
    await own.waitForFunction(
      () => {
        const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } })
          .__TURNOVER__
        return t.events.some((e) => e.type === 'guest:arrived')
      },
      undefined,
      { polling: 100, timeout: 30_000 },
    )
    let checkedIn = false
    for (let i = 0; i < 20 && !checkedIn; i++) {
      const hintVisible = await own.evaluate(
        () =>
          (document.querySelector('#desk-hint') as HTMLElement | null)?.style.visibility ===
          'visible',
      )
      if (hintVisible) {
        await pressE(own)
        try {
          await own.waitForFunction(
            () => {
              const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } })
                .__TURNOVER__
              return t.events.some((e) => e.type === 'suitcase:carried')
            },
            undefined,
            { polling: 100, timeout: 2_000 },
          )
          checkedIn = true
        } catch {
          // The check-in intent has not landed yet — re-read the hint.
        }
      } else {
        await own.waitForTimeout(500)
      }
    }
    expect(checkedIn).toBe(true)
    await waitForStep(own, 'ride the car')

    // Walk east to the landing; the E presses there (call, then board —
    // AD-025) complete the car step, leaving the delivery card showing.
    await walkUntil(own, 'ada', 'ArrowRight', (x) => x >= 29.0)
    for (let i = 0; i < 14; i++) {
      await pressE(own)
      try {
        await own.waitForFunction(
          () =>
            document.querySelector('#elevator-riders') !== null &&
            !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
          undefined,
          { polling: 100, timeout: 1_500 },
        )
        break
      } catch {
        // Car still en route — press again when it arrives.
      }
    }
    await waitForStep(own, 'deliver the suitcase')

    // Ride to floor1 (in-car press), exit through the open doors, and place
    // at the room 7 door — any door accepts a placement (3.E AD-040 layout).
    await own.keyboard.press('1')
    await own.waitForFunction(
      () => document.querySelector('#panel-floor')?.textContent === 'floor1',
      undefined,
      { polling: 100, timeout: 15_000 },
    )
    await own.keyboard.down('ArrowLeft')
    await own.waitForTimeout(900)
    await own.keyboard.up('ArrowLeft')
    await walkUntil(own, 'ada', 'ArrowLeft', (x) => x <= doorXTiles(7) + 0.4)
    // The exit hop overshoots the door zone; tap back right until the label
    // sits within the door range so the ladder resolves place.
    for (let i = 0; i < 6; i++) {
      const p = await readLabel(own, 'ada')
      if (Math.abs(p.x / TILE - doorXTiles(7)) <= 0.8) break
      await own.keyboard.down('ArrowRight')
      await own.waitForTimeout(200)
      await own.keyboard.up('ArrowRight')
      await own.waitForTimeout(150)
    }
    for (let i = 0; i < 8; i++) {
      await pressE(own)
      try {
        await waitForStep(own, 'turn a room', 2_000)
        break
      } catch {
        // Not placed yet — press again.
      }
    }
    await waitForStep(own, 'turn a room')

    // Work: a staff channel is rejected in a prepped room, so walk west
    // across the segments and stand in the first room whose OBSERVED state
    // is workable (entry fires room:observed per segment — honest in-world
    // knowledge, the same read a player acts on). A dealt saboteur passes
    // this loop on the first room either way.
    const workableRoom = async (): Promise<number | null> =>
      own.evaluate(() => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              events: { type: string; payload: { floor: string; room: number; state: string } }[]
            }
          }
        ).__TURNOVER__
        const seen = new Map<number, string>()
        for (const e of t.events) {
          if (e.type === 'room:observed' && e.payload.floor === 'floor1') {
            seen.set(e.payload.room, e.payload.state)
          }
        }
        const workable = [...seen.entries()]
          .filter(([, state]) => state !== 'prepped')
          .map(([room]) => room)
          .sort((a, b) => b - a) // most eastward first — least walking back
        return workable[0] ?? null
      })
    let target = await workableRoom()
    for (const room of [6, 5, 4, 3]) {
      if (target !== null) break
      await walkUntil(own, 'ada', 'ArrowLeft', (x) => x <= doorXTiles(room))
      target = await workableRoom()
    }
    if (target === null) target = 3 // saboteur fallback: any room takes a channel
    await walkUntil(own, 'ada', 'ArrowRight', (x) => x >= doorXTiles(target) - 0.4)
    for (let i = 0; i < 6; i++) {
      const p = await readLabel(own, 'ada')
      if (Math.abs(p.x / TILE - doorXTiles(target)) <= 0.8) break
      await own.keyboard.down(p.x / TILE > doorXTiles(target) ? 'ArrowLeft' : 'ArrowRight')
      await own.waitForTimeout(180)
      await own.keyboard.up('ArrowLeft')
      await own.keyboard.up('ArrowRight')
      await own.waitForTimeout(150)
    }
    await pressSpaceUntilWork(own)
    // The card moves past the work step — straight to the goal for staff, or
    // through the private saboteur card first (the deal is server RNG).
    await own.waitForFunction(
      () => {
        const title = document.querySelector('#tutorial-step')?.textContent ?? ''
        return title.includes('the shift') || title.includes('turncoat')
      },
      undefined,
      { polling: 100, timeout: 8_000 },
    )

    // The goal card (and, for a dealt saboteur, the private card before it)
    // completes on got-it; the flag lands either way.
    for (let i = 0; i < 4; i++) {
      const hidden = await own.evaluate(
        () => document.querySelector('#tutorial-card')?.hasAttribute('hidden') === true,
      )
      if (hidden) break
      await own.click('#tutorial-confirm')
      await own.waitForTimeout(300)
    }
    await own.waitForFunction(
      () => document.querySelector('#tutorial-card')?.hasAttribute('hidden') === true,
    )
    expect(await own.evaluate(() => window.localStorage.getItem('turnover.tutorial'))).toBe('done')

    for (const page of pages) await page.context().close()
  })
})
