import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowRight, CircleUserRound, Copy, ExternalLink, GitBranch, Keyboard, Link2, Moon, Plus, RefreshCw, Search, Settings, Trash2, UserRoundCheck,
} from 'lucide-react'
import { Menu, type MenuItem } from './Menu'
import { Modal } from './Popover'
import { Kbd, PriorityIcon, StatusGlyph, TeamIcon } from './icons'
import { PICKER_TITLES } from './pickers'
import { useData, data, issueByKey } from '../store/data'
import { useSettings } from '../store/settings'
import { openPicker, setUi, targetIds, useUi, type PickerKind } from '../store/ui'
import { searchRemote } from '../store/sync'
import { navigate } from '../app/router'
import { comboLabel } from '../app/hotkeys'
import { assignToMe, confirmDelete, copyBranch, copyKeys, copyUrl, cycleTheme, openCreate, openInJira, syncNow } from '../app/actions'
import { fuzzyScore } from '../lib/cx'
import { useDebounced } from '../lib/hooks'
import { hierarchyOf, priorityLevel, statusFor } from '../domain/view'
import type { Issue } from '../domain/types'

interface Command {
  id: string
  label: string
  section: string
  icon?: ReactNode
  combo?: string
  keywords?: string
  run: () => void
}

const KEY_RE = /^[A-Za-z][A-Za-z0-9_]+-\d+$/

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  if (!open) return null
  return <Palette />
}

