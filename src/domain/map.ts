import type {
  JBoardConfig,
  JChangelog,
  JComment,
  JField,
  JIssue,
  JIssueType,
  JPriority,
  JSprint,
  JStatus,
  JUser,
} from '../jira/types'
import type {
  AdfDoc,
  Comment,
  FieldMeta,
  HistoryEntry,
  Issue,
  IssueType,
  Priority,
  PriorityLevel,
  Sprint,
  Status,
  StatusType,
  User,
} from './types'
import { STATUS_TYPES } from './types'

// ---------- statuses ----------

const CANCELED_RE = /cancel|won'?t|wont|reject|declin|duplicate|abandon|invalid|obsolete|not (?:a bug|doing|planned)/i
const BACKLOG_RE = /backlog|icebox|triage|idea|someday|later|parking/i

/** Jira only has three status categories; Linear has five types. Names fill in the gap. */
export function statusTypeFor(name: string, categoryKey: string | undefined): StatusType {
  if (categoryKey === 'done') return CANCELED_RE.test(name) ? 'canceled' : 'completed'
  if (categoryKey === 'indeterminate') return 'started'
  return BACKLOG_RE.test(name) ? 'backlog' : 'unstarted'
}

export function buildStatuses(
  raw: JStatus[],
  columns?: NonNullable<JBoardConfig['columnConfig']>['columns'],
  overrides: Record<string, StatusType> = {},
): Status[] {
  const unique = new Map<string, JStatus>()
  for (const s of raw) if (s && !unique.has(s.id)) unique.set(s.id, s)
  const colIndex = new Map<string, number>()
  columns?.forEach((col, ci) => col.statuses.forEach((s, si) => colIndex.set(String(s.id), ci * 100 + si)))
  const list = [...unique.values()].map((s, i) => ({
    id: s.id,
    name: s.name,
    category: s.statusCategory?.key ?? 'new',
    type: overrides[s.id] ?? statusTypeFor(s.name, s.statusCategory?.key),
    position: colIndex.get(s.id) ?? 100000 + i,
    order: 0,
  }))
  return sortStatuses(list)
}

export function sortStatuses(list: Status[]): Status[] {
  return [...list]
    .sort((a, b) => STATUS_TYPES.indexOf(a.type) - STATUS_TYPES.indexOf(b.type) || a.position - b.position)
    .map((s, order) => ({ ...s, order }))
}

/** Re-type statuses after the user changes overrides in settings. */
export function retypeStatuses(list: Status[], overrides: Record<string, StatusType> = {}): Status[] {
  return sortStatuses(list.map((s) => ({ ...s, type: overrides[s.id] ?? statusTypeFor(s.name, s.category) })))
}

export function mapStatus(s: JStatus): Status {
  const category = s.statusCategory?.key ?? 'new'
  return { id: s.id, name: s.name, category, type: statusTypeFor(s.name, category), order: 999, position: 100000 }
}

// ---------- priorities ----------

export function priorityLevelFor(name: string, index: number, total: number): PriorityLevel {
  const n = name.toLowerCase()
  if (/^(none|no priority|unprioriti[sz]ed|not set)$/.test(n)) return 0
  if (/highest|blocker|critical|urgent|emergency|showstopper|\bp0\b/.test(n)) return 1
  if (/lowest|trivial|minor|\blow\b|\bp[3-5]\b/.test(n)) return 4
  if (/high|major|important|\bp1\b/.test(n)) return 2
  if (/medium|normal|moderate|default|\bp2\b/.test(n)) return 3
  if (total <= 1) return 3
  // Unknown scheme: spread Jira's own order (highest first) across urgent..low.
  return (1 + Math.min(3, Math.floor((index / total) * 4))) as PriorityLevel
}

export function mapPriorities(raw: JPriority[]): Priority[] {
  return raw.map((p, i) => ({ id: p.id, name: p.name, level: priorityLevelFor(p.name, i, raw.length), order: i }))
}

// ---------- users, types, sprints ----------

export function mapUser(u: JUser): User {
  return {
    id: u.accountId,
    name: u.displayName,
    avatarUrl: u.avatarUrls?.['48x48'] ?? u.avatarUrls?.['32x32'],
    active: u.active !== false,
    email: u.emailAddress,
  }
}

export function mapIssueType(t: JIssueType): IssueType {
  return {
    id: t.id,
    name: t.name,
    iconUrl: t.iconUrl,
    subtask: t.subtask,
    hierarchyLevel: t.hierarchyLevel ?? (t.subtask ? -1 : /epic/i.test(t.name) ? 1 : 0),
  }
}

export function mapSprint(s: JSprint, teamKey: string, boardId: number): Sprint {
  return {
    id: s.id,
    name: s.name,
    state: s.state,
    startDate: s.startDate,
    endDate: s.endDate,
    completeDate: s.completeDate,
    goal: s.goal || undefined,
    boardId: s.originBoardId ?? s.boardId ?? boardId,
    teamKey,
  }
}

// ---------- fields ----------

const ESTIMATE_NAMES = ['story points', 'story point estimate', 'story point', 'estimate', 'points']

export function discoverFields(fields: JField[]): FieldMeta {
  const sprint = fields.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')
  const rank = fields.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-lexo-rank')
  const estimates = fields
    .filter(
      (f) =>
        f.custom &&
        (f.schema?.custom === 'com.atlassian.jira.plugin.system.customfieldtypes:jsw-story-points' ||
          (f.schema?.type === 'number' && ESTIMATE_NAMES.includes(f.name.toLowerCase()))),
    )
    .sort((a, b) => ESTIMATE_NAMES.indexOf(a.name.toLowerCase()) - ESTIMATE_NAMES.indexOf(b.name.toLowerCase()))
  return { sprintFieldId: sprint?.id, rankFieldId: rank?.id, estimateFieldIds: estimates.map((f) => f.id) }
}

