import { api } from '../jira/api'
import { JiraClient, JiraError } from '../jira/client'
import type { JIssue, JStatus } from '../jira/types'
import { deltaSyncJql, initialSyncJql, textSearchJql } from '../domain/jql'
import {
  asAdf,
  buildStatuses,
  discoverFields,
  issueFieldList,
  mapChangelog,
  mapComment,
  mapIssue,
  mapIssueType,
  mapPriorities,
  mapSprint,
  mapUser,
  retypeStatuses,
} from '../domain/map'
import type { Issue, Sprint, Team } from '../domain/types'
import { DEMO_SITE, getSettings, siteBaseUrl, type Settings } from './settings'
import {
  data,
  hydrate,
  issueByKey,
  removeIssues,
  setData,
  setSync,
  upsertIssues,
  upsertMeta,
  upsertUsers,
} from './data'

// ---------------------------------------------------------------- client

let client: JiraClient | null = null
let clientSite: string | null = null

export function jira(): JiraClient {
  if (!client) throw new JiraError(0, 'Not connected to a Jira site')
  return client
}

export async function makeClient(s: Pick<Settings, 'site' | 'auth'>): Promise<JiraClient> {
  if (!s.site) throw new Error('No site configured')
  if (s.site === DEMO_SITE) {
    const { createMockFetch, MOCK_BASE_URL } = await import('../jira/mock/server')
    mockFetch ??= createMockFetch(import.meta.env.MODE === 'test' ? { latency: [0, 0] } : {})
    return new JiraClient(MOCK_BASE_URL, { mode: 'session' }, mockFetch)
  }
  return new JiraClient(siteBaseUrl(s.site), s.auth)
}
let mockFetch: ReturnType<typeof import('../jira/mock/server').createMockFetch> | undefined

/** The Jira web URL for an issue (for "Open in Jira"). */
export function jiraIssueUrl(key: string) {
  const base = data().siteInfo?.baseUrl ?? (clientSite && clientSite !== DEMO_SITE ? siteBaseUrl(clientSite) : '')
  return base ? `${base}/browse/${key}` : ''
}

// ---------------------------------------------------------------- connect / bootstrap

let pollTimer: ReturnType<typeof setInterval> | undefined
let generation = 0

export async function connect(settings: Settings) {
  const gen = ++generation
  stopPolling()
  client = null
  clientSite = settings.site
  if (!settings.site) {
    setData({ site: null, hydrated: true })
    return
  }
  await hydrate(settings.site)
  if (gen !== generation) return
  client = await makeClient(settings)
  await bootstrap(gen)
  if (gen !== generation) return
  startPolling()
}

async function bootstrap(gen: number) {
  const c = jira()
  try {
    const [me, server, fields, priorities] = await Promise.all([
      api.myself(c),
      api.serverInfo(c).catch(() => undefined),
      api.fields(c),
      api.priorities(c),
    ])
    if (gen !== generation) return
    const site = data().site!
    setData({
      me: mapUser(me),
      siteInfo: {
        host: site,
        title: server?.serverTitle || site.split('.')[0],
        baseUrl: site === DEMO_SITE ? '' : (server?.baseUrl ?? siteBaseUrl(site)),
      },
      fieldMeta: discoverFields(fields),
      priorities: mapPriorities(priorities),
      connection: 'ok',
      connectionError: undefined,
    })
    upsertUsers([mapUser(me)])
    void api
      .labels(c)
      .then((p) => gen === generation && setData({ labels: p.values }))
      .catch(() => undefined)
  } catch (e) {
    reportConnectionError(e)
    return
  }
  void syncAll()
}

function reportConnectionError(e: unknown) {
  if (e instanceof JiraError) {
    setData({ connection: e.isAuth ? 'auth' : e.isNetwork ? 'offline' : 'error', connectionError: e.message })
  } else {
    setData({ connection: 'error', connectionError: String((e as Error)?.message ?? e) })
  }
}

/** Re-try after the user logs in to Jira in another tab. */
export async function reconnect() {
  if (!client) return connect(getSettings())
  await bootstrap(generation)
}

// ---------------------------------------------------------------- polling

const POLL_MS = 60_000
const META_TTL = 30 * 60_000
const FULL_TTL = 6 * 3600_000

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void syncAll()
  }, POLL_MS)
}

function stopPolling() {
  clearInterval(pollTimer)
}

export function disconnect() {
  generation++
  stopPolling()
  client = null
}

/** Demo mode only: the in-memory Jira behind the demo site. */
export function demoDb() {
  return mockFetch?.db
}

let lastFocusSync = 0
if (typeof window !== 'undefined') {
  const onFocus = () => {
    if (!client || document.visibilityState !== 'visible' || Date.now() - lastFocusSync < 10_000) return
    lastFocusSync = Date.now()
    if (data().connection === 'auth' || data().connection === 'offline') void reconnect()
    else void syncAll()
  }
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onFocus)
}

// ---------------------------------------------------------------- team sync

/** Issue ids with an in-flight local edit; sync results must not overwrite them. */
export const pending = new Map<string, number>()

