import { expect, type Page, test } from '@playwright/test'

// Spec client:voice_party (gate scenario, voice project — fake media device):
// one party per game session. Two real clients join, turn the mic on, and the
// mesh connects peer-to-peer over the room's signaling relay. The chip's data
// attributes are the observable state (data-mic / data-members / data-connected).

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

/** The chip lives under scaled/overlaid stage surfaces — fire its handler directly. */
async function toggleVoice(page: Page) {
  await page.locator('#voice-toggle').dispatchEvent('pointerdown')
}

test.describe('client:voice_party', () => {
  test('two players join the party and connect peer-to-peer (VOICE-01..04)', async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')

    const guest = await browser.newContext().then((c) => c.newPage())
    await join(guest, code, 'bruno')
    await guest.waitForSelector('#lobby-view')

    // The world scene mounts with the lobby — both chips exist.
    await host.waitForSelector('#voice-toggle')
    await guest.waitForSelector('#voice-toggle')
    await expect(host.locator('#voice-toggle')).toHaveAttribute('data-mic', 'off')
    await expect(guest.locator('#voice-toggle')).toHaveAttribute('data-members', '0')

    // Mic on: capture + join. Membership is public — each side sees the other.
    await toggleVoice(host)
    await expect(host.locator('#voice-toggle')).toHaveAttribute('data-mic', 'on')
    await expect(guest.locator('#voice-toggle')).toHaveAttribute('data-members', '1', {
      timeout: 10_000,
    })

    await toggleVoice(guest)
    await expect(guest.locator('#voice-toggle')).toHaveAttribute('data-mic', 'on')
    await expect(host.locator('#voice-toggle')).toHaveAttribute('data-members', '1', {
      timeout: 10_000,
    })

    // Real ICE: the mesh reaches 'connected' in both directions (VOICE-03).
    await expect(host.locator('#voice-toggle')).toHaveAttribute('data-connected', '1', {
      timeout: 20_000,
    })
    await expect(guest.locator('#voice-toggle')).toHaveAttribute('data-connected', '1', {
      timeout: 20_000,
    })

    // Mic-off leaves the party publicly: the peer count drops on the other end.
    await toggleVoice(host)
    await expect(host.locator('#voice-toggle')).toHaveAttribute('data-mic', 'off')
    await expect(guest.locator('#voice-toggle')).toHaveAttribute('data-members', '0', {
      timeout: 10_000,
    })
    await expect(guest.locator('#voice-toggle')).toHaveAttribute('data-connected', '0', {
      timeout: 10_000,
    })

    await guest.context().close()
    await host.context().close()
  })
})