export const BASE_ISSUE_FIELDS = [
  'summary',
  'status',
  'priority',
  'assignee',
  'reporter',
  'creator',
  'labels',
  'issuetype',
  'project',
  'parent',
  'created',
  'updated',
  'resolutiondate',
  'duedate',
]

export function issueFieldList(meta: FieldMeta, extra: string[] = []): string[] {
  const out = new Set([...BASE_ISSUE_FIELDS, ...meta.estimateFieldIds, ...extra])
  if (meta.sprintFieldId) out.add(meta.sprintFieldId)
  if (meta.rankFieldId) out.add(meta.rankFieldId)
  return [...out]
}

// ---------- issues ----------

function pickSprint(value: unknown): { current?: number; all: number[] } {
  if (!Array.isArray(value) || value.length === 0) return { all: [] }
  const sprints = value.filter((s): s is JSprint => s && typeof s === 'object' && typeof s.id === 'number')
  const active = sprints.find((s) => s.state === 'active')
  const future = sprints
    .filter((s) => s.state === 'future')
    .sort((a, b) => (a.startDate ?? '9').localeCompare(b.startDate ?? '9') || a.id - b.id)[0]
  return { current: (active ?? future)?.id, all: sprints.map((s) => s.id) }
}

function pickEstimate(fields: JIssue['fields'], ids: string[]): number | undefined {
  for (const id of ids) {
    const v = fields[id]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

export function mapIssue(
  j: JIssue,
  meta: FieldMeta,
  teamEstimateField?: string,
): { issue: Issue; users: User[]; status?: Status; type?: IssueType } {
  const f = j.fields
  const users: User[] = []
  for (const u of [f.assignee, f.reporter, f.creator]) if (u?.accountId) users.push(mapUser(u))
  const sprint = meta.sprintFieldId ? pickSprint(f[meta.sprintFieldId]) : { all: [] as number[] }
  const estimateIds = teamEstimateField ? [teamEstimateField, ...meta.estimateFieldIds] : meta.estimateFieldIds
  const parentType = f.parent?.fields?.issuetype
  const issue: Issue = {
    id: j.id,
    key: j.key,
    teamKey: f.project?.key ?? j.key.split('-')[0],
    title: f.summary ?? '',
    statusId: f.status?.id ?? '',
    priorityId: f.priority?.id ?? undefined,
    assigneeId: f.assignee?.accountId ?? undefined,
    reporterId: f.reporter?.accountId ?? undefined,
    creatorId: f.creator?.accountId ?? undefined,
    labels: f.labels ?? [],
    typeId: f.issuetype?.id ?? '',
    parent: f.parent
      ? {
          id: f.parent.id,
          key: f.parent.key,
          title: f.parent.fields?.summary ?? f.parent.key,
          hierarchyLevel: parentType ? mapIssueType(parentType).hierarchyLevel : 1,
          statusCategory: f.parent.fields?.status?.statusCategory?.key,
        }
      : undefined,
    sprintId: sprint.current,
    sprintIds: sprint.all,
    estimate: pickEstimate(f, estimateIds),
    dueDate: f.duedate ?? undefined,
    createdAt: f.created ?? new Date(0).toISOString(),
    updatedAt: f.updated ?? f.created ?? new Date(0).toISOString(),
    resolvedAt: f.resolutiondate ?? undefined,
    rank: meta.rankFieldId ? (f[meta.rankFieldId] ?? undefined) : undefined,
  }
  return { issue, users, status: f.status ? mapStatus(f.status) : undefined, type: f.issuetype ? mapIssueType(f.issuetype) : undefined }
}

export function asAdf(v: unknown): AdfDoc | null {
  if (v && typeof v === 'object' && (v as AdfDoc).type === 'doc') return v as AdfDoc
  if (typeof v === 'string' && v.trim()) {
    return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: v }] }] }
  }
  return null
}

export function mapComment(c: JComment): { comment: Comment; user?: User } {
  return {
    comment: { id: c.id, authorId: c.author?.accountId, body: asAdf(c.body), createdAt: c.created, updatedAt: c.updated },
    user: c.author?.accountId ? mapUser(c.author) : undefined,
  }
}

const HISTORY_FIELDS = new Set(['status', 'priority', 'assignee', 'labels', 'summary', 'Sprint', 'parent', 'IssueParentAssociation', 'Epic Link', 'duedate', 'Story Points', 'Story point estimate', 'issuetype', 'resolution'])

export function mapChangelog(c: JChangelog): { entry: HistoryEntry; user?: User } | null {
  const items = c.items
    .filter((i) => HISTORY_FIELDS.has(i.field) && i.field !== 'resolution')
    .map((i) => ({ field: i.field, from: i.fromString, to: i.toString, fromId: i.from, toId: i.to }))
  if (!items.length) return null
  return {
    entry: { id: c.id, authorId: c.author?.accountId, createdAt: c.created, items },
    user: c.author?.accountId ? mapUser(c.author) : undefined,
  }
}

/** Fields payload for creating/updating an estimate, given the team. */
export function estimateField(meta: FieldMeta, teamEstimateField?: string): string | undefined {
  return teamEstimateField ?? meta.estimateFieldIds[0]
}
