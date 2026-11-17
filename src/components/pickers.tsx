import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Plus, Tag } from 'lucide-react'
import { Menu, type MenuItem } from './Menu'
import { Avatar, CycleIcon, PriorityIcon, ProjectIcon, StatusGlyph, StatusIcon } from './icons'
import { Modal, Popover } from './Popover'
import { useData, data } from '../store/data'
import { setUi, useUi, type PickerKind } from '../store/ui'
import { searchUsers, sprintsForTeam } from '../store/sync'
import {
  reachableStatuses,
  setAssignee,
  setDueDate,
  setEstimate,
  setParent,
  setPriority,
  setSprint,
  setStatus,
  toggleLabel,
} from '../store/mutations'
import { NONE, epicOf, hierarchyOf, isClosed } from '../domain/view'
import { STATUS_TYPES, STATUS_TYPE_LABEL, type Issue } from '../domain/types'
import { useDebounced, useViewCtx } from '../lib/hooks'
import { formatDate, toIsoDate } from '../lib/time'

export const PICKER_TITLES: Record<PickerKind, string> = {
  status: 'Change status…',
  priority: 'Change priority…',
  assignee: 'Assign to…',
  labels: 'Change labels…',
  sprint: 'Move to cycle…',
  project: 'Set project…',
  estimate: 'Set estimate…',
  dueDate: 'Set due date…',
  parent: 'Set parent…',
}

const ESTIMATES = [0, 1, 2, 3, 5, 8, 13, 21]

/**
 * A picker for one property, independent of what it edits. `current` holds the selected
 * value(s); `onPick` receives the chosen value (NONE for "no value").
 */
