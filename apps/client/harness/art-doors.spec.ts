import { type Page, expect, test } from '@playwright/test'

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
    // Ride to floor1 (walk west, board, press floor1, exit) — the exit must
    // happen INSIDE the 1 s open-door dwell (arrival ≈ 2.3 s after the press,
    // doors close ≈ 1 s later): a closed car cannot be exited.
    await host.keyboard.down('ArrowLeft')
    await host.waitForTimeout(3000)
    await host.keyboard.up('ArrowLeft')
    await host.keyboard.press('1')
    await host.waitForTimeout(2400)
    await host.keyboard.down('ArrowRight')
    await host.waitForTimeout(400)
    await host.keyboard.up('ArrowRight')
    // Walk right off the landing into the first room segment and keep
    // walking until the own-room interior renders (the FR-10 inside read).
    await host.keyboard.down('ArrowRight')
    await host.waitForFunction(
      () => {
        const label = document.querySelector('#room-state')
        if (label === null || label.hasAttribute('hidden')) return false
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: {
                  list: { type: string; name: string; visible: boolean }[]
                }
              } | null
            }
          }
        ).__TURNOVER__
        const list = t.scene('Round')?.children.list ?? []
        return (
          list.filter(
            (c) => c.type === 'Image' && c.name.startsWith('interior:') && c.visible,
          ).length === 1
        )
      },
      undefined,
      { timeout: 10_000 },
    )

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
