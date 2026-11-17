import type { Issue, IssueType, Priority, Sprint, Status, StatusType, Team, User } from './types'
import { STATUS_TYPES, STATUS_TYPE_LABEL } from './types'

// Pure list logic: filtering, ordering and grouping issues for list and board views.

export type GroupBy = 'status' | 'assignee' | 'priority' | 'project' | 'cycle' | 'label' | 'none'
export type OrderBy = 'manual' | 'priority' | 'updated' | 'created' | 'title' | 'dueDate' | 'estimate'
export type CompletedMode = 'all' | 'week' | 'month' | 'none'
export type FilterField = 'status' | 'statusType' | 'assignee' | 'priority' | 'label' | 'type' | 'cycle' | 'project' | 'creator' | 'team'
export type Prop = 'priority' | 'key' | 'status' | 'labels' | 'project' | 'cycle' | 'estimate' | 'dueDate' | 'assignee' | 'updated' | 'created' | 'type'

export const NONE = '__none__'

export interface Filter {
  field: FilterField
  op: 'is' | 'isNot'
  values: string[]
}

export interface DisplayOptions {
  layout: 'list' | 'board'
  groupBy: GroupBy
  orderBy: OrderBy
  completed: CompletedMode
  showSubIssues: boolean
  showEmptyGroups: boolean
  properties: Prop[]
}

export const DEFAULT_DISPLAY: DisplayOptions = {
  layout: 'list',
  groupBy: 'status',
  orderBy: 'priority',
  completed: 'week',
  showSubIssues: true,
  showEmptyGroups: false,
  properties: ['priority', 'key', 'status', 'labels', 'project', 'estimate', 'dueDate', 'assignee', 'updated'],
}

export interface ViewCtx {
  teams: Record<string, Team>
  statuses: Record<string, Status>
  priorities: Priority[]
  users: Record<string, User>
  sprints: Record<number, Sprint>
  issueTypes: Record<string, IssueType>
  issues: Record<string, Issue>
  meId?: string
}

export function statusFor(i: Issue, ctx: Pick<ViewCtx, 'teams' | 'statuses'>): Status | undefined {
  return ctx.teams[i.teamKey]?.statuses.find((s) => s.id === i.statusId) ?? ctx.statuses[i.statusId]
}

export function statusTypeOf(i: Issue, ctx: Pick<ViewCtx, 'teams' | 'statuses'>): StatusType {
  return statusFor(i, ctx)?.type ?? 'unstarted'
}

export function isClosed(i: Issue, ctx: Pick<ViewCtx, 'teams' | 'statuses'>) {
  const t = statusTypeOf(i, ctx)
  return t === 'completed' || t === 'canceled'
}

export function priorityLevel(i: Issue, ctx: Pick<ViewCtx, 'priorities'>) {
  return ctx.priorities.find((p) => p.id === i.priorityId)?.level ?? 0
}

/** The epic ("project") an issue belongs to, if any. */
export function epicOf(i: Issue, ctx: Pick<ViewCtx, 'issues'>) {
  if (!i.parent) return undefined
  if (i.parent.hierarchyLevel >= 1) return i.parent
  const parent = ctx.issues[i.parent.id]
  return parent?.parent && parent.parent.hierarchyLevel >= 1 ? parent.parent : undefined
}

export function hierarchyOf(i: Issue, ctx: Pick<ViewCtx, 'issueTypes'>) {
  return ctx.issueTypes[i.typeId]?.hierarchyLevel ?? 0
}

// ---------------------------------------------------------------- filtering

export function valuesFor(i: Issue, field: FilterField, ctx: ViewCtx): string[] {
  switch (field) {
    case 'status':
      return [i.statusId]
    case 'statusType':
      return [statusTypeOf(i, ctx)]
    case 'assignee':
      return [i.assigneeId ?? NONE]
    case 'creator':
      return [i.reporterId ?? i.creatorId ?? NONE]
    case 'priority':
      return [i.priorityId ?? NONE]
    case 'label':
      return i.labels.length ? i.labels : [NONE]
    case 'type':
      return [i.typeId]
    case 'cycle':
      return [i.sprintId != null ? String(i.sprintId) : NONE]
    case 'project':
      return [epicOf(i, ctx)?.id ?? NONE]
    case 'team':
      return [i.teamKey]
  }
}

