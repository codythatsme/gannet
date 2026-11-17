import { useCallback, useEffect, useMemo } from 'react'
import { Layers } from 'lucide-react'
import { IssuesView } from './IssuesView'
import { Avatar, CycleIcon, ProjectIcon, StatusGlyph, TeamIcon } from '../components/icons'
import { AdfView } from '../components/AdfView'
import type { Issue } from '../domain/types'
import { epicOf, isClosed, statusFor, statusTypeOf } from '../domain/view'
import { sprintJql, epicChildrenJql } from '../domain/jql'
import { useViewCtx } from '../lib/hooks'
import { formatDate } from '../lib/time'
import { issueByKey, useData } from '../store/data'
import { loadIssueDetail, loadJql, fetchIssue } from '../store/sync'
import { navigate } from '../app/router'
import { openCreate } from '../app/actions'

export function MyIssuesView({ tab }: { tab: 'assigned' | 'created' | 'all' }) {
  const meUser = useData((s) => s.me)
  const me = meUser?.id
  const scope = useCallback(
    (i: Issue) => !!me && (tab === 'assigned' ? i.assigneeId === me : tab === 'created' ? (i.reporterId ?? i.creatorId) === me : i.assigneeId === me || (i.reporterId ?? i.creatorId) === me),
    [me, tab],
  )
  return (
    <IssuesView
      viewKey={`my-${tab}`}
      title="My issues"
      icon={<Avatar user={meUser} size={18} />}
      tabs={[
        { id: 'assigned', label: 'Assigned', href: '#/my-issues/assigned', active: tab === 'assigned' },
        { id: 'created', label: 'Created', href: '#/my-issues/created', active: tab === 'created' },
        { id: 'all', label: 'Activity', href: '#/my-issues/all', active: tab === 'all' },
      ]}
      scope={scope}
      defaults={{ properties: ['priority', 'key', 'status', 'labels', 'project', 'dueDate', 'updated', 'assignee'] }}
      createDefaults={tab === 'assigned' && me ? { assigneeId: me } : {}}
      emptyText={tab === 'assigned' ? 'Nothing assigned to you. Nice.' : 'No issues'}
    />
  )
}

export function TeamIssuesView({ teamKey, tab }: { teamKey: string; tab: 'all' | 'active' | 'backlog' }) {
  const ctx = useViewCtx()
  const team = ctx.teams[teamKey]
  const usesSprints = !!team?.sprintsEnabled
  const scope = useCallback(
    (i: Issue) => {
      if (i.teamKey !== teamKey) return false
      if (tab === 'all') return true
      const t = statusTypeOf(i, ctx)
      const inActive = i.sprintId != null && ctx.sprints[i.sprintId]?.state === 'active'
      // Scrum teams: "active" is the running sprint; everything else not started is backlog.
      if (tab === 'active') return t === 'started' || (t === 'unstarted' && (!usesSprints || inActive))
      return t === 'backlog' || (usesSprints && t === 'unstarted' && !inActive)
    },
    [teamKey, tab, ctx, usesSprints],
  )
  return (
    <IssuesView
      viewKey={`team-${teamKey}-${tab}`}
      title={team?.name ?? teamKey}
      icon={<TeamIcon teamKey={teamKey} team={team} size={18} />}
      teamKey={teamKey}
      tabs={[
        { id: 'all', label: 'All issues', href: `#/team/${teamKey}/all`, active: tab === 'all' },
        { id: 'active', label: 'Active', href: `#/team/${teamKey}/active`, active: tab === 'active' },
        { id: 'backlog', label: 'Backlog', href: `#/team/${teamKey}/backlog`, active: tab === 'backlog' },
      ]}
      scope={scope}
      createDefaults={{ teamKey, statusType: tab === 'backlog' ? 'backlog' : undefined }}
      emptyText={team ? 'No issues here yet' : 'Loading team…'}
    />
  )
}

function Progress({ done, total, started = 0 }: { done: number; total: number; started?: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <span className="progress" title={`${done} of ${total} done`}>
      <span className="progress-bar">
        <span className="progress-started" style={{ width: `${total ? ((done + started) / total) * 100 : 0}%` }} />
        <span className="progress-done" style={{ width: `${pct}%` }} />
      </span>
      <span className="progress-pct">{pct}%</span>
    </span>
  )
}

