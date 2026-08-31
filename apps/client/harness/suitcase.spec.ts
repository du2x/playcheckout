import { expect, type Page, test } from '@playwright/test'

// Spec SUI-21..27 (gate scenario client:suitcase; amended AD-034): the
// suitcase slice. Two scenarios — the blind-place confirm is GONE (SUI-26
// dropped: assignments are building-wide notices):
//  - test 1 stays on the LOBBY (no ride): check-in handoff, the announce
//    line landing on EVERY page, the receiver-only own-marker hint, the
//    carried marker riding the carrier, and the DISCRIMINATING last-5
//    walkie contract (six lifecycle lines driven; count === 5 and the early
//    "takes" line evicted, newest-first kept);
//  - test 2 spends the ONE affordable ride: direct place at a door (every
//    carrier is "confident" now), PLACEMENT IS SILENT, and the self-regrab.

const TILE = 32

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

/** Count of harness-visible events so far (the door-open wait is relative). */
async function eventCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __TURNOVER__: { events: unknown[] } }).__TURNOVER__.events.length,
  )
}

/** True once the named floor's doors opened AFTER the given event count. */
async function waitDoorOpen(page: Page, floor: string, afterCount: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      ({ after, target }) => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              events: { type: string; payload: { floor: string; open: boolean } }[]
            }
          }
        ).__TURNOVER__
        return t.events.some(
          (e, i) =>
            i >= after &&
            e.type === 'elevator:doors' &&
            e.payload.floor === target &&
            e.payload.open,
        )
      },
      { after: afterCount, target: floor },
      { timeout: 6_000 },
    )
    return true
  } catch {
    return false
  }
}

/** Call + board at the west landing, ride to the floor, step off. The own
 *  label stays hidden until the EXIT (riders have no floor stream in the
 *  car, AD-008), so arrival is detected via the public elevator:doors
 *  event, and the floor press uses the harness press-retry pattern
 *  (AD-028 — the rider session may lag the boarding by a tick). */
async function rideTo(
  page: Page,
  who: string,
  floorDigit: 'Digit1' | 'Digit2' | 'Digit3',
  floor: 'floor1' | 'floor2' | 'floor3',
): Promise<void> {
  await walkUntil(page, who, 'ArrowLeft', (x) => x <= 1.0)
  // Press E until the rider boards (press-as-board, AD-025): the first press
  // summons the car when it is away; once it stands at this floor the press
  // boards. The rider's label hides when the floor stream stops (AD-008).
  // The whole ride must fit the 30 s test shift — keep the retries brisk.
  for (let i = 0; i < 14; i++) {
    await page.keyboard.down('e')
    await page.keyboard.up('e')
    try {
      await page.waitForFunction(
        (name) => {
          const t = (
            window as unknown as {
              __TURNOVER__: {
                scene: (name: string) => {
                  children: { list: { type: string; text?: string; visible: boolean }[] }
                } | null
              }
            }
          ).__TURNOVER__
          const scene = t.scene('Round')
          const label = scene?.children?.list.find((c) => c.type === 'Text' && c.text === name)
          return label !== undefined && label.visible === false
        },
        who,
        { timeout: 1_500 },
      )
      break
    } catch {
      // not boarded yet — press again
    }
  }
  const before = await eventCount(page)
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press(floorDigit)
    if (await waitDoorOpen(page, floor, before)) break
  }
  // Hop off: hold a direction through the door swing; the exit applies the
  // moment the doors are fully open (AD-026).
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(900)
  await page.keyboard.up('ArrowRight')
  try {
    await page.waitForFunction(
      (name) => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: { list: { type: string; text?: string; visible: boolean }[] }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        const label = scene?.children?.list.find((c) => c.type === 'Text' && c.text === name)
        return label !== undefined && label.visible === true
      },
      who,
      { timeout: 15_000 },
    )
  } catch {
    const evs = await page.evaluate(() =>
      (
        window as unknown as {
          __TURNOVER__: { events: { type: string; payload: Record<string, unknown> }[] }
        }
      ).__TURNOVER__.events
        .slice(-14)
        .map((e) => `${e.type}:${JSON.stringify(e.payload)}`),
    )
    throw new Error(`exit failed; events=${evs.join(' | ')}`)
  }
}

