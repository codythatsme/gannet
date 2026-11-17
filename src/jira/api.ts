import { JiraClient, JiraError, q } from './client'
import type {
  JBoard,
  JBoardConfig,
  JChangelog,
  JComment,
  JField,
  JIssue,
  JPage,
  JPriority,
  JProject,
  JSearchResponse,
  JSprint,
  JTransition,
  JUser,
} from './types'

// Typed wrappers for every Jira endpoint Gannet uses. Keep this list short and documented:
// it is also the contract the mock server in ./mock implements.

export const api = {
  myself: (c: JiraClient) => c.get<JUser>('/rest/api/3/myself'),

  serverInfo: (c: JiraClient) => c.get<{ baseUrl: string; serverTitle?: string }>('/rest/api/3/serverInfo'),

  fields: (c: JiraClient) => c.get<JField[]>('/rest/api/3/field'),

  async priorities(c: JiraClient): Promise<JPriority[]> {
    try {
      const page = await c.get<JPage<JPriority>>('/rest/api/3/priority/search?maxResults=100')
      return page.values
    } catch (e) {
      if (e instanceof JiraError && e.status === 404) return c.get<JPriority[]>('/rest/api/3/priority')
      throw e
    }
  },

  searchProjects: (c: JiraClient, query = '', startAt = 0) =>
    c.get<JPage<JProject>>(`/rest/api/3/project/search${q({ query, startAt, maxResults: 50, orderBy: 'name' })}`),

  recentProjects: (c: JiraClient) => c.get<JProject[]>('/rest/api/3/project/recent?maxResults=20'),

  project: (c: JiraClient, key: string) => c.get<JProject>(`/rest/api/3/project/${encodeURIComponent(key)}`),

  projectStatuses: (c: JiraClient, key: string) =>
    c.get<{ id: string; name: string; subtask: boolean; statuses: JIssue['fields']['status'][] }[]>(
      `/rest/api/3/project/${encodeURIComponent(key)}/statuses`,
    ),

  boards: (c: JiraClient, projectKey: string) =>
    c.get<JPage<JBoard>>(`/rest/agile/1.0/board${q({ projectKeyOrId: projectKey, maxResults: 50 })}`),

  boardConfig: (c: JiraClient, boardId: number) => c.get<JBoardConfig>(`/rest/agile/1.0/board/${boardId}/configuration`),

  async sprints(c: JiraClient, boardId: number): Promise<JSprint[]> {
    const out: JSprint[] = []
    let startAt = 0
    for (let i = 0; i < 20; i++) {
      const page = await c.get<JPage<JSprint>>(`/rest/agile/1.0/board/${boardId}/sprint${q({ startAt, maxResults: 50 })}`)
      out.push(...page.values)
      if (page.isLast !== false || page.values.length === 0) break
      startAt += page.values.length
    }
    return out
  },

  assignableUsers: (c: JiraClient, projectKey: string, query = '') =>
    c.get<JUser[]>(`/rest/api/3/user/assignable/search${q({ project: projectKey, query, maxResults: 100 })}`),

  /** Enhanced JQL search (the old /search endpoint was removed from Jira Cloud). */
  search: (c: JiraClient, jql: string, fields: string[], nextPageToken?: string, maxResults = 100) =>
    c.post<JSearchResponse>('/rest/api/3/search/jql', { jql, fields, maxResults, nextPageToken }),

  issue: (c: JiraClient, key: string, fields: string[]) =>
    c.get<JIssue>(`/rest/api/3/issue/${encodeURIComponent(key)}${q({ fields: fields.join(',') })}`),

  createIssue: (c: JiraClient, fields: Record<string, unknown>) => c.post<{ id: string; key: string }>('/rest/api/3/issue', { fields }),

  updateIssue: (c: JiraClient, key: string, body: { fields?: Record<string, unknown>; update?: Record<string, unknown> }) =>
    c.put<void>(`/rest/api/3/issue/${encodeURIComponent(key)}`, body),

  deleteIssue: (c: JiraClient, key: string) => c.delete<void>(`/rest/api/3/issue/${encodeURIComponent(key)}?deleteSubtasks=true`),

  assign: (c: JiraClient, key: string, accountId: string | null) =>
    c.put<void>(`/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, { accountId }),

  transitions: (c: JiraClient, key: string) =>
    c.get<{ transitions: JTransition[] }>(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`),

  transition: (c: JiraClient, key: string, transitionId: string) =>
    c.post<void>(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: transitionId } }),

  comments: (c: JiraClient, key: string) =>
    c.get<{ comments: JComment[] }>(`/rest/api/3/issue/${encodeURIComponent(key)}/comment?orderBy=created&maxResults=100`),

  addComment: (c: JiraClient, key: string, body: unknown) =>
    c.post<JComment>(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body }),

  changelog: (c: JiraClient, key: string) =>
    c.get<JPage<JChangelog>>(`/rest/api/3/issue/${encodeURIComponent(key)}/changelog?maxResults=100`),

  moveToSprint: (c: JiraClient, sprintId: number, keys: string[]) =>
    c.post<void>(`/rest/agile/1.0/sprint/${sprintId}/issue`, { issues: keys }),

  moveToBacklog: (c: JiraClient, keys: string[]) => c.post<void>('/rest/agile/1.0/backlog/issue', { issues: keys }),

  labels: (c: JiraClient, startAt = 0) => c.get<JPage<string>>(`/rest/api/3/label${q({ startAt, maxResults: 1000 })}`),
}
