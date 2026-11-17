import type { FetchLike } from '../client'
import type { JIssue, JStatus } from '../types'
import { createMockDb, MOCK_FIELDS, type MockDb } from './data'

// An in-memory imitation of the Jira Cloud REST endpoints in src/jira/api.ts.
// Used for demo mode and tests. Only the behaviour Gannet relies on is modelled.

export const MOCK_BASE_URL = 'https://demo.gannet.invalid'

type Handler = (ctx: { db: MockDb; params: string[]; url: URL; body: any; now: number }) => unknown

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const iso = (t: number) => new Date(t).toISOString().replace('Z', '+0000')

function findIssue(db: MockDb, keyOrId: string): JIssue {
  const issue = db.issues.find((i) => i.key === keyOrId || i.id === keyOrId)
  if (!issue) throw new HttpError(404, 'Issue does not exist or you do not have permission to see it.')
  return issue
}

function userById(db: MockDb, id: string | null | undefined) {
  if (!id) return null
  const u = db.users.find((x) => x.accountId === id)
  if (!u) throw new HttpError(400, `User ${id} does not exist`)
  return u
}

function log(db: MockDb, issue: JIssue, now: number, field: string, from: string | null | undefined, to: string | null | undefined) {
  ;(db.changelog[issue.id] ??= []).push({
    id: `${issue.id}-h${now}-${Math.random().toString(36).slice(2, 6)}`,
    author: db.me,
    created: iso(now),
    items: [{ field, fromString: from ?? null, toString: to ?? null }],
  })
}

function touch(issue: JIssue, now: number) {
  issue.fields.updated = iso(now)
}

// ------------------------------------------------------------- tiny JQL evaluator

function splitTop(s: string, sep: RegExp): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = false
  let last = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '"' && s[i - 1] !== '\\') quote = !quote
    if (quote) continue
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (depth === 0) {
      const m = s.slice(i).match(sep)
      if (m && m.index === 0) {
        parts.push(s.slice(last, i))
        i += m[0].length - 1
        last = i + 1
      }
    }
  }
  parts.push(s.slice(last))
  return parts.map((p) => p.trim()).filter(Boolean)
}

const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1')

function relative(spec: string, now: number) {
  const m = spec.match(/^-(\d+)([mdhw])$/)
  if (!m) return 0
  const unit = { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2] as 'm']
  return now - Number(m[1]) * unit
}

function matchClause(db: MockDb, issue: JIssue, clause: string, now: number): boolean {
  clause = clause.trim()
  if (clause.startsWith('(') && clause.endsWith(')')) return matchExpr(db, issue, clause.slice(1, -1), now)
  const f = issue.fields
  let m: RegExpMatchArray | null
  if ((m = clause.match(/^project\s*=\s*(.+)$/i))) return f.project?.key === unquote(m[1])
  if ((m = clause.match(/^project\s+in\s*\((.+)\)$/i))) return m[1].split(',').map(unquote).includes(f.project?.key ?? '')
  if ((m = clause.match(/^statusCategory\s*!=\s*Done$/i))) return f.status?.statusCategory.key !== 'done'
  if ((m = clause.match(/^updated\s*>=\s*(-\d+[mdhw])$/i))) return Date.parse(f.updated!) >= relative(m[1], now)
  if ((m = clause.match(/^issuetype\s+in\s*\((.+)\)$/i))) return m[1].split(',').map(unquote).includes(f.issuetype?.id ?? '')
  if ((m = clause.match(/^key\s*=\s*(.+)$/i))) return issue.key === unquote(m[1])
  if ((m = clause.match(/^key\s+in\s*\((.+)\)$/i))) return m[1].split(',').map(unquote).includes(issue.key)
  if ((m = clause.match(/^parent\s*=\s*(.+)$/i))) return f.parent?.key === unquote(m[1])
  if ((m = clause.match(/^sprint\s*=\s*(\d+)$/i))) return (f[MOCK_FIELDS.sprint] ?? []).some((s: any) => s.id === Number(m![1]))
  if ((m = clause.match(/^assignee\s*=\s*currentUser\(\)$/i))) return f.assignee?.accountId === db.me.accountId
  if ((m = clause.match(/^text\s*~\s*(.+)$/i))) {
    const needle = unquote(m[1]).replace(/\*$/, '').toLowerCase()
    return (f.summary ?? '').toLowerCase().includes(needle) || JSON.stringify(f.description ?? '').toLowerCase().includes(needle)
  }
  throw new HttpError(400, `Mock JQL does not understand: ${clause}`)
}

