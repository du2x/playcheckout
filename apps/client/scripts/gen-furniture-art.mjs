/**
 * Furniture + seated-guest art generator (lobby/mezzanine furnishing slice).
 *
 * Deterministic, dependency-free: a minimal PNG codec (RGBA, 8-bit, filter-0
 * rows) plus hand-placed pixel art matching the AD-020 Deco palette already
 * used by the elevator interior and corridor band. Seated guests are DERIVED
 * from the standing archetype silhouettes (torso crop + lap slab) so every
 * archetype keeps its head/hat identity while seated at a restaurant table.
 *
 * Run: `node apps/client/scripts/gen-furniture-art.mjs` (rewrites in place).
 * Generated art is committed; this script is its provenance, not a build step.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'art')

// --- PNG codec (RGBA8 only — everything in public/art is colorType 6) ------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let w = 0
  let h = 0
  const idats = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6)
        throw new Error(`unsupported PNG: depth ${data[8]} color ${data[9]}`)
    } else if (type === 'IDAT') {
      idats.push(data)
    }
    pos += 12 + len
  }
  const raw = inflateRows(Buffer.concat(idats), w, h)
  return { w, h, rgba: raw }
}

function inflateRows(deflated, w, h) {
  const raw = inflateSync(deflated)
  const stride = w * 4
  const out = Buffer.alloc(stride * h)
  let pos = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++]
    const row = raw.subarray(pos, pos + stride)
    pos += stride
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0
      const b = prev !== null ? prev[x] : 0
      const c = x >= 4 && prev !== null ? prev[x - 4] : 0
      let v = row[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 0xff
    }
  }
  return out
}

// --- Canvas helpers ---------------------------------------------------------

function canvas(w, h) {
  return { w, h, data: Buffer.alloc(w * h * 4) }
}

function px(c, x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return
  const i = (y * c.w + x) * 4
  c.data[i] = r
  c.data[i + 1] = g
  c.data[i + 2] = b
  c.data[i + 3] = a
}

function rect(c, x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(c, x, y, color)
}

function hline(c, x0, x1, y, color) {
  rect(c, x0, y, x1, y, color)
}

function ellipse(c, cx, cy, rx, ry, color) {
  for (let y = -ry; y <= ry; y++) {
    const dx = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))))
    hline(c, cx - dx, cx + dx, cy + y, color)
  }
}

// --- AD-020 Deco palette (matches the elevator interior / corridor band) ----

const OUTLINE = [0x24, 0x18, 0x12]
const WOOD_DARK = [0x4a, 0x30, 0x1e]
const WOOD = [0x6e, 0x4a, 0x2e]
const WOOD_LIGHT = [0x8a, 0x62, 0x3a]
const BRASS = [0xb3, 0x87, 0x3a]
const BRASS_LIGHT = [0xd4, 0xaf, 0x6a]
const IVORY = [0xf2, 0xea, 0xd8]
const IVORY_SHADE = [0xd8, 0xcc, 0xb0]
const CRIMSON = [0x7a, 0x2f, 0x2f]
const CRIMSON_DARK = [0x5a, 0x20, 0x20]
const UPHOLSTERY = [0x3f, 0x5a, 0x44]
const UPHOLSTERY_LIGHT = [0x54, 0x74, 0x59]
const POT = [0x8a, 0x5a, 0x3a]
const POT_DARK = [0x6e, 0x44, 0x29]
const LEAF = [0x4a, 0x7a, 0x4a]
const LEAF_LIGHT = [0x66, 0x99, 0x5e]
const LEAF_DARK = [0x36, 0x5c, 0x38]

// --- Furniture pieces -------------------------------------------------------

/** Reception desk, 76x46, service side facing EAST (the queue side). */
function drawDesk() {
  const c = canvas(76, 46)
  // Body
  rect(c, 6, 15, 69, 45, WOOD)
  rect(c, 6, 15, 69, 15, WOOD_LIGHT)
  // Crimson Deco panels with brass trim
  for (const [x0, x1] of [
    [12, 32],
    [43, 63],
  ]) {
    rect(c, x0, 22, x1, 39, CRIMSON)
    rect(c, x0, 22, x1, 22, CRIMSON_DARK)
    rect(c, x0, 39, x1, 39, CRIMSON_DARK)
    px(c, x0 - 1, 22, BRASS)
    px(c, x1 + 1, 22, BRASS)
    px(c, x0 - 1, 39, BRASS)
    px(c, x1 + 1, 39, BRASS)
  }
  // Countertop: marble slab with brass edge
  rect(c, 2, 9, 73, 14, IVORY)
  hline(c, 2, 73, 9, IVORY)
  hline(c, 3, 72, 10, [0xfa, 0xf6, 0xea])
  rect(c, 2, 13, 73, 14, IVORY_SHADE)
  hline(c, 2, 73, 15, BRASS)
  // Service bell on the counter (east side)
  ellipse(c, 62, 8, 4, 3, BRASS)
  hline(c, 60, 64, 6, BRASS_LIGHT)
  px(c, 62, 5, BRASS_LIGHT)
  rect(c, 59, 11, 65, 11, BRASS)
  // Outline + feet
  for (let y = 15; y <= 45; y++) {
    px(c, 6, y, OUTLINE)
    px(c, 69, y, OUTLINE)
  }
  hline(c, 6, 69, 45, OUTLINE)
  rect(c, 8, 43, 20, 44, WOOD_DARK)
  rect(c, 55, 43, 67, 44, WOOD_DARK)
  return c
}

