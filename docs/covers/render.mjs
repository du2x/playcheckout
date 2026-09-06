// Renders the cover family to PNG. Run from the repo root:
//   node docs/covers/render.mjs
// Resolves playwright from apps/client's dependencies (workspace install).
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(new URL('../../apps/client/package.json', import.meta.url))
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  ;({ chromium } = require('@playwright/test'))
}

const shots = [
  ['docs/covers/turnover-cover.html', 'docs/covers/turnover-cover.png', 1200, 1600],
  ['docs/covers/turnover-cover-og.html', 'docs/covers/turnover-cover-og.png', 1200, 630],
  ['docs/covers/turnover-cover-splash.html', 'apps/client/public/art/ui/title-card.png', 960, 576],
  ['apps/client/public/favicon.svg', 'apps/client/public/favicon-32.png', 32, 32],
]

const browser = await chromium.launch()
for (const [html, out, width, height] of shots) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.goto(pathToFileURL(path.resolve(html)).href, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.resolve(out) })
  await page.close()
  console.log('rendered', out)
}
await browser.close()
