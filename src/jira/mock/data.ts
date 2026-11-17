import type { JComment, JChangelog, JIssue, JIssueType, JPriority, JProject, JSprint, JStatus, JUser } from '../types'

// A deterministic, realistic-looking Jira site for demo mode and tests.

export const MOCK_FIELDS = {
  sprint: 'customfield_10020',
  points: 'customfield_10016',
  rank: 'customfield_10019',
}

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface MockDb {
  me: JUser
  users: JUser[]
  priorities: JPriority[]
  statuses: JStatus[]
  issueTypes: JIssueType[]
  projects: (JProject & { boardId: number; boardType: string })[]
  sprints: (JSprint & { boardId: number })[]
  issues: JIssue[]
  comments: Record<string, JComment[]>
  changelog: Record<string, JChangelog[]>
  labels: string[]
  nextId: number
  counters: Record<string, number>
}

const cat = (id: number, key: string, name: string) => ({ id, key, name })
const NEW = cat(2, 'new', 'To Do')
const IND = cat(4, 'indeterminate', 'In Progress')
const DONE = cat(3, 'done', 'Done')

const PEOPLE = ['Sam Patel', 'Jordan Lee', 'Priya Shah', 'Diego Alvarez', 'Mia Chen', 'Noah Kim', 'Ava Johnson', 'Leo Martin']

const TITLES: Record<string, string[]> = {
  WEB: [
    'Settings page flickers when switching tabs', 'Add keyboard shortcut for quick search', 'Dark mode colors are off in the billing modal',
    'Migrate date pickers to the new component', 'Onboarding checklist does not persist dismissals', 'Improve empty state for the dashboard',
    'Table column widths reset after refresh', 'Support pasting images into comments', 'Slow first paint on the projects page',
    'Avatar upload fails for HEIC images', 'Add bulk actions to the members list', 'Breadcrumbs overflow on narrow screens',
    'Replace legacy toast system', 'Notification bell badge count is stale', 'Invite flow loses role selection on back',
    'Create shareable links for filtered views', 'Audit focus states for accessibility', 'Search results jump while typing',
    'Sidebar collapse state should persist', 'Add CSV export to reports', 'Fix double submit on the signup form',
    'Command palette ranking ignores recent items', 'Hydration warning on the pricing page', 'Lazy-load heavy charts',
    'Inline edit for issue titles', 'Drag and drop reordering in boards', 'Remember last used workspace',
    'Session expiry should not lose drafts', 'Unify button sizes across forms', 'Upgrade bundler and remove polyfills',
  ],
  API: [
    'Rate limiter counts retries twice', 'Add cursor pagination to /v2/events', 'Webhook deliveries retry forever on 410',
    'Paginate audit log export', 'Slow query on workspace members endpoint', 'Rotate signing keys without downtime',
    'Return 409 on duplicate idempotency keys', 'Background job queue stalls under load', 'Add OpenAPI examples for errors',
    'Deprecate v1 search endpoint', 'Cache permission checks per request', 'Timeouts when exporting large projects',
    'Emit metrics for queue latency', 'Soft-delete for comments', 'Validate time zones on schedule creation',
    'Backfill missing created_by values', 'N+1 queries in the activity feed', 'Support partial updates via PATCH',
    'Health check should include replica lag', 'Make SSO login idempotent', 'Batch endpoint for label changes',
    'Reduce cold start time of workers', 'Fix race when two users rename a team', 'Add request IDs to all error responses',
    'Database connection pool exhaustion at peak', 'Encrypt API tokens at rest', 'GraphQL depth limit',
    'Retry transient S3 errors in uploads', 'Normalize email casing on import', 'Archive stale sandbox tenants',
  ],
  MOB: [
    'Crash when opening a deep link while logged out', 'Push notifications arrive twice on Android', 'Offline mode for viewing issues',
    'Pull to refresh spinner never stops', 'Keyboard covers the comment input', 'Add biometric unlock',
    'Image attachments are blurry', 'Haptics on swipe actions', 'Widget for assigned issues',
    'Tablet layout for issue detail', 'App icon badge does not clear', 'Reduce app size below 40 MB',
    'Share sheet extension for creating issues', 'Dark mode status bar contrast', 'Login with SSO opens wrong browser',
    'Infinite scroll loads duplicates', 'Support dynamic type sizes', 'Background sync drains battery',
    'Crash reporting misses native stack traces', 'Quick reply from notifications',
  ],
}

const EPICS: Record<string, string[]> = {
  WEB: ['New navigation', 'Performance pass Q4', 'Accessibility audit', 'Reporting v2'],
  API: ['Public API v2', 'Reliability & on-call', 'Data retention'],
  MOB: ['Offline support', 'Mobile 3.0 redesign'],
}

const LABELS = ['bug', 'frontend', 'backend', 'design', 'tech-debt', 'performance', 'customer', 'security']

