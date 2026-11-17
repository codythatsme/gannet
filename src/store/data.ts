import { create } from 'zustand'
import { del, get as idbGet, set as idbSet } from 'idb-keyval'
import type {
  FieldMeta,
  Issue,
  IssueDetail,
  IssueType,
  Priority,
  SiteInfo,
  Sprint,
  Status,
  Team,
  User,
} from '../domain/types'

export interface SyncInfo {
  lastSyncAt?: number
  lastFullSyncAt?: number
  metaAt?: number
  syncing?: boolean
  error?: string
  truncated?: boolean
}

export type Connection = 'unknown' | 'ok' | 'auth' | 'offline' | 'error'

export interface DataState {
  site: string | null
  hydrated: boolean
  connection: Connection
  connectionError?: string
  siteInfo?: SiteInfo
  me?: User
  fieldMeta: FieldMeta
  priorities: Priority[]
  teams: Record<string, Team>
  /** Every status seen, by id (teams that aren't synced still render). */
  statuses: Record<string, Status>
  issueTypes: Record<string, IssueType>
  users: Record<string, User>
  issues: Record<string, Issue>
  sprints: Record<number, Sprint>
  assignable: Record<string, string[]>
  labels: string[]
  sync: Record<string, SyncInfo>
  details: Record<string, IssueDetail>
}

const empty = (): Omit<DataState, 'site' | 'hydrated'> => ({
  connection: 'unknown',
  fieldMeta: { estimateFieldIds: [] },
  priorities: [],
  teams: {},
  statuses: {},
  issueTypes: {},
  users: {},
  issues: {},
  sprints: {},
  assignable: {},
  labels: [],
  sync: {},
  details: {},
})

export const useData = create<DataState>(() => ({ site: null, hydrated: false, ...empty() }))

export const data = () => useData.getState()
export const setData = useData.setState

// ---------------------------------------------------------------- upserts

export function upsertUsers(users: (User | undefined)[]) {
  const cur = data().users
  let next: Record<string, User> | null = null
  for (const u of users) {
    if (!u) continue
    const prev = cur[u.id]
    if (prev && prev.name === u.name && prev.avatarUrl === u.avatarUrl && prev.active === u.active) continue
    next ??= { ...cur }
    next[u.id] = { ...prev, ...u }
  }
  if (next) setData({ users: next })
}

export function upsertMeta(statuses: (Status | undefined)[], types: (IssueType | undefined)[]) {
  const s = data()
  let st: Record<string, Status> | null = null
  for (const x of statuses) if (x && !s.statuses[x.id]) (st ??= { ...s.statuses })[x.id] = x
  let ty: Record<string, IssueType> | null = null
  for (const x of types) if (x && !s.issueTypes[x.id]) (ty ??= { ...s.issueTypes })[x.id] = x
  if (st || ty) setData({ ...(st ? { statuses: st } : {}), ...(ty ? { issueTypes: ty } : {}) })
}

export function upsertIssues(list: Issue[], skip?: Set<string>) {
  if (!list.length) return
  const next = { ...data().issues }
  for (const i of list) if (!skip?.has(i.id)) next[i.id] = i
  setData({ issues: next })
}

export function removeIssues(ids: string[]) {
  if (!ids.length) return
  const next = { ...data().issues }
  for (const id of ids) delete next[id]
  setData({ issues: next })
}

export function patchIssue(id: string, patch: Partial<Issue>) {
  const cur = data().issues[id]
  if (!cur) return
  setData({ issues: { ...data().issues, [id]: { ...cur, ...patch } } })
}

export function setSync(teamKey: string, patch: Partial<SyncInfo>) {
  const s = data().sync
  setData({ sync: { ...s, [teamKey]: { ...s[teamKey], ...patch } } })
}

// ---------------------------------------------------------------- lookups

const keyIndexCache = new WeakMap<Record<string, Issue>, Map<string, string>>()

export function keyIndex(issues: Record<string, Issue>) {
  let idx = keyIndexCache.get(issues)
  if (!idx) {
    idx = new Map()
    for (const i of Object.values(issues)) idx.set(i.key, i.id)
    keyIndexCache.set(issues, idx)
  }
  return idx
}

