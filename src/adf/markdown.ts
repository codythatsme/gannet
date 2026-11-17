import type { AdfDoc, AdfNode } from '../domain/types'

// Markdown <-> Atlassian Document Format for the subset of ADF that Markdown can carry.
//
// Dialect notes (chosen so ADF -> MD -> ADF round-trips):
//  - A single newline inside a paragraph is a hard break (Jira users expect that).
//  - Mentions are written as [@Name](mention:ACCOUNT_ID).
//  - Smart links (inlineCard) are written as <https://...>.
//  - Emoji are :short_name:.
//  - Task lists use - [ ] / - [x].

type Mark = { type: string; attrs?: Record<string, any> }

const BLOCK_EDITABLE = new Set([
  'doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'blockquote', 'rule',
  'taskList', 'taskItem', 'text', 'hardBreak', 'mention', 'emoji', 'inlineCard',
])
const MARK_EDITABLE = new Set(['strong', 'em', 'code', 'strike', 'link'])

const FRIENDLY: Record<string, string> = {
  table: 'tables', media: 'images/attachments', mediaSingle: 'images/attachments', mediaGroup: 'attachments',
  mediaInline: 'attachments', panel: 'panels', expand: 'expand sections', nestedExpand: 'expand sections',
  layoutSection: 'layouts', extension: 'macros', bodiedExtension: 'macros', inlineExtension: 'macros',
  decisionList: 'decisions', blockCard: 'link cards', embedCard: 'embeds', status: 'status lozenges', date: 'dates',
  underline: 'underline', textColor: 'text colors', subsup: 'sub/superscript', backgroundColor: 'highlights',
}

/**
 * Which parts of a document Markdown can't represent.
 * `blocking` would lose content (images, tables...); `lossy` only loses formatting.
 */
export function markdownCompatibility(doc: AdfDoc | null): { blocking: string[]; lossy: string[] } {
  const blocking = new Set<string>()
  const lossy = new Set<string>()
  const walk = (n: AdfNode) => {
    if (!BLOCK_EDITABLE.has(n.type)) blocking.add(FRIENDLY[n.type] ?? n.type)
    for (const m of n.marks ?? []) if (!MARK_EDITABLE.has(m.type)) lossy.add(FRIENDLY[m.type] ?? m.type)
    n.content?.forEach(walk)
  }
  if (doc) walk(doc)
  return { blocking: [...blocking], lossy: [...lossy] }
}

// ---------------------------------------------------------------- ADF -> Markdown

export function adfToMarkdown(doc: AdfDoc | null): string {
  if (!doc?.content) return ''
  return blocksToMd(doc.content).trim()
}

function blocksToMd(nodes: AdfNode[]): string {
  return nodes.map(blockToMd).filter((s) => s !== null).join('\n\n')
}

function indent(text: string, by: string, firstBy = by) {
  return text
    .split('\n')
    .map((l, i) => (i === 0 ? firstBy : l ? by : '') + l)
    .join('\n')
}

function blockToMd(n: AdfNode): string {
  switch (n.type) {
    case 'paragraph':
      return escapeLineStarts(inlineToMd(n.content ?? []))
    case 'heading':
      return '#'.repeat(Math.min(6, Math.max(1, n.attrs?.level ?? 1))) + ' ' + inlineToMd(n.content ?? [])
    case 'rule':
      return '---'
    case 'codeBlock': {
      const text = (n.content ?? []).map((t) => t.text ?? '').join('')
      return '```' + (n.attrs?.language ?? '') + '\n' + text + '\n```'
    }
    case 'blockquote':
      return blocksToMd(n.content ?? [])
        .split('\n')
        .map((l) => (l ? '> ' + l : '>'))
        .join('\n')
    case 'bulletList':
      return (n.content ?? []).map((item) => indent(listItemToMd(item), '  ', '- ')).join('\n')
    case 'orderedList': {
      const start = n.attrs?.order ?? 1
      return (n.content ?? [])
        .map((item, i) => {
          const marker = `${start + i}. `
          return indent(listItemToMd(item), ' '.repeat(marker.length), marker)
        })
        .join('\n')
    }
    case 'taskList':
      return (n.content ?? [])
        .map((item) =>
          item.type === 'taskList'
            ? indent(blockToMd(item), '  ')
            : `- [${item.attrs?.state === 'DONE' ? 'x' : ' '}] ` + inlineToMd(item.content ?? []),
        )
        .join('\n')
    default:
      return n.content ? blocksToMd(n.content) : `[${n.type}]`
  }
}

