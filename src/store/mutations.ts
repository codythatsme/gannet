import { api } from '../jira/api'
import { JiraError } from '../jira/client'
import { markdownToAdf } from '../adf/markdown'
import { estimateField } from '../domain/map'
import type { AdfDoc, Issue, ParentRef } from '../domain/types'
import { data, issueByKey, patchIssue, removeIssues, setData, statusOf } from './data'
import { fetchIssue, jira, loadIssueDetail, pending } from './sync'
import { toast } from './ui'

// Every edit is applied locally first, then sent to Jira. On failure the local change is
// rolled back and the user sees Jira's error. On success the issue is re-read from Jira so
// derived fields (updated, resolution, rank...) are authoritative.

const errorText = (e: unknown) => (e instanceof JiraError ? e.message : (e as Error)?.message || 'Something went wrong')

async function mutate(ids: string[], local: (i: Issue) => Partial<Issue> | null, remote: (i: Issue) => Promise<unknown>, label: string) {
  const targets = ids.map((id) => data().issues[id]).filter(Boolean)
  const results = await Promise.all(
    targets.map(async (before) => {
      const patch = local(before)
      if (!patch) return true
      pending.set(before.id, (pending.get(before.id) ?? 0) + 1)
      patchIssue(before.id, patch)
      try {
        await remote(before)
        return true
      } catch (e) {
        // Roll back only the fields we touched, in case something else changed meanwhile.
        const restore: Partial<Issue> = {}
        for (const k of Object.keys(patch) as (keyof Issue)[]) (restore as any)[k] = before[k]
        patchIssue(before.id, restore)
        toast(`${before.key}: couldn't ${label}. ${errorText(e)}`, 'error')
        return false
      } finally {
        const n = (pending.get(before.id) ?? 1) - 1
        if (n <= 0) pending.delete(before.id)
        else pending.set(before.id, n)
        if (!pending.has(before.id)) void fetchIssue(before.key).catch(() => undefined)
      }
    }),
  )
  return results.every(Boolean)
}

// ---------------------------------------------------------------- fields

export function setStatus(ids: string[], statusId: string) {
  return mutate(
    ids,
    (i) => {
      if (i.statusId === statusId) return null
      const target = data().statuses[statusId]
      const done = target && (target.type === 'completed' || target.type === 'canceled')
      return { statusId, resolvedAt: done ? new Date().toISOString() : undefined }
    },
    async (i) => {
      const { transitions } = await api.transitions(jira(), i.key)
      const t = transitions.find((x) => x.to.id === statusId)
      if (!t) {
        const from = statusOf(i)?.name ?? 'the current status'
        const to = data().statuses[statusId]?.name ?? 'that status'
        throw new Error(`Jira's workflow has no transition from ${from} to ${to}`)
      }
      await api.transition(jira(), i.key, t.id)
    },
    'change status',
  )
}

/** Status ids reachable from the issue's current status in Jira's workflow. */
export async function reachableStatuses(issueKey: string): Promise<Set<string>> {
  const { transitions } = await api.transitions(jira(), issueKey)
  return new Set(transitions.map((t) => t.to.id))
}

export function setPriority(ids: string[], priorityId: string) {
  return mutate(
    ids,
    (i) => (i.priorityId === priorityId ? null : { priorityId }),
    (i) => api.updateIssue(jira(), i.key, { fields: { priority: { id: priorityId } } }),
    'change priority',
  )
}

export function setAssignee(ids: string[], accountId: string | null) {
  return mutate(
    ids,
    (i) => (i.assigneeId === (accountId ?? undefined) ? null : { assigneeId: accountId ?? undefined }),
    (i) => api.assign(jira(), i.key, accountId),
    'change assignee',
  )
}

export function setLabels(id: string, labels: string[]) {
  return mutate(
    [id],
    () => ({ labels }),
    (i) => api.updateIssue(jira(), i.key, { fields: { labels } }),
    'update labels',
  )
}

/** Add or remove one label across several issues. */
export function toggleLabel(ids: string[], label: string, add: boolean) {
  return mutate(
    ids,
    (i) => {
      const has = i.labels.includes(label)
      if (has === add) return null
      return { labels: add ? [...i.labels, label] : i.labels.filter((l) => l !== label) }
    },
    (i) => api.updateIssue(jira(), i.key, { update: { labels: [add ? { add: label } : { remove: label }] } }),
    add ? 'add label' : 'remove label',
  )
}

export function setEstimate(ids: string[], estimate: number | null) {
  return mutate(
    ids,
    (i) => (i.estimate === (estimate ?? undefined) ? null : { estimate: estimate ?? undefined }),
    (i) => {
      const field = estimateField(data().fieldMeta, data().teams[i.teamKey]?.estimateFieldId)
      if (!field) throw new Error('No estimate field found in this Jira site')
      return api.updateIssue(jira(), i.key, { fields: { [field]: estimate } })
    },
    'set estimate',
  )
}

export function setDueDate(ids: string[], dueDate: string | null) {
  return mutate(
    ids,
    (i) => (i.dueDate === (dueDate ?? undefined) ? null : { dueDate: dueDate ?? undefined }),
    (i) => api.updateIssue(jira(), i.key, { fields: { duedate: dueDate } }),
    'set due date',
  )
}