/** Lobby settee, 56x28, backrest on the WEST end. */
function drawBench() {
  const c = canvas(56, 28)
  // Backrest post + cap
  rect(c, 1, 1, 4, 17, WOOD)
  rect(c, 1, 1, 4, 1, BRASS)
  px(c, 1, 2, WOOD_LIGHT)
  // Seat: crimson upholstery on a wood frame
  rect(c, 1, 13, 53, 17, CRIMSON)
  hline(c, 2, 52, 13, [0x8f, 0x3c, 0x3c])
  rect(c, 1, 18, 53, 20, WOOD)
  hline(c, 1, 53, 20, WOOD_DARK)
  // Brass tacks along the seat front
  for (const x of [6, 15, 24, 33, 42, 50]) px(c, x, 18, BRASS)
  // Legs
  rect(c, 3, 21, 6, 26, WOOD_DARK)
  rect(c, 48, 21, 51, 26, WOOD_DARK)
  hline(c, 3, 6, 27, OUTLINE)
  hline(c, 48, 51, 27, OUTLINE)
  return c
}

/** Potted palm, 30x48. No candles, no sconces — foliage only. */
function drawPlant() {
  const c = canvas(30, 48)
  // Fronds
  ellipse(c, 15, 11, 11, 7, LEAF)
  ellipse(c, 8, 19, 7, 5, LEAF_DARK)
  ellipse(c, 22, 17, 8, 5, LEAF)
  ellipse(c, 12, 25, 6, 4, LEAF_LIGHT)
  ellipse(c, 20, 26, 5, 4, LEAF_DARK)
  // Frond highlights
  px(c, 12, 8, LEAF_LIGHT)
  px(c, 16, 6, LEAF_LIGHT)
  px(c, 21, 14, LEAF_LIGHT)
  px(c, 7, 17, LEAF_LIGHT)
  // Trunk
  rect(c, 14, 26, 16, 37, WOOD)
  px(c, 14, 30, WOOD_DARK)
  px(c, 14, 34, WOOD_DARK)
  // Pot: rim + tapered body
  rect(c, 7, 37, 23, 40, POT)
  hline(c, 7, 23, 37, [0xa5, 0x71, 0x4b])
  rect(c, 9, 41, 21, 46, POT_DARK)
  hline(c, 9, 21, 46, OUTLINE)
  hline(c, 7, 23, 40, POT_DARK)
  return c
}