function listItemToMd(item: AdfNode): string {
  // Nested lists and extra paragraphs go on the following lines; the caller indents them.
  return (item.content ?? []).map(blockToMd).join('\n')
}

const LINE_START_RE = /^(\s*)(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|---\s*$)/

function escapeLineStarts(s: string) {
  return s
    .split('\n')
    .map((l) => l.replace(LINE_START_RE, (_m, sp, tok) => sp + '\\' + tok))
    .join('\n')
}

function escapeText(t: string) {
  return t
    .replace(/\\/g, '\\\\')
    .replace(/([`*[\]~])/g, '\\$1')
    .replace(/(^|[^A-Za-z0-9])_/g, '$1\\_')
    .replace(/_(?=[^A-Za-z0-9]|$)/g, '\\_')
    .replace(/<(?=https?:)/g, '\\<')
    .replace(/:([a-z0-9_+-]+):/g, '\\:$1:')
}

function inlineToMd(nodes: AdfNode[]): string {
  let out = ''
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out += wrapMarks(n.text ?? '', n.marks ?? [])
        break
      case 'hardBreak':
        out += '\n'
        break
      case 'mention': {
        const name = String(n.attrs?.text ?? '').replace(/^@/, '') || 'user'
        out += `[@${name}](mention:${n.attrs?.id ?? ''})`
        break
      }
      case 'emoji':
        out += n.attrs?.shortName ?? n.attrs?.text ?? ''
        break
      case 'inlineCard':
        out += n.attrs?.url ? `<${n.attrs.url}>` : ''
        break
      case 'date': {
        const ts = Number(n.attrs?.timestamp)
        out += Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : ''
        break
      }
      case 'status':
        out += n.attrs?.text ? `[${n.attrs.text}]` : ''
        break
      default:
        out += n.text ?? ''
    }
  }
  return out
}

function wrapMarks(text: string, marks: Mark[]): string {
  const has = (t: string) => marks.find((m) => m.type === t)
  let s = has('code') ? '`' + text.replace(/`/g, '') + '`' : escapeText(text)
  // Keep surrounding whitespace outside the delimiters, or Markdown won't recognise them.
  const lead = s.match(/^\s*/)![0]
  const trail = s.slice(lead.length).match(/\s*$/)![0]
  let core = s.slice(lead.length, s.length - trail.length)
  if (!core) return s
  if (has('strike')) core = `~~${core}~~`
  if (has('em')) core = `*${core}*`
  if (has('strong')) core = `**${core}**`
  const link = has('link')
  if (link) core = `[${core}](${String(link.attrs?.href ?? '').replace(/\)/g, '%29')})`
  return lead + core + trail
}

// ---------------------------------------------------------------- Markdown -> ADF

export function markdownToAdf(md: string): AdfDoc {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  return { type: 'doc', version: 1, content: parseBlocks(lines) }
}

const FENCE_RE = /^\s*```\s*([\w+#.-]*)\s*$/
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/

const isBlank = (l: string) => !l.trim()
const indentOf = (l: string) => l.match(/^\s*/)![0].replace(/\t/g, '    ').length

function startsBlock(l: string) {
  return FENCE_RE.test(l) || HEADING_RE.test(l) || RULE_RE.test(l) || QUOTE_RE.test(l) || LIST_RE.test(l)
}

function parseBlocks(lines: string[]): AdfNode[] {
  const out: AdfNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }
    let m: RegExpMatchArray | null
    if ((m = line.match(FENCE_RE))) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++])
      i++ // closing fence
      const node: AdfNode = { type: 'codeBlock', content: body.length ? [{ type: 'text', text: body.join('\n') }] : [] }
      if (m[1]) node.attrs = { language: m[1] }
      out.push(node)
      continue
    }
    if ((m = line.match(HEADING_RE))) {
      out.push({ type: 'heading', attrs: { level: m[1].length }, content: parseInline(m[2]) })
      i++
      continue
    }
    if (RULE_RE.test(line)) {
      out.push({ type: 'rule' })
      i++
      continue
    }
    if (QUOTE_RE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE_RE.test(lines[i])) body.push(lines[i++].match(QUOTE_RE)![1])
      out.push({ type: 'blockquote', content: parseBlocks(body).filter((b) => b.type !== 'heading' && b.type !== 'rule' && b.type !== 'blockquote') })
      continue
    }
    if (LIST_RE.test(line)) {
      const { node, next } = parseList(lines, i)
      out.push(node)
      i = next
      continue
    }
    const para: string[] = []
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !startsBlock(lines[i]))) para.push(lines[i++].trim())
    const content: AdfNode[] = []
    para.forEach((p, idx) => {
      if (idx > 0) content.push({ type: 'hardBreak' })
      content.push(...parseInline(p))
    })
    out.push({ type: 'paragraph', content })
  }
  return out
}