export function matchesFilters(i: Issue, filters: Filter[], ctx: ViewCtx) {
  return filters.every((f) => {
    if (!f.values.length) return true
    const vals = valuesFor(i, f.field, ctx).map((v) => (v === ctx.meId && f.values.includes('me') ? 'me' : v))
    const hit = vals.some((v) => f.values.includes(v))
    return f.op === 'is' ? hit : !hit
  })
}

export function matchesText(i: Issue, text: string) {
  if (!text) return true
  const t = text.toLowerCase()
  return i.title.toLowerCase().includes(t) || i.key.toLowerCase().includes(t) || i.labels.some((l) => l.toLowerCase().includes(t))
}

export function applyDisplay(list: Issue[], opts: DisplayOptions, ctx: ViewCtx, now = Date.now()): Issue[] {
  const cutoff = opts.completed === 'week' ? now - 7 * 86400000 : opts.completed === 'month' ? now - 30 * 86400000 : 0
  return list.filter((i) => {
    const h = hierarchyOf(i, ctx)
    if (h >= 1) return false // epics are shown as projects, not issues
    if (!opts.showSubIssues && h < 0) return false
    if (opts.completed !== 'all' && isClosed(i, ctx)) {
      if (opts.completed === 'none') return false
      return Date.parse(i.resolvedAt ?? i.updatedAt) >= cutoff
    }
    return true
  })
}

// ---------------------------------------------------------------- ordering

const levelRank = (l: number) => (l === 0 ? 5 : l)