const COMMENT_LINES = [
  'I can reproduce this on staging, looks related to the cache change last week.',
  'Picked this up. Should have a PR by tomorrow.',
  'Do we have a design for the empty state yet?',
  'Customer reported this again today, bumping priority.',
  'Merged. Will verify after the next deploy.',
  'This might be a duplicate of an older ticket, checking.',
  'Added a test that covers the edge case.',
  'Blocked on the API change, see linked issue.',
]

function para(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function description(r: () => number, title: string) {
  const content: any[] = [para(`${title}. This came up during the last planning session and affects a number of users.`)]
  if (r() < 0.6) {
    content.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Acceptance criteria' }] })
    content.push({
      type: 'bulletList',
      content: ['Behaviour matches the spec', 'Covered by tests', 'No regressions in related flows'].map((t) => ({
        type: 'listItem',
        content: [para(t)],
      })),
    })
  }
  if (r() < 0.3) {
    content.push(para('Repro steps:'))
    content.push({ type: 'codeBlock', attrs: { language: 'bash' }, content: [{ type: 'text', text: 'npm run dev\nopen http://localhost:3000/settings' }] })
  }
  if (r() < 0.4) {
    content.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'See ' },
        { type: 'text', text: 'the design doc', marks: [{ type: 'link', attrs: { href: 'https://example.com/design' } }] },
        { type: 'text', text: ' for ' },
        { type: 'text', text: 'context', marks: [{ type: 'strong' }] },
        { type: 'text', text: '.' },
      ],
    })
  }
  return { type: 'doc', version: 1, content }
}