export function PropertyMenu({
  kind,
  teamKeys,
  current,
  onPick,
  onClose,
  issueKey,
}: {
  kind: PickerKind
  teamKeys: string[]
  current: string[]
  onPick: (value: string) => void
  onClose: () => void
  /** For status: check reachable transitions for this issue. */
  issueKey?: string
}) {
  const ctx = useViewCtx()
  const assignable = useData((s) => s.assignable)
  const knownLabels = useData((s) => s.labels)
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query, 250)
  const [remoteUsers, setRemoteUsers] = useState<string[]>([])
  const [reachable, setReachable] = useState<Set<string> | null>(null)
  const singleTeam = teamKeys.length === 1 ? ctx.teams[teamKeys[0]] : undefined

  useEffect(() => {
    if (kind !== 'status' || !issueKey) return
    let alive = true
    reachableStatuses(issueKey)
      .then((r) => alive && setReachable(r))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [kind, issueKey])

  useEffect(() => {
    if (kind !== 'assignee' || !debounced.trim() || !teamKeys[0]) return
    let alive = true
    searchUsers(teamKeys[0], debounced)
      .then((us) => alive && setRemoteUsers(us.map((u) => u.id)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [kind, debounced, teamKeys])

  const has = (v: string) => current.includes(v)

  const items: MenuItem[] = useMemo(() => {
    switch (kind) {
      case 'status': {
        if (singleTeam) {
          return singleTeam.statuses.map((s) => {
            const blocked = reachable && !reachable.has(s.id) && !has(s.id)
            return {
              id: s.id,
              label: s.name,
              icon: <StatusGlyph status={s} team={singleTeam} />,
              selected: has(s.id),
              disabled: !!blocked,
              hint: blocked ? 'No transition' : undefined,
              keywords: STATUS_TYPE_LABEL[s.type],
            }
          })
        }
        // Several teams: pick a status type; each issue gets its team's first status of that type.
        return STATUS_TYPES.map((t) => ({ id: `type:${t}`, label: STATUS_TYPE_LABEL[t], icon: <StatusIcon type={t} />, selected: has(`type:${t}`) }))
      }
      case 'priority': {
        const list = [...ctx.priorities].sort((a, b) => (a.level || 5) - (b.level || 5) || a.order - b.order)
        return list.map((p) => ({ id: p.id, label: p.name, icon: <PriorityIcon level={p.level} />, selected: has(p.id) }))
      }
      case 'assignee': {
        const ids = new Set<string>()
        if (ctx.meId) ids.add(ctx.meId)
        for (const k of teamKeys) for (const id of assignable[k] ?? []) ids.add(id)
        for (const id of remoteUsers) ids.add(id)
        for (const id of current) if (id !== NONE) ids.add(id)
        const users = [...ids].map((id) => ctx.users[id]).filter(Boolean)
        users.sort((a, b) => (a.id === ctx.meId ? -1 : b.id === ctx.meId ? 1 : a.name.localeCompare(b.name)))
        return [
          { id: NONE, label: 'No assignee', icon: <Avatar user={null} size={16} />, selected: has(NONE) },
          ...users.map((u) => ({
            id: u.id,
            label: u.id === ctx.meId ? `${u.name} (you)` : u.name,
            icon: <Avatar user={u} size={16} />,
            keywords: u.email,
            selected: has(u.id),
            hint: u.id === ctx.meId ? 'I' : undefined,
          })),
        ]
      }
      case 'labels': {
        const all = new Set<string>(knownLabels)
        for (const i of Object.values(ctx.issues)) for (const l of i.labels) all.add(l)
        for (const l of current) all.add(l)
        const sorted = [...all].sort((a, b) => (has(b) ? 1 : 0) - (has(a) ? 1 : 0) || a.localeCompare(b))
        const items: MenuItem[] = sorted.map((l) => ({ id: l, label: l, icon: <Tag size={13} />, selected: has(l) }))
        const typed = query.trim().replace(/\s+/g, '-')
        if (typed && !all.has(typed)) items.push({ id: typed, label: `Create label "${typed}"`, icon: <Plus size={13} />, sticky: true })
        return items
      }
      case 'sprint': {
        const sprints = teamKeys.flatMap((k) => sprintsForTeam(k, ctx.sprints)).filter((s) => s.state !== 'closed')
        return [
          { id: NONE, label: 'No cycle', icon: <CycleIcon />, selected: has(NONE) },
          ...sprints.map((s) => ({
            id: String(s.id),
            label: s.name,
            icon: <CycleIcon state={s.state} />,
            hint: s.state === 'active' ? 'Current' : s.startDate ? formatDate(s.startDate) : 'Upcoming',
            selected: has(String(s.id)),
          })),
        ]
      }
      case 'project': {
        const epics = Object.values(ctx.issues).filter((i) => hierarchyOf(i, ctx) >= 1 && teamKeys.includes(i.teamKey))
        epics.sort((a, b) => Number(isClosed(a, ctx)) - Number(isClosed(b, ctx)) || a.title.localeCompare(b.title))
        return [
          { id: NONE, label: 'No project', icon: <ProjectIcon id="none" />, selected: has(NONE) },
          ...epics.map((e) => ({ id: e.id, label: e.title, icon: <ProjectIcon id={e.id} done={isClosed(e, ctx)} />, keywords: e.key, hint: e.key, selected: has(e.id) })),
        ]
      }
      case 'estimate': {
        const typed = Number(query.trim())
        const items: MenuItem[] = [
          { id: NONE, label: 'No estimate', selected: has(NONE) },
          ...ESTIMATES.map((n) => ({ id: String(n), label: `${n} point${n === 1 ? '' : 's'}`, selected: has(String(n)), keywords: String(n) })),
        ]
        if (query.trim() && Number.isFinite(typed) && typed >= 0 && !ESTIMATES.includes(typed)) {
          items.push({ id: String(typed), label: `Set to ${typed} points`, sticky: true })
        }
        return items
      }
      case 'dueDate': {
        const d = (n: number) => toIsoDate(new Date(Date.now() + n * 86400000))
        const friday = (() => {
          const now = new Date()
          const add = (5 - now.getDay() + 7) % 7 || 7
          return d(add)
        })()
        const opts = [
          { id: d(0), label: 'Today' },
          { id: d(1), label: 'Tomorrow' },
          { id: friday, label: 'End of this week' },
          { id: d(7), label: 'In one week' },
          { id: d(14), label: 'In two weeks' },
        ]
        return [
          { id: NONE, label: 'No due date', selected: has(NONE) },
          ...opts.map((o) => ({ ...o, icon: <CalendarDays size={13} />, hint: formatDate(o.id), selected: has(o.id) })),
        ]
      }
      default:
        return []
    }
  }, [kind, ctx, teamKeys, assignable, remoteUsers, knownLabels, current, reachable, singleTeam, query]) // eslint-disable-line react-hooks/exhaustive-deps

  const footer =
    kind === 'dueDate' ? (
      <div className="menu-footer">
        <label className="date-custom">
          <span>Pick a date</span>
          <input
            type="date"
            defaultValue={current[0] && current[0] !== NONE ? current[0] : ''}
            onChange={(e) => e.target.value && onPick(e.target.value)}
          />
        </label>
      </div>
    ) : null

  return (
    <Menu
      items={items}
      multi={kind === 'labels'}
      placeholder={PICKER_TITLES[kind].replace('…', '') + '…'}
      query={query}
      onQueryChange={setQuery}
      onSelect={(it) => onPick(it.id)}
      onClose={onClose}
      footer={footer}
    />
  )
}

// ---------------------------------------------------------------- applying picks to issues

export function currentValues(kind: PickerKind, issues: Issue[], ctx = data()): string[] {
  const vals = new Set<string>()
  for (const i of issues) {
    switch (kind) {
      case 'status':
        vals.add(new Set(issues.map((x) => x.teamKey)).size > 1 ? `type:${ctx.statuses[i.statusId]?.type}` : i.statusId)
        break
      case 'priority':
        vals.add(i.priorityId ?? NONE)
        break
      case 'assignee':
        vals.add(i.assigneeId ?? NONE)
        break
      case 'labels':
        // Show a label as selected only when every target has it.
        break
      case 'sprint':
        vals.add(i.sprintId != null ? String(i.sprintId) : NONE)
        break
      case 'project':
        vals.add(epicOf(i, ctx)?.id ?? NONE)
        break
      case 'estimate':
        vals.add(i.estimate != null ? String(i.estimate) : NONE)
        break
      case 'dueDate':
        vals.add(i.dueDate ?? NONE)
        break
    }
  }
  if (kind === 'labels' && issues.length) {
    for (const l of issues[0].labels) if (issues.every((i) => i.labels.includes(l))) vals.add(l)
  }
  // With several issues and differing values, nothing is "selected".
  return kind !== 'labels' && vals.size > 1 ? [] : [...vals]
}

export function applyPick(kind: PickerKind, issueIds: string[], value: string, ctx = data()) {
  const none = value === NONE
  switch (kind) {
    case 'status': {
      if (value.startsWith('type:')) {
        const type = value.slice(5)
        const byStatus = new Map<string, string[]>()
        for (const id of issueIds) {
          const i = ctx.issues[id]
          const s = ctx.teams[i?.teamKey]?.statuses.find((x) => x.type === type)
          if (s) byStatus.set(s.id, [...(byStatus.get(s.id) ?? []), id])
        }
        return Promise.all([...byStatus].map(([sid, ids]) => setStatus(ids, sid)))
      }
      return setStatus(issueIds, value)
    }
    case 'priority':
      return none ? undefined : setPriority(issueIds, value)
    case 'assignee':
      return setAssignee(issueIds, none ? null : value)
    case 'labels': {
      const issues = issueIds.map((id) => ctx.issues[id]).filter(Boolean)
      const allHave = issues.every((i) => i.labels.includes(value))
      return toggleLabel(issueIds, value, !allHave)
    }
    case 'sprint':
      return setSprint(issueIds, none ? null : Number(value))
    case 'project': {
      if (none) return setParent(issueIds, null)
      const e = ctx.issues[value]
      return e ? setParent(issueIds, { id: e.id, key: e.key, title: e.title, hierarchyLevel: 1 }) : undefined
    }
    case 'estimate':
      return setEstimate(issueIds, none ? null : Number(value))
    case 'dueDate':
      return setDueDate(issueIds, none ? null : value)
  }
}

/** Global host for pickers opened by shortcuts, rows and the command palette. */
export function IssuePickerHost() {
  const picker = useUi((s) => s.picker)
  const issues = useData((s) => s.issues)
  if (!picker) return null
  const targets = picker.issueIds.map((id) => issues[id]).filter(Boolean)
  if (!targets.length) return null
  const close = () => setUi({ picker: null })
  const teamKeys = [...new Set(targets.map((i) => i.teamKey))]
  const menu = (
    <PropertyMenu
      kind={picker.kind}
      teamKeys={teamKeys}
      current={currentValues(picker.kind, targets)}
      issueKey={targets.length === 1 ? targets[0].key : undefined}
      onClose={close}
      onPick={(v) => {
        void applyPick(picker.kind, picker.issueIds, v)
        if (picker.kind !== 'labels') close()
      }}
    />
  )
  if (picker.anchor) {
    return (
      <Popover anchor={picker.anchor} onClose={close} width={picker.kind === 'project' ? 300 : 250}>
        {menu}
      </Popover>
    )
  }
  return (
    <Modal onClose={close} className="picker-modal">
      <div className="picker-context">
        {targets.length === 1 ? (
          <>
            <span className="picker-key">{targets[0].key}</span> {targets[0].title}
          </>
        ) : (
          `${targets.length} issues`
        )}
      </div>
      {menu}
    </Modal>
  )
}