/** Restaurant table, 32x30 — tabletop just above the seated guest's lap. */
function drawTable() {
  const c = canvas(32, 30)
  // Pedestal
  rect(c, 14, 14, 17, 24, WOOD)
  px(c, 14, 18, WOOD_DARK)
  px(c, 17, 21, WOOD_DARK)
  rect(c, 10, 25, 21, 28, WOOD_DARK)
  hline(c, 10, 21, 28, OUTLINE)
  // Marble top (top edge at ground-22 — just above the seat-top + lap zone)
  rect(c, 0, 8, 31, 13, IVORY)
  hline(c, 1, 30, 9, [0xfa, 0xf6, 0xea])
  rect(c, 0, 12, 31, 13, IVORY_SHADE)
  hline(c, 0, 31, 14, BRASS)
  px(c, 0, 8, OUTLINE)
  px(c, 31, 8, OUTLINE)
  return c
}

/**
 * Restaurant chair, 18x34, side profile FACING EAST (backrest on the west).
 * The seat surface sits exactly CHAIR_SEAT_TOP_PX (14 px) above the ground
 * line — the seated-guest anchor reads this constant (scenes/furniture.ts).
 */
function drawChair() {
  const c = canvas(18, 34)
  // Backrest post + pad (west side — the guest's back)
  rect(c, 1, 0, 4, 21, WOOD)
  rect(c, 4, 2, 6, 19, UPHOLSTERY)
  hline(c, 4, 6, 2, UPHOLSTERY_LIGHT)
  px(c, 1, 0, BRASS)
  // Seat: pad on a wood frame — seat TOP at y20 (ground-14)
  rect(c, 1, 20, 16, 23, UPHOLSTERY)
  hline(c, 2, 15, 20, UPHOLSTERY_LIGHT)
  rect(c, 1, 24, 16, 26, WOOD)
  hline(c, 1, 16, 26, WOOD_DARK)
  for (const x of [3, 8, 13]) px(c, x, 24, BRASS)
  // Legs
  rect(c, 2, 27, 4, 32, WOOD_DARK)
  rect(c, 13, 27, 15, 32, WOOD_DARK)
  hline(c, 2, 4, 33, OUTLINE)
  hline(c, 13, 15, 33, OUTLINE)
  return c
}

/**
 * The hotel receptionist, 34x64 — the cast's standing scale, drawn FRONT
 * FACING (toward the screen) in full staff livery: ivory uniform, brass
 * buttons, dark bob. Not a tint carrier — the colors are final.
 */
function drawReceptionist() {
  const c = canvas(34, 64)
  const HAIR = [0x3a, 0x2a, 0x24]
  const HAIR_LIGHT = [0x50, 0x3a, 0x30]
  const SKIN = [0xd9, 0xa8, 0x78]
  const SKIN_SHADE = [0xbf, 0x8e, 0x62]
  // Bob haircut framing the face
  rect(c, 9, 1, 24, 10, HAIR)
  rect(c, 7, 4, 10, 16, HAIR)
  rect(c, 23, 4, 26, 16, HAIR)
  hline(c, 9, 24, 1, HAIR_LIGHT)
  // Face
  rect(c, 11, 8, 22, 19, SKIN)
  hline(c, 11, 22, 17, SKIN_SHADE)
  px(c, 14, 12, OUTLINE)
  px(c, 19, 12, OUTLINE)
  px(c, 13, 9, [0xe8, 0xbc, 0x90])
  px(c, 20, 9, [0xe8, 0xbc, 0x90])
  // Neck
  rect(c, 15, 20, 18, 22, SKIN_SHADE)
  // Uniform torso: ivory with shaded sides, brass buttons + collar
  rect(c, 6, 23, 27, 46, IVORY)
  rect(c, 6, 23, 8, 46, IVORY_SHADE)
  rect(c, 25, 23, 27, 46, IVORY_SHADE)
  hline(c, 6, 27, 23, [0xfa, 0xf6, 0xea])
  rect(c, 12, 23, 21, 25, IVORY)
  hline(c, 13, 20, 25, BRASS)
  for (const y of [29, 34, 39]) px(c, 16, y, BRASS)
  px(c, 17, 29, BRASS_LIGHT)
  px(c, 17, 34, BRASS_LIGHT)
  px(c, 17, 39, BRASS_LIGHT)
  // Name tag
  rect(c, 21, 28, 24, 30, BRASS)
  // Arms: ivory sleeves, skin hands
  rect(c, 3, 25, 5, 44, IVORY_SHADE)
  rect(c, 28, 25, 30, 44, IVORY_SHADE)
  px(c, 4, 25, IVORY)
  px(c, 29, 25, IVORY)
  rect(c, 3, 45, 5, 48, SKIN)
  rect(c, 28, 45, 30, 48, SKIN)
  // Pencil skirt + heels
  rect(c, 8, 47, 25, 56, CRIMSON_DARK)
  hline(c, 8, 25, 47, [0x4a, 0x28, 0x28])
  rect(c, 11, 57, 13, 61, HAIR)
  rect(c, 20, 57, 22, 61, HAIR)
  rect(c, 10, 62, 14, 63, OUTLINE)
  rect(c, 19, 62, 23, 63, OUTLINE)
  return c
}

