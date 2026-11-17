import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Modal, Popover, rectOf, type Rect } from './Popover'
import { Menu } from './Menu'
import { PropertyMenu } from './pickers'
import { Avatar, CycleIcon, PriorityIcon, ProjectIcon, Spinner, StatusGlyph, TeamIcon } from './icons'
import { labelColor } from './IssueList'
import { useData, data, issueByKey } from '../store/data'
import { useSettings } from '../store/settings'
import { setUi, toast, useUi, type CreateDraft, type PickerKind } from '../store/ui'
import { createIssue } from '../store/mutations'
import { NONE } from '../domain/view'
import type { IssueType, Team } from '../domain/types'
import { navigate } from '../app/router'
import { cx } from '../lib/cx'

export function CreateIssueHost() {
  const draft = useUi((s) => s.create)
  if (!draft) return null
  return <CreateIssue initial={draft} />
}

function defaultType(team: Team | undefined, parentLevel: number | undefined, preferred?: string): IssueType | undefined {
  const types = team?.issueTypes ?? []
  if (parentLevel !== undefined && parentLevel <= 0) return types.find((t) => t.hierarchyLevel < 0)
  const standard = types.filter((t) => t.hierarchyLevel === 0)
  return standard.find((t) => t.id === preferred) ?? standard.find((t) => /^task$/i.test(t.name)) ?? standard.find((t) => /story/i.test(t.name)) ?? standard[0]
}

