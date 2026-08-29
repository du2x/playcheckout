import { expect, type Page, test } from '@playwright/test'

// Spec WORK-01..17 (gate scenario client:work_channels): the player-facing work
// slice — walk into a room segment, Space starts a channel, the own progress
// bar fills over `seconds`, the room label shows the observed interior, and a
// non-occupant tab receives no interior or channel events (protocol rule 2).

interface SceneRead {
  labels: { text: string; x: number; visible: boolean }[]
  rectCount: number
  carCount: number
}

async function readScene(page: Page): Promise<SceneRead> {
  return page.evaluate(() => {
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
    const list = scene.children.list
    return {
      labels: list
        .filter((c) => c.type === 'Text')
        .map((c) => ({ text: String(c.text), x: c.x, visible: c.visible })),
      rectCount: list.filter((c) => c.type === 'Rectangle').length,
      carCount: list.filter((c) => c.type === 'Ellipse').length,
    }
  })
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

function ownPlayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const t = (window as unknown as { __TURNOVER__: { local: { playerId: string } } }).__TURNOVER__
    return t.local.playerId
  })
}

function adaMoveCount(page: Page, adaId: string): Promise<number> {
  return page.evaluate((id) => {
    const t = (
      window as unknown as {
        __TURNOVER__: { events: { type: string; payload: { playerId?: string } }[] }
      }
    ).__TURNOVER__
    return t.events.filter((e) => e.type === 'player:moved' && e.payload.playerId === id).length
  }, adaId)
}

test.describe('client:work_channels', () => {
  test('walk-in, Space channel, progress bar, room label; outsiders see nothing (WORK-01..17)', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    const host = pages[0] as Page
    const code = await createRoom(host, 'ada')
    const adaId = await ownPlayerId(host)
    for (const [index, name] of ['bruno', 'caro', 'dina'].entries()) {
      await join(pages[index + 1] as Page, code, name)
    }
    await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 4)

    // Pre-round: walk to the west landing — the parked car auto-boards ada
    // (AD-014 boarding rule); the round begins with her aboard.
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowLeft')
    await host.waitForTimeout(300)

    // (WORK-03's lobby-phase rejection is server-asserted: the client
    // short-circuits work intents on floors without rooms.)

    await host.click('#start-button')
    for (const page of pages) await page.waitForSelector('#round-hud')
    await host.keyboard.press('1') // in-car press: ride to floor1 (AD-014)

    // Ride to floor1 (2 s per floor per §7; no arrival — she is aboard).
    await host.waitForFunction(
      () => document.querySelector('#panel-west')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )

    // Exit through the open doors: holding right walks her off the car and
    // then along floor1.
    await host.keyboard.down('ArrowRight')
    // WORK-17 in vivo: while ada walks on floor1, the lobby tab's event stream
    // receives NO new positions for her (sameFloor routing, AD-009).
    const beforeMoves = await adaMoveCount(pages[1] as Page, adaId)
    await host.waitForTimeout(1000)
    const afterMoves = await adaMoveCount(pages[1] as Page, adaId)
    expect(afterMoves).toBe(beforeMoves)

    // 1 s of walking lands ~6 tiles out — inside room 2's segment [4.5, 8);
    // the client derives the room from the same shared geometry as the server.
    await host.keyboard.up('ArrowRight')
    await host.waitForTimeout(300)

    // Space starts the channel: the own progress bar appears.
    await host.keyboard.press('Space')
    await host.waitForFunction(
      () => {
        const bar = document.querySelector('#work-progress')
        return bar !== null && !bar.hasAttribute('hidden')
      },
      undefined,
      { timeout: 5000 },
    )
    const started = await host.evaluate(() => {
      const t = (
        window as unknown as {
          __TURNOVER__: {
            events: { type: string; payload: { playerId: string; seconds: number } }[]
          }
        }
      ).__TURNOVER__
      return t.events.find((e) => e.type === 'work:started')?.payload
    })
    expect(started?.seconds).toBe(5)

    // The bar fills over `seconds` and the completion clears it (WORK-02);
    // the hide may race the last frame of fill, so either state satisfies.
    await host.waitForFunction(
      () => {
        const bar = document.querySelector('#work-progress')
        if (bar?.hasAttribute('hidden')) return true
        const fill = document.querySelector('#work-progress-fill')
        return fill instanceof HTMLElement && parseFloat(fill.style.width) >= 95
      },
      undefined,
      { timeout: 10_000 },
    )
    await host.waitForFunction(
      () => document.querySelector('#work-progress')?.hasAttribute('hidden') === true,
      undefined,
      { timeout: 5000 },
    )

    // The interior was observed on entry and the transition updated the label
    // while standing inside (WORK-14/15/16 client half).
    const observed = await host.evaluate(() => {
      const t = (
        window as unknown as {
          __TURNOVER__: {
            events: { type: string; payload: { state: string; room: number } }[]
          }
        }
      ).__TURNOVER__
      return t.events.find((e) => e.type === 'room:observed')?.payload
    })
    expect(observed?.state).toBe('fresh')
    expect(observed?.room).toBeGreaterThanOrEqual(1)
    await host.waitForFunction(
      () => {
        const label = document.querySelector('#room-state')
        return (
          label !== null && !label.hasAttribute('hidden') && /prepped/.test(label.textContent ?? '')
        )
      },
      undefined,
      { timeout: 5000 },
    )
    await host.waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __TURNOVER__: { events: { type: string; payload: { floor?: string } }[] }
          }
        ).__TURNOVER__
        return t.events.some((e) => e.type === 'room:prepped' && e.payload.floor === 'floor1')
      },
      undefined,
      { timeout: 5000 },
    )

    // Non-occupant tab: no interior event, no channel event, no room label
    // (WORK-15/16 in vivo; protocol rule 2 enforced end-to-end).
    const guestPage = pages[1] as Page
    await guestPage.waitForTimeout(300)
    const guestTypes = await guestPage.evaluate(() => {
      const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } }).__TURNOVER__
      return t.events.map((e) => e.type)
    })
    expect(guestTypes).not.toContain('room:prepped')
    expect(guestTypes).not.toContain('work:started')
    expect(guestTypes).not.toContain('work:ended')
    expect(guestTypes).not.toContain('room:observed')
    expect(await guestPage.$('#room-state')).not.toBeNull()
    expect(await guestPage.$('#room-state:not([hidden])')).toBeNull()

    // The scene contract is untouched: rectangles + car ellipses only.
    for (const page of pages) {
      const scene = await readScene(page)
      expect(scene.rectCount).toBe(4)
      expect(scene.carCount).toBe(2)
    }

    for (const page of pages) await page.context().close()
  })
})
