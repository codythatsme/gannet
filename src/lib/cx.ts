export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export function hashHue(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Git branch name in the style Linear uses: key + slugified title. */
export function branchName(key: string, title: string, user?: string) {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  const prefix = user ? user.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '') + '/' : ''
  return `${prefix}${key.toLowerCase()}-${slug}`
}

/** Simple fuzzy score: contiguous / word-start matches score higher; 0 = no match. */
export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return 1
  const idx = t.indexOf(q)
  if (idx === 0) return 100
  if (idx > 0) return (/\W/.test(t[idx - 1]) ? 80 : 60) - Math.min(idx, 20) / 2
  let ti = 0
  let score = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return 0
    score += found === ti ? 2 : 1
    ti = found + 1
  }
  return Math.min(40, score)
}