export function setParent(ids: string[], parent: ParentRef | null) {
  return mutate(
    ids,
    (i) => (i.parent?.id === parent?.id || i.id === parent?.id ? null : { parent: parent ?? undefined }),
    (i) => api.updateIssue(jira(), i.key, { fields: { parent: parent ? { key: parent.key } : null } }),
    parent ? 'set parent' : 'remove parent',
  )
}

export function setSprint(ids: string[], sprintId: number | null) {
  const sprint = sprintId ? data().sprints[sprintId] : undefined
  return mutate(
    ids,
    (i) =>
      i.sprintId === (sprintId ?? undefined)
        ? null
        : { sprintId: sprintId ?? undefined, sprintIds: sprintId ? [...new Set([...i.sprintIds, sprintId])] : i.sprintIds },
    (i) => (sprint ? api.moveToSprint(jira(), sprint.id, [i.key]) : api.moveToBacklog(jira(), [i.key])),
    sprint ? 'move to cycle' : 'remove from cycle',
  )
}

export function setTitle(id: string, title: string) {
  const t = title.trim()
  if (!t) return Promise.resolve(false)
  return mutate(
    [id],
    (i) => (i.title === t ? null : { title: t }),
    (i) => api.updateIssue(jira(), i.key, { fields: { summary: t } }),
    'rename',
  )
}

export async function setDescription(id: string, doc: AdfDoc | null) {
  const issue = data().issues[id]
  if (!issue) return false
  const prev = data().details[id]
  if (prev) setData({ details: { ...data().details, [id]: { ...prev, description: doc } } })
  try {
    await api.updateIssue(jira(), issue.key, { fields: { description: doc } })
    return true
  } catch (e) {
    if (prev) setData({ details: { ...data().details, [id]: prev } })
    toast(`${issue.key}: couldn't save description. ${errorText(e)}`, 'error')
    return false
  }
}

export async function addComment(id: string, markdown: string) {
  const issue = data().issues[id]
  if (!issue || !markdown.trim()) return false
  try {
    await api.addComment(jira(), issue.key, markdownToAdf(markdown))
    await loadIssueDetail(issue.key, true)
    return true
  } catch (e) {
    toast(`${issue.key}: couldn't add comment. ${errorText(e)}`, 'error')
    return false
  }
}

export async function deleteIssues(ids: string[]) {
  const issues = ids.map((id) => data().issues[id]).filter(Boolean)
  removeIssues(issues.map((i) => i.id))
  const failed: Issue[] = []
  await Promise.all(
    issues.map((i) =>
      api.deleteIssue(jira(), i.key).catch((e) => {
        failed.push(i)
        toast(`${i.key}: couldn't delete. ${errorText(e)}`, 'error')
      }),
    ),
  )
  if (failed.length) setData({ issues: { ...data().issues, ...Object.fromEntries(failed.map((i) => [i.id, i])) } })
  else toast(issues.length === 1 ? `Deleted ${issues[0].key}` : `Deleted ${issues.length} issues`, 'success')
}

// ---------------------------------------------------------------- create

export interface CreateInput {
  teamKey: string
  typeId: string
  title: string
  description: string
  statusId?: string
  priorityId?: string
  assigneeId?: string
  labels: string[]
  sprintId?: number
  parentKey?: string
  estimate?: number
}

export async function createIssue(input: CreateInput): Promise<Issue | undefined> {
  const s = data()
  const fields: Record<string, unknown> = {
    project: { key: input.teamKey },
    issuetype: { id: input.typeId },
    summary: input.title.trim(),
  }
  if (input.description.trim()) fields.description = markdownToAdf(input.description)
  if (input.priorityId) fields.priority = { id: input.priorityId }
  if (input.assigneeId) fields.assignee = { accountId: input.assigneeId }
  if (input.labels.length) fields.labels = input.labels
  if (input.parentKey) fields.parent = { key: input.parentKey }
  const estField = estimateField(s.fieldMeta, s.teams[input.teamKey]?.estimateFieldId)
  if (input.estimate != null && estField) fields[estField] = input.estimate

  let created: { id: string; key: string }
  try {
    created = await api.createIssue(jira(), fields)
  } catch (e) {
    toast(`Couldn't create issue. ${errorText(e)}`, 'error')
    return undefined
  }
  // Status and sprint can't be set on create; apply them as follow-ups.
  const followUps: Promise<unknown>[] = []
  if (input.sprintId) followUps.push(api.moveToSprint(jira(), input.sprintId, [created.key]))
  if (input.statusId) {
    followUps.push(
      (async () => {
        const { transitions } = await api.transitions(jira(), created.key)
        const t = transitions.find((x) => x.to.id === input.statusId)
        if (t) await api.transition(jira(), created.key, t.id)
      })(),
    )
  }
  const settled = await Promise.allSettled(followUps)
  for (const r of settled) if (r.status === 'rejected') toast(`${created.key} created, but ${errorText(r.reason)}`, 'error')
  try {
    return await fetchIssue(created.key)
  } catch {
    return issueByKey(created.key)
  }
}