export function createMockDb(now = Date.now()): MockDb {
  const r = rng(42)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const day = 86400000
  const iso = (t: number) => new Date(t).toISOString().replace('Z', '+0000')

  const users: JUser[] = PEOPLE.map((name, i) => ({
    accountId: `acct-${i + 1}`,
    displayName: name,
    emailAddress: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com',
    active: true,
    avatarUrls: {},
  }))
  const me = users[0]

  const priorities: JPriority[] = ['Highest', 'High', 'Medium', 'Low', 'Lowest'].map((name, i) => ({ id: String(i + 1), name }))

  const statuses: JStatus[] = [
    { id: '10000', name: 'Backlog', statusCategory: NEW },
    { id: '10001', name: 'To Do', statusCategory: NEW },
    { id: '10002', name: 'In Progress', statusCategory: IND },
    { id: '10003', name: 'In Review', statusCategory: IND },
    { id: '10004', name: 'Done', statusCategory: DONE },
    { id: '10005', name: "Won't Do", statusCategory: DONE },
  ]

  const issueTypes: JIssueType[] = [
    { id: '10100', name: 'Epic', subtask: false, hierarchyLevel: 1 },
    { id: '10101', name: 'Task', subtask: false, hierarchyLevel: 0 },
    { id: '10102', name: 'Bug', subtask: false, hierarchyLevel: 0 },
    { id: '10103', name: 'Story', subtask: false, hierarchyLevel: 0 },
    { id: '10104', name: 'Subtask', subtask: true, hierarchyLevel: -1 },
  ]
  const typeById = (id: string) => issueTypes.find((t) => t.id === id)!

  const projects: MockDb['projects'] = [
    { id: '20001', key: 'WEB', name: 'Web App', simplified: false, style: 'classic', projectTypeKey: 'software', issueTypes, boardId: 1, boardType: 'scrum' },
    { id: '20002', key: 'API', name: 'Platform API', simplified: false, style: 'classic', projectTypeKey: 'software', issueTypes, boardId: 2, boardType: 'scrum' },
    { id: '20003', key: 'MOB', name: 'Mobile', simplified: true, style: 'next-gen', projectTypeKey: 'software', issueTypes, boardId: 3, boardType: 'kanban' },
  ]

  const sprints: MockDb['sprints'] = []
  let sprintId = 100
  for (const p of projects.filter((p) => p.boardType === 'scrum')) {
    for (let k = -3; k <= 1; k++) {
      const start = now + k * 14 * day - 5 * day
      const state = k < 0 ? 'closed' : k === 0 ? 'active' : 'future'
      sprints.push({
        id: sprintId++,
        name: `${p.key} Sprint ${24 + k}`,
        state,
        startDate: state === 'future' ? undefined : iso(start),
        endDate: state === 'future' ? undefined : iso(start + 14 * day),
        completeDate: state === 'closed' ? iso(start + 14 * day) : undefined,
        goal: state === 'active' ? 'Ship the navigation beta and burn down P1 bugs' : undefined,
        boardId: p.boardId,
        originBoardId: p.boardId,
      })
    }
  }

  const issues: JIssue[] = []
  const comments: Record<string, JComment[]> = {}
  const changelog: Record<string, JChangelog[]> = {}
  const counters: Record<string, number> = {}
  let nextId = 30000
  let rankSeq = 0

  const sprintField = (projectKey: string, statusCat: string) => {
    const ps = sprints.filter((s) => s.boardId === projects.find((p) => p.key === projectKey)!.boardId)
    if (!ps.length) return null
    const active = ps.find((s) => s.state === 'active')!
    const future = ps.find((s) => s.state === 'future')!
    const closed = ps.filter((s) => s.state === 'closed')
    const strip = ({ boardId, ...s }: JSprint & { boardId: number }) => ({ ...s, boardId })
    if (statusCat === 'done') return r() < 0.7 ? [strip(pick(closed))] : r() < 0.5 ? [strip(active)] : null
    if (statusCat === 'indeterminate') return r() < 0.9 ? [strip(active)] : null
    const x = r()
    return x < 0.35 ? [strip(active)] : x < 0.55 ? [strip(future)] : null
  }

  const make = (project: MockDb['projects'][number], title: string, typeId: string, opts: { parent?: JIssue; statusId?: string } = {}) => {
    counters[project.key] = (counters[project.key] ?? 0) + 1
    const key = `${project.key}-${counters[project.key]}`
    const roll = r()
    const statusId =
      opts.statusId ??
      (roll < 0.22 ? '10000' : roll < 0.45 ? '10001' : roll < 0.6 ? '10002' : roll < 0.68 ? '10003' : roll < 0.95 ? '10004' : '10005')
    const status = statuses.find((s) => s.id === statusId)!
    const created = now - Math.floor(r() * 90 * day) - day
    const updated = Math.min(now - Math.floor(r() * 3600000), created + Math.floor(r() * 40 * day))
    const pRoll = r()
    const priority = pRoll < 0.06 ? priorities[0] : pRoll < 0.25 ? priorities[1] : pRoll < 0.65 ? priorities[2] : pRoll < 0.9 ? priorities[3] : priorities[4]
    const assignee = r() < 0.8 ? (r() < 0.25 ? me : pick(users)) : null
    const reporter = pick(users)
    const labels = [...new Set(Array.from({ length: Math.floor(r() * 2.4) }, () => pick(LABELS)))]
    if (typeId === '10102' && !labels.includes('bug')) labels.unshift('bug')
    const type = typeById(typeId)
    const parent = opts.parent
    const issue: JIssue = {
      id: String(nextId++),
      key,
      fields: {
        summary: title,
        status,
        priority,
        assignee,
        reporter,
        creator: reporter,
        labels,
        issuetype: type,
        project: { id: project.id, key: project.key, name: project.name },
        parent: parent
          ? { id: parent.id, key: parent.key, fields: { summary: parent.fields.summary, status: parent.fields.status, issuetype: parent.fields.issuetype } }
          : undefined,
        created: iso(created),
        updated: iso(updated),
        resolutiondate: status.statusCategory.key === 'done' ? iso(updated) : null,
        duedate: r() < 0.12 ? new Date(now + Math.floor((r() * 30 - 5) * day)).toISOString().slice(0, 10) : null,
        description: description(r, title),
        [MOCK_FIELDS.points]: type.hierarchyLevel === 0 && r() < 0.7 ? pick([1, 2, 3, 5, 8]) : null,
        [MOCK_FIELDS.sprint]: type.hierarchyLevel === 0 ? sprintField(project.key, status.statusCategory.key) : null,
        [MOCK_FIELDS.rank]: `0|i${String(rankSeq++ * 37).padStart(5, '0')}:`,
      },
    }
    issues.push(issue)
    const nComments = Math.floor(r() * 3.2)
    comments[issue.id] = Array.from({ length: nComments }, (_, i) => {
      const t = iso(created + (i + 1) * Math.floor((updated - created) / (nComments + 1)))
      return { id: `${issue.id}-c${i}`, author: pick(users), body: { type: 'doc', version: 1, content: [para(pick(COMMENT_LINES))] }, created: t, updated: t }
    })
    changelog[issue.id] =
      status.id !== '10000' && status.id !== '10001'
        ? [
            {
              id: `${issue.id}-h1`,
              author: assignee ?? reporter,
              created: iso(created + Math.floor((updated - created) / 2)),
              items: [{ field: 'status', fieldId: 'status', from: '10001', fromString: 'To Do', to: status.id, toString: status.name }],
            },
          ]
        : []
    return issue
  }

  for (const project of projects) {
    const epics = EPICS[project.key].map((t, i) => make(project, t, '10100', { statusId: i === 0 ? '10002' : i === EPICS[project.key].length - 1 ? '10001' : '10002' }))
    for (const title of TITLES[project.key]) {
      const typeId = r() < 0.3 ? '10102' : r() < 0.5 ? '10103' : '10101'
      const issue = make(project, title, typeId, { parent: r() < 0.7 ? pick(epics) : undefined })
      if (r() < 0.15) {
        for (const t of ['Write tests', 'Update docs', 'Handle edge cases'].slice(0, 1 + Math.floor(r() * 3))) make(project, `${t}`, '10104', { parent: issue })
      }
    }
  }

  return { me, users, priorities, statuses, issueTypes, projects, sprints, issues, comments, changelog, labels: LABELS, nextId, counters }
}
