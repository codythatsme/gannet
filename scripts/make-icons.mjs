// Generates the extension icons (rounded indigo square with a white bird) as PNGs, with no dependencies.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function shade(x, y) {
  // x, y in [0, 1]. Returns [r, g, b, a] in [0, 1].
  const r = 0.22
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0)
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0)
  if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0]
  const t = y
  let col = [0.43 - 0.1 * t, 0.47 - 0.12 * t, 0.95 - 0.15 * t]
  // Bird: two upper arcs.
  // Bird: two wing arcs whose outer tips stop short of the baseline, with round caps.
  const R = 0.17, W = 0.04, CY = 0.6
  for (const [cx, lo, hi] of [[0.33, 0, 145], [0.67, 35, 180]]) {
    const a = (Math.atan2(CY - y, x - cx) * 180) / Math.PI
    const d = Math.hypot(x - cx, y - CY)
    if (a >= lo && a <= hi && Math.abs(d - R) < W) col = [1, 1, 1]
    for (const t of [lo, hi]) {
      const tx = cx + R * Math.cos((t * Math.PI) / 180), ty = CY - R * Math.sin((t * Math.PI) / 180)
      if (Math.hypot(x - tx, y - ty) < W) col = [1, 1, 1]
    }
  }
  return [...col, 1]
}

function png(size) {
  const ss = 4
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0, 0]
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const [r, g, b, a] = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
          acc = [acc[0] + r * a, acc[1] + g * a, acc[2] + b * a, acc[3] + a]
        }
      const a = acc[3] / (ss * ss)
      const o = py * (size * 4 + 1) + 1 + px * 4
      raw[o] = a ? Math.round((acc[0] / acc[3]) * 255) : 0
      raw[o + 1] = a ? Math.round((acc[1] / acc[3]) * 255) : 0
      raw[o + 2] = a ? Math.round((acc[2] / acc[3]) * 255) : 0
      raw[o + 3] = Math.round(a * 255)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync('public/icons', { recursive: true })
for (const s of [16, 32, 48, 128]) writeFileSync(`public/icons/icon-${s}.png`, png(s))
console.log('icons written')