export function CyclesView({ teamKey }: { teamKey: string }) {
  const ctx = useViewCtx()
  const team = ctx.teams[teamKey]
  const sprints = useMemo(() => Object.values(ctx.sprints).filter((s) => s.teamKey === teamKey), [ctx.sprints, teamKey])
  const stats = useMemo(() => {
    const m = new Map<number, { total: number; done: number; started: number; points: number; donePoints: number }>()
    for (const i of Object.values(ctx.issues)) {
      if (i.teamKey !== teamKey) continue
      for (const sid of i.sprintId != null ? [i.sprintId] : i.sprintIds.slice(-1)) {
        const st = m.get(sid) ?? { total: 0, done: 0, started: 0, points: 0, donePoints: 0 }
        const t = statusTypeOf(i, ctx)
        st.total++
        st.points += i.estimate ?? 0
        if (t === 'completed' || t === 'canceled') {
          st.done++
          st.donePoints += i.estimate ?? 0
        } else if (t === 'started') st.started++
        m.set(sid, st)
      }
    }
    return m
  }, [ctx, teamKey])
  const groups: [string, typeof sprints][] = [
    ['Current', sprints.filter((s) => s.state === 'active')],
    ['Upcoming', sprints.filter((s) => s.state === 'future').sort((a, b) => a.id - b.id)],
    ['Past', sprints.filter((s) => s.state === 'closed').sort((a, b) => (b.completeDate ?? '').localeCompare(a.completeDate ?? '')).slice(0, 12)],
  ]
  return (
    <div className="view">
      <header className="view-header">
        <div className="view-title">
          <TeamIcon teamKey={teamKey} team={team} size={18} />
          <h1>{team?.name ?? teamKey}</h1>
          <span className="crumb-sep">›</span>
          <h1 className="muted-title">Cycles</h1>
        </div>
      </header>
      <div className="view-body scroll">
        {!team?.sprintsEnabled && team && <div className="list-empty">This team's Jira board doesn't use sprints.</div>}
        {groups.map(([label, list]) =>
          list.length ? (
            <section key={label} className="card-section">
              <div className="section-title">{label}</div>
              {list.map((s) => {
                const st = stats.get(s.id)
                const daysLeft = s.endDate ? Math.ceil((Date.parse(s.endDate) - Date.now()) / 86400000) : null
                return (
                  <a key={s.id} className="cycle-row" href={`#/team/${teamKey}/cycle/${s.id}`}>
                    <CycleIcon state={s.state} size={16} />
                    <span className="cycle-name">{s.name}</span>
                    <span className="muted">{s.startDate ? `${formatDate(s.startDate)} → ${formatDate(s.endDate)}` : 'Not started'}</span>
                    {s.state === 'active' && daysLeft != null && <span className="chip">{daysLeft >= 0 ? `${daysLeft} days left` : 'Overdue'}</span>}
                    <span className="flex" />
                    {st && st.points > 0 && (
                      <span className="muted small">
                        {st.donePoints}/{st.points} pts
                      </span>
                    )}
                    {st ? <Progress done={st.done} total={st.total} started={st.started} /> : <span className="muted small">No synced issues</span>}
                  </a>
                )
              })}
            </section>
          ) : null,
        )}
        {team?.sprintsEnabled && sprints.length === 0 && <div className="list-empty">No sprints yet</div>}
      </div>
    </div>
  )
}

export function CycleView({ teamKey, sprintId }: { teamKey: string; sprintId: number }) {
  const ctx = useViewCtx()
  const sprint = ctx.sprints[sprintId]
  const team = ctx.teams[teamKey]
  useEffect(() => {
    // Closed sprints usually fall outside the sync window.
    void loadJql(sprintJql(sprintId)).catch(() => undefined)
  }, [sprintId])
  const scope = useCallback((i: Issue) => i.sprintId === sprintId || i.sprintIds.includes(sprintId), [sprintId])
  const header = sprint && (
    <div className="scope-header">
      <CycleIcon state={sprint.state} size={16} />
      <span>{sprint.startDate ? `${formatDate(sprint.startDate)} → ${formatDate(sprint.endDate)}` : 'Not started yet'}</span>
      {sprint.goal && <span className="muted">· {sprint.goal}</span>}
    </div>
  )
  return (
    <IssuesView
      viewKey={`cycle-${teamKey}`}
      title={sprint?.name ?? 'Cycle'}
      icon={<TeamIcon teamKey={teamKey} team={team} size={18} />}
      teamKey={teamKey}
      scope={scope}
      header={header}
      defaults={{ completed: 'all', layout: 'board' }}
      createDefaults={{ teamKey, sprintId: sprint && sprint.state !== 'closed' ? sprintId : undefined }}
      tabs={[
        { id: 'cycles', label: 'All cycles', href: `#/team/${teamKey}/cycles`, active: false },
        { id: 'this', label: sprint?.state === 'active' ? 'Current' : sprint?.state === 'future' ? 'Upcoming' : 'Past', href: location.hash, active: true },
      ]}
      allTeams
    />
  )
}