function CreateIssue({ initial }: { initial: CreateDraft }) {
  const teams = useData((s) => s.teams)
  const users = useData((s) => s.users)
  const priorities = useData((s) => s.priorities)
  const sprints = useData((s) => s.sprints)
  const settings = useSettings((s) => s.settings)
  const teamKeys = settings.teamKeys

  const [teamKey, setTeamKey] = useState(initial.teamKey && teamKeys.includes(initial.teamKey) ? initial.teamKey : teamKeys[0])
  const team = teams[teamKey ?? '']
  const parent = initial.parentKey ? issueByKey(initial.parentKey) : undefined
  const parentLevel = initial.parentKey ? (parent?.typeId ? (data().issueTypes[parent.typeId]?.hierarchyLevel ?? 0) : 1) : undefined

  const [typeId, setTypeId] = useState<string | undefined>(() => initial.typeId ?? defaultType(team, parentLevel, settings.defaultTypes[teamKey ?? ''])?.id)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [statusId, setStatusId] = useState<string | undefined>(() => initial.statusId ?? (initial.statusType ? team?.statuses.find((s) => s.type === initial.statusType)?.id : undefined))
  const [priorityId, setPriorityId] = useState(initial.priorityId)
  const [assigneeId, setAssigneeId] = useState(initial.assigneeId)
  const [labels, setLabels] = useState<string[]>(initial.labels ?? [])
  const [sprintId, setSprintId] = useState(initial.sprintId)
  const [parentRef, setParentRef] = useState(initial.parentKey ? { key: initial.parentKey, title: initial.parentTitle ?? initial.parentKey, id: parent?.id } : undefined)
  const [estimate, setEstimate] = useState<number | undefined>()
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState<{ kind: PickerKind | 'team' | 'type'; anchor: Rect } | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  // Switching team resets team-specific fields.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setTypeId(defaultType(teams[teamKey ?? ''], parentLevel, settings.defaultTypes[teamKey ?? ''])?.id)
    setStatusId(undefined)
    setSprintId(undefined)
    if (parentRef && parentRef.key.split('-')[0] !== teamKey) setParentRef(undefined)
  }, [teamKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => setUi({ create: null })
  const type = team?.issueTypes.find((t) => t.id === typeId)
  const status = team?.statuses.find((s) => s.id === statusId)
  const sprint = sprintId ? sprints[sprintId] : undefined
  const priority = priorities.find((p) => p.id === priorityId)

  const submit = async () => {
    if (!title.trim() || !teamKey || !typeId || busy) return
    setBusy(true)
    const created = await createIssue({
      teamKey, typeId, title, description, statusId, priorityId, assigneeId, labels, sprintId, parentKey: parentRef?.key, estimate,
    })
    setBusy(false)
    if (!created) return
    toast(`Created ${created.key}`, 'success', { label: 'Open', run: () => navigate({ name: 'issue', key: created.key }) })
    if (more) {
      setTitle('')
      setDescription('')
      titleRef.current?.focus()
    } else close()
  }

  const open = (kind: PickerKind | 'team' | 'type') => (e: React.MouseEvent) => {
    const r = rectOf(e.currentTarget)
    if (r) setPicker({ kind, anchor: r })
  }

  const pickerEl = useMemo(() => {
    if (!picker) return null
    const done = () => setPicker(null)
    if (picker.kind === 'team') {
      return (
        <Menu
          items={teamKeys.map((k) => ({ id: k, label: teams[k]?.name ?? k, icon: <TeamIcon teamKey={k} team={teams[k]} size={16} />, selected: k === teamKey, keywords: k }))}
          onSelect={(it) => {
            setTeamKey(it.id)
            done()
          }}
          onClose={done}
        />
      )
    }
    if (picker.kind === 'type') {
      const types = (team?.issueTypes ?? []).filter((t) => (parentLevel !== undefined && parentLevel <= 0 ? t.hierarchyLevel < 0 : t.hierarchyLevel >= 0))
      return (
        <Menu
          items={types.map((t) => ({ id: t.id, label: t.name, icon: t.iconUrl ? <img src={t.iconUrl} width={14} height={14} alt="" /> : undefined, selected: t.id === typeId }))}
          onSelect={(it) => {
            setTypeId(it.id)
            done()
          }}
          onClose={done}
        />
      )
    }
    const kind = picker.kind
    const current =
      kind === 'status' ? [statusId ?? ''] : kind === 'priority' ? [priorityId ?? NONE] : kind === 'assignee' ? [assigneeId ?? NONE] : kind === 'labels' ? labels : kind === 'sprint' ? [sprintId ? String(sprintId) : NONE] : kind === 'project' ? [parentRef?.id ?? NONE] : kind === 'estimate' ? [estimate != null ? String(estimate) : NONE] : []
    return (
      <PropertyMenu
        kind={kind}
        teamKeys={teamKey ? [teamKey] : []}
        current={current}
        onClose={done}
        onPick={(v) => {
          const none = v === NONE
          if (kind === 'status') setStatusId(v)
          if (kind === 'priority') setPriorityId(none ? undefined : v)
          if (kind === 'assignee') setAssigneeId(none ? undefined : v)
          if (kind === 'labels') setLabels((ls) => (ls.includes(v) ? ls.filter((l) => l !== v) : [...ls, v]))
          if (kind === 'sprint') setSprintId(none ? undefined : Number(v))
          if (kind === 'project') {
            const e = data().issues[v]
            setParentRef(none || !e ? undefined : { key: e.key, title: e.title, id: e.id })
          }
          if (kind === 'estimate') setEstimate(none ? undefined : Number(v))
          if (kind !== 'labels') done()
        }}
      />
    )
  }, [picker, teamKeys, teams, teamKey, team, typeId, statusId, priorityId, assigneeId, labels, sprintId, parentRef, estimate, parentLevel])

  if (!teamKey) {
    return (
      <Modal onClose={close} className="create-modal">
        <div className="create-empty">
          Choose which Jira projects to show first.{' '}
          <a href="#/settings" onClick={close}>
            Open settings
          </a>
        </div>
      </Modal>
    )
  }

  const isSub = parentLevel !== undefined && parentLevel <= 0

  return (
    <Modal onClose={close} className="create-modal" top="10vh">
      <div
        className="create"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      >
        <div className="create-head">
          <button className="chip-btn" onClick={open('team')}>
            <TeamIcon teamKey={teamKey} team={team} size={16} />
            {team?.name ?? teamKey}
          </button>
          <span className="crumb-sep">›</span>
          <span className="muted">{isSub ? `New sub-issue of ${parentRef?.key}` : (type?.hierarchyLevel ?? 0) >= 1 ? 'New project' : 'New issue'}</span>
          <span className="flex" />
          <button className="icon-btn" onClick={close} title="Close (Esc)">
            <X size={15} />
          </button>
        </div>
        <input
          ref={titleRef}
          className="create-title"
          autoFocus
          placeholder="Issue title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault()
              ;(e.currentTarget.parentElement?.querySelector('.create-desc') as HTMLTextAreaElement | null)?.focus()
            }
          }}
        />
        <textarea className="create-desc" placeholder="Add description… (Markdown)" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        <div className="create-props">
          <button className="chip-btn" onClick={open('type')} title="Issue type">
            {type?.iconUrl && <img src={type.iconUrl} width={14} height={14} alt="" />}
            {type?.name ?? 'Type'}
          </button>
          <button className="chip-btn" onClick={open('status')}>
            <StatusGlyph status={status ?? team?.statuses.find((s) => s.type === 'unstarted') ?? team?.statuses[0]} team={team} />
            {status?.name ?? 'Default status'}
          </button>
          <button className="chip-btn" onClick={open('priority')}>
            <PriorityIcon level={priority?.level ?? 0} />
            {priority?.name ?? 'Priority'}
          </button>
          <button className="chip-btn" onClick={open('assignee')}>
            <Avatar user={assigneeId ? users[assigneeId] : null} size={16} />
            {assigneeId ? users[assigneeId]?.name : 'Assignee'}
          </button>
          <button className="chip-btn" onClick={open('labels')}>
            {labels.length ? (
              labels.map((l) => (
                <span key={l} className="label-inline">
                  <span className="label-dot" style={{ background: labelColor(l) }} />
                  {l}
                </span>
              ))
            ) : (
              <>Labels</>
            )}
          </button>
          {team?.sprintsEnabled && !isSub && (
            <button className="chip-btn" onClick={open('sprint')}>
              <CycleIcon state={sprint?.state} />
              {sprint?.name ?? 'Cycle'}
            </button>
          )}
          {!isSub && (
            <button className="chip-btn" onClick={open('project')}>
              <ProjectIcon id={parentRef?.id ?? 'none'} />
              <span className="truncate">{parentRef?.title ?? 'Project'}</span>
            </button>
          )}
          <button className="chip-btn" onClick={open('estimate')}>
            {estimate != null ? `${estimate} pts` : 'Estimate'}
          </button>
        </div>
        <div className="create-foot">
          <label className="toggle-label">
            <input type="checkbox" className="switch" checked={more} onChange={(e) => setMore(e.target.checked)} />
            Create more
          </label>
          <span className="flex" />
          <span className="muted small">⌘↵</span>
          <button className={cx('btn primary')} disabled={!title.trim() || busy || !typeId} onClick={() => void submit()}>
            {busy ? <Spinner size={13} /> : 'Create issue'}
          </button>
        </div>
      </div>
      {picker && (
        <Popover anchor={picker.anchor} onClose={() => setPicker(null)} width={260}>
          {pickerEl}
        </Popover>
      )}
    </Modal>
  )
}
