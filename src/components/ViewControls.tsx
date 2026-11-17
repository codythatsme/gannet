import { useMemo, useRef, useState } from 'react'
import { Columns3, LayoutList, X } from 'lucide-react'
import { Menu, type MenuItem } from './Menu'
import { Popover, rectOf, type Rect } from './Popover'
import { Avatar, CycleIcon, PriorityIcon, ProjectIcon, StatusGlyph, StatusIcon, TeamIcon } from './icons'
import type { DisplayOptions, Filter, FilterField, GroupBy, OrderBy, Prop, ViewCtx } from '../domain/view'
import { NONE, epicOf, statusTypeOf } from '../domain/view'
import { STATUS_TYPES, STATUS_TYPE_LABEL, type Issue } from '../domain/types'
import { cx } from '../lib/cx'
import { labelColor } from './IssueList'

const FIELD_LABEL: Record<FilterField, string> = {
  status: 'Status',
  statusType: 'Status',
  assignee: 'Assignee',
  creator: 'Creator',
  priority: 'Priority',
  label: 'Labels',
  project: 'Project',
  cycle: 'Cycle',
  type: 'Issue type',
  team: 'Team',
}

function valueItems(field: FilterField, base: Issue[], ctx: ViewCtx, teamKey?: string): MenuItem[] {
  const count = new Map<string, number>()
  const bump = (k: string) => count.set(k, (count.get(k) ?? 0) + 1)
  const hint = (k: string) => String(count.get(k) ?? 0)
  switch (field) {
    case 'status': {
      for (const i of base) bump(i.statusId)
      const team = teamKey ? ctx.teams[teamKey] : undefined
      return (team?.statuses ?? []).map((s) => ({ id: s.id, label: s.name, icon: <StatusGlyph status={s} team={team} />, hint: hint(s.id) }))
    }
    case 'statusType':
      for (const i of base) bump(statusTypeOf(i, ctx))
      return STATUS_TYPES.map((t) => ({ id: t, label: STATUS_TYPE_LABEL[t], icon: <StatusIcon type={t} />, hint: hint(t) }))
    case 'assignee':
    case 'creator': {
      const get = (i: Issue) => (field === 'assignee' ? i.assigneeId : (i.reporterId ?? i.creatorId)) ?? NONE
      for (const i of base) bump(get(i))
      const ids = [...count.keys()].filter((k) => k !== NONE && k !== ctx.meId)
      ids.sort((a, b) => (ctx.users[a]?.name ?? '').localeCompare(ctx.users[b]?.name ?? ''))
      return [
        ...(ctx.meId ? [{ id: 'me', label: 'Current user', icon: <Avatar user={ctx.users[ctx.meId]} size={16} />, hint: hint(ctx.meId) }] : []),
        ...(field === 'assignee' ? [{ id: NONE, label: 'No assignee', icon: <Avatar user={null} size={16} />, hint: hint(NONE) }] : []),
        ...ids.map((id) => ({ id, label: ctx.users[id]?.name ?? 'Unknown', icon: <Avatar user={ctx.users[id]} size={16} />, hint: hint(id) })),
      ]
    }
    case 'priority':
      for (const i of base) bump(i.priorityId ?? NONE)
      return [
        ...[...ctx.priorities]
          .sort((a, b) => (a.level || 5) - (b.level || 5) || a.order - b.order)
          .map((p) => ({ id: p.id, label: p.name, icon: <PriorityIcon level={p.level} />, hint: hint(p.id) })),
        { id: NONE, label: 'No priority', icon: <PriorityIcon level={0} />, hint: hint(NONE) },
      ]
    case 'label':
      for (const i of base) (i.labels.length ? i.labels : [NONE]).forEach(bump)
      return [
        ...[...count.keys()].filter((k) => k !== NONE).sort().map((l) => ({ id: l, label: l, icon: <span className="label-dot" style={{ background: labelColor(l) }} />, hint: hint(l) })),
        { id: NONE, label: 'No labels', hint: hint(NONE) },
      ]
    case 'project': {
      const titles = new Map<string, string>()
      for (const i of base) {
        const e = epicOf(i, ctx)
        bump(e?.id ?? NONE)
        if (e) titles.set(e.id, e.title)
      }
      return [
        ...[...titles].sort((a, b) => a[1].localeCompare(b[1])).map(([id, t]) => ({ id, label: t, icon: <ProjectIcon id={id} />, hint: hint(id) })),
        { id: NONE, label: 'No project', hint: hint(NONE) },
      ]
    }
    case 'cycle':
      for (const i of base) bump(i.sprintId != null ? String(i.sprintId) : NONE)
      return [
        ...[...count.keys()]
          .filter((k) => k !== NONE)
          .map((k) => ctx.sprints[Number(k)])
          .filter(Boolean)
          .map((s) => ({ id: String(s.id), label: s.name, icon: <CycleIcon state={s.state} />, hint: hint(String(s.id)) })),
        { id: NONE, label: 'No cycle', hint: hint(NONE) },
      ]
    case 'type':
      for (const i of base) bump(i.typeId)
      return [...count.keys()].map((id) => ({ id, label: ctx.issueTypes[id]?.name ?? id, icon: ctx.issueTypes[id]?.iconUrl ? <img src={ctx.issueTypes[id].iconUrl} width={14} height={14} alt="" /> : undefined, hint: hint(id) }))
    case 'team':
      for (const i of base) bump(i.teamKey)
      return [...count.keys()].map((k) => ({ id: k, label: ctx.teams[k]?.name ?? k, icon: <TeamIcon teamKey={k} team={ctx.teams[k]} size={16} />, hint: hint(k) }))
  }
}

