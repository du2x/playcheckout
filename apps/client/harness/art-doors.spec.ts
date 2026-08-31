import { expect, type Page, test } from '@playwright/test'

// Gate scenario client:art_doors (cycle 2.10, ART-06/10/11; the interior
// render half lands with T4): doors are production door Images, phase-free
// across lobby → round, uniform texture (no state tint anywhere), and the
// grand lobby floor has no rooms (AD-010).

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

function doorImageSummary(page: Page): Promise<{
  total: number
  visible: number
  textures: string[]
  lobbyDoors: number
}> {
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
                texture: { key: string }
              }[]
            }
          } | null
        }
      }
    ).__TURNOVER__
    const scene = t.scene('Round')
    const doors = (scene?.children.list ?? []).filter(
      (c) => c.type === 'Image' && c.name.startsWith('door:'),
    )
    return {
      total: doors.length,
      visible: doors.filter((d) => d.visible).length,
      textures: [...new Set(doors.map((d) => d.texture.key))],
      lobbyDoors: doors.filter((d) => d.name.startsWith('door:lobby')).length,
    }
  })
}

test.describe('client:art_doors', () => {
  test('door Images are phase-free, uniformly textured, and absent from the lobby (ART-06/10/11)', async ({
    browser,
  }) => {
    test.setTimeout(30_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    await fourPlayerRound(pages)
    const host = pages[0] as Page

    // Round phase: the door set persists unchanged from the pre-round mount
    // (ART-11 phase-free; the pre-round half is pinned by client:doors_pre_round).
    const summary = (await doorImageSummary(host)) ?? {
      total: 0,
      visible: 0,
      textures: [],
      lobbyDoors: 0,
    }
    expect(summary.total).toBe(24) // 8 rooms × 3 guest floors
    expect(summary.lobbyDoors).toBe(0) // AD-010: the grand lobby has no rooms
    expect(summary.textures).toEqual(['door-closed']) // ART-10: no state tint family

    // Live play shows the own floor only (AD-008): the host spawned on the
    // lobby floor, so no door is visible from there even mid-round.
    expect(summary.visible).toBe(0)

    // --- Interior half (ART-07..09, ART-14) ---
    // Ride to floor1 (walk west, board via the call press (AD-025), press
    // floor1, exit) — the exit must happen INSIDE the 1 s open-door dwell
    // (arrival ≈ 2.3 s after the press, doors close ≈ 1 s later): a closed
    // car cannot be exited.
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowLeft')
    await host.keyboard.press('ArrowUp')
    await host.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 8000 },
    )
    await host.keyboard.press('1')
    // AD-026 stop anatomy: the arrival moved lands at the START of the
    // opening swing — hold the exit direction from that event; the pending
    // exit applies when the doors are fully open (inside the 1 s dwell).
    await host.waitForFunction(
      () => document.querySelector('#panel-west')?.textContent === 'floor1',
      undefined,
      { timeout: 10_000 },
    )
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(400)
    await host.keyboard.up('ArrowRight')
    // Walk right off the landing into the first room segment and keep
    // walking until the own-room interior renders (the FR-10 inside read).
    await host.keyboard.down('ArrowRight')
    await host
      .waitForFunction(
        () => {
          const label = document.querySelector('#room-state')
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
                      texture?: { key: string }
                    }[]
                  }
                } | null
              }
            }
          ).__TURNOVER__
          const list = t.scene('Round')?.children.list ?? []
          const me = list.find((c) => c.type === 'Sprite' && c.texture?.key === 'staff-walk')
          const interiors = list.filter(
            (c) => c.type === 'Image' && c.name.startsWith('interior:') && c.visible,
          ).length
          const done = label !== null && !label.hasAttribute('hidden') && interiors === 1
          if (!done) {
            ;(window as unknown as { __dbg?: unknown[] }).__dbg = [
              label === null
                ? 'no-el'
                : label.hasAttribute('hidden')
                  ? 'hidden'
                  : label.textContent,
              me === undefined ? 'no-me' : Math.round(me.x),
              interiors,
            ]
          }
          return done
        },
        undefined,
        { timeout: 10_000 },
      )
      .catch(async () => {
        const dbg = await host.evaluate(() => (window as unknown as { __dbg?: unknown[] }).__dbg)
        console.log('TEST1-DEBUG:', JSON.stringify(dbg))
      })

    function interiorsRead(): { visible: number; textures: string[]; openDoors: number } {
      const t = (
        window as unknown as {
          __TURNOVER__: {
            scene: (name: string) => {
              children: {
                list: {
                  type: string
                  name: string
                  visible: boolean
                  texture: { key: string }
                }[]
              }
            } | null
          }
        }
      ).__TURNOVER__
      const list = t.scene('Round')?.children.list ?? []
      const interiors = list.filter((c) => c.type === 'Image' && c.name.startsWith('interior:'))
      const openDoors = list.filter(
        (c) => c.type === 'Image' && c.name.startsWith('door:') && c.texture.key === 'door-open',
      ).length
      return {
        visible: interiors.filter((c) => c.visible).length,
        textures: [...new Set(interiors.map((c) => c.texture.key))],
        openDoors,
      }
    }

    // ART-08: the own room's doorway is open with the tidy interior behind it
    // (a never-prepped room is protocol-'fresh' → mapped to room-prepped);
    // ART-14: exactly ONE interior Image exists in a live scene.
    const inside = await host.evaluate(interiorsRead)
    expect(inside.visible).toBe(1)
    expect(inside.textures).toEqual(['room-prepped'])
    expect(inside.openDoors).toBe(1)
    const roomLabel = await host.textContent('#room-state')
    expect(roomLabel).toMatch(/^room \d+: /)

    // ART-09: stepping back out (past the room segments) removes the
    // interior again.
    await host.keyboard.up('ArrowRight')
    await host.keyboard.down('ArrowLeft')
    await host.waitForFunction(
      () => document.querySelector('#room-state')?.hasAttribute('hidden') === true,
      undefined,
      { timeout: 10_000 },
    )
    await host.keyboard.up('ArrowLeft')
    const outside = await host.evaluate(interiorsRead)
    expect(outside.visible).toBe(0)
    for (const page of pages.slice(1)) await page.context().close()
  })
})

