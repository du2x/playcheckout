import { expect, type Page, test } from '@playwright/test'

// Spec EVID-01..19 (gate scenario client:evidence_cues): the player-facing
// evidence slice — a staff prep hangs a hallway-readable card (EVID-01), the
// saboteur's entry fires a door-open cue and the un-prep a rustle cue for a
// same-floor viewer (EVID-16/19), and the card survives the re-trash (EVID-03).
// Roles are read from the own role card and the choreography adapts (the deal
// is random server-side); the wire stays role-blind (protocol rule 3).

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

async function join(page: Page, code: string, name: string) {
  await page.goto('/')
  await page.fill('#join-code', code)
  await page.fill('#join-name', name)
  await page.click('#join-submit')
  await page.waitForSelector('#lobby-view')
}

function roleOf(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('#role-card')?.textContent?.trim() ?? 'unknown')
}

function eventsOf(
  page: Page,
): Promise<{ type: string; at: number; payload: Record<string, unknown> }[]> {
  return page.evaluate(
    () => (window as unknown as { __TURNOVER__: { events: never[] } }).__TURNOVER__.events,
  )
}

/** Walk to the west landing, auto-board the parked car, press floor1, ride. */
async function rideWestToFloor1(page: Page) {
  await page.keyboard.down('ArrowLeft')
  await page.waitForTimeout(3000)
  await page.keyboard.up('ArrowLeft')
  await page.waitForTimeout(200)
  await page.keyboard.press('1')
  await page.waitForFunction(
    () => document.querySelector('#panel-west')?.textContent === 'floor1',
    undefined,
    { timeout: 10_000 },
  )
}

/** Walk to the east landing, auto-board the parked car, press floor1, ride. */
async function rideEastToFloor1(page: Page) {
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(3000)
  await page.keyboard.up('ArrowRight')
  await page.waitForTimeout(200)
  await page.keyboard.press('1')
  await page.waitForFunction(
    () => document.querySelector('#panel-east')?.textContent === 'floor1',
    undefined,
    { timeout: 10_000 },
  )
}

