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
      rectCount: list.filter((c) => c.type === 'Sprite' && c.texture?.key === 'staff-walk').length,
      carCount: list.filter((c) => c.type === 'Sprite' && c.texture?.key === 'elevator-door')
        .length,
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

    // Pre-round: walk to the west landing and board the parked car with the
    // landing call press (AD-025); the round begins with her aboard.
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowRight')
    await host.keyboard.press('ArrowUp')
    await host.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 8000 },
    )

    // (WORK-03's lobby-phase rejection is server-asserted: the client
    // short-circuits work intents on floors without rooms.)

    await host.click('#start-button')
    for (const page of pages) await page.waitForSelector('#round-hud')
    await host.keyboard.press('1') // in-car press: ride to floor1 (AD-014)

    // Ride to floor1 (2 s per floor per §7; no arrival — she is aboard).
    await host.waitForFunction(
      () => document.querySelector('#panel-floor')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )

    // Exit through the open doors: holding left walks her off the car (the
    // landing is the EAST end — cycle 3.E AD-040) and then along floor1.
    await host.keyboard.down('ArrowLeft') // held 1.5 s: 0.5 s swing + 1 s walk (AD-026)
    // WORK-17 in vivo: while ada walks on floor1, the lobby tab's event stream
    // receives NO new positions for her (sameFloor routing, AD-009).
    const beforeMoves = await adaMoveCount(pages[1] as Page, adaId)
    await host.waitForTimeout(1500)
    const afterMoves = await adaMoveCount(pages[1] as Page, adaId)
    expect(afterMoves).toBe(beforeMoves)

    // 1 s of walking (the pending exit ate the first 0.5 s of the hold,
    // AD-026) lands ~6 tiles west of the landing — inside room 7's segment
    // [22.5, 26.25); the client derives the room from the same shared
    // geometry as the server.
    await host.keyboard.up('ArrowLeft')
    await host.waitForTimeout(300)

    // Arm the work-visit recorder (50 ms sampler) BEFORE the channel starts:
    // the choreography gate. The visited room's door is identified at arm
    // time — the visible door nearest ada's name label, which the standing
    // ART-08 rule holds OPEN while she stands inside — then tracked across
    // the channel: it must swing fully shut while the body wears the scrub
    // pose (silhouetted to the shadow ink while the door seats closed), with
    // the interior cropped to the doorway band (no leak past the frame), and
    // swing back open after the body strides out.
    await host.evaluate(() => {
      const w = window as unknown as {
        __workRecorder?: {
          ownDoorName: string | null
          sawWorkPose: boolean
          sawSilhouette: boolean
          sawDoorShut: boolean
          sawInteriorWhileWorking: boolean
          croppedInterior: boolean
          minPoseY: number | null
          sawOpenAfter: number
          stopped: boolean
        }
      }
      w.__workRecorder = {
        ownDoorName: null,
        sawWorkPose: false,
        sawSilhouette: false,
        sawDoorShut: false,
        sawInteriorWhileWorking: false,
        croppedInterior: false,
        minPoseY: null,
        sawOpenAfter: 0,
        stopped: false,
      }
      const sample = () => {
        const rec = w.__workRecorder
        if (rec === undefined || rec.stopped) return
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: {
                  list: {
                    type: string
                    name: string
                    text?: string
                    visible: boolean
                    x: number
                    y: number
                    isCropped?: boolean
                    texture?: { key: string }
                  }[]
                }
              } | null
            }
          }
        ).__TURNOVER__
        const list = t.scene('Round')?.children.list ?? []
        const doors = list.filter(
          (c) => c.type === 'Image' && c.name.startsWith('door:') && c.visible,
        )
        const interior = list.find(
          (c) => c.type === 'Image' && c.name.startsWith('interior:') && c.visible,
        )
        const interiors = interior === undefined ? 0 : 1
        const worker = list.find(
          (c) =>
            c.type === 'Sprite' &&
            (c.texture?.key === 'staff-work' || c.texture?.key === 'staff-work-shadow'),
        )
        if (worker !== undefined) {
          rec.sawWorkPose = true
          if (worker.texture?.key === 'staff-work-shadow') rec.sawSilhouette = true
          rec.minPoseY = rec.minPoseY === null ? worker.y : Math.min(rec.minPoseY, worker.y)
          if (interiors >= 1) rec.sawInteriorWhileWorking = true
        }
        if (interior !== undefined && interior.isCropped === true) rec.croppedInterior = true
        if (rec.ownDoorName === null && !rec.sawWorkPose) {
          const label = list.find((c) => c.type === 'Text' && c.text === 'ada' && c.visible)
          if (label !== undefined && doors.length > 0) {
            const nearest = doors.reduce((a, b) =>
              Math.abs(b.x - label.x) < Math.abs(a.x - label.x) ? b : a,
            )
            rec.ownDoorName = nearest.name
          }
        }
        const ownDoor = doors.find((c) => c.name === rec.ownDoorName)
        if (ownDoor === undefined || ownDoor.texture === undefined) return
        if (worker !== undefined && ownDoor.texture.key === 'door-closed') {
          rec.sawDoorShut = true
        }
        if (rec.sawDoorShut && ownDoor.texture.key === 'door-open') rec.sawOpenAfter += 1
      }
      window.setInterval(sample, 50)
    })

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

    // The visit's exit walk: the visited room's door swings back open once
    // the body strides out (the 50 ms sampler catches the reopened doorway).
    await host.waitForFunction(
      () =>
        ((window as unknown as { __workRecorder?: { sawOpenAfter: number } }).__workRecorder
          ?.sawOpenAfter ?? 0) > 0,
      undefined,
      { timeout: 5000 },
    )
    await host.evaluate(() => {
      const w = window as unknown as { __workRecorder?: { stopped: boolean } }
      if (w.__workRecorder !== undefined) w.__workRecorder.stopped = true
    })
    const visit = await host.evaluate(
      () =>
        (
          window as unknown as {
            __workRecorder?: {
              sawWorkPose: boolean
              sawSilhouette: boolean
              sawDoorShut: boolean
              sawInteriorWhileWorking: boolean
              croppedInterior: boolean
              minPoseY: number | null
            }
          }
        ).__workRecorder,
    )
    expect(visit?.sawWorkPose).toBe(true) // the scrub pose owned the body
    expect(visit?.sawSilhouette).toBe(true) // the seated door silhouetted it
    expect(visit?.sawDoorShut).toBe(true) // the door closed behind the worker
    expect(visit?.sawInteriorWhileWorking).toBe(true) // the doorway slice stayed
    expect(visit?.croppedInterior).toBe(true) // interior cropped to the doorway band
    // The body walked up into the room's depth (spot is 14 px above the lane;
    // standing feet live at 430).
    expect(visit?.minPoseY ?? 430).toBeLessThanOrEqual(424)

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
    // The deal is random server-side: ada's channel preps the room only when
    // she is staff. A saboteur's work on a fresh room is a FAKE prep —
    // animation only, no state change, and by protocol NOTHING is emitted
    // (FR-9), so the label must stay fresh and no room:prepped may arrive.
    const isSaboteur = await host.evaluate(
      () => document.querySelector('#role-card')?.textContent === 'saboteur',
    )
    if (isSaboteur) {
      await host.waitForTimeout(1500)
      // The walk lands near the east landing's first segment; the exact room
      // varies with walk timing, so pin the STATE not the room number.
      expect(await host.evaluate(() => document.querySelector('#room-state')?.textContent)).toMatch(
        /^room \d+: fresh$/,
      )
      const prepped = await host.evaluate(() => {
        const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } })
          .__TURNOVER__
        return t.events.some((e) => e.type === 'room:prepped' || e.type === 'room:trashed')
      })
      expect(prepped).toBe(false)
    } else {
      await host.waitForFunction(
        () => {
          const label = document.querySelector('#room-state')
          return (
            label !== null &&
            !label.hasAttribute('hidden') &&
            /prepped/.test(label.textContent ?? '')
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
    }

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

    // The scene contract is untouched: player sprites + car ellipses only.
    for (const page of pages) {
      const scene = await readScene(page)
      expect(scene.rectCount).toBe(4)
      expect(scene.carCount).toBe(1)
    }

    for (const page of pages) await page.context().close()
  })
})