function Palette() {
  const page = useUi((s) => s.palettePage)
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query, 300)
  const [remote, setRemote] = useState<Issue[]>([])
  const [remoteState, setRemoteState] = useState<'idle' | 'loading' | 'done'>('idle')
  const teams = useData((s) => s.teams)
  const issues = useData((s) => s.issues)
  const teamKeys = useSettings((s) => s.settings.teamKeys)
  const close = () => setUi({ paletteOpen: false, palettePage: 'root' })
  const [targets] = useState(() => targetIds())

  useEffect(() => {
    setRemote([])
    setRemoteState('idle')
  }, [debounced])

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = []
    if (targets.length) {
      const first = data().issues[targets[0]]
      const section = targets.length === 1 && first ? `Issue · ${first.key}` : `${targets.length} issues`
      const pick = (kind: PickerKind, combo: string) => ({
        id: `pick-${kind}`,
        label: PICKER_TITLES[kind],
        section,
        combo,
        run: () => openPicker(kind, targets),
      })
      out.push(
        pick('status', 's'),
        pick('priority', 'p'),
        pick('assignee', 'a'),
        { id: 'assign-me', label: 'Assign to me', section, combo: 'i', icon: <UserRoundCheck size={14} />, run: () => assignToMe(targets) },
        pick('labels', 'l'),
        pick('sprint', 'shift+c'),
        pick('project', 'shift+p'),
        pick('estimate', 'e'),
        pick('dueDate', 'shift+d'),
        { id: 'copy-key', label: 'Copy issue key', section, combo: 'mod+.', icon: <Copy size={14} />, run: () => void copyKeys(targets) },
        { id: 'copy-branch', label: 'Copy git branch name', section, combo: 'mod+shift+.', icon: <GitBranch size={14} />, run: () => void copyBranch(targets) },
        { id: 'copy-url', label: 'Copy Jira link', section, icon: <Link2 size={14} />, run: () => void copyUrl(targets) },
        { id: 'open-jira', label: 'Open in Jira', section, combo: 'shift+o', icon: <ExternalLink size={14} />, run: () => openInJira(targets) },
        { id: 'delete', label: targets.length > 1 ? 'Delete issues…' : 'Delete issue…', section, combo: 'mod+backspace', icon: <Trash2 size={14} />, run: () => confirmDelete(targets) },
      )
    }
    out.push(
      { id: 'create', label: 'Create new issue', section: 'Create', combo: 'c', icon: <Plus size={14} />, run: () => openCreate() },
      { id: 'my-issues', label: 'Go to My issues', section: 'Navigation', combo: 'g m', icon: <CircleUserRound size={14} />, run: () => navigate({ name: 'my-issues', tab: 'assigned' }) },
    )
    for (const k of teamKeys) {
      const name = teams[k]?.name ?? k
      const icon = <TeamIcon teamKey={k} team={teams[k]} size={14} />
      out.push({ id: `team-${k}`, label: `Go to ${name} issues`, keywords: k, section: 'Navigation', icon, run: () => navigate({ name: 'team', teamKey: k, tab: 'all' }) })
      if (teams[k]?.sprintsEnabled) out.push({ id: `cycles-${k}`, label: `Go to ${name} cycles`, keywords: `${k} sprints`, section: 'Navigation', icon, run: () => navigate({ name: 'cycles', teamKey: k }) })
      out.push({ id: `projects-${k}`, label: `Go to ${name} projects`, keywords: `${k} epics`, section: 'Navigation', icon, run: () => navigate({ name: 'projects', teamKey: k }) })
    }
    out.push(
      { id: 'settings', label: 'Open settings', section: 'Navigation', combo: 'g s', icon: <Settings size={14} />, run: () => navigate('#/settings') },
      { id: 'sync', label: 'Sync with Jira now', section: 'Gannet', icon: <RefreshCw size={14} />, run: syncNow },
      { id: 'theme', label: 'Switch theme', section: 'Gannet', keywords: 'dark light mode', icon: <Moon size={14} />, run: cycleTheme },
      { id: 'help', label: 'Keyboard shortcuts', section: 'Gannet', combo: 'shift+/', icon: <Keyboard size={14} />, run: () => setUi({ help: true }) },
    )
    return out
  }, [targets, teamKeys, teams])

  const items = useMemo<(MenuItem & { run: () => void })[]>(() => {
    const q = query.trim()
    const cmdItems = commands
      .map((c, i) => ({ c, i, s: q ? fuzzyScore(`${c.label} ${c.keywords ?? ''}`, q) : 1 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map(({ c }) => ({
        id: c.id,
        label: c.label,
        icon: c.icon,
        section: q ? 'Commands' : c.section,
        hint: c.combo ? <Kbd keys={comboLabel(c.combo)} /> : undefined,
        run: c.run,
      }))

    const issueItems: (MenuItem & { run: () => void })[] = []
    if (q || page === 'issues') {
      const seen = new Set<string>()
      const scored = Object.values(issues)
        .map((i) => ({ i, s: q ? Math.max(fuzzyScore(i.key, q) * 1.2, fuzzyScore(i.title, q)) : Date.parse(i.updatedAt) / 1e13 }))
        .filter((x) => x.s > (q ? 20 : 0))
        .sort((a, b) => b.s - a.s)
        .slice(0, 30)
      for (const { i } of [...scored, ...remote.map((i) => ({ i }))]) {
        if (seen.has(i.id)) continue
        seen.add(i.id)
        issueItems.push(issueItem(i, () => navigate({ name: 'issue', key: i.key })))
      }
      if (KEY_RE.test(q) && !issueByKey(q.toUpperCase())) {
        issueItems.unshift({ id: 'open-key', label: `Open ${q.toUpperCase()}`, icon: <ArrowRight size={14} />, section: 'Issues', run: () => navigate({ name: 'issue', key: q.toUpperCase() }) })
      }
      if (q.length >= 2) {
        issueItems.push({
          id: 'search-jira',
          label: remoteState === 'loading' ? `Searching Jira for "${q}"…` : remoteState === 'done' ? `Searched Jira for "${q}" (${remote.length} found)` : `Search Jira for "${q}"`,
          icon: <Search size={14} />,
          section: 'Issues',
          disabled: remoteState === 'loading',
          run: () => {
            setRemoteState('loading')
            searchRemote(q)
              .then((r) => {
                setRemote(r)
                setRemoteState('done')
              })
              .catch(() => setRemoteState('done'))
          },
        })
      }
    }
    return page === 'issues' ? [...issueItems, ...cmdItems] : [...cmdItems, ...issueItems]
  }, [commands, query, issues, remote, remoteState, page])

  return (
    <Modal onClose={close} className="palette">
      <Menu
        items={items}
        filter={false}
        query={query}
        onQueryChange={setQuery}
        placeholder={page === 'issues' ? 'Search issues by title or key…' : 'Type a command or search…'}
        onClose={close}
        onSelect={(it) => {
          const item = items.find((x) => x.id === it.id)
          if (!item) return
          if (item.id === 'search-jira') return item.run()
          close()
          item.run()
        }}
      />
    </Modal>
  )
}

function issueItem(i: Issue, run: () => void): MenuItem & { run: () => void } {
  const ctx = data()
  const epic = hierarchyOf(i, ctx) >= 1
  return {
    id: `issue-${i.id}`,
    label: i.title,
    keywords: i.key,
    section: 'Issues',
    icon: (
      <span className="palette-issue-icons">
        <PriorityIcon level={priorityLevel(i, ctx)} size={13} />
        <StatusGlyph status={statusFor(i, ctx)} team={ctx.teams[i.teamKey]} size={13} />
      </span>
    ),
    hint: <span className="row-key">{epic ? `Project · ${i.key}` : i.key}</span>,
    run,
  }
}
