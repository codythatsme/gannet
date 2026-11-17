import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Columns3, LayoutList, ListFilter, SlidersHorizontal } from 'lucide-react'
import { IssueList } from '../components/IssueList'
import { Board } from '../components/Board'
import { DisplayMenu, FilterChips, FilterMenu, useViewMenus } from '../components/ViewControls'
import { SyncIndicator } from '../components/SyncIndicator'
import type { DisplayOptions, Filter, Group } from '../domain/view'
import { applyDisplay, DEFAULT_DISPLAY, groupDefaults, groupIssues, matchesFilters, sortIssues } from '../domain/view'
import type { Issue } from '../domain/types'
import { useViewCtx } from '../lib/hooks'
import { local } from '../lib/platform'
import { cx } from '../lib/cx'
import { useSettings } from '../store/settings'
import { setUi, type CreateDraft } from '../store/ui'
import { useHotkeys } from '../app/hotkeys'
import { openCreate } from '../app/actions'
import { data } from '../store/data'

export interface Tab {
  id: string
  label: string
  href: string
  active: boolean
}

interface ViewState {
  display: DisplayOptions
  filters: Filter[]
  collapsed: string[]
}

function useViewState(viewKey: string, defaults: Partial<DisplayOptions>) {
  const storageKey = `gannet.view.${viewKey}`
  const initial = useMemo<ViewState>(() => {
    const s = local.get<ViewState>(storageKey, { display: { ...DEFAULT_DISPLAY, ...defaults }, filters: [], collapsed: [] })
    return { ...s, display: { ...DEFAULT_DISPLAY, ...defaults, ...s.display } }
  }, [storageKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState(initial)
  useEffect(() => setState(initial), [initial])
  const update = useCallback(
    (patch: Partial<ViewState>) =>
      setState((cur) => {
        const next = { ...cur, ...patch }
        local.set(storageKey, next)
        return next
      }),
    [storageKey],
  )
  return [state, update] as const
}

/**
 * The workhorse view: any scoped set of issues as a grouped list or board, with filters and
 * display options persisted per view.
 */
export function IssuesView({
  viewKey,
  title,
  icon,
  tabs,
  scope,
  teamKey,
  createDefaults,
  defaults = {},
  header,
  emptyText,
  allTeams = false,
}: {
  viewKey: string
  title: ReactNode
  icon?: ReactNode
  tabs?: Tab[]
  scope: (i: Issue) => boolean
  teamKey?: string
  createDefaults?: CreateDraft
  defaults?: Partial<DisplayOptions>
  header?: ReactNode
  emptyText?: string
  /** Include issues from teams outside the sidebar (e.g. a project's children). */
  allTeams?: boolean
}) {
  const ctx = useViewCtx()
  const teamKeys = useSettings((s) => s.settings.teamKeys)
  const [state, update] = useViewState(viewKey, defaults)
  const { display, filters } = state
  const collapsed = useMemo(() => new Set(state.collapsed), [state.collapsed])
  const menus = useViewMenus()

  const base = useMemo(() => {
    const keys = new Set(teamKeys)
    return Object.values(ctx.issues).filter((i) => (allTeams || keys.has(i.teamKey)) && scope(i))
  }, [ctx.issues, teamKeys, scope, allTeams])

  const visible = useMemo(() => applyDisplay(base.filter((i) => matchesFilters(i, filters, ctx)), display, ctx), [base, filters, display, ctx])
  const groupBy = display.layout === 'board' && display.groupBy === 'none' ? 'status' : display.groupBy
  const groups = useMemo(
    () => groupIssues(sortIssues(visible, display.orderBy, ctx), groupBy, ctx, { teamKey, showEmpty: display.showEmptyGroups || display.layout === 'board' }),
    [visible, display.orderBy, groupBy, ctx, teamKey, display.showEmptyGroups, display.layout],
  )
  // Board: hide canceled-type columns unless they have issues, like Linear.
  const boardGroups = useMemo(() => groups.filter((g) => g.issues.length || g.meta.statusType !== 'canceled'), [groups])

  useEffect(() => {
    setUi({ navLabel: typeof title === 'string' ? title : '' })
  }, [title])
  useEffect(() => () => setUi({ selected: new Set(), focusedId: null }), [viewKey])

  const createIn = useCallback(
    (g: Group) => {
      const d = groupDefaults(g)
      const draft: CreateDraft = { ...createDefaults }
      if (d.statusId) draft.statusId = d.statusId
      if (d.statusType) draft.statusType = d.statusType
      if (d.assigneeId) draft.assigneeId = d.assigneeId
      if (d.priorityId) draft.priorityId = d.priorityId
      if (d.sprintId) draft.sprintId = d.sprintId
      if (d.label) draft.labels = [d.label]
      if (d.projectId) {
        const e = data().issues[d.projectId]
        if (e) Object.assign(draft, { parentKey: e.key, parentTitle: e.title })
      }
      openCreate(draft)
    },
    [createDefaults],
  )

  useHotkeys({
    f: () => menus.openFilter(),
    'shift+f': () => update({ filters: [] }),
    'mod+b': () => update({ display: { ...display, layout: display.layout === 'list' ? 'board' : 'list' } }),
    'shift+v': () => menus.openDisplay(),
    c: () => openCreate(createDefaults),
  })

  const allowCycle = teamKey ? !!ctx.teams[teamKey]?.sprintsEnabled : Object.values(ctx.teams).some((t) => t.sprintsEnabled)

  return (
    <div className="view">
      <header className="view-header">
        <div className="view-title">
          {icon}
          <h1>{title}</h1>
          {tabs && (
            <nav className="tabs">
              {tabs.map((t) => (
                <a key={t.id} href={t.href} className={cx('tab', t.active && 'on')}>
                  {t.label}
                </a>
              ))}
            </nav>
          )}
        </div>
        <div className="view-actions">
          <SyncIndicator teamKey={teamKey} />
          <button ref={menus.filterBtn} className={cx('btn ghost', filters.length > 0 && 'on')} onClick={() => menus.openFilter()} title="Filter (F)">
            <ListFilter size={14} /> Filter
          </button>
          <div className="segmented small">
            <button className={cx(display.layout === 'list' && 'on')} title="List (⌘B)" onClick={() => update({ display: { ...display, layout: 'list' } })}>
              <LayoutList size={14} />
            </button>
            <button className={cx(display.layout === 'board' && 'on')} title="Board (⌘B)" onClick={() => update({ display: { ...display, layout: 'board' } })}>
              <Columns3 size={14} />
            </button>
          </div>
          <button ref={menus.displayBtn} className="btn ghost" onClick={menus.openDisplay} title="Display options (⇧V)">
            <SlidersHorizontal size={14} /> Display
          </button>
        </div>
      </header>
      {header}
      <FilterChips filters={filters} setFilters={(f) => update({ filters: f })} ctx={ctx} teamKey={teamKey} onEdit={(field, el) => menus.openFilter(field, el)} />
      <div className="view-body">
        {display.layout === 'list' ? (
          <IssueList
            groups={groups}
            ctx={ctx}
            properties={display.properties}
            collapsed={collapsed}
            onToggleGroup={(id) => update({ collapsed: collapsed.has(id) ? state.collapsed.filter((x) => x !== id) : [...state.collapsed, id] })}
            onCreateInGroup={createIn}
            teamKey={teamKey}
            emptyText={filters.length ? 'No issues match these filters' : emptyText}
          />
        ) : (
          <Board groups={boardGroups} ctx={ctx} properties={display.properties} teamKey={teamKey} onCreateInGroup={createIn} />
        )}
      </div>
      {menus.filterAt && (
        <FilterMenu
          anchor={menus.filterAt.anchor}
          initialField={menus.filterAt.field}
          onClose={menus.closeFilter}
          base={base}
          ctx={ctx}
          teamKey={teamKey}
          filters={filters}
          setFilters={(f) => update({ filters: f })}
        />
      )}
      {menus.displayAt && (
        <DisplayMenu anchor={menus.displayAt} onClose={menus.closeDisplay} display={display} setDisplay={(d) => update({ display: d })} allowCycle={allowCycle} />
      )}
    </div>
  )
}