type ListKind = 'bullet' | 'ordered' | 'task'

function parseList(lines: string[], start: number): { node: AdfNode; next: number } {
  const first = lines[start].match(LIST_RE)!
  const base = indentOf(lines[start])
  const kindOf = (m: RegExpMatchArray): ListKind => (m[3] !== undefined ? 'task' : /\d/.test(m[2]) ? 'ordered' : 'bullet')
  const kind = kindOf(first)
  const items: { text: string; checked: boolean; contentIndent: number; children: string[] }[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      let j = i + 1
      while (j < lines.length && isBlank(lines[j])) j++
      const nm = j < lines.length ? lines[j].match(LIST_RE) : null
      if (j < lines.length && items.length && (indentOf(lines[j]) > base || (nm && indentOf(lines[j]) === base && kindOf(nm) === kind))) {
        items[items.length - 1].children.push('')
        i = j
        continue
      }
      break
    }
    const ind = indentOf(line)
    const m = line.match(LIST_RE)
    if (ind < base) break
    if (ind === base && m) {
      if (kindOf(m) !== kind) break
      items.push({ text: m[4], checked: /x/i.test(m[3] ?? ''), contentIndent: base + m[2].length + 1, children: [] })
      i++
      continue
    }
    if (ind > base && items.length) {
      const cur = items[items.length - 1]
      cur.children.push(line.replace(/^\s+/, (sp) => sp.slice(Math.min(sp.length, cur.contentIndent))))
      i++
      continue
    }
    break
  }

  if (kind === 'task') {
    const content: AdfNode[] = []
    for (const it of items) {
      content.push({ type: 'taskItem', attrs: { localId: localId(), state: it.checked ? 'DONE' : 'TODO' }, content: parseInline(it.text) })
      for (const child of parseBlocks(it.children)) if (child.type === 'taskList') content.push(child)
    }
    return { node: { type: 'taskList', attrs: { localId: localId() }, content }, next: i }
  }

  const node: AdfNode = {
    type: kind === 'ordered' ? 'orderedList' : 'bulletList',
    content: items.map((it) => ({
      type: 'listItem',
      content: [
        { type: 'paragraph', content: parseInline(it.text) },
        ...parseBlocks(it.children).filter((b) => ['paragraph', 'bulletList', 'orderedList', 'codeBlock', 'taskList'].includes(b.type)),
      ],
    })),
  }
  if (kind === 'ordered') {
    const n = parseInt(first[2], 10)
    node.attrs = { order: Number.isFinite(n) ? n : 1 }
  }
  return { node, next: i }
}

let idCounter = 0
const localId = () => `gannet-${Date.now().toString(36)}-${(idCounter++).toString(36)}`

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~<>:@|]/

function textNode(text: string, marks: Mark[]): AdfNode {
  return marks.length ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text }
}

function findClosing(s: string, from: number, delim: string): number {
  for (let j = from; j <= s.length - delim.length; j++) {
    if (s[j] === '\\') {
      j++
      continue
    }
    if (s.startsWith(delim, j)) return j
  }
  return -1
}

function findLinkEnd(s: string, open: number): { textEnd: number; urlEnd: number } | null {
  let depth = 0
  for (let j = open; j < s.length; j++) {
    if (s[j] === '\\') {
      j++
      continue
    }
    if (s[j] === '[') depth++
    else if (s[j] === ']') {
      depth--
      if (depth === 0) {
        if (s[j + 1] !== '(') return null
        const close = s.indexOf(')', j + 2)
        return close < 0 ? null : { textEnd: j, urlEnd: close }
      }
    }
  }
  return null
}