export function FilterMenu({
  anchor,
  onClose,
  base,
  ctx,
  teamKey,
  filters,
  setFilters,
  initialField,
}: {
  anchor: Rect
  onClose: () => void
  base: Issue[]
  ctx: ViewCtx
  teamKey?: string
  filters: Filter[]
  setFilters: (f: Filter[]) => void
  initialField?: FilterField
}) {
  const [field, setField] = useState<FilterField | null>(initialField ?? null)
  const fields: FilterField[] = [teamKey ? 'status' : 'statusType', 'assignee', 'priority', 'label', 'project', 'cycle', 'creator', 'type', ...(teamKey ? [] : (['team'] as FilterField[]))]
  if (!field) {
    return (
      <Popover anchor={anchor} onClose={onClose} width={220}>
        <Menu
          placeholder="Filter…"
          items={fields.map((f) => ({ id: f, label: FIELD_LABEL[f] }))}
          onSelect={(it) => setField(it.id as FilterField)}
          onClose={onClose}
        />
      </Popover>
    )
  }
  const existing = filters.find((f) => f.field === field)
  const selected = new Set(existing?.values ?? [])
  const items = valueItems(field, base, ctx, teamKey).map((it) => ({ ...it, selected: selected.has(it.id) }))
  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <Menu
        multi
        placeholder={`${FIELD_LABEL[field]}…`}
        items={items}
        onClose={onClose}
        onSelect={(it) => {
          const vals = new Set(selected)
          if (vals.has(it.id)) vals.delete(it.id)
          else vals.add(it.id)
          const rest = filters.filter((f) => f.field !== field)
          setFilters(vals.size ? [...rest, { field, op: existing?.op ?? 'is', values: [...vals] }] : rest)
        }}
      />
    </Popover>
  )
}

export function FilterChips({ filters, setFilters, ctx, teamKey, onEdit }: { filters: Filter[]; setFilters: (f: Filter[]) => void; ctx: ViewCtx; teamKey?: string; onEdit: (field: FilterField, el: Element) => void }) {
  const label = (f: Filter, v: string) => {
    if (v === NONE) return 'None'
    if (v === 'me') return 'Me'
    switch (f.field) {
      case 'status':
        return ctx.teams[teamKey ?? '']?.statuses.find((s) => s.id === v)?.name ?? ctx.statuses[v]?.name ?? v
      case 'statusType':
        return STATUS_TYPE_LABEL[v as keyof typeof STATUS_TYPE_LABEL] ?? v
      case 'assignee':
      case 'creator':
        return ctx.users[v]?.name ?? v
      case 'priority':
        return ctx.priorities.find((p) => p.id === v)?.name ?? v
      case 'project':
        return ctx.issues[v]?.title ?? v
      case 'cycle':
        return ctx.sprints[Number(v)]?.name ?? v
      case 'type':
        return ctx.issueTypes[v]?.name ?? v
      case 'team':
        return ctx.teams[v]?.name ?? v
      default:
        return v
    }
  }
  if (!filters.length) return null
  return (
    <div className="filter-bar">
      {filters.map((f) => (
        <span key={f.field} className="filter-chip">
          <span className="filter-field">{FIELD_LABEL[f.field]}</span>
          <button
            className="filter-op"
            title="Toggle is / is not"
            onClick={() => setFilters(filters.map((x) => (x === f ? { ...x, op: x.op === 'is' ? 'isNot' : 'is' } : x)))}
          >
            {f.op === 'is' ? (f.values.length > 1 ? 'is any of' : 'is') : f.values.length > 1 ? 'is none of' : 'is not'}
          </button>
          <button className="filter-values" onClick={(e) => onEdit(f.field, e.currentTarget)}>
            {f.values.length > 2 ? `${f.values.length} values` : f.values.map((v) => label(f, v)).join(', ')}
          </button>
          <button className="filter-remove" title="Remove filter" onClick={() => setFilters(filters.filter((x) => x !== f))}>
            <X size={12} />
          </button>
        </span>
      ))}
      <button className="link-btn" onClick={() => setFilters([])}>
        Clear
      </button>
    </div>
  )
}

