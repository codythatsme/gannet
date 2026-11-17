// The subset of Jira Cloud REST payloads Gannet reads. Only fields we use are typed.

export interface JStatusCategory {
  id: number
  key: string // new | indeterminate | done | undefined
  name: string
  colorName?: string
}

export interface JStatus {
  id: string
  name: string
  statusCategory: JStatusCategory
}

export interface JUser {
  accountId: string
  displayName: string
  emailAddress?: string
  active?: boolean
  avatarUrls?: Record<string, string>
}

export interface JPriority {
  id: string
  name: string
  iconUrl?: string
  statusColor?: string
}

export interface JIssueType {
  id: string
  name: string
  iconUrl?: string
  subtask: boolean
  hierarchyLevel?: number
}

export interface JProject {
  id: string
  key: string
  name: string
  avatarUrls?: Record<string, string>
  simplified?: boolean
  style?: string
  projectTypeKey?: string
  issueTypes?: JIssueType[]
}

export interface JSprint {
  id: number
  name: string
  state: 'active' | 'future' | 'closed'
  startDate?: string
  endDate?: string
  completeDate?: string
  goal?: string
  boardId?: number
  originBoardId?: number
}

export interface JIssueFields {
  summary?: string
  status?: JStatus
  priority?: JPriority | null
  assignee?: JUser | null
  reporter?: JUser | null
  creator?: JUser | null
  labels?: string[]
  issuetype?: JIssueType
  project?: { id: string; key: string; name?: string }
  parent?: { id: string; key: string; fields?: { summary?: string; status?: JStatus; issuetype?: JIssueType } }
  created?: string
  updated?: string
  resolutiondate?: string | null
  duedate?: string | null
  description?: any
  [custom: string]: any
}

export interface JIssue {
  id: string
  key: string
  fields: JIssueFields
}

export interface JSearchResponse {
  issues: JIssue[]
  nextPageToken?: string
  isLast?: boolean
}

export interface JTransition {
  id: string
  name: string
  to: JStatus
  hasScreen?: boolean
  isAvailable?: boolean
}

export interface JComment {
  id: string
  author?: JUser
  body?: any
  created: string
  updated: string
}

export interface JChangelog {
  id: string
  author?: JUser
  created: string
  items: { field: string; fieldId?: string; from?: string | null; fromString?: string | null; to?: string | null; toString?: string | null }[]
}

export interface JField {
  id: string
  name: string
  custom: boolean
  schema?: { type?: string; custom?: string; customId?: number }
}

export interface JBoard {
  id: number
  name: string
  type: string // scrum | kanban | simple
}

export interface JBoardConfig {
  columnConfig?: { columns: { name: string; statuses: { id: string }[] }[] }
  estimation?: { type?: string; field?: { fieldId: string; displayName?: string } }
}

export interface JPage<T> {
  values: T[]
  isLast?: boolean
  total?: number
  startAt?: number
  maxResults?: number
}