test.describe('client:evidence_cues', () => {
  test('card hangs, door-open cue fires, rustle fires, card survives re-trash (EVID-01/03/16/19)', async ({
    browser,
  }) => {
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

    // Roles are random: pick the staff page and the saboteur page from the
    // private role cards (server-side deal, never on the wire).
    const roles = await Promise.all(pages.map((p) => roleOf(p)))
    const sabIndex = roles.indexOf('saboteur')
    const saboteur = pages[sabIndex === -1 ? 0 : sabIndex] as Page
    const staffIndex = roles.findIndex((r, i) => r !== 'saboteur' && i !== sabIndex)
    const staff = pages[staffIndex] as Page
    expect(sabIndex).toBeGreaterThanOrEqual(0)

    // Staff rides west and parks inside room 2 ([4.5, 8) — 1 s of walking).
    await rideWestToFloor1(staff)
    await staff.keyboard.down('ArrowRight')
    await staff.waitForTimeout(1000)
    await staff.keyboard.up('ArrowRight')
    await staff.waitForTimeout(300)

    // Saboteur rides east and stands at the floor1 landing.
    await rideEastToFloor1(saboteur)

    // Arm the staff page's cue watcher BEFORE the saboteur walks (the DOM cue
    // lives only CUE_TTL_MS).
    const enteredCue = staff
      .waitForSelector('#evidence-layer [data-cue-kind="entered"]', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false)

    // Saboteur walks left from the east landing into room 2 (crossing rooms
    // 8..3 — every entry is a door-open cue; the watcher catches them).
    await saboteur.keyboard.down('ArrowLeft')
    await saboteur.waitForTimeout(4000)
    await saboteur.keyboard.up('ArrowLeft')
    await saboteur.waitForTimeout(300)
    expect(await enteredCue).toBe(true)

    // Only NOW does the staff member prep (5 s): the card auto-hangs (EVID-01)
    // while BOTH pages stand on floor1 — sameFloor delivery is live, no replay.
    await staff.keyboard.press('Space')
    await staff.waitForFunction(
      () =>
        (
          window as unknown as { __TURNOVER__: { events: { type: string }[] } }
        ).__TURNOVER__.events.some((e) => e.type === 'room:carded'),
      undefined,
      { timeout: 15_000 },
    )
    const cardedPayload = await staff.evaluate(() => {
      const t = (
        window as unknown as {
          __TURNOVER__: { events: { type: string; payload: Record<string, unknown> }[] }
        }
      ).__TURNOVER__
      return t.events.find((e) => e.type === 'room:carded')?.payload
    })
    expect(cardedPayload?.floor).toBe('floor1')
    expect(Number(cardedPayload?.room)).toBeGreaterThanOrEqual(1)

    // The card glyph is hallway-visible on the own floor (FR-11) — both
    // floor1 pages see it.
    for (const [pi, page] of [staff, saboteur].entries()) {
      try {
        await page.waitForFunction(
          () => {
            const el = document.querySelector('#evidence-layer [data-room-key^="floor1:"]')
            return el !== null && getComputedStyle(el).visibility === 'visible'
          },
          undefined,
          { timeout: 5_000 },
        )
      } catch (error) {
        const dump = await page.evaluate(() => {
          const t = (
            window as unknown as {
              __TURNOVER__: {
                events: { type: string; at: number; payload: Record<string, unknown> }[]
                local: { playerId: string }
              }
            }
          ).__TURNOVER__
          const el = document.querySelector('#evidence-layer [data-room-key]')
          const ownMoves = t.events.filter(
            (e) =>
              e.type === 'player:moved' &&
              (e.payload as { playerId?: string }).playerId === t.local.playerId,
          )
          return {
            layer: !!document.querySelector('#evidence-layer'),
            markers: document.querySelectorAll('#evidence-layer [data-room-key]').length,
            firstStyle: el?.getAttribute('style') ?? null,
            cardedEvents: t.events.filter((e) => e.type === 'room:carded').length,
            ownId: t.local.playerId,
            ownFloors: [...new Set(ownMoves.map((m) => (m.payload as { floor?: string }).floor))],
            lastX: (ownMoves.at(-1)?.payload as { x?: number }).x ?? null,
            lastOwnMoveAt: ownMoves.at(-1)?.at ?? null,
            lastEventAt: t.events.at(-1)?.at ?? null,
          }
        })
        throw new Error(
          `page ${pi} card marker failed: ${JSON.stringify(dump)}; source error: ${String(error)}`,
        )
      }
    }

    // Saboteur un-preps the prepped room (3 s): the rustle fires (FR-13) and
    // the card STAYS hung (EVID-03).
    const rustleCue = staff
      .waitForSelector('#evidence-layer [data-cue-kind="rustle"]', { timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    await saboteur.keyboard.press('Space')
    await staff.waitForFunction(
      () =>
        (
          window as unknown as { __TURNOVER__: { events: { type: string }[] } }
        ).__TURNOVER__.events.some((e) => e.type === 'room:rustle'),
      undefined,
      { timeout: 15_000 },
    )
    expect(await rustleCue).toBe(true)
    const trash = await staff.evaluate(() => {
      const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } }).__TURNOVER__
      return t.events.some((e) => e.type === 'room:trashed')
    })
    expect(trash).toBe(true)

    // The card survived the re-trash (EVID-03) — the marker remains.
    await staff.waitForTimeout(1000)
    const cardStill = await staff.evaluate(() => {
      const layer = document.querySelector('#evidence-layer')
      return layer !== null && layer.querySelector('[data-room-key^="floor1:"]') !== null
    })
    expect(cardStill).toBe(true)

    // The saboteur's own event stream never received a role payload (leak
    // rule 3: roles travel only on the private role:dealt deal, once).
    const leaky = (await eventsOf(saboteur)).filter((e) => e.type === 'role:dealt').length
    expect(leaky).toBe(1) // exactly the saboteur's own private deal
  })
})