const locks = new Map<string, Promise<void>>()

export async function syncAll(opts: { full?: boolean } = {}) {
  const keys = getSettings().teamKeys
  await Promise.all(keys.map((k) => syncTeam(k, opts)))
}

export function syncTeam(teamKey: string, opts: { full?: boolean } = {}): Promise<void> {
  const running = locks.get(teamKey)
  if (running) return running
  const p = (async () => {
    setSync(teamKey, { syncing: true })
    try {
      const info = data().sync[teamKey]
      if (!data().teams[teamKey] || !info?.metaAt || Date.now() - info.metaAt > META_TTL || opts.full) await refreshTeamMeta(teamKey)
      await syncIssues(teamKey, opts.full)
      setSync(teamKey, { syncing: false, error: undefined })
      if (data().connection !== 'ok') setData({ connection: 'ok', connectionError: undefined })
    } catch (e) {
      setSync(teamKey, { syncing: false, error: (e as Error).message })
      if (e instanceof JiraError && (e.isAuth || e.isNetwork)) reportConnectionError(e)
    } finally {
      locks.delete(teamKey)
    }
  })()
  locks.set(teamKey, p)
  return p
}

export async function refreshTeamMeta(teamKey: string) {
  const c = jira()
  const [project, statusSets, boards] = await Promise.all([
    api.project(c, teamKey),
    api.projectStatuses(c, teamKey),
    api.boards(c, teamKey).catch(() => ({ values: [] })),
  ])
  const board = boards.values.find((b) => b.type === 'scrum') ?? boards.values[0]
  const [config, sprints, assignable] = await Promise.all([
    board ? api.boardConfig(c, board.id).catch(() => undefined) : undefined,
    board ? api.sprints(c, board.id).catch(() => null) : null,
    api.assignableUsers(c, teamKey).catch(() => []),
  ])
  const rawStatuses = statusSets.flatMap((t) => t.statuses).filter(Boolean) as JStatus[]
  const overrides = getSettings().statusOverrides[teamKey] ?? {}
  const issueTypes = (project.issueTypes ?? []).map(mapIssueType)
  const team: Team = {
    id: project.id,
    key: project.key,
    name: project.name,
    avatarUrl: project.avatarUrls?.['48x48'],
    simplified: project.simplified ?? project.style === 'next-gen',
    statuses: buildStatuses(rawStatuses, config?.columnConfig?.columns, overrides),
    issueTypes,
    boardId: board?.id,
    boardType: board?.type,
    sprintsEnabled: !!sprints,
    estimateFieldId: config?.estimation?.field?.fieldId,
  }
  const sprintMap = { ...data().sprints }
  for (const [id, s] of Object.entries(sprintMap)) if (s.teamKey === teamKey) delete sprintMap[Number(id)]
  for (const s of sprints ?? []) sprintMap[s.id] = mapSprint(s, teamKey, board!.id)

  const users = assignable.map(mapUser)
  upsertUsers(users)
  upsertMeta(team.statuses, issueTypes)
  setData({
    teams: { ...data().teams, [teamKey]: team },
    sprints: sprintMap,
    assignable: { ...data().assignable, [teamKey]: users.filter((u) => u.active).map((u) => u.id) },
  })
  setSync(teamKey, { metaAt: Date.now() })
}

/** Apply new status-type overrides from settings without refetching. */
export function applyStatusOverrides(teamKey: string) {
  const team = data().teams[teamKey]
  if (!team) return
  const statuses = retypeStatuses(team.statuses, getSettings().statusOverrides[teamKey] ?? {})
  const all = { ...data().statuses }
  for (const s of statuses) all[s.id] = s
  setData({ teams: { ...data().teams, [teamKey]: { ...team, statuses } }, statuses: all })
}

function ingest(raw: JIssue[]): Issue[] {
  const s = data()
  const out: Issue[] = []
  const users = []
  const statuses = []
  const types = []
  for (const j of raw) {
    const teamKey = j.fields.project?.key ?? j.key.split('-')[0]
    const m = mapIssue(j, s.fieldMeta, s.teams[teamKey]?.estimateFieldId)
    out.push(m.issue)
    users.push(...m.users)
    statuses.push(m.status)
    types.push(m.type)
  }
  upsertUsers(users)
  upsertMeta(statuses, types)
  return out
}