/**
 * The mezzanine kitchen door, 56x88 — a service double door in the guest-room
 * door scale: wood frame, two swing panels with brass push plates and
 * porthole windows, plus a lintel sign plate. Wall-plane decor for now; a
 * future cycle gives it a use.
 */
function drawKitchenDoor() {
  const c = canvas(56, 88)
  // Frame + lintel
  rect(c, 2, 0, 53, 8, WOOD)
  rect(c, 2, 0, 53, 1, WOOD_LIGHT)
  rect(c, 2, 8, 6, 87, WOOD)
  rect(c, 49, 8, 53, 87, WOOD)
  px(c, 2, 8, OUTLINE)
  px(c, 53, 8, OUTLINE)
  // Sign plate on the lintel
  rect(c, 18, 2, 37, 6, BRASS)
  hline(c, 18, 37, 6, WOOD_DARK)
  hline(c, 20, 35, 3, BRASS_LIGHT)
  // Swing panels with a center gap
  rect(c, 7, 8, 26, 87, WOOD_LIGHT)
  rect(c, 29, 8, 48, 87, WOOD_LIGHT)
  rect(c, 26, 8, 28, 87, OUTLINE)
  for (const [x0, x1] of [
    [7, 26],
    [29, 48],
  ]) {
    hline(c, x0, x1, 8, [0x9a, 0x70, 0x40])
    // Porthole window
    ellipse(c, Math.round((x0 + x1) / 2), 20, 6, 6, WOOD)
    ellipse(c, Math.round((x0 + x1) / 2), 20, 4, 4, [0x1e, 0x2a, 0x30])
    px(c, Math.round((x0 + x1) / 2) - 2, 18, [0x4a, 0x5e, 0x68])
    // Push plate
    rect(c, x0 + 4, 40, x1 - 4, 60, BRASS)
    rect(c, x0 + 5, 41, x1 - 5, 59, [0xc4, 0x9a, 0x4a])
    hline(c, x0 + 6, x1 - 6, 41, BRASS_LIGHT)
    // Panel base shading
    hline(c, x0, x1, 85, WOOD)
    hline(c, x0, x1, 86, WOOD)
  }
  // Kick plates
  rect(c, 7, 76, 26, 82, IVORY_SHADE)
  rect(c, 29, 76, 48, 82, IVORY_SHADE)
  hline(c, 7, 26, 82, BRASS)
  hline(c, 29, 48, 82, BRASS)
  return c
}

// --- Seated guest derivation ------------------------------------------------

/**
 * Derive `guest-<archetype>-sit.png` from the standing silhouette: keep the
 * head/torso (top 62% of the content rows), then append an 8-px lap slab
 * whose per-column colors continue the torso — the chair seat and table
 * cover the missing legs in-game. Grayscale in, grayscale out: the palette
 * tint pipeline (VPOL-06/08) applies unchanged.
 */