export function sortIssues(list: Issue[], orderBy: OrderBy, ctx: ViewCtx): Issue[] {
  const byUpdated = (a: Issue, b: Issue) => b.updatedAt.localeCompare(a.updatedAt)
  const pr = (i: Issue) => {
    const p = ctx.priorities.find((x) => x.id === i.priorityId)
    return p ? levelRank(p.level) * 100 + p.order : 600
  }
  const cmp: Record<OrderBy, (a: Issue, b: Issue) => number> = {
    manual: (a, b) => (a.rank && b.rank ? (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) : a.rank ? -1 : b.rank ? 1 : 0) || b.createdAt.localeCompare(a.createdAt),
    priority: (a, b) => pr(a) - pr(b) || byUpdated(a, b),
    updated: byUpdated,
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    title: (a, b) => a.title.localeCompare(b.title),
    dueDate: (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || pr(a) - pr(b),
    estimate: (a, b) => (b.estimate ?? -1) - (a.estimate ?? -1) || pr(a) - pr(b),
  }
  return [...list].sort(cmp[orderBy])
}

// ---------------------------------------------------------------- grouping

export interface GroupMeta {
  statusId?: string
  statusType?: StatusType
  userId?: string
  priorityId?: string
  priorityLevel?: number
  sprintId?: number
  projectId?: string
  label?: string
}

export interface Group {
  id: string
  label: string
  issues: Issue[]
  meta: GroupMeta
}

/**
 * Group issues. When the view spans several teams, status groups use Gannet's status types
 * (each Jira project has its own statuses); within one team they use that team's statuses.
 */
export function groupIssues(list: Issue[], groupBy: GroupBy, ctx: ViewCtx, opts: { teamKey?: string; showEmpty?: boolean } = {}): Group[] {
  const groups = new Map<string, Group>()
  const add = (id: string, label: string, meta: GroupMeta, issue?: Issue) => {
    let g = groups.get(id)
    if (!g) groups.set(id, (g = { id, label, issues: [], meta }))
    if (issue) g.issues.push(issue)
  }
  const team = opts.teamKey ? ctx.teams[opts.teamKey] : undefined
  let order: (g: Group) => number | string = () => 0

  switch (groupBy) {
    case 'none':
      add('all', 'All issues', {})
      for (const i of list) add('all', 'All issues', {}, i)
      break

    case 'status':
      if (team) {
        if (opts.showEmpty) for (const s of team.statuses) add(s.id, s.name, { statusId: s.id, statusType: s.type })
        for (const i of list) {
          const s = statusFor(i, ctx)
          add(i.statusId, s?.name ?? 'Unknown', { statusId: i.statusId, statusType: s?.type }, i)
        }
        order = (g) => team.statuses.find((s) => s.id === g.id)?.order ?? 999
      } else {
        if (opts.showEmpty) for (const t of STATUS_TYPES) add(`type:${t}`, STATUS_TYPE_LABEL[t], { statusType: t })
        for (const i of list) {
          const t = statusTypeOf(i, ctx)
          add(`type:${t}`, STATUS_TYPE_LABEL[t], { statusType: t }, i)
        }
        // Linear's "My issues" order: in progress first.
        const mine: StatusType[] = ['started', 'unstarted', 'backlog', 'completed', 'canceled']
        order = (g) => mine.indexOf(g.meta.statusType!)
      }
      break

    case 'assignee':
      for (const i of list) {
        const u = i.assigneeId ? ctx.users[i.assigneeId] : undefined
        add(i.assigneeId ?? NONE, u?.name ?? (i.assigneeId ? 'Unknown user' : 'No assignee'), { userId: i.assigneeId ?? NONE }, i)
      }
      order = (g) => (g.id === NONE ? '~' : g.id === ctx.meId ? '!' : g.label.toLowerCase())
      break

    case 'priority':
      if (opts.showEmpty) for (const p of ctx.priorities) add(p.id, p.name, { priorityId: p.id, priorityLevel: p.level })
      for (const i of list) {
        const p = ctx.priorities.find((x) => x.id === i.priorityId)
        add(i.priorityId ?? NONE, p?.name ?? 'No priority', { priorityId: i.priorityId ?? NONE, priorityLevel: p?.level ?? 0 }, i)
      }
      order = (g) => {
        const p = ctx.priorities.find((x) => x.id === g.id)
        return p ? levelRank(p.level) * 100 + p.order : 9999
      }
      break

    case 'project':
      for (const i of list) {
        const e = epicOf(i, ctx)
        add(e?.id ?? NONE, e?.title ?? 'No project', { projectId: e?.id ?? NONE }, i)
      }
      order = (g) => (g.id === NONE ? '~' : g.label.toLowerCase())
      break

    case 'cycle': {
      const stateRank = { active: 0, future: 1, closed: 2 }
      for (const i of list) {
        const s = i.sprintId != null ? ctx.sprints[i.sprintId] : undefined
        add(s ? String(s.id) : NONE, s?.name ?? 'No cycle', { sprintId: s?.id }, i)
      }
      order = (g) => {
        const s = g.meta.sprintId != null ? ctx.sprints[g.meta.sprintId] : undefined
        return s ? stateRank[s.state] * 1e9 + (s.state === 'closed' ? 1e8 - s.id : s.id) : 9e9
      }
      break
    }

    case 'label':
      for (const i of list) {
        if (!i.labels.length) add(NONE, 'No labels', { label: NONE }, i)
        for (const l of i.labels) add(`label:${l}`, l, { label: l }, i)
      }
      order = (g) => (g.id === NONE ? '~' : g.label.toLowerCase())
      break
  }

  return [...groups.values()].sort((a, b) => {
    const x = order(a)
    const y = order(b)
    return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
  })
}

/** The issue patch implied by dropping onto / creating in a group. */
export function groupDefaults(g: Group): { statusId?: string; statusType?: StatusType; assigneeId?: string | null; priorityId?: string; sprintId?: number | null; projectId?: string | null; label?: string } {
  const m = g.meta
  if (m.statusId) return { statusId: m.statusId }
  if (m.statusType) return { statusType: m.statusType }
  if (m.userId) return { assigneeId: m.userId === NONE ? null : m.userId }
  if (m.priorityId && m.priorityId !== NONE) return { priorityId: m.priorityId }
  if ('sprintId' in m) return { sprintId: m.sprintId ?? null }
  if (m.projectId) return { projectId: m.projectId === NONE ? null : m.projectId }
  if (m.label && m.label !== NONE) return { label: m.label }
  return {}
}
