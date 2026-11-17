import { describe, expect, it } from 'vitest'
import { adfToMarkdown, markdownCompatibility, markdownToAdf, parseInline } from '../src/adf/markdown'
import type { AdfDoc } from '../src/domain/types'

const doc = (...content: any[]): AdfDoc => ({ type: 'doc', version: 1, content })
const p = (...content: any[]) => ({ type: 'paragraph', content })
const t = (text: string, ...marks: string[]) => (marks.length ? { type: 'text', text, marks: marks.map((type) => ({ type })) } : { type: 'text', text })

const strip = (n: any): any => {
  if (Array.isArray(n)) return n.map(strip)
  if (n && typeof n === 'object') {
    const out: any = {}
    for (const [k, v] of Object.entries(n)) if (k !== 'localId') out[k] = strip(v)
    return out
  }
  return n
}

describe('markdownToAdf', () => {
  it('parses inline marks', () => {
    expect(parseInline('a **bold** and *em* and `code` ~~gone~~')).toEqual([
      t('a '), t('bold', 'strong'), t(' and '), t('em', 'em'), t(' and '), t('code', 'code'), t(' '), t('gone', 'strike'),
    ])
  })

  it('does not treat snake_case as emphasis', () => {
    expect(parseInline('use snake_case_names here')).toEqual([t('use snake_case_names here')])
  })

  it('parses links, mentions, smart links and emoji', () => {
    expect(parseInline('see [docs](https://x.dev) ping [@Ann Lee](mention:abc123) <https://y.dev/a> :tada:')).toEqual([
      t('see '),
      { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://x.dev' } }] },
      t(' ping '),
      { type: 'mention', attrs: { id: 'abc123', text: '@Ann Lee' } },
      t(' '),
      { type: 'inlineCard', attrs: { url: 'https://y.dev/a' } },
      t(' '),
      { type: 'emoji', attrs: { shortName: ':tada:' } },
    ])
  })

  it('parses blocks', () => {
    const md = ['# Title', '', 'line one', 'line two', '', '- a', '  - nested', '- b', '', '1. first', '2. second', '', '```ts', 'const x = 1', '```', '', '> quoted', '', '---', '', '- [ ] todo', '- [x] done'].join('\n')
    expect(strip(markdownToAdf(md))).toEqual(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [t('Title')] },
        p(t('line one'), { type: 'hardBreak' }, t('line two')),
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [p(t('a')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('nested'))] }] }] },
            { type: 'listItem', content: [p(t('b'))] },
          ],
        },
        { type: 'orderedList', attrs: { order: 1 }, content: [{ type: 'listItem', content: [p(t('first'))] }, { type: 'listItem', content: [p(t('second'))] }] },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const x = 1')] },
        { type: 'blockquote', content: [p(t('quoted'))] },
        { type: 'rule' },
        { type: 'taskList', attrs: {}, content: [{ type: 'taskItem', attrs: { state: 'TODO' }, content: [t('todo')] }, { type: 'taskItem', attrs: { state: 'DONE' }, content: [t('done')] }] },
      ),
    )
  })
})

describe('round trip', () => {
  const cases = [
    'Plain paragraph',
    'Hello **bold** *em* `code` ~~strike~~ [link](https://a.b)',
    '# Heading\n\nBody text\nwith a break',
    '- one\n- two\n  - three\n- four',
    '3. three\n4. four',
    '```js\nlet a = 1\n\nlet b = 2\n```',
    '> quote line\n> second',
    '- [ ] open\n- [x] closed',
    'Mention [@Sam](mention:id-1) and <https://example.com/x> :smile:',
    'Literal \\*stars\\* and \\_underscores\\_ and a\\_b',
    '\\# not a heading\n\\- not a list',
  ]
  for (const md of cases) {
    it(JSON.stringify(md), () => {
      const adf = markdownToAdf(md)
      const back = adfToMarkdown(adf)
      expect(strip(markdownToAdf(back))).toEqual(strip(adf))
    })
  }

  it('escapes literal markdown characters coming from Jira text', () => {
    const adf = doc(p(t('2 * 3 = 6 and file_name.txt and [x]')))
    expect(strip(markdownToAdf(adfToMarkdown(adf)))).toEqual(strip(adf))
  })

  it('keeps marks across escaped text', () => {
    const adf = doc(p(t('a*b', 'strong'), t(' tail')))
    expect(strip(markdownToAdf(adfToMarkdown(adf)))).toEqual(strip(adf))
  })
})

describe('markdownCompatibility', () => {
  it('flags content markdown cannot hold', () => {
    const d = doc(p({ type: 'text', text: 'x', marks: [{ type: 'textColor', attrs: { color: '#f00' } }] }), { type: 'table', content: [] })
    expect(markdownCompatibility(d)).toEqual({ blocking: ['tables'], lossy: ['text colors'] })
  })
})
