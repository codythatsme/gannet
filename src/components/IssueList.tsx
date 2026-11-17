import { memo, useCallback, useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { ChevronRight, Plus } from 'lucide-react'
import type { Group, Prop, ViewCtx } from '../domain/view'
import { epicOf, isClosed, priorityLevel, statusFor } from '../domain/view'
import type { Issue } from '../domain/types'
import { Avatar, CycleIcon, PriorityIcon, ProjectIcon, StatusGlyph, StatusIcon } from './icons'
import { cx } from '../lib/cx'
import { dueState, formatDate, shortAge } from '../lib/time'
import { openPicker, setUi, toggleSelected, ui, useUi } from '../store/ui'
import { navigate } from '../app/router'
import { useHotkeys } from '../app/hotkeys'
import type { PickerKind } from '../store/ui'

type Row = { kind: 'group'; group: Group; collapsed: boolean } | { kind: 'issue'; issue: Issue; depth: number }

const ROW_H = 38
const GROUP_H = 38

/**
 * Grouped, virtualized issue list. Keyboard: j/k or arrows move focus, x selects,
 * Enter opens; property shortcuts act on the focused or selected issues.
 */
export function IssueList({
  groups,
  ctx,
  properties,
  collapsed,
  onToggleGroup,
  onCreateInGroup,
  teamKey,
  emptyText,
}: {
  groups: Group[]
  ctx: ViewCtx
  properties: Prop[]
  collapsed: Set<string>
  onToggleGroup: (id: string) => void
  onCreateInGroup?: (g: Group) => void
  teamKey?: string
  emptyText?: string
}) {
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const single = groups.length === 1 && groups[0].id === 'all'
    for (const g of groups) {
      const c = collapsed.has(g.id)
      if (!single) out.push({ kind: 'group', group: g, collapsed: c })
      if (!c) for (const issue of g.issues) out.push({ kind: 'issue', issue, depth: 0 })
    }
    return out
  }, [groups, collapsed])

  const issueRows = useMemo(() => rows.flatMap((r, i) => (r.kind === 'issue' ? [{ id: r.issue.id, index: i }] : [])), [rows])

  // Publish the visible order for j/k, detail prev/next and select-all.
  useEffect(() => {
    setUi({ navList: issueRows.map((r) => r.id) })
    const f = ui().focusedId
    if (f && !issueRows.some((r) => r.id === f)) setUi({ focusedId: null })
  }, [issueRows])

  const parentRef = useRef<HTMLDivElement>(null)
  const stickyIndexes = useMemo(() => rows.flatMap((r, i) => (r.kind === 'group' ? [i] : [])), [rows])
  const activeSticky = useRef(0)
  const rangeExtractor = useCallback(
    (range: Range) => {
      activeSticky.current = [...stickyIndexes].reverse().find((i) => range.startIndex >= i) ?? -1
      const next = new Set([...(activeSticky.current >= 0 ? [activeSticky.current] : []), ...defaultRangeExtractor(range)])
      return [...next].sort((a, b) => a - b)
    },
    [stickyIndexes],
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i].kind === 'group' ? GROUP_H : ROW_H),
    overscan: 12,
    rangeExtractor,
  })

  const focusedId = useUi((s) => s.focusedId)
  const selected = useUi((s) => s.selected)

  const focusIndex = (idx: number) => {
    const r = issueRows[Math.max(0, Math.min(issueRows.length - 1, idx))]
    if (!r) return
    setUi({ focusedId: r.id })
    virtualizer.scrollToIndex(r.index, { align: 'auto' })
  }
  const current = () => issueRows.findIndex((r) => r.id === ui().focusedId)
  const move = (d: number, extend = false) => {
    const cur = current()
    const next = cur < 0 ? (d > 0 ? 0 : issueRows.length - 1) : cur + d
    if (extend && cur >= 0) {
      const sel = new Set(ui().selected)
      sel.add(issueRows[cur].id)
      const n = issueRows[Math.max(0, Math.min(issueRows.length - 1, next))]
      if (n) sel.add(n.id)
      setUi({ selected: sel })
    }
    focusIndex(next)
  }

  useHotkeys({
    j: () => move(1),
    arrowdown: () => move(1),
    k: () => move(-1),
    arrowup: () => move(-1),
    'shift+j': () => move(1, true),
    'shift+arrowdown': () => move(1, true),
    'shift+k': () => move(-1, true),
    'shift+arrowup': () => move(-1, true),
    x: () => {
      const id = ui().focusedId
      if (id) toggleSelected(id)
    },
    'mod+a': () => setUi({ selected: new Set(issueRows.map((r) => r.id)) }),
    enter: () => {
      const id = ui().focusedId
      if (id) navigate({ name: 'issue', key: ctx.issues[id]?.key })
    },
    o: () => {
      const id = ui().focusedId
      if (id) navigate({ name: 'issue', key: ctx.issues[id]?.key })
    },
    escape: () => {
      if (ui().selected.size) setUi({ selected: new Set() })
      else if (ui().focusedId) setUi({ focusedId: null })
      else return false
    },
  })

  const lastClicked = useRef<string | null>(null)
  const onRowClick = useCallback(
    (e: MouseEvent, issue: Issue) => {
      if (e.shiftKey && lastClicked.current) {
        const a = issueRows.findIndex((r) => r.id === lastClicked.current)
        const b = issueRows.findIndex((r) => r.id === issue.id)
        const sel = new Set(ui().selected)
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(issueRows[i].id)
        setUi({ selected: sel, focusedId: issue.id })
        return
      }
      if (e.metaKey || e.ctrlKey) {
        toggleSelected(issue.id)
        lastClicked.current = issue.id
        return
      }
      lastClicked.current = issue.id
      setUi({ focusedId: issue.id })
      navigate({ name: 'issue', key: issue.key })
    },
    [issueRows],
  )

  if (!rows.length) {
    return <div className="list-empty">{emptyText ?? 'No issues'}</div>
  }

  return (
    <div className="issue-list" ref={parentRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index]
          const isSticky = activeSticky.current === v.index
          const style = isSticky
            ? ({ position: 'sticky', top: 0, zIndex: 2, height: v.size } as const)
            : ({ position: 'absolute', top: 0, left: 0, right: 0, height: v.size, transform: `translateY(${v.start}px)` } as const)
          if (row.kind === 'group') {
            return (
              <GroupHeader
                key={`g:${row.group.id}`}
                group={row.group}
                collapsed={row.collapsed}
                style={style}
                ctx={ctx}
                teamKey={teamKey}
                onToggle={() => onToggleGroup(row.group.id)}
                onCreate={onCreateInGroup ? () => onCreateInGroup(row.group) : undefined}
              />
            )
          }
          return (
            <IssueRow
              key={row.issue.id}
              issue={row.issue}
              ctx={ctx}
              properties={properties}
              focused={focusedId === row.issue.id}
              selected={selected.has(row.issue.id)}
              anySelected={selected.size > 0}
              style={style}
              onClick={onRowClick}
            />
          )
        })}
      </div>
    </div>
  )
}