export function issueByKey(key: string, issues = data().issues): Issue | undefined {
  const id = keyIndex(issues).get(key)
  return id ? issues[id] : undefined
}

const childrenCache = new WeakMap<Record<string, Issue>, Map<string, Issue[]>>()

/** Issues grouped by parent id (sub-issues and epic children). */
export function childrenIndex(issues: Record<string, Issue>) {
  let idx = childrenCache.get(issues)
  if (!idx) {
    idx = new Map()
    for (const i of Object.values(issues)) {
      if (!i.parent) continue
      const arr = idx.get(i.parent.id)
      if (arr) arr.push(i)
      else idx.set(i.parent.id, [i])
    }
    childrenCache.set(issues, idx)
  }
  return idx
}

export function statusOf(issue: Issue, s: Pick<DataState, 'teams' | 'statuses'> = data()): Status | undefined {
  return s.teams[issue.teamKey]?.statuses.find((x) => x.id === issue.statusId) ?? s.statuses[issue.statusId]
}

export function typeOf(issue: Issue, s: Pick<DataState, 'issueTypes'> = data()) {
  return s.issueTypes[issue.typeId]
}

/** Epics (hierarchy level 1) are Gannet "projects". */
export function isEpic(issue: Issue, s: Pick<DataState, 'issueTypes'> = data()) {
  return (s.issueTypes[issue.typeId]?.hierarchyLevel ?? 0) >= 1
}

export function isSubtask(issue: Issue, s: Pick<DataState, 'issueTypes'> = data()) {
  return (s.issueTypes[issue.typeId]?.hierarchyLevel ?? 0) < 0
}

/** The epic an issue belongs to, looking through a sub-task's parent if needed. */
export function projectOf(issue: Issue, s: Pick<DataState, 'issues' | 'issueTypes'> = data()) {
  if (!issue.parent) return undefined
  if (issue.parent.hierarchyLevel >= 1) return issue.parent
  const parent = s.issues[issue.parent.id]
  return parent?.parent && parent.parent.hierarchyLevel >= 1 ? parent.parent : undefined
}

// ---------------------------------------------------------------- persistence

const PERSISTED: (keyof DataState)[] = [
  'siteInfo', 'me', 'fieldMeta', 'priorities', 'teams', 'statuses', 'issueTypes', 'users', 'issues', 'sprints', 'assignable', 'labels', 'sync',
]
const MAX_DETAILS = 300
const SCHEMA = 3
const dataKey = (site: string) => `gannet:v${SCHEMA}:data:${site}`
const detailKey = (site: string) => `gannet:v${SCHEMA}:details:${site}`

let persistTimer: ReturnType<typeof setTimeout> | undefined
let unsub: (() => void) | undefined

export async function hydrate(site: string) {
  unsub?.()
  clearTimeout(persistTimer)
  setData({ site, hydrated: false, ...empty() }, false)
  try {
    const [snap, details] = await Promise.all([idbGet(dataKey(site)), idbGet(detailKey(site))])
    if (data().site !== site) return
    // Sync flags from a previous session are stale.
    const sync = Object.fromEntries(Object.entries((snap?.sync ?? {}) as Record<string, SyncInfo>).map(([k, v]) => [k, { ...v, syncing: false }]))
    setData({ ...(snap ?? {}), sync, details: details ?? {}, hydrated: true })
  } catch {
    setData({ hydrated: true })
  }
  unsub = useData.subscribe((state, prev) => {
    if (state.site !== site) return
    const dirty = PERSISTED.some((k) => state[k] !== prev[k]) || state.details !== prev.details
    if (!dirty) return
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => void persist(site), 800)
  })
}

async function persist(site: string) {
  const s = data()
  if (s.site !== site) return
  const snap: Record<string, unknown> = {}
  for (const k of PERSISTED) snap[k] = s[k]
  const details = Object.fromEntries(
    Object.entries(s.details)
      .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
      .slice(0, MAX_DETAILS),
  )
  try {
    await Promise.all([idbSet(dataKey(site), snap), idbSet(detailKey(site), details)])
  } catch (e) {
    console.warn('[gannet] could not persist cache', e)
  }
}

export async function clearCache(site: string) {
  await Promise.all([del(dataKey(site)), del(detailKey(site))])
  if (data().site === site) setData({ ...empty(), hydrated: true })
}
