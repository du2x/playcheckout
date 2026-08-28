import { expect, test } from '@playwright/test'

// Spec SKEL-07: Phaser 4 boots a placeholder scene; window.__TURNOVER__ exists
// in dev/harness builds (minimal Phase 1 boot check — full scenario format is
// the Phase 3 harness).
test('client boots Phaser and exposes the dev-only turnover hook', async ({ page }) => {
  await page.goto('/')

  await page.waitForFunction(
    () => {
      const t = (window as unknown as { __TURNOVER__?: { scene?: (n: string) => unknown } })
        .__TURNOVER__
      return Boolean(t?.scene?.('Boot'))
    },
    undefined,
    { timeout: 10000 },
  )

  const hook = await page.evaluate(() => {
    const t = (
      window as unknown as {
        __TURNOVER__?: { events: unknown[]; local: unknown; scene: (n: string) => unknown }
      }
    ).__TURNOVER__
    return {
      exists: Boolean(t),
      hasEvents: Array.isArray(t?.events),
      hasLocal: typeof t?.local === 'object',
      sceneBooted: Boolean(t?.scene?.('Boot')),
      canvasVisible: Boolean(document.querySelector('#game canvas')),
      overlayPresent: Boolean(document.querySelector('#overlay')),
    }
  })

  expect(hook.exists).toBe(true)
  expect(hook.hasEvents).toBe(true)
  expect(hook.hasLocal).toBe(true)
  expect(hook.sceneBooted).toBe(true)
  expect(hook.canvasVisible).toBe(true)
  expect(hook.overlayPresent).toBe(true)
})
