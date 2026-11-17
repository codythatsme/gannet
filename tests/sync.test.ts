import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, demoDb, disconnect, syncAll, loadIssueDetail } from '../src/store/sync'
import { data, issueByKey, statusOf } from '../src/store/data'
import { defaultSettings, useSettings } from '../src/store/settings'
import { createIssue, setAssignee, setPriority, setSprint, setStatus, toggleLabel } from '../src/store/mutations'
import { applyDisplay, DEFAULT_DISPLAY, groupIssues, sortIssues, type ViewCtx } from '../src/domain/view'

const settings = { ...defaultSettings, site: 'demo', teamKeys: ['WEB', 'API', 'MOB'] }

const ctx = (): ViewCtx => {
  const s = data()
  return { ...s, meId: s.me?.id }
}

beforeAll(async () => {
  useSettings.setState({ settings, loaded: true })
  await connect(settings)
  // connect() kicks off syncAll in the background; wait for it.
  await syncAll()
})
afterAll(() => disconnect())

describe('sync against the demo Jira', () => {
  it('loads site, teams, statuses and sprints', () => {
    const s = data()
    expect(s.connection).toBe('ok')
    expect(s.me?.name).toBe('Sam Patel')
    expect(Object.keys(s.teams).sort()).toEqual(['API', 'MOB', 'WEB'])
    expect(s.teams.WEB.statuses.map((x) => `${x.name}:${x.type}`)).toEqual([
      'Backlog:backlog', 'To Do:unstarted', 'In Progress:started', 'In Review:started', 'Done:completed', "Won't Do:canceled",
    ])
    expect(s.teams.WEB.sprintsEnabled).toBe(true)
    expect(s.teams.MOB.sprintsEnabled).toBe(false)
    expect(s.teams.WEB.estimateFieldId).toBe('customfield_10016')
    expect(Object.values(s.sprints).filter((x) => x.teamKey === 'WEB' && x.state === 'active')).toHaveLength(1)
  })

  it('syncs open issues and recent closed ones', () => {
    const issues = Object.values(data().issues)
    expect(issues.length).toBeGreaterThan(60)
    const db = demoDb()!
    const now = Date.now()
    const expected = db.issues.filter(
      (i) => i.fields.status?.statusCategory.key !== 'done' || Date.parse(i.fields.updated!) >= now - 30 * 86400000 || i.fields.issuetype?.hierarchyLevel === 1,
    )
    expect(issues.length).toBe(expected.length)
    const withEpic = issues.find((i) => i.parent?.hierarchyLevel === 1)
    expect(withEpic).toBeTruthy()
  })

  it('applies edits locally and in Jira', async () => {
    const issue = Object.values(data().issues).find((i) => i.teamKey === 'WEB' && statusOf(i)?.type === 'unstarted')!
    const inProgress = data().teams.WEB.statuses.find((s) => s.name === 'In Progress')!
    const p = setStatus([issue.id], inProgress.id)
    expect(data().issues[issue.id].statusId).toBe(inProgress.id) // optimistic
    expect(await p).toBe(true)
    const raw = demoDb()!.issues.find((i) => i.id === issue.id)!
    expect(raw.fields.status?.name).toBe('In Progress')

    await setPriority([issue.id], '1')
    await setAssignee([issue.id], 'acct-3')
    await toggleLabel([issue.id], 'customer', true)
    expect(raw.fields.priority?.name).toBe('Highest')
    expect(raw.fields.assignee?.displayName).toBe('Priya Shah')
    expect(raw.fields.labels).toContain('customer')

    const active = Object.values(data().sprints).find((s) => s.teamKey === 'WEB' && s.state === 'active')!
    await setSprint([issue.id], active.id)
    expect(raw.fields.customfield_10020.at(-1).id).toBe(active.id)
  })

  it('rolls back when Jira rejects an edit', async () => {
    const issue = Object.values(data().issues).find((i) => i.teamKey === 'API')!
    const before = data().issues[issue.id].priorityId
    const ok = await setPriority([issue.id], 'nope')
    expect(ok).toBe(false)
    expect(data().issues[issue.id].priorityId).toBe(before)
  })

  it('creates issues with follow-up status', async () => {
    const team = data().teams.MOB
    const started = team.statuses.find((s) => s.type === 'started')!
    const created = await createIssue({
      teamKey: 'MOB', typeId: '10101', title: 'Created from a test', description: 'Hello **world**', statusId: started.id, labels: ['design'], priorityId: '2',
    })
    expect(created?.key).toMatch(/^MOB-\d+$/)
    expect(issueByKey(created!.key)?.statusId).toBe(started.id)
    await loadIssueDetail(created!.key)
    expect(data().details[created!.id].description?.content[0].content?.[1]).toEqual({ type: 'text', text: 'world', marks: [{ type: 'strong' }] })
  })

  it('picks up remote changes with a delta sync', async () => {
    const raw = demoDb()!.issues.find((i) => i.key === 'WEB-10')!
    raw.fields.summary = 'Renamed in Jira'
    raw.fields.updated = new Date().toISOString()
    await syncAll()
    expect(issueByKey('WEB-10')?.title).toBe('Renamed in Jira')
  })

  it('groups and orders issues for views', () => {
    const c = ctx()
    const web = applyDisplay(Object.values(c.issues).filter((i) => i.teamKey === 'WEB'), { ...DEFAULT_DISPLAY, completed: 'all' }, c)
    const groups = groupIssues(sortIssues(web, 'priority', c), 'status', c, { teamKey: 'WEB', showEmpty: true })
    expect(groups.map((g) => g.label)).toEqual(['Backlog', 'To Do', 'In Progress', 'In Review', 'Done', "Won't Do"])
    expect(groups.reduce((n, g) => n + g.issues.length, 0)).toBe(web.length)
    const mine = groupIssues(Object.values(c.issues).filter((i) => i.assigneeId === c.meId), 'status', c)
    expect(mine[0].meta.statusType).toBe('started')
  })
})