async function syncIssues(teamKey: string, forceFull?: boolean) {
  const c = jira()
  const settings = getSettings()
  const info = data().sync[teamKey] ?? {}
  const startedAt = Date.now()
  const full = forceFull || !info.lastSyncAt || !info.lastFullSyncAt || startedAt - info.lastFullSyncAt > FULL_TTL
  const team = data().teams[teamKey]
  const epicTypes = (team?.issueTypes ?? []).filter((t) => t.hierarchyLevel >= 1).map((t) => t.id)
  const jql = full ? initialSyncJql(teamKey, settings.syncWindowDays, epicTypes) : deltaSyncJql(teamKey, info.lastSyncAt!, startedAt)
  const fields = issueFieldList(data().fieldMeta, team?.estimateFieldId ? [team.estimateFieldId] : [])

  const seen = new Set<string>()
  let token: string | undefined
  let truncated = false
  for (;;) {
    const page = await api.search(c, jql, fields, token)
    const issues = ingest(page.issues)
    for (const i of issues) seen.add(i.id)
    upsertIssues(issues, new Set(pending.keys()))
    token = page.nextPageToken
    if (!token || page.isLast === true || page.issues.length === 0) break
    if (seen.size >= settings.maxIssuesPerTeam) {
      truncated = true
      break
    }
  }

  if (full && !truncated) {
    // Anything we hold for this team that the full query didn't return was deleted, moved,
    // or fell out of the sync window.
    const stale = Object.values(data().issues)
      .filter((i) => i.teamKey === teamKey && !seen.has(i.id) && !pending.has(i.id))
      .map((i) => i.id)
    removeIssues(stale)
  }
  setSync(teamKey, { lastSyncAt: startedAt, ...(full ? { lastFullSyncAt: startedAt, truncated } : {}) })
}

// ---------------------------------------------------------------- single issues

export async function fetchIssue(keyOrId: string): Promise<Issue | undefined> {
  const s = data()
  const teamKey = keyOrId.includes('-') ? keyOrId.split('-')[0] : undefined
  const team = teamKey ? s.teams[teamKey] : undefined
  const raw = await api.issue(jira(), keyOrId, issueFieldList(s.fieldMeta, team?.estimateFieldId ? [team.estimateFieldId] : []))
  const [issue] = ingest([raw])
  // A moved issue gets a new key; drop the stale copy.
  const old = issueByKey(keyOrId)
  if (old && old.id !== issue.id) removeIssues([old.id])
  upsertIssues([issue])
  return issue
}

const detailInflight = new Map<string, Promise<void>>()

export function loadIssueDetail(key: string, force = false): Promise<void> {
  const existing = detailInflight.get(key)
  if (existing && !force) return existing
  const p = (async () => {
    const c = jira()
    const s = data()
    const team = s.teams[key.split('-')[0]]
    const fields = issueFieldList(s.fieldMeta, ['description', ...(team?.estimateFieldId ? [team.estimateFieldId] : [])])
    try {
      const [raw, comments, changelog] = await Promise.all([
        api.issue(c, key, fields),
        api.comments(c, key).catch(() => ({ comments: [] })),
        api.changelog(c, key).catch(() => ({ values: [] })),
      ])
      const [issue] = ingest([raw])
      if (!pending.has(issue.id)) upsertIssues([issue])
      const cs = comments.comments.map(mapComment)
      const hs = changelog.values.map(mapChangelog).filter((x) => x !== null)
      upsertUsers([...cs.map((x) => x.user), ...hs.map((x) => x.user)])
      setData({
        details: {
          ...data().details,
          [issue.id]: {
            description: asAdf(raw.fields.description),
            comments: cs.map((x) => x.comment),
            history: hs.map((x) => x.entry),
            fetchedAt: Date.now(),
          },
        },
      })
    } catch (e) {
      if (e instanceof JiraError && e.status === 404) {
        const local = issueByKey(key)
        if (local) removeIssues([local.id])
      }
      throw e
    } finally {
      detailInflight.delete(key)
    }
  })()
  detailInflight.set(key, p)
  return p
}

/** Load every issue matching a JQL query (e.g. a closed sprint or an epic's children). */
export async function loadJql(jql: string, limit = 1000): Promise<number> {
  const s = data()
  const fields = issueFieldList(s.fieldMeta)
  let token: string | undefined
  let n = 0
  for (;;) {
    const page = await api.search(jira(), jql, fields, token)
    upsertIssues(ingest(page.issues), new Set(pending.keys()))
    n += page.issues.length
    token = page.nextPageToken
    if (!token || page.isLast === true || !page.issues.length || n >= limit) break
  }
  return n
}

/** Server-side text search, for issues outside the local cache. */
export async function searchRemote(text: string, limit = 25): Promise<Issue[]> {
  if (!text.trim() || !client) return []
  const s = data()
  const jql = textSearchJql(text, getSettings().teamKeys)
  const page = await api.search(jira(), jql, issueFieldList(s.fieldMeta), undefined, limit)
  const issues = ingest(page.issues)
  upsertIssues(issues, new Set(pending.keys()))
  return issues
}

export async function searchProjects(query: string) {
  const page = await api.searchProjects(jira(), query)
  return page.values
}

export async function recentProjects() {
  return api.recentProjects(jira()).catch(() => [])
}

export async function searchUsers(teamKey: string, query: string) {
  const users = (await api.assignableUsers(jira(), teamKey, query)).map(mapUser)
  upsertUsers(users)
  return users
}

export function sprintsForTeam(teamKey: string, sprints: Record<number, Sprint> = data().sprints): Sprint[] {
  const order = { active: 0, future: 1, closed: 2 }
  return Object.values(sprints)
    .filter((s) => s.teamKey === teamKey)
    .sort((a, b) => order[a.state] - order[b.state] || (a.state === 'closed' ? b.id - a.id : a.id - b.id))
}