const GROUP_LABEL: Record<GroupBy, string> = { status: 'Status', assignee: 'Assignee', priority: 'Priority', project: 'Project', cycle: 'Cycle', label: 'Label', none: 'No grouping' }
const ORDER_LABEL: Record<OrderBy, string> = { manual: 'Manual (Jira rank)', priority: 'Priority', updated: 'Last updated', created: 'Last created', title: 'Title', dueDate: 'Due date', estimate: 'Estimate' }
const PROP_LABEL: Record<Prop, string> = { priority: 'Priority', key: 'ID', status: 'Status', labels: 'Labels', project: 'Project', cycle: 'Cycle', estimate: 'Estimate', dueDate: 'Due date', assignee: 'Assignee', updated: 'Updated', created: 'Created', type: 'Type' }
const PROPS: Prop[] = ['priority', 'key', 'status', 'labels', 'project', 'cycle', 'estimate', 'dueDate', 'created', 'updated', 'assignee']

export function DisplayMenu({ anchor, onClose, display, setDisplay, allowCycle }: { anchor: Rect; onClose: () => void; display: DisplayOptions; setDisplay: (d: DisplayOptions) => void; allowCycle: boolean }) {
  const set = <K extends keyof DisplayOptions>(k: K, v: DisplayOptions[K]) => setDisplay({ ...display, [k]: v })
  const groups = (Object.keys(GROUP_LABEL) as GroupBy[]).filter((g) => allowCycle || g !== 'cycle')
  return (
    <Popover anchor={anchor} onClose={onClose} width={320} align="end">
      <div className="display-menu">
        <div className="segmented">
          <button className={cx(display.layout === 'list' && 'on')} onClick={() => set('layout', 'list')}>
            <LayoutList size={14} /> List
          </button>
          <button className={cx(display.layout === 'board' && 'on')} onClick={() => set('layout', 'board')}>
            <Columns3 size={14} /> Board
          </button>
        </div>
        <label className="display-row">
          <span>{display.layout === 'board' ? 'Columns' : 'Grouping'}</span>
          <select value={display.groupBy} onChange={(e) => set('groupBy', e.target.value as GroupBy)}>
            {groups.map((g) => (
              <option key={g} value={g}>
                {GROUP_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="display-row">
          <span>Ordering</span>
          <select value={display.orderBy} onChange={(e) => set('orderBy', e.target.value as OrderBy)}>
            {(Object.keys(ORDER_LABEL) as OrderBy[]).map((o) => (
              <option key={o} value={o}>
                {ORDER_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        <label className="display-row">
          <span>Completed issues</span>
          <select value={display.completed} onChange={(e) => set('completed', e.target.value as DisplayOptions['completed'])}>
            <option value="all">All</option>
            <option value="month">Past month</option>
            <option value="week">Past week</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="display-row">
          <span>Show sub-issues</span>
          <input type="checkbox" className="switch" checked={display.showSubIssues} onChange={(e) => set('showSubIssues', e.target.checked)} />
        </label>
        <label className="display-row">
          <span>Show empty groups</span>
          <input type="checkbox" className="switch" checked={display.showEmptyGroups} onChange={(e) => set('showEmptyGroups', e.target.checked)} />
        </label>
        <div className="display-section">Display properties</div>
        <div className="prop-toggles">
          {PROPS.map((p) => (
            <button
              key={p}
              className={cx('prop-toggle', display.properties.includes(p) && 'on')}
              onClick={() => set('properties', display.properties.includes(p) ? display.properties.filter((x) => x !== p) : [...display.properties, p])}
            >
              {PROP_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
    </Popover>
  )
}

/** Header buttons: filter + display. Exposes refs so hotkeys can open them. */
export function useViewMenus() {
  const filterBtn = useRef<HTMLButtonElement>(null)
  const displayBtn = useRef<HTMLButtonElement>(null)
  const [filterAt, setFilterAt] = useState<{ anchor: Rect; field?: FilterField } | null>(null)
  const [displayAt, setDisplayAt] = useState<Rect | null>(null)
  return useMemo(
    () => ({
      filterBtn,
      displayBtn,
      filterAt,
      displayAt,
      openFilter: (field?: FilterField, el?: Element | null) => {
        const r = rectOf(el ?? filterBtn.current)
        if (r) setFilterAt({ anchor: r, field })
      },
      openDisplay: () => {
        const r = rectOf(displayBtn.current)
        if (r) setDisplayAt(r)
      },
      closeFilter: () => setFilterAt(null),
      closeDisplay: () => setDisplayAt(null),
    }),
    [filterAt, displayAt],
  )
}