export function ProjectsView({ teamKey }: { teamKey: string }) {
  const ctx = useViewCtx()
  const team = ctx.teams[teamKey]
  const epics = useMemo(() => {
    const list = Object.values(ctx.issues).filter((i) => i.teamKey === teamKey && (ctx.issueTypes[i.typeId]?.hierarchyLevel ?? 0) >= 1)
    const order = { started: 0, unstarted: 1, backlog: 2, completed: 3, canceled: 4 }
    return list.sort((a, b) => order[statusTypeOf(a, ctx)] - order[statusTypeOf(b, ctx)] || a.title.localeCompare(b.title))
  }, [ctx, teamKey])
  const progress = useMemo(() => {
    const m = new Map<string, { total: number; done: number; started: number }>()
    for (const i of Object.values(ctx.issues)) {
      const e = epicOf(i, ctx)
      if (!e || (ctx.issueTypes[i.typeId]?.hierarchyLevel ?? 0) < 0) continue
      const st = m.get(e.id) ?? { total: 0, done: 0, started: 0 }
      st.total++
      const t = statusTypeOf(i, ctx)
      if (t === 'completed' || t === 'canceled') st.done++
      else if (t === 'started') st.started++
      m.set(e.id, st)
    }
    return m
  }, [ctx])
  const epicType = team?.issueTypes.find((t) => t.hierarchyLevel === 1)
  return (
    <div className="view">
      <header className="view-header">
        <div className="view-title">
          <TeamIcon teamKey={teamKey} team={team} size={18} />
          <h1>{team?.name ?? teamKey}</h1>
          <span className="crumb-sep">›</span>
          <h1 className="muted-title">Projects</h1>
        </div>
        <div className="view-actions">
          {epicType && (
            <button className="btn ghost" onClick={() => openCreate({ teamKey, typeId: epicType.id })}>
              New project
            </button>
          )}
        </div>
      </header>
      <div className="view-body scroll">
        <div className="table-head project-grid">
          <span>Name</span>
          <span>Status</span>
          <span>Lead</span>
          <span>Target</span>
          <span>Progress</span>
        </div>
        {epics.map((e) => {
          const st = progress.get(e.id)
          const status = statusFor(e, ctx)
          return (
            <a key={e.id} className="project-row project-grid" href={`#/project/${e.key}`}>
              <span className="project-name">
                <ProjectIcon id={e.id} done={isClosed(e, ctx)} size={16} />
                <span className="truncate">{e.title}</span>
                <span className="row-key">{e.key}</span>
              </span>
              <span className="project-status">
                <StatusGlyph status={status} team={team} />
                {status?.name}
              </span>
              <span>{e.assigneeId ? <Avatar user={ctx.users[e.assigneeId]} size={18} /> : <span className="muted">—</span>}</span>
              <span className="muted">{e.dueDate ? formatDate(e.dueDate) : '—'}</span>
              <span>{st ? <Progress done={st.done} total={st.total} started={st.started} /> : <span className="muted small">No issues</span>}</span>
            </a>
          )
        })}
        {epics.length === 0 && <div className="list-empty">No epics in this team yet. Gannet shows Jira epics as projects.</div>}
      </div>
    </div>
  )
}

export function ProjectView({ epicKey }: { epicKey: string }) {
  const issues = useData((s) => s.issues)
  const epic = issueByKey(epicKey, issues)
  const detail = useData((s) => (epic ? s.details[epic.id] : undefined))
  const ctx = useViewCtx()
  useEffect(() => {
    void (async () => {
      if (!issueByKey(epicKey)) await fetchIssue(epicKey).catch(() => undefined)
      await Promise.all([loadJql(epicChildrenJql(epicKey)).catch(() => undefined), loadIssueDetail(epicKey).catch(() => undefined)])
    })()
  }, [epicKey])
  const scope = useCallback((i: Issue) => epicOf(i, ctx)?.key === epicKey, [ctx, epicKey])
  const children = useMemo(() => Object.values(ctx.issues).filter(scope), [ctx.issues, scope])
  const done = children.filter((c) => isClosed(c, ctx)).length
  const started = children.filter((c) => statusTypeOf(c, ctx) === 'started').length
  const header = epic && (
    <div className="project-header">
      <div className="project-meta">
        <StatusGlyph status={statusFor(epic, ctx)} team={ctx.teams[epic.teamKey]} />
        <span>{statusFor(epic, ctx)?.name}</span>
        {epic.assigneeId && (
          <>
            <span className="muted">· Lead</span>
            <Avatar user={ctx.users[epic.assigneeId]} size={16} />
            <span>{ctx.users[epic.assigneeId]?.name}</span>
          </>
        )}
        {epic.dueDate && <span className="muted">· Target {formatDate(epic.dueDate)}</span>}
        <span className="flex" />
        <Progress done={done} total={children.length} started={started} />
        <button className="btn ghost small" onClick={() => navigate({ name: 'issue', key: epic.key })}>
          <Layers size={13} /> Details
        </button>
      </div>
      {detail?.description && <AdfView doc={detail.description} className="prose project-desc" />}
    </div>
  )
  return (
    <IssuesView
      viewKey="project"
      title={epic?.title ?? epicKey}
      icon={<ProjectIcon id={epic?.id ?? epicKey} size={18} />}
      teamKey={epic?.teamKey}
      scope={scope}
      header={header}
      allTeams
      defaults={{ completed: 'all' }}
      createDefaults={epic ? { teamKey: epic.teamKey, parentKey: epic.key, parentTitle: epic.title } : {}}
      emptyText="No issues in this project yet"
    />
  )
}
