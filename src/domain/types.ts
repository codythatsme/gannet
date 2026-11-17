// Gannet's own model. Jira data is mapped into these shapes by src/domain/map.ts;
// the UI never reads raw Jira payloads.

/** Linear-style workflow buckets. Every Jira status is assigned one of these. */
export type StatusType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export const STATUS_TYPES: StatusType[] = ['backlog', 'unstarted', 'started', 'completed', 'canceled']

export const STATUS_TYPE_LABEL: Record<StatusType, string> = {
  backlog: 'Backlog',
  unstarted: 'Todo',
  started: 'In progress',
  completed: 'Done',
  canceled: 'Canceled',
}

export interface Status {
  id: string
  name: string
  type: StatusType
  /** Jira status category key: new | indeterminate | done */
  category: string
  /** Final position in the team's workflow (type first, then board column). */
  order: number
  /** Raw board column position, kept so types can be re-assigned without refetching. */
  position: number
}

/** 0 = no priority, 1 = urgent, 2 = high, 3 = medium, 4 = low */
export type PriorityLevel = 0 | 1 | 2 | 3 | 4

export interface Priority {
  id: string
  name: string
  level: PriorityLevel
  /** Jira's own ordering (0 = highest). */
  order: number
}

export interface User {
  id: string
  name: string
  avatarUrl?: string
  active: boolean
  email?: string
}

export interface IssueType {
  id: string
  name: string
  iconUrl?: string
  subtask: boolean
  /** -1 sub-task, 0 standard, 1 epic, 2+ above epic */
  hierarchyLevel: number
}

export interface Team {
  id: string
  key: string
  name: string
  avatarUrl?: string
  /** Team-managed ("next-gen") project. */
  simplified: boolean
  statuses: Status[]
  issueTypes: IssueType[]
  boardId?: number
  boardType?: string
  sprintsEnabled: boolean
  /** Field used for estimates on this team's board, if Jira reports one. */
  estimateFieldId?: string
}

export interface Sprint {
  id: number
  name: string
  state: 'active' | 'future' | 'closed'
  startDate?: string
  endDate?: string
  completeDate?: string
  goal?: string
  boardId: number
  teamKey: string
}

export interface ParentRef {
  id: string
  key: string
  title: string
  hierarchyLevel: number
  statusCategory?: string
}

export interface Issue {
  id: string
  key: string
  teamKey: string
  title: string
  statusId: string
  priorityId?: string
  assigneeId?: string
  reporterId?: string
  creatorId?: string
  labels: string[]
  typeId: string
  parent?: ParentRef
  /** Current (active, else next future) sprint, if any. */
  sprintId?: number
  /** Every sprint the issue has been in, including closed ones. */
  sprintIds: number[]
  estimate?: number
  dueDate?: string
  createdAt: string
  updatedAt: string
  resolvedAt?: string
  rank?: string
}

// --- Atlassian Document Format (subset typing) ---
export interface AdfNode {
  type: string
  attrs?: Record<string, any>
  content?: AdfNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, any> }[]
}
export interface AdfDoc extends AdfNode {
  type: 'doc'
  version: 1
  content: AdfNode[]
}

export interface Comment {
  id: string
  authorId?: string
  body: AdfDoc | null
  createdAt: string
  updatedAt: string
}

export interface HistoryItem {
  field: string
  from?: string | null
  to?: string | null
  fromId?: string | null
  toId?: string | null
}

export interface HistoryEntry {
  id: string
  authorId?: string
  createdAt: string
  items: HistoryItem[]
}

export interface IssueDetail {
  description: AdfDoc | null
  comments: Comment[]
  history: HistoryEntry[]
  fetchedAt: number
}

export interface FieldMeta {
  sprintFieldId?: string
  estimateFieldIds: string[]
  rankFieldId?: string
}

export interface SiteInfo {
  host: string
  title: string
  baseUrl: string
}