function GroupHeader({
  group,
  collapsed,
  style,
  ctx,
  teamKey,
  onToggle,
  onCreate,
}: {
  group: Group
  collapsed: boolean
  style: React.CSSProperties
  ctx: ViewCtx
  teamKey?: string
  onToggle: () => void
  onCreate?: () => void
}) {
  const m = group.meta
  let icon: React.ReactNode = null
  if (m.statusId) icon = <StatusGlyph status={ctx.statuses[m.statusId] ?? ctx.teams[teamKey ?? '']?.statuses.find((s) => s.id === m.statusId)} team={teamKey ? ctx.teams[teamKey] : undefined} />
  else if (m.statusType) icon = <StatusIcon type={m.statusType} />
  else if (m.userId) icon = <Avatar user={ctx.users[m.userId]} size={16} />
  else if (m.priorityId) icon = <PriorityIcon level={m.priorityLevel ?? 0} />
  else if (m.projectId) icon = <ProjectIcon id={m.projectId} />
  else if ('sprintId' in m) icon = <CycleIcon state={m.sprintId != null ? ctx.sprints[m.sprintId]?.state : undefined} />
  const points = group.issues.reduce((n, i) => n + (i.estimate ?? 0), 0)
  return (
    <div className="group-header" style={style} onClick={onToggle}>
      <ChevronRight size={12} className={cx('group-chevron', !collapsed && 'open')} />
      {icon}
      <span className="group-label">{group.label}</span>
      <span className="group-count">{group.issues.length}</span>
      {points > 0 && <span className="group-points">{points} pts</span>}
      <span className="flex" />
      {onCreate && (
        <button
          className="icon-btn group-add"
          title="Create issue in this group"
          onClick={(e) => {
            e.stopPropagation()
            onCreate()
          }}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  )
}

const IssueRow = memo(function IssueRow({
  issue,
  ctx,
  properties,
  focused,
  selected,
  anySelected,
  style,
  onClick,
}: {
  issue: Issue
  ctx: ViewCtx
  properties: Prop[]
  focused: boolean
  selected: boolean
  anySelected: boolean
  style: React.CSSProperties
  onClick: (e: MouseEvent, issue: Issue) => void
}) {
  const show = (p: Prop) => properties.includes(p)
  const status = statusFor(issue, ctx)
  const team = ctx.teams[issue.teamKey]
  const epic = show('project') ? epicOf(issue, ctx) : undefined
  const sprint = show('cycle') && issue.sprintId != null ? ctx.sprints[issue.sprintId] : undefined
  const closed = isClosed(issue, ctx)
  const due = dueState(issue.dueDate, closed)
  const pick = (kind: PickerKind) => (e: MouseEvent) => {
    e.stopPropagation()
    const ids = ui().selected.has(issue.id) ? [...ui().selected] : [issue.id]
    openPicker(kind, ids, e.currentTarget)
  }
  const parentSub = issue.parent && issue.parent.hierarchyLevel < 1 ? issue.parent : undefined
  return (
    <div
      className={cx('issue-row', focused && 'focused', selected && 'selected', closed && 'closed')}
      style={style}
      onClick={(e) => onClick(e, issue)}
      onMouseEnter={() => ui().focusedId !== issue.id && !anySelected && setUi({ focusedId: issue.id })}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/gannet-issue', issue.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <span
        className={cx('row-check', (selected || anySelected) && 'visible')}
        onClick={(e) => {
          e.stopPropagation()
          toggleSelected(issue.id)
        }}
      >
        <input type="checkbox" checked={selected} readOnly tabIndex={-1} />
      </span>
      {show('priority') && (
        <button className="row-btn" onClick={pick('priority')} title="Priority">
          <PriorityIcon level={priorityLevel(issue, ctx)} />
        </button>
      )}
      {show('key') && <span className="row-key">{issue.key}</span>}
      {show('status') && (
        <button className="row-btn" onClick={pick('status')} title={status?.name}>
          <StatusGlyph status={status} team={team} />
        </button>
      )}
      <span className="row-title">
        {parentSub && <span className="row-parent">{parentSub.key} ›</span>}
        {issue.title}
      </span>
      <span className="row-props">
        {show('labels') &&
          issue.labels.slice(0, 3).map((l) => (
            <span key={l} className="chip label-chip" onClick={pick('labels')}>
              <span className="label-dot" style={{ background: labelColor(l) }} />
              {l}
            </span>
          ))}
        {show('labels') && issue.labels.length > 3 && <span className="chip">+{issue.labels.length - 3}</span>}
        {epic && (
          <span className="chip project-chip" onClick={pick('project')} title={epic.title}>
            <ProjectIcon id={epic.id} size={12} />
            <span className="chip-text">{epic.title}</span>
          </span>
        )}
        {sprint && (
          <span className="chip" onClick={pick('sprint')}>
            <CycleIcon state={sprint.state} size={12} />
            {sprint.name.replace(/^.*?(\d+)$/, 'Cycle $1')}
          </span>
        )}
        {show('dueDate') && issue.dueDate && (
          <span className={cx('chip due-chip', due)} onClick={pick('dueDate')}>
            {formatDate(issue.dueDate)}
          </span>
        )}
        {show('estimate') && issue.estimate != null && (
          <span className="chip estimate-chip" onClick={pick('estimate')} title="Estimate">
            {issue.estimate}
          </span>
        )}
        {show('created') && <span className="row-date" title="Created">{formatDate(issue.createdAt)}</span>}
        {show('updated') && <span className="row-date" title={`Updated ${new Date(issue.updatedAt).toLocaleString()}`}>{shortAge(issue.updatedAt)}</span>}
        {show('assignee') && (
          <button className="row-btn" onClick={pick('assignee')} title={issue.assigneeId ? ctx.users[issue.assigneeId]?.name : 'Unassigned'}>
            <Avatar user={issue.assigneeId ? (ctx.users[issue.assigneeId] ?? { id: issue.assigneeId, name: '?', active: true }) : null} size={18} />
          </button>
        )}
      </span>
    </div>
  )
})

const LABEL_COLORS = ['#eb5757', '#f2994a', '#f2c94c', '#4cb782', '#4ea7fc', '#5e6ad2', '#bb87fc', '#95a2b3', '#26b5ce', '#e26b9e']
export function labelColor(label: string) {
  let h = 0
  for (const c of label) h = (h * 33 + c.charCodeAt(0)) >>> 0
  return /bug/i.test(label) ? '#eb5757' : LABEL_COLORS[h % LABEL_COLORS.length]
}
