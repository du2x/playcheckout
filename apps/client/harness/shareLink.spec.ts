import { expect, type Page, test } from '@playwright/test'

// ?room=CODE share links (gate scenario client:share_link): the lobby shows a
// copyable invite URL, and opening a deep link prefills the join code so a
// guest only types a name. Real server via the webServer hook; assertions on
// the overlay DOM, same shape as client:lobby_join.

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

test.describe('client:share_link', () => {
  test('the lobby shows the shareable ?room link and copies it to the clipboard', async ({
    browser,
  }) => {
    const host = await browser.newContext().then((c) => c.newPage())
    await host.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const code = await createRoom(host, 'ada')

    const origin = await host.evaluate(() => window.location.origin)
    const link = await host.inputValue('#share-link')
    expect(link).toBe(`${origin}/?room=${code}`)

    await host.click('#share-copy')
    await host.waitForFunction(() => {
      const b = document.querySelector('#share-copy')
      return b !== null && b.textContent === 'copied ✓'
    })
    expect(await host.evaluate(() => navigator.clipboard.readText())).toBe(link)

    await host.context().close()
  })

  test('a deep link prefills the code, focuses the name field, and joins (LIGHT-01 fold)', async ({
    browser,
  }) => {
    const host = await browser.newContext().then((c) => c.newPage())
    const code = await createRoom(host, 'ada')
    const shareLink = await host.inputValue('#share-link')

    // The guest opens the host's copied link verbatim — that is the whole
    // feature: no manual code entry anywhere in the loop.
    const guest = await browser.newContext().then((c) => c.newPage())
    await guest.goto(shareLink)
    await guest.waitForSelector('#join-view')
    expect(await guest.inputValue('#join-code')).toBe(code)
    expect(await guest.evaluate(() => document.activeElement?.id ?? '')).toBe('join-name')

    // The whole guest flow is now: type a name, press Join.
    await guest.fill('#join-name', 'bruno')
    await guest.click('#join-submit')
    await guest.waitForSelector('#lobby-view')
    const roster = await guest.$$eval('#roster li', (items) => items.map((li) => li.textContent))
    expect(roster).toEqual(['ada', 'bruno'])

    await guest.context().close()
    await host.context().close()
  })

  test('a junk room param is sanitized before prefill (LIGHT-04 fold)', async ({ page }) => {
    await page.goto('/?room=ab1!x9')
    await page.waitForSelector('#join-view')
    expect(await page.inputValue('#join-code')).toBe('ABX')
  })

  test('a room-less URL still shows an empty code field', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#join-view')
    expect(await page.inputValue('#join-code')).toBe('')
    expect(await page.$('#share-row')).toBeNull()
  })
})
