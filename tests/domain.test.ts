import { describe, expect, it } from 'vitest'
import { buildStatuses, discoverFields, priorityLevelFor, retypeStatuses, statusTypeFor } from '../src/domain/map'
import { deltaSyncJql, initialSyncJql, textSearchJql } from '../src/domain/jql'

describe('status mapping', () => {
  it('maps Jira categories and names onto status types', () => {
    expect(statusTypeFor('Backlog', 'new')).toBe('backlog')
    expect(statusTypeFor('To Do', 'new')).toBe('unstarted')
    expect(statusTypeFor('Selected for Development', 'new')).toBe('unstarted')
    expect(statusTypeFor('In Review', 'indeterminate')).toBe('started')
    expect(statusTypeFor('Done', 'done')).toBe('completed')
    expect(statusTypeFor("Won't Do", 'done')).toBe('canceled')
    expect(statusTypeFor('Duplicate', 'done')).toBe('canceled')
  })

  it('orders by type, then board column, and honours overrides', () => {
    const raw = [
      { id: '3', name: 'Done', statusCategory: { id: 3, key: 'done', name: 'Done' } },
      { id: '2', name: 'Doing', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } },
      { id: '1', name: 'To Do', statusCategory: { id: 2, key: 'new', name: 'To Do' } },
      { id: '4', name: 'QA', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } },
    ]
    const cols = [{ name: 'a', statuses: [{ id: '1' }] }, { name: 'b', statuses: [{ id: '4' }] }, { name: 'c', statuses: [{ id: '2' }] }]
    const out = buildStatuses(raw, cols)
    expect(out.map((s) => s.name)).toEqual(['To Do', 'QA', 'Doing', 'Done'])
    const re = retypeStatuses(out, { '1': 'backlog', '4': 'completed' })
    expect(re.map((s) => `${s.name}:${s.type}`)).toEqual(['To Do:backlog', 'Doing:started', 'QA:completed', 'Done:completed'])
  })
})

describe('priority mapping', () => {
  it('recognises common schemes', () => {
    const names = ['Highest', 'High', 'Medium', 'Low', 'Lowest']
    expect(names.map((n, i) => priorityLevelFor(n, i, 5))).toEqual([1, 2, 3, 4, 4])
    expect(['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'].map((n, i) => priorityLevelFor(n, i, 5))).toEqual([1, 1, 2, 4, 4])
    expect(['P0', 'P1', 'P2', 'P3'].map((n, i) => priorityLevelFor(n, i, 4))).toEqual([1, 2, 3, 4])
  })
  it('falls back to position for unknown names', () => {
    expect(['Red', 'Orange', 'Yellow', 'Green'].map((n, i) => priorityLevelFor(n, i, 4))).toEqual([1, 2, 3, 4])
  })
})

describe('fields', () => {
  it('finds sprint, rank and estimate fields', () => {
    const meta = discoverFields([
      { id: 'customfield_1', name: 'Sprint', custom: true, schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
      { id: 'customfield_2', name: 'Rank', custom: true, schema: { custom: 'com.pyxis.greenhopper.jira:gh-lexo-rank' } },
      { id: 'customfield_3', name: 'Story point estimate', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:jsw-story-points' } },
      { id: 'customfield_4', name: 'Story Points', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
    ])
    expect(meta).toEqual({ sprintFieldId: 'customfield_1', rankFieldId: 'customfield_2', estimateFieldIds: ['customfield_4', 'customfield_3'] })
  })
})

describe('jql', () => {
  it('builds sync queries', () => {
    expect(initialSyncJql('WEB', 30, ['10000'])).toBe('project = "WEB" AND (statusCategory != Done OR updated >= -30d OR issuetype in (10000)) ORDER BY updated DESC')
    expect(deltaSyncJql('WEB', 0, 5 * 60000)).toBe('project = "WEB" AND updated >= -7m ORDER BY updated ASC')
    expect(textSearchJql('say "hi"', ['A'])).toBe('project in ("A") AND text ~ "say \\"hi\\"*" ORDER BY updated DESC')
    expect(textSearchJql('web-12', [])).toBe('(key = "WEB-12" OR text ~ "web-12") ORDER BY updated DESC')
  })
})
