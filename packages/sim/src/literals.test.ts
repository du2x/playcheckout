import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Spec SKEL-04 AC4: tuning/layout literals live only in packages/shared.
// Distinctive prd §7 values only — 1..5 tile counts and other small integers are
// too common in ordinary code to grep meaningfully and stay review-enforced.
// *.test.ts files are excluded so this file's own literals don't self-match.
const DENYLIST = [/\b300\b/, /\b75\b/, /\b0\.8\b/, /\b6\b/]
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const SCAN_ROOTS = [
  join(repoRoot, 'packages/sim/src'),
  join(repoRoot, 'apps/server/src'),
  join(repoRoot, 'apps/client/src'),
]
const EXCLUDED = /\.(test|spec)\.ts$/

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !EXCLUDED.test(e.name))
    .map((e) => join(e.parentPath, e.name))
}

describe('tuning literal denylist', () => {
  it('finds no prd §7 tuning literals outside packages/shared', () => {
    const violations: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const file of listFiles(root)) {
        const lines = readFileSync(file, 'utf8').split('\n')
        lines.forEach((line, i) => {
          if (DENYLIST.some((re) => re.test(line)))
            violations.push(`${file}:${i + 1}: ${line.trim()}`)
        })
      }
    }
    expect(violations).toEqual([])
  })
})