function matchExpr(db: MockDb, issue: JIssue, expr: string, now: number): boolean {
  return splitTop(expr, /^\s+OR\s+/i).some((alt) => splitTop(alt, /^\s+AND\s+/i).every((c) => matchClause(db, issue, c, now)))
}

function runJql(db: MockDb, jql: string, now: number): JIssue[] {
  const [where, order] = jql.split(/\s+ORDER BY\s+/i)
  const list = where.trim() ? db.issues.filter((i) => matchExpr(db, i, where, now)) : [...db.issues]
  const om = order?.match(/^(\w+)\s*(ASC|DESC)?/i)
  if (om) {
    const field = om[1] as 'updated' | 'created'
    const dir = om[2]?.toUpperCase() === 'ASC' ? 1 : -1
    list.sort((a, b) => dir * (Date.parse(a.fields[field] ?? '') - Date.parse(b.fields[field] ?? '')))
  }
  return list
}

function pickFields(issue: JIssue, fields: string[] | undefined): JIssue {
  if (!fields || fields.includes('*all')) return structuredClone(issue)
  const out: JIssue = { id: issue.id, key: issue.key, fields: {} }
  for (const f of fields) if (f in issue.fields) out.fields[f] = structuredClone(issue.fields[f])
  return out
}

// ------------------------------------------------------------- routes

