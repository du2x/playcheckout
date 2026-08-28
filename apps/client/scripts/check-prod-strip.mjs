import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// SKEL-08: window.__TURNOVER__ ships in dev/harness builds only — production
// bundles must tree-shake it away (turnover-client-harness contract).
const dist = fileURLToPath(new URL('../dist', import.meta.url))
const expectAbsent = process.argv.includes('--expect-absent')
const expectPresent = process.argv.includes('--expect-present')

const bundleFiles = readdirSync(join(dist, 'assets'), { recursive: true }).filter((f) =>
  String(f).endsWith('.js'),
)
const hit = bundleFiles.some((f) =>
  readFileSync(join(dist, 'assets', String(f)), 'utf8').includes('__TURNOVER__'),
)

if (expectAbsent && hit) {
  console.error('prod bundle contains __TURNOVER__ — dev hook leaked into production')
  process.exit(1)
}
if (expectPresent && !hit) {
  console.error('harness bundle is missing __TURNOVER__ — dev build broken or wrong mode')
  process.exit(1)
}
console.log(`strip check ok (${bundleFiles.length} bundles, hook ${hit ? 'present' : 'absent'})`)
