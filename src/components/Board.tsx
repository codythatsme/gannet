import { memo, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Group, Prop, ViewCtx } from '../domain/view'
import { epicOf, groupDefaults, isClosed, priorityLevel, statusFor } from '../domain/view'
import type { Issue } from '../domain/types'
import { Avatar, CycleIcon, PriorityIcon, ProjectIcon, StatusGlyph, StatusIcon } from './icons'
import { cx } from '../lib/cx'
import { dueState, formatDate } from '../lib/time'
import { setUi, toggleSelected, ui, useUi } from '../store/ui'
import { navigate } from '../app/router'
import { useHotkeys } from '../app/hotkeys'
import { setAssignee, setParent, setPriority, setSprint, setStatus, toggleLabel } from '../store/mutations'
import { data } from '../store/data'
import { labelColor } from './IssueList'
import { toast } from '../store/ui'

const COLUMN_LIMIT = 150

/** Apply a group's defining value to dropped issues (status, assignee, priority...). */
export async function dropIntoGroup(g: Group, ids: string[]) {
  const d = groupDefaults(g)
  if (d.statusId) return setStatus(ids, d.statusId)
  if (d.statusType) {
    for (const id of ids) {
      const i = data().issues[id]
      const s = data().teams[i?.teamKey]?.statuses.find((x) => x.type === d.statusType)
      if (s) await setStatus([id], s.id)
    }
    return
  }
  if ('assigneeId' in d) return setAssignee(ids, d.assigneeId ?? null)
  if (d.priorityId) return setPriority(ids, d.priorityId)
  if ('sprintId' in d) return setSprint(ids, d.sprintId ?? null)
  if ('projectId' in d) {
    if (!d.projectId) return setParent(ids, null)
    const e = data().issues[d.projectId]
    if (e) return setParent(ids, { id: e.id, key: e.key, title: e.title, hierarchyLevel: 1 })
  }
  if (d.label) return toggleLabel(ids, d.label, true)
  toast("Can't move issues into this column")
}