export function parseInline(s: string, marks: Mark[] = []): AdfNode[] {
  const out: AdfNode[] = []
  let buf = ''
  const flush = () => {
    if (buf) {
      const prev = out[out.length - 1]
      if (prev?.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(marks)) prev.text += buf
      else out.push(textNode(buf, marks))
      buf = ''
    }
  }
  const push = (nodes: AdfNode[]) => {
    flush()
    out.push(...nodes)
  }
  const withMark = (m: Mark) => (marks.some((x) => x.type === m.type) ? marks : [...marks, m])

  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.test(s[i + 1])) {
      buf += s[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1)
      if (end > i + 1) {
        // ADF only allows `code` to combine with `link`.
        push([textNode(s.slice(i + 1, end), [...marks.filter((m) => m.type === 'link'), { type: 'code' }])])
        i = end + 1
        continue
      }
    }
    if (s.startsWith('**', i) || s.startsWith('__', i)) {
      const d = s.slice(i, i + 2)
      const end = findClosing(s, i + 2, d)
      if (end > i + 2) {
        push(parseInline(s.slice(i + 2, end), withMark({ type: 'strong' })))
        i = end + 2
        continue
      }
    }
    if (s.startsWith('~~', i)) {
      const end = findClosing(s, i + 2, '~~')
      if (end > i + 2) {
        push(parseInline(s.slice(i + 2, end), withMark({ type: 'strike' })))
        i = end + 2
        continue
      }
    }
    if ((c === '*' || c === '_') && s[i + 1] !== c && s[i + 1] !== ' ' && s[i + 1] !== undefined) {
      const okStart = c === '*' || i === 0 || !/[A-Za-z0-9]/.test(s[i - 1])
      const end = okStart ? findClosing(s, i + 1, c) : -1
      const okEnd = end > i + 1 && s[end - 1] !== ' ' && (c === '*' || end + 1 >= s.length || !/[A-Za-z0-9]/.test(s[end + 1]))
      if (okEnd) {
        push(parseInline(s.slice(i + 1, end), withMark({ type: 'em' })))
        i = end + 1
        continue
      }
    }
    if (c === '[') {
      const link = findLinkEnd(s, i)
      if (link) {
        const label = s.slice(i + 1, link.textEnd)
        const href = s.slice(link.textEnd + 2, link.urlEnd).trim()
        if (href.startsWith('mention:')) {
          push([{ type: 'mention', attrs: { id: href.slice(8), text: '@' + label.replace(/^@/, '') } }])
        } else {
          push(parseInline(label, [...marks.filter((m) => m.type !== 'link'), { type: 'link', attrs: { href } }]))
        }
        i = link.urlEnd + 1
        continue
      }
    }
    if (c === '<') {
      const m = s.slice(i).match(/^<(https?:\/\/[^>\s]+)>/)
      if (m) {
        push([{ type: 'inlineCard', attrs: { url: m[1] } }])
        i += m[0].length
        continue
      }
    }
    if (c === ':') {
      const m = s.slice(i).match(/^:([a-z0-9_+-]+):/)
      if (m && (i === 0 || !/[A-Za-z0-9]/.test(s[i - 1]))) {
        push([{ type: 'emoji', attrs: { shortName: m[0] } }])
        i += m[0].length
        continue
      }
    }
    buf += c
    i++
  }
  flush()
  return out
}

// ---------------------------------------------------------------- helpers

export function adfToPlainText(doc: AdfNode | null | undefined, limit = Infinity): string {
  if (!doc) return ''
  let out = ''
  const walk = (n: AdfNode) => {
    if (out.length > limit) return
    if (n.type === 'text') out += n.text ?? ''
    else if (n.type === 'hardBreak') out += '\n'
    else if (n.type === 'mention') out += n.attrs?.text ?? ''
    else if (n.type === 'emoji') out += n.attrs?.text ?? n.attrs?.shortName ?? ''
    else if (n.type === 'inlineCard') out += n.attrs?.url ?? ''
    n.content?.forEach(walk)
    if (['paragraph', 'heading', 'listItem', 'codeBlock', 'taskItem'].includes(n.type)) out += '\n'
  }
  walk(doc)
  return out.trim().slice(0, limit)
}

export function isEmptyAdf(doc: AdfDoc | null | undefined) {
  return !doc || adfToPlainText(doc).trim() === '' && !(doc.content ?? []).some((n) => n.type !== 'paragraph')
}