function deriveSitSprite(archetype) {
  const src = decodePng(readFileSync(join(root, 'chars', `guest-${archetype}.png`)))
  const { w, rgba } = src
  const alphaAt = (x, y) => rgba[(y * w + x) * 4 + 3]
  let top = -1
  let bottom = -1
  for (let y = 0; y < src.h; y++) {
    let any = false
    for (let x = 0; x < w; x++)
      if (alphaAt(x, y) > 0) {
        any = true
        break
      }
    if (any) {
      if (top === -1) top = y
      bottom = y
    }
  }
  if (top === -1) throw new Error(`empty sprite: guest-${archetype}.png`)
  const contentH = bottom - top + 1
  // Seated read: head + a short torso above the chair seat (~42% of the
  // standing content) — any taller and the pose reads as standing.
  const keepRows = Math.max(6, Math.round(contentH * 0.42))
  const cropY = top + keepRows - 1
  const LAP_H = 9
  const c = canvas(w, keepRows + LAP_H)
  // Torso copy
  for (let y = 0; y < keepRows; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((top + y) * w + x) * 4
      const j = (y * w + x) * 4
      c.data[j] = rgba[i]
      c.data[j + 1] = rgba[i + 1]
      c.data[j + 2] = rgba[i + 2]
      c.data[j + 3] = rgba[i + 3]
    }
  }
  // Content x-extent at the crop line (widest of the last 3 torso rows)
  let x0 = w
  let x1 = -1
  for (let y = cropY - 2; y <= cropY; y++) {
    for (let x = 0; x < w; x++) {
      if (alphaAt(x, y) > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
      }
    }
  }
  if (x1 === -1) throw new Error(`no content at crop line: guest-${archetype}`)
  // Lap slab: thighs continuing the torso colors, widened toward the table
  // side, with a 1-px break under the torso so the fold reads at game scale.
  for (let ly = 0; ly < LAP_H; ly++) {
    const srcY = Math.max(top, cropY - (LAP_H - 1 - ly))
    const spread = ly === 0 ? 0 : ly >= LAP_H - 1 ? 2 : 3
    for (let x = x0 - spread; x <= x1 + spread; x++) {
      const sx = Math.min(Math.max(x, x0), x1)
      const i = (srcY * w + sx) * 4
      if (rgba[i + 3] === 0) continue
      const shade = ly === 0 ? 0.72 : ly === LAP_H - 1 ? 0.78 : 1
      px(c, x, keepRows + ly, [
        Math.round(rgba[i] * shade),
        Math.round(rgba[i + 1] * shade),
        Math.round(rgba[i + 2] * shade),
      ])
    }
  }
  return c
}

// --- Emission ---------------------------------------------------------------

const pieces = [
  ['props/furniture-desk.png', drawDesk],
  ['props/furniture-bench.png', drawBench],
  ['props/furniture-plant.png', drawPlant],
  ['props/furniture-table.png', drawTable],
  ['props/furniture-chair.png', drawChair],
  ['props/furniture-kitchen-door.png', drawKitchenDoor],
  ['chars/npc-receptionist.png', drawReceptionist],
]

const ARCHETYPES = [
  'suite',
  'tourist',
  'clerk',
  'elder',
  'dandy',
  'diva',
  'flapper',
  'merchant',
  'professor',
  'child',
]

let written = 0
for (const [rel, draw] of pieces) {
  const c = draw()
  writeFileSync(join(root, rel), encodePng(c.w, c.h, c.data))
  console.log(`wrote art/${rel} (${c.w}x${c.h})`)
  written++
}
for (const a of ARCHETYPES) {
  const c = deriveSitSprite(a)
  const rel = `chars/guest-${a}-sit.png`
  writeFileSync(join(root, rel), encodePng(c.w, c.h, c.data))
  console.log(`wrote art/${rel} (${c.w}x${c.h})`)
  written++
}
console.log(`${written} files`)