test.describe('client:art_doors — cue doorway', () => {
  test('a hallway watcher sees the entered-cue doorway flip with no interior leak (ART-07/09)', async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext().then((c) => c.newPage())),
    )
    await fourPlayerRound(pages)
    const host = pages[0] as Page
    const watcher = pages[1] as Page

    // Both staff ride to floor1 in ONE car (cap 2): the host makes the
    // AD-025 call-press; the watcher auto-boards on the open-door ticks
    // (AD-014) — the shared-ride flow movement.spec proves.
    for (const page of [host, watcher]) {
      await page.keyboard.down('ArrowLeft')
      await page.waitForTimeout(3000)
      await page.keyboard.up('ArrowLeft')
    }
    // Each rider makes her own landing call-press (AD-025 boarding intent);
    // the duplicate call is harmless — both board (cap 2).
    await host.keyboard.press('ArrowUp')
    await watcher.keyboard.press('ArrowUp')
    await watcher.waitForFunction(
      () =>
        document.querySelector('#elevator-riders') !== null &&
        !document.querySelector('#elevator-riders')?.hasAttribute('hidden'),
      undefined,
      { timeout: 8000 },
    )
    for (const page of [host, watcher]) await page.keyboard.press('1')
    // AD-026: hold the exit direction from the arrival moved — the pending
    // exit applies when the doors are fully open, and the keyup cancels any
    // leftover hold so both riders settle at the landing (the watcher parks
    // in the hallway; the host walks on into room 1).
    for (const page of [host, watcher]) {
      await page.waitForFunction(
        () => document.querySelector('#panel-west')?.textContent === 'floor1',
        undefined,
        { timeout: 10_000 },
      )
    }
    for (const page of [host, watcher]) {
      // Hold PAST the 0.5 s opening swing (AD-026): the exit is a held
      // intent — a short tap would be cancelled by the keyup mid-swing.
      await page.keyboard.down('ArrowRight')
      await page.waitForTimeout(700)
      await page.keyboard.up('ArrowRight')
      await page.waitForTimeout(400)
    }
    // The watcher re-enters the hallway (x < 1) so the recorder samples the
    // doorway from OUTSIDE every room segment (ART-09's no-leak vantage).
    await watcher.keyboard.down('ArrowLeft')
    await watcher.waitForTimeout(600)
    await watcher.keyboard.up('ArrowLeft')
    await watcher.waitForTimeout(300)

    // The watcher parks in the hallway and samples every 50 ms: door
    // textures + interior Image count (state recorder, read once at the end).
    await watcher.evaluate(() => {
      const w = window as unknown as {
        __doorRecorder?: { open: number; interiors: number; closedAfter: boolean }
      }
      w.__doorRecorder = { open: 0, interiors: 0, closedAfter: false }
      const id = window.setInterval(() => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: {
                  list: { type: string; name: string; visible: boolean; texture: { key: string } }[]
                }
              } | null
            }
          }
        ).__TURNOVER__
        const list = t.scene('Round')?.children.list ?? []
        const door = list.find((c) => c.type === 'Image' && c.name === 'door:floor1:1')
        const rec = (
          window as unknown as {
            __doorRecorder?: { open: number; interiors: number; closedAfter: boolean }
          }
        ).__doorRecorder
        if (rec === undefined || door === undefined) return
        if (door.texture.key === 'door-open') rec.open += 1
        rec.interiors = Math.max(
          rec.interiors,
          list.filter((c) => c.type === 'Image' && c.name.startsWith('interior:') && c.visible)
            .length,
        )
        if (rec.open > 0 && door.texture.key === 'door-closed') rec.closedAfter = true
      }, 50)
      void id
    })

    // The host walks into room 1 and back out while the watcher records.
    // An out-and-back first: under load the exit walk can drift the host
    // inside room 1 before the recorder arms, and the entered cue only
    // fires on a room ENTRY — re-firing it guarantees a live window.
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(400)
    await host.keyboard.up('ArrowLeft')
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(400)
    await host.waitForFunction(
      () => {
        const label = document.querySelector('#room-state')
        return label !== null && !label.hasAttribute('hidden')
      },
      undefined,
      { timeout: 10_000 },
    )
    await host.waitForTimeout(500)
    await host.keyboard.up('ArrowRight')
    await host.keyboard.down('ArrowLeft')
    await host.waitForFunction(
      () => document.querySelector('#room-state')?.hasAttribute('hidden') === true,
      undefined,
      { timeout: 10_000 },
    )
    await host.keyboard.up('ArrowLeft')
    await host.waitForTimeout(900) // let the 700 ms cue window close

    const rec = await watcher.evaluate(
      () =>
        (
          window as unknown as {
            __doorRecorder?: { open: number; interiors: number; closedAfter: boolean }
          }
        ).__doorRecorder,
    )
    // ART-07: the doorway flipped open from the room:entered cue alone...
    expect(rec?.open).toBeGreaterThan(0)
    // ...ART-09: no interior Image EVER existed in the hallway scene, and
    // the doorway settled back to closed after the cue window.
    expect(rec?.interiors).toBe(0)
    expect(rec?.closedAfter).toBe(true)
    for (const page of pages.slice(2)) await page.context().close()
  })
})