export function Board({
  groups,
  ctx,
  properties,
  teamKey,
  onCreateInGroup,
}: {
  groups: Group[]
  ctx: ViewCtx
  properties: Prop[]
  teamKey?: string
  onCreateInGroup?: (g: Group) => void
}) {
  const [dragOver, setDragOver] = useState<string | null>(null)
  const focusedId = useUi((s) => s.focusedId)
  const selected = useUi((s) => s.selected)

  const columns = useMemo(() => groups.map((g) => g.issues.slice(0, COLUMN_LIMIT).map((i) => i.id)), [groups])
  useEffect(() => setUi({ navList: columns.flat() }), [columns])

  const locate = () => {
    const id = ui().focusedId
    for (let c = 0; c < columns.length; c++) {
      const r = columns[c].indexOf(id ?? '')
      if (r >= 0) return { c, r }
    }
    return null
  }
  const focus = (c: number, r: number) => {
    const col = columns[c]
    if (!col?.length) return
    const id = col[Math.max(0, Math.min(col.length - 1, r))]
    setUi({ focusedId: id })
    document.querySelector(`[data-card="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const moveCol = (d: number) => {
    const at = locate()
    let c = at ? at.c + d : 0
    while (c >= 0 && c < columns.length && !columns[c].length) c += d
    if (c >= 0 && c < columns.length) focus(c, at?.r ?? 0)
  }
  useHotkeys({
    j: () => {
      const at = locate()
      at ? focus(at.c, at.r + 1) : moveCol(1)
    },
    arrowdown: () => {
      const at = locate()
      at ? focus(at.c, at.r + 1) : moveCol(1)
    },
    k: () => {
      const at = locate()
      if (at) focus(at.c, at.r - 1)
    },
    arrowup: () => {
      const at = locate()
      if (at) focus(at.c, at.r - 1)
    },
    arrowleft: () => moveCol(-1),
    arrowright: () => moveCol(1),
    x: () => {
      const id = ui().focusedId
      if (id) toggleSelected(id)
    },
    enter: () => {
      const id = ui().focusedId
      if (id) navigate({ name: 'issue', key: ctx.issues[id]?.key })
    },
    escape: () => {
      if (ui().selected.size) setUi({ selected: new Set() })
      else return false
    },
  })

  return (
    <div className="board">
      {groups.map((g) => {
        const m = g.meta
        let icon: React.ReactNode = null
        if (m.statusId) icon = <StatusGlyph status={ctx.statuses[m.statusId]} team={teamKey ? ctx.teams[teamKey] : undefined} />
        else if (m.statusType) icon = <StatusIcon type={m.statusType} />
        else if (m.userId) icon = <Avatar user={ctx.users[m.userId]} size={16} />
        else if (m.priorityId) icon = <PriorityIcon level={m.priorityLevel ?? 0} />
        else if (m.projectId) icon = <ProjectIcon id={m.projectId} />
        else if ('sprintId' in m) icon = <CycleIcon state={m.sprintId != null ? ctx.sprints[m.sprintId]?.state : undefined} />
        return (
          <div
            key={g.id}
            className={cx('board-col', dragOver === g.id && 'drag-over')}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('text/gannet-issue')) {
                e.preventDefault()
                setDragOver(g.id)
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(null)
              const id = e.dataTransfer.getData('text/gannet-issue')
              if (!id) return
              const ids = ui().selected.has(id) ? [...ui().selected] : [id]
              if (ids.every((x) => g.issues.some((i) => i.id === x))) return
              void dropIntoGroup(g, ids)
            }}
          >
            <div className="board-col-header">
              {icon}
              <span className="group-label">{g.label}</span>
              <span className="group-count">{g.issues.length}</span>
              <span className="flex" />
              {onCreateInGroup && (
                <button className="icon-btn" title="Create issue" onClick={() => onCreateInGroup(g)}>
                  <Plus size={14} />
                </button>
              )}
            </div>
            <div className="board-col-body">
              {g.issues.slice(0, COLUMN_LIMIT).map((issue) => (
                <Card key={issue.id} issue={issue} ctx={ctx} properties={properties} focused={focusedId === issue.id} selected={selected.has(issue.id)} />
              ))}
              {g.issues.length > COLUMN_LIMIT && <div className="board-more">+{g.issues.length - COLUMN_LIMIT} more — switch to list view or filter</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const Card = memo(function Card({ issue, ctx, properties, focused, selected }: { issue: Issue; ctx: ViewCtx; properties: Prop[]; focused: boolean; selected: boolean }) {
  const show = (p: Prop) => properties.includes(p)
  const status = statusFor(issue, ctx)
  const epic = show('project') ? epicOf(issue, ctx) : undefined
  const closed = isClosed(issue, ctx)
  const due = dueState(issue.dueDate, closed)
  return (
    <div
      data-card={issue.id}
      className={cx('card', focused && 'focused', selected && 'selected')}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/gannet-issue', issue.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onMouseEnter={() => setUi({ focusedId: issue.id })}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return toggleSelected(issue.id)
        navigate({ name: 'issue', key: issue.key })
      }}
    >
      <div className="card-top">
        <span className="row-key">{issue.key}</span>
        <span className="flex" />
        {show('assignee') && issue.assigneeId && <Avatar user={ctx.users[issue.assigneeId]} size={18} />}
      </div>
      <div className="card-title">
        <StatusGlyph status={status} team={ctx.teams[issue.teamKey]} />
        <span>{issue.title}</span>
      </div>
      <div className="card-props">
        {show('priority') && <PriorityIcon level={priorityLevel(issue, ctx)} />}
        {epic && (
          <span className="chip project-chip">
            <ProjectIcon id={epic.id} size={12} />
            <span className="chip-text">{epic.title}</span>
          </span>
        )}
        {show('labels') &&
          issue.labels.slice(0, 2).map((l) => (
            <span key={l} className="chip label-chip">
              <span className="label-dot" style={{ background: labelColor(l) }} />
              {l}
            </span>
          ))}
        {show('dueDate') && issue.dueDate && <span className={cx('chip due-chip', due)}>{formatDate(issue.dueDate)}</span>}
        {show('estimate') && issue.estimate != null && <span className="chip estimate-chip">{issue.estimate}</span>}
      </div>
    </div>
  )
})
