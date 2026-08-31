import { expect, type Page, test } from '@playwright/test'

// Spec SUI-24..27 (gate scenario client:suitcase): the suitcase slice —
// check-in hands off at the desk (walkie lifecycle line, building-wide), the
// assignment surfaces ONLY on the receiver's own hint (SUI-27, own
// knowledge), the E ladder places at a room door (confident for an overheard
// assignment — no confirm) and picks a resting suitcase back up
// (self-regrab), the suitcase marker rides the carrier and pins the doorway
// (SUI-24), and PLACEMENT IS SILENT — no walkie line ever fires for it
// (SUI-21/22). The blind-place one-step confirm (SUI-26) is exercised by a
// second player who never overheard the assignment.
// Guest timing rides the AD-028 test seam (scale 0.5 in playwright.config:
// first arrival ≈ 15 s, shift 30 s — the flows below are staged inside it).

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

interface Read {
  x: number
  visible: boolean
}

async function readLabel(page: Page, name: string): Promise<Read> {
  return page.evaluate((who) => {
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
    const label = scene.children.list.find((c) => c.type === 'Text' && c.text === who)
    if (label === undefined) throw new Error(`no label for ${who}`)
    return { x: label.x, visible: label.visible }
  }, name)
}

/** Hold a walk key in bursts until the own label's x crosses the predicate. */
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
  for (let i = 0; i < 10; i++) {
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
        { timeout: 3_000 },
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
}

/** Room segment center in tiles (AD-010 geometry). */
function doorXTiles(room: number): number {
  return (room - 1) * 3.5 + 2.75
}

test.describe('client:suitcase', () => {
  test('check-in hands off, the assignment shows on the receiver only, a confident place is silent, and self-regrab works (SUI-24/25/27, SUI-21 silence)', async ({
    browser,
  }) => {
    test.setTimeout(150_000)
    const pages = await Promise.all(
      [0, 1, 2, 3].map(async () => await (await browser.newContext()).newPage()),
    )
    await fourPlayerRound(pages)
    const own = pages[0] as Page
    const t0 = Date.now()
    const mark = (m: string) => console.log(`[t1 +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`)

    // A guest queues (≈15 s scaled), the desk hint shows at the desk.
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
    await own.keyboard.down('e')
    await own.keyboard.up('e')
    for (const page of pages) {
      await page.waitForFunction(() =>
        (document.querySelector('#walkie-log')?.textContent ?? '').includes('«ada» takes a guest'),
      )
    }

    // SUI-27: the assignment surfaces ONLY on the receiver's own hint.
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

    // Ride to floor1 and place at the FIRST door east of the landing —
    // the room is assignment-independent (any door accepts a placement).
    // The whole flow must fit the 30 s test shift after the ≈15 s arrival.
    mark('hint parsed')
    await rideTo(own, 'ada', 'Digit1', 'floor1')
    mark('rode to floor1')
    await walkUntil(own, 'ada', 'ArrowRight', (x) => x >= doorXTiles(1) - 0.4)
    mark('at door 1')
    const confirmBefore = await own.evaluate(
      () => (document.querySelector('#place-confirm') as HTMLElement | null)?.style.visibility,
    )
    expect(confirmBefore).not.toBe('visible')
    await own.keyboard.down('e')
    await own.keyboard.up('e')

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
    mark('placed; marker visible')
    const logAfterPlace = await own.textContent('#walkie-log')
    expect(logAfterPlace ?? '').not.toMatch(/place/i)

    // Self-regrab (SUI-08): E at the resting suitcase picks it back up —
    // with a walkie lifecycle line.
    await own.keyboard.down('e')
    await own.keyboard.up('e')
    await own.waitForFunction(
      () =>
        (document.querySelector('#walkie-log')?.textContent ?? '').includes(
          '«ada» picks up a suitcase',
        ),
      undefined,
      { timeout: 15_000 },
    )
    mark('picked up again')
  })

  test('a player who never overheard the assignment gets the one-step blind-place confirm (SUI-26)', async ({
    browser,
  }) => {
    test.setTimeout(150_000)
    const pages = await Promise.all(
      [0, 1, 2, 3].map(async () => await (await browser.newContext()).newPage()),
    )
    await fourPlayerRound(pages)
    const ada = pages[0] as Page
    const bruno = pages[1] as Page

    // ada pre-rides to floor1 and waits at room 4's door — OUT of desk
    // earshot, so bruno's check-in assignment never reaches her.
    await rideTo(ada, 'ada', 'Digit1', 'floor1')
    await walkUntil(ada, 'ada', 'ArrowRight', (x) => x >= doorXTiles(1) - 0.4)

    // bruno (at the desk, spawn x = 15) checks the guest in and rides it to
    // the SAME door — a confident place (he overheard his own guest).
    await bruno.waitForFunction(() => {
      const t = (window as unknown as { __TURNOVER__: { events: { type: string }[] } }).__TURNOVER__
      return t.events.some((e) => e.type === 'guest:arrived')
    })
    // ada is on floor1 — the desk-earshot policy (lobby floor only) cannot
    // reach her, so the check-in assignment never arrives (SUI-04).
    await bruno.keyboard.down('e')
    await bruno.keyboard.up('e')
    await bruno.waitForSelector('#suitcase-assignment', { state: 'visible' })
    await rideTo(bruno, 'bruno', 'Digit1', 'floor1')
    await walkUntil(bruno, 'bruno', 'ArrowRight', (x) => x >= doorXTiles(1) - 0.4)
    await bruno.keyboard.down('e')
    await bruno.keyboard.up('e')

    // ada picks the resting suitcase up (anyone may) and walks one door
    // east: placing there is a GAMBLE — the confirm gates it (SUI-26).
    await ada.waitForFunction(
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
    await ada.keyboard.down('e')
    await ada.keyboard.up('e')
    // The pickup's lifecycle line confirms ada now carries it.
    await ada.waitForFunction(
      () =>
        (document.querySelector('#walkie-log')?.textContent ?? '').includes(
          '«ada» picks up a suitcase',
        ),
      undefined,
      { timeout: 15_000 },
    )
    await ada.keyboard.down('e')
    await ada.waitForSelector('#place-confirm', { state: 'visible' })
    const confirmText = await ada.textContent('#place-confirm')
    expect(confirmText ?? '').toContain("haven't heard")
    await ada.click('#place-confirm-yes')
    await ada.waitForSelector('#place-confirm', { state: 'hidden' })

    // The gamble placed silently — the walkie never carries a placement.
    const log = await ada.textContent('#walkie-log')
    expect(log ?? '').not.toMatch(/place/i)
  })
})