/** Press E repeatedly until the predicate holds — the intent flushes next
 *  tick, so a press racing the previous one is simply re-issued (MOVE-10). */
async function pressEUntil(page: Page, predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await pressE(page)
    try {
      await page.waitForFunction(predicate, undefined, { timeout: 2_000 })
      return
    } catch {
      // intent not on the wire yet — press again
    }
  }
  throw new Error('pressEUntil did not converge')
}

/** Room segment center in tiles (AD-010 geometry). */
function doorXTiles(room: number): number {
  return (room - 1) * 3.5 + 2.75
}

/** E press: keydown runs the contextual ladder, keyup ends the hold window. */
async function pressE(page: Page): Promise<void> {
  await page.keyboard.down('e')
  await page.keyboard.up('e')
}

test.describe('client:suitcase', () => {
  test('check-in hands off on the lobby: building-wide announce + lifecycle lines, receiver-only hint, carried marker, discriminating last-5 log (SUI-21/23/24/27, AD-034)', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()))
    const pages = await Promise.all(contexts.map((c) => c.newPage()))
    await fourPlayerRound(pages)
    const own = pages[0] as Page
    const bruno = pages[1] as Page

    // A guest queues (≈6 s scaled), the desk hint shows at the desk.
    await own.waitForFunction(() => {
      const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } }).__TURNOVER__
      return t.events.some((e) => e.type === 'guest:arrived')
    })
    await own.waitForFunction(
      () =>
        (document.querySelector('#desk-hint') as HTMLElement | null)?.style.visibility ===
        'visible',
    )

    // Check-in: E at the desk takes the suitcase. The lifecycle line is
    // building-wide (SUI-21).
    await pressE(own)
    for (const page of pages) {
      await page.waitForFunction(() =>
        (document.querySelector('#walkie-log')?.textContent ?? '').includes('«ada» takes a guest'),
      )
    }

    // SUI-03/04 (amended AD-034): the assignment is a BUILDING-WIDE notice —
    // the announce walkie line lands on EVERY page, not the receiver only.
    for (const page of pages) {
      await page.waitForFunction(() =>
        (document.querySelector('#walkie-log')?.textContent ?? '').includes("I'm in floor"),
      )
    }

    // SUI-12: the carried marker rides the carrier — a visible Rectangle
    // near the own label's x.
    await own.waitForFunction(
      (ownPx) => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: { list: { type: string; x: number; visible: boolean }[] }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        return (
          scene?.children?.list.some(
            (c) => c.type === 'Rectangle' && c.visible && Math.abs(c.x - ownPx) < 30,
          ) === true
        )
      },
      (await readLabel(own, 'ada')).x,
      { timeout: 15_000 },
    )

    // SUI-27: the own hint surfaces on the carrier's page only (a convenience
    // surface for the carried guest) — the other three pages never show one.
    await own.waitForSelector('#suitcase-assignment', { state: 'visible' })
    const hintText = await own.textContent('#suitcase-assignment')
    expect(hintText ?? '').toMatch(/guest's room: floor\d:\d/)
    for (const other of pages.slice(1)) {
      const visible = await other.evaluate(
        () =>
          (document.querySelector('#suitcase-assignment') as HTMLElement | null)?.style
            .visibility === 'visible',
      )
      expect(visible).toBe(false)
    }

    // SUI-23 (discriminating, post-AD-034): the DOM log is capped at 5, so
    // the trim is proven by VOLUME — count walkie-producing events on the
    // wire, wait for five MORE after ada's "takes" line (the 5-slot log
    // must then have evicted it, newest-first), and assert exactly that:
    // 5 lines kept, ada's early takes gone, newer lifecycle lines present.
    const WALKIE_KINDS = [
      'guest:arrived',
      'guest:settled',
      'guest:checked_out',
      'guest:assigned',
      'suitcase:carried',
      'suitcase:picked_up',
      'guest:complained',
    ] as string[]
    const countWalkieEvents = (p: Page): Promise<number> =>
      p.evaluate((kinds) => {
        const set = new Set(kinds)
        const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } })
          .__TURNOVER__
        return t.events.filter((e) => set.has(e.type)).length
      }, WALKIE_KINDS)
    const baseline = await countWalkieEvents(own)
    await bruno.waitForFunction(() => {
      const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } }).__TURNOVER__
      return t.events.filter((e) => e.type === 'guest:arrived').length >= 2
    })
    await pressEUntil(bruno, () =>
      (document.querySelector('#walkie-log')?.textContent ?? '').includes('«bruno» takes a guest'),
    )
    await own.waitForFunction(
      ({ kinds, base }) => {
        const set = new Set(kinds)
        const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } })
          .__TURNOVER__
        return t.events.filter((e) => set.has(e.type)).length >= base + 5
      },
      { kinds: WALKIE_KINDS, base: baseline },
      { timeout: 40_000 },
    )
    const lineCount = await own.evaluate(
      () => document.querySelectorAll('#walkie-log .walkie-line').length,
    )
    expect(lineCount).toBe(5)
    const logText = (await own.textContent('#walkie-log')) ?? ''
    expect(logText).not.toContain("«ada» takes a guest's suitcase")
    expect(logText).toMatch(/takes a guest|arrives at the front desk|announces|settles into/)

    for (const context of contexts) await context.close()
  })

  test('one ride: a confident place is silent and the self-regrab walks the lifecycle log (SUI-24/25, SUI-21/22 silence)', async ({
    browser,
  }) => {
    test.setTimeout(150_000)
    const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()))
    const pages = await Promise.all(contexts.map((c) => c.newPage()))
    await fourPlayerRound(pages)
    const own = pages[0] as Page

    // Guest queues, check in at the desk (the assignment is announced
    // building-wide — AD-034).
    await own.waitForFunction(() => {
      const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } }).__TURNOVER__
      return t.events.some((e) => e.type === 'guest:arrived')
    })
    await own.waitForFunction(
      () =>
        (document.querySelector('#desk-hint') as HTMLElement | null)?.style.visibility ===
        'visible',
    )
    await pressE(own)
    await own.waitForFunction(() =>
      (document.querySelector('#walkie-log')?.textContent ?? '').includes('«ada» takes a guest'),
    )
    await own.waitForSelector('#suitcase-assignment', { state: 'visible' })

    // Ride to floor1 and place at the FIRST door east of the landing — the
    // room is assignment-independent (any door accepts a placement). The
    // confirm is gone (AD-034): a carrier at a door places directly.
    await rideTo(own, 'ada', 'Digit1', 'floor1')
    await walkUntil(own, 'ada', 'ArrowRight', (x) => x >= doorXTiles(1) - 0.4)
    await pressE(own)

    // The marker rests at the doorway (SUI-24) and PLACEMENT IS SILENT
    // (SUI-21/22): the walkie log gains no line at all.
    await own.waitForFunction(
      (doorPx) => {
        const t = (
          window as unknown as {
            __TURNOVER__: {
              scene: (name: string) => {
                children: { list: { type: string; x: number; visible: boolean }[] }
              } | null
            }
          }
        ).__TURNOVER__
        const scene = t.scene('Round')
        return (
          scene?.children?.list.some(
            (c) => c.type === 'Rectangle' && c.visible && Math.abs(c.x - doorPx) < 20,
          ) === true
        )
      },
      doorXTiles(1) * TILE,
      { timeout: 30_000 },
    )
    const logAfterPlace = await own.textContent('#walkie-log')
    expect(logAfterPlace ?? '').not.toMatch(/place/i)

    // Self-regrab (SUI-08): E at the resting suitcase picks it back up —
    // with a walkie lifecycle line.
    await pressEUntil(own, () =>
      (document.querySelector('#walkie-log')?.textContent ?? '').includes(
        '«ada» picks up a suitcase',
      ),
    )

    for (const context of contexts) await context.close()
  })
})