const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/rest\/api\/3\/myself$/, ({ db }) => db.me],
  ['GET', /^\/rest\/api\/3\/serverInfo$/, () => ({ baseUrl: MOCK_BASE_URL, serverTitle: 'Acme (demo)' })],
  [
    'GET',
    /^\/rest\/api\/3\/field$/,
    () => [
      { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
      { id: MOCK_FIELDS.sprint, name: 'Sprint', custom: true, schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
      { id: MOCK_FIELDS.points, name: 'Story point estimate', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:jsw-story-points' } },
      { id: MOCK_FIELDS.rank, name: 'Rank', custom: true, schema: { type: 'any', custom: 'com.pyxis.greenhopper.jira:gh-lexo-rank' } },
    ],
  ],
  ['GET', /^\/rest\/api\/3\/priority\/search$/, ({ db }) => ({ values: db.priorities, isLast: true })],
  [
    'GET',
    /^\/rest\/api\/3\/project\/search$/,
    ({ db, url }) => {
      const query = (url.searchParams.get('query') ?? '').toLowerCase()
      const values = db.projects.filter((p) => !query || p.name.toLowerCase().includes(query) || p.key.toLowerCase().includes(query))
      return { values: values.map(({ boardId, boardType, issueTypes, ...p }) => p), isLast: true, total: values.length }
    },
  ],
  ['GET', /^\/rest\/api\/3\/project\/recent$/, ({ db }) => db.projects.map(({ boardId, boardType, issueTypes, ...p }) => p)],
  [
    'GET',
    /^\/rest\/api\/3\/project\/([^/]+)$/,
    ({ db, params }) => {
      const p = db.projects.find((x) => x.key === params[0] || x.id === params[0])
      if (!p) throw new HttpError(404, 'No project could be found')
      const { boardId, boardType, ...rest } = p
      return rest
    },
  ],
  [
    'GET',
    /^\/rest\/api\/3\/project\/([^/]+)\/statuses$/,
    ({ db }) => db.issueTypes.map((t) => ({ id: t.id, name: t.name, subtask: t.subtask, statuses: db.statuses })),
  ],
  [
    'GET',
    /^\/rest\/agile\/1\.0\/board$/,
    ({ db, url }) => {
      const p = db.projects.find((x) => x.key === url.searchParams.get('projectKeyOrId'))
      return { values: p ? [{ id: p.boardId, name: `${p.name} board`, type: p.boardType }] : [], isLast: true }
    },
  ],
  [
    'GET',
    /^\/rest\/agile\/1\.0\/board\/(\d+)\/configuration$/,
    ({ db }) => ({
      columnConfig: {
        columns: [
          { name: 'Backlog', statuses: [{ id: '10000' }] },
          { name: 'To Do', statuses: [{ id: '10001' }] },
          { name: 'In Progress', statuses: [{ id: '10002' }] },
          { name: 'In Review', statuses: [{ id: '10003' }] },
          { name: 'Done', statuses: [{ id: '10004' }, { id: '10005' }] },
        ].filter((c) => c.statuses.every((s) => db.statuses.some((x) => x.id === s.id))),
      },
      estimation: { type: 'field', field: { fieldId: MOCK_FIELDS.points, displayName: 'Story point estimate' } },
    }),
  ],
  [
    'GET',
    /^\/rest\/agile\/1\.0\/board\/(\d+)\/sprint$/,
    ({ db, params }) => {
      const id = Number(params[0])
      const p = db.projects.find((x) => x.boardId === id)
      if (p?.boardType !== 'scrum') throw new HttpError(400, 'The board does not support sprints')
      return { values: db.sprints.filter((s) => s.boardId === id), isLast: true }
    },
  ],
  [
    'GET',
    /^\/rest\/api\/3\/user\/assignable\/search$/,
    ({ db, url }) => {
      const query = (url.searchParams.get('query') ?? '').toLowerCase()
      return db.users.filter((u) => !query || u.displayName.toLowerCase().includes(query))
    },
  ],
  ['GET', /^\/rest\/api\/3\/label$/, ({ db }) => ({ values: db.labels, isLast: true })],
  [
    'POST',
    /^\/rest\/api\/3\/search\/jql$/,
    ({ db, body, now }) => {
      const all = runJql(db, body.jql ?? '', now)
      const start = Number(body.nextPageToken ?? 0)
      const size = Math.min(Number(body.maxResults ?? 50), 100)
      const page = all.slice(start, start + size)
      const isLast = start + size >= all.length
      return { issues: page.map((i) => pickFields(i, body.fields)), isLast, nextPageToken: isLast ? undefined : String(start + size) }
    },
  ],
  [
    'GET',
    /^\/rest\/api\/3\/issue\/([^/]+)$/,
    ({ db, params, url }) => pickFields(findIssue(db, params[0]), url.searchParams.get('fields')?.split(',')),
  ],
  [
    'POST',
    /^\/rest\/api\/3\/issue$/,
    ({ db, body, now }) => {
      const f = body.fields ?? {}
      const project = db.projects.find((p) => p.key === f.project?.key || p.id === f.project?.id)
      if (!project) throw new HttpError(400, 'project: Specify a valid project ID or key')
      if (!f.summary?.trim()) throw new HttpError(400, 'summary: You must specify a summary of the issue.')
      const type = db.issueTypes.find((t) => t.id === f.issuetype?.id) ?? db.issueTypes[1]
      const parent = f.parent?.key ? findIssue(db, f.parent.key) : undefined
      db.counters[project.key] = (db.counters[project.key] ?? 0) + 1
      const issue: JIssue = {
        id: String(db.nextId++),
        key: `${project.key}-${db.counters[project.key]}`,
        fields: {
          summary: f.summary,
          status: db.statuses[1],
          priority: db.priorities.find((p) => p.id === f.priority?.id) ?? db.priorities[2],
          assignee: userById(db, f.assignee?.accountId),
          reporter: db.me,
          creator: db.me,
          labels: f.labels ?? [],
          issuetype: type,
          project: { id: project.id, key: project.key, name: project.name },
          parent: parent ? { id: parent.id, key: parent.key, fields: { summary: parent.fields.summary, status: parent.fields.status, issuetype: parent.fields.issuetype } } : undefined,
          created: iso(now),
          updated: iso(now),
          resolutiondate: null,
          duedate: f.duedate ?? null,
          description: f.description ?? null,
          [MOCK_FIELDS.points]: f[MOCK_FIELDS.points] ?? null,
          [MOCK_FIELDS.sprint]: null,
          [MOCK_FIELDS.rank]: `0|z${now}:`,
        },
      }
      db.issues.push(issue)
      db.comments[issue.id] = []
      db.changelog[issue.id] = []
      return { id: issue.id, key: issue.key, self: `${MOCK_BASE_URL}/rest/api/3/issue/${issue.id}` }
    },
  ],
  [
    'PUT',
    /^\/rest\/api\/3\/issue\/([^/]+)$/,
    ({ db, params, body, now }) => {
      const issue = findIssue(db, params[0])
      const f = body.fields ?? {}
      for (const [k, v] of Object.entries<any>(f)) {
        switch (k) {
          case 'summary':
            if (!String(v).trim()) throw new HttpError(400, 'summary: You must specify a summary of the issue.')
            log(db, issue, now, 'summary', issue.fields.summary, v)
            issue.fields.summary = v
            break
          case 'priority': {
            const p = db.priorities.find((x) => x.id === v?.id)
            if (!p) throw new HttpError(400, 'priority: invalid priority')
            log(db, issue, now, 'priority', issue.fields.priority?.name, p.name)
            issue.fields.priority = p
            break
          }
          case 'labels':
            log(db, issue, now, 'labels', (issue.fields.labels ?? []).join(' '), (v as string[]).join(' '))
            issue.fields.labels = v
            break
          case 'description':
            issue.fields.description = v
            break
          case 'duedate':
            log(db, issue, now, 'duedate', issue.fields.duedate, v)
            issue.fields.duedate = v
            break
          case 'parent': {
            const parent = v?.key ? findIssue(db, v.key) : null
            log(db, issue, now, 'IssueParentAssociation', issue.fields.parent?.key, parent?.key)
            issue.fields.parent = parent
              ? { id: parent.id, key: parent.key, fields: { summary: parent.fields.summary, status: parent.fields.status, issuetype: parent.fields.issuetype } }
              : undefined
            break
          }
          case MOCK_FIELDS.points:
            log(db, issue, now, 'Story point estimate', String(issue.fields[k] ?? ''), v == null ? null : String(v))
            issue.fields[k] = v
            break
          default:
            throw new HttpError(400, `${k}: Field '${k}' cannot be set. It is not on the appropriate screen, or unknown.`)
        }
      }
      for (const [k, ops] of Object.entries<any[]>(body.update ?? {})) {
        if (k !== 'labels') throw new HttpError(400, `${k}: update operations are not supported by the mock`)
        const before = [...(issue.fields.labels ?? [])]
        let labels = before
        for (const op of ops) {
          if (op.add && !labels.includes(op.add)) labels = [...labels, op.add]
          if (op.remove) labels = labels.filter((l) => l !== op.remove)
          if (op.set) labels = op.set
        }
        log(db, issue, now, 'labels', before.join(' '), labels.join(' '))
        issue.fields.labels = labels
      }
      touch(issue, now)
      return undefined
    },
  ],
  [
    'DELETE',
    /^\/rest\/api\/3\/issue\/([^/]+)$/,
    ({ db, params }) => {
      const issue = findIssue(db, params[0])
      db.issues = db.issues.filter((i) => i.id !== issue.id && i.fields.parent?.id !== issue.id)
      return undefined
    },
  ],
  [
    'PUT',
    /^\/rest\/api\/3\/issue\/([^/]+)\/assignee$/,
    ({ db, params, body, now }) => {
      const issue = findIssue(db, params[0])
      const user = userById(db, body.accountId)
      log(db, issue, now, 'assignee', issue.fields.assignee?.displayName, user?.displayName)
      issue.fields.assignee = user
      touch(issue, now)
      return undefined
    },
  ],
  [
    'GET',
    /^\/rest\/api\/3\/issue\/([^/]+)\/transitions$/,
    ({ db, params }) => {
      const issue = findIssue(db, params[0])
      return {
        transitions: db.statuses
          .filter((s) => s.id !== issue.fields.status?.id)
          .map((s) => ({ id: `t${s.id}`, name: s.name, to: s, hasScreen: false, isAvailable: true })),
      }
    },
  ],
  [
    'POST',
    /^\/rest\/api\/3\/issue\/([^/]+)\/transitions$/,
    ({ db, params, body, now }) => {
      const issue = findIssue(db, params[0])
      const to = db.statuses.find((s) => `t${s.id}` === body.transition?.id) as JStatus | undefined
      if (!to) throw new HttpError(400, 'Transition id is not valid for this issue.')
      log(db, issue, now, 'status', issue.fields.status?.name, to.name)
      issue.fields.status = to
      issue.fields.resolutiondate = to.statusCategory.key === 'done' ? iso(now) : null
      touch(issue, now)
      return undefined
    },
  ],
  [
    'GET',
    /^\/rest\/api\/3\/issue\/([^/]+)\/comment$/,
    ({ db, params }) => {
      const c = db.comments[findIssue(db, params[0]).id] ?? []
      return { comments: structuredClone(c), total: c.length }
    },
  ],
  [
    'POST',
    /^\/rest\/api\/3\/issue\/([^/]+)\/comment$/,
    ({ db, params, body, now }) => {
      const issue = findIssue(db, params[0])
      const c = { id: `${issue.id}-c${now}`, author: db.me, body: body.body, created: iso(now), updated: iso(now) }
      ;(db.comments[issue.id] ??= []).push(c)
      touch(issue, now)
      return c
    },
  ],
  [
    'GET',
    /^\/rest\/api\/3\/issue\/([^/]+)\/changelog$/,
    ({ db, params }) => {
      const values = db.changelog[findIssue(db, params[0]).id] ?? []
      return { values: structuredClone(values), isLast: true, total: values.length }
    },
  ],
  [
    'POST',
    /^\/rest\/agile\/1\.0\/sprint\/(\d+)\/issue$/,
    ({ db, params, body, now }) => {
      const sprint = db.sprints.find((s) => s.id === Number(params[0]))
      if (!sprint) throw new HttpError(404, 'Sprint not found')
      if (sprint.state === 'closed') throw new HttpError(400, 'Cannot move issues into a closed sprint')
      for (const key of body.issues ?? []) {
        const issue = findIssue(db, key)
        const prev = (issue.fields[MOCK_FIELDS.sprint] ?? []) as any[]
        log(db, issue, now, 'Sprint', prev.map((s) => s.name).join(', '), sprint.name)
        issue.fields[MOCK_FIELDS.sprint] = [...prev.filter((s) => s.state === 'closed'), { ...sprint }]
        touch(issue, now)
      }
      return undefined
    },
  ],
  [
    'POST',
    /^\/rest\/agile\/1\.0\/backlog\/issue$/,
    ({ db, body, now }) => {
      for (const key of body.issues ?? []) {
        const issue = findIssue(db, key)
        const prev = (issue.fields[MOCK_FIELDS.sprint] ?? []) as any[]
        log(db, issue, now, 'Sprint', prev.map((s) => s.name).join(', '), null)
        issue.fields[MOCK_FIELDS.sprint] = prev.filter((s) => s.state === 'closed')
        touch(issue, now)
      }
      return undefined
    },
  ],
]

export function createMockFetch(opts: { latency?: [number, number]; db?: MockDb; now?: () => number } = {}): FetchLike & { db: MockDb } {
  const db = opts.db ?? createMockDb()
  const [lo, hi] = opts.latency ?? [60, 220]
  const clock = opts.now ?? (() => Date.now())
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const url = new URL(input, MOCK_BASE_URL)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (hi > 0) await new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)))
    const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined
    for (const [m, re, handler] of routes) {
      if (m !== method) continue
      const match = url.pathname.match(re)
      if (!match) continue
      try {
        const data = handler({ db, params: match.slice(1).map(decodeURIComponent), url, body, now: clock() })
        return data === undefined ? new Response(null, { status: 204 }) : Response.json(data)
      } catch (e) {
        if (e instanceof HttpError) return Response.json({ errorMessages: [e.message], errors: {} }, { status: e.status })
        throw e
      }
    }
    return Response.json({ errorMessages: [`Mock has no route for ${method} ${url.pathname}`] }, { status: 404 })
  }
  return Object.assign(fetchImpl, { db })
}
