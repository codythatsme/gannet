import { useState } from 'react'
import { ChevronRight, CircleUserRound, Keyboard, Layers, Plus, Search, Settings, SquarePen } from 'lucide-react'
import { useData } from '../store/data'
import { useSettings } from '../store/settings'
import { setUi } from '../store/ui'
import { useRoute } from '../app/router'
import { openCreate } from '../app/actions'
import { Avatar, CycleIcon, TeamIcon } from './icons'
import { cx } from '../lib/cx'
import { local } from '../lib/platform'
import { isMac } from '../app/hotkeys'

export function Sidebar() {
  const route = useRoute()
  const teamKeys = useSettings((s) => s.settings.teamKeys)
  const teams = useData((s) => s.teams)
  const me = useData((s) => s.me)
  const siteInfo = useData((s) => s.siteInfo)
  const [collapsed, setCollapsed] = useState<string[]>(() => local.get('gannet.sidebar', { collapsed: [] as string[] }).collapsed)
  const toggle = (k: string) => {
    const next = collapsed.includes(k) ? collapsed.filter((x) => x !== k) : [...collapsed, k]
    setCollapsed(next)
    local.set('gannet.sidebar', { collapsed: next })
  }
  const routeTeam = 'teamKey' in route ? route.teamKey : undefined

  return (
    <nav className="sidebar">
      <div className="sidebar-top">
        <a className="workspace" href="#/settings" title="Settings">
          <span className="workspace-icon">{(siteInfo?.title ?? 'G')[0].toUpperCase()}</span>
          <span className="workspace-name">{siteInfo?.title ?? 'Gannet'}</span>
        </a>
        <span className="flex" />
        <button className="icon-btn" title="Search (⌘K)" onClick={() => setUi({ paletteOpen: true, palettePage: 'issues' })}>
          <Search size={15} />
        </button>
        <button className="icon-btn new-issue" title="New issue (C)" onClick={() => openCreate()}>
          <SquarePen size={15} />
        </button>
      </div>

      <div className="sidebar-scroll">
        <a className={cx('nav-item', route.name === 'my-issues' && 'on')} href="#/my-issues/assigned">
          {me ? <Avatar user={me} size={16} /> : <CircleUserRound size={15} />}
          My issues
        </a>

        <div className="nav-section">
          <span>Your teams</span>
          <a className="icon-btn tiny" href="#/settings" title="Choose teams">
            <Plus size={13} />
          </a>
        </div>
        {teamKeys.length === 0 && (
          <a className="nav-item muted" href="#/settings">
            Pick Jira projects to show…
          </a>
        )}
        {teamKeys.map((key) => {
          const team = teams[key]
          const open = !collapsed.includes(key)
          return (
            <div key={key} className="team-block">
              <button className={cx('nav-item team-item', routeTeam === key && 'in')} onClick={() => toggle(key)}>
                <TeamIcon teamKey={key} team={team} size={18} />
                <span className="truncate">{team?.name ?? key}</span>
                <ChevronRight size={12} className={cx('team-chevron', open && 'open')} />
              </button>
              {open && (
                <div className="team-children">
                  <a className={cx('nav-item sub', (route.name === 'team' && route.teamKey === key) && 'on')} href={`#/team/${key}/all`}>
                    <Layers size={14} /> Issues
                  </a>
                  {team?.sprintsEnabled && (
                    <a className={cx('nav-item sub', (route.name === 'cycles' || route.name === 'cycle') && route.teamKey === key && 'on')} href={`#/team/${key}/cycles`}>
                      <CycleIcon state="active" size={14} /> Cycles
                    </a>
                  )}
                  <a className={cx('nav-item sub', route.name === 'projects' && route.teamKey === key && 'on')} href={`#/team/${key}/projects`}>
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                      <path d="M7 1.2 12.2 4v6L7 12.8 1.8 10V4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                    Projects
                  </a>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="sidebar-bottom">
        <a className={cx('nav-item', route.name === 'settings' && 'on')} href="#/settings">
          <Settings size={15} /> Settings
        </a>
        <button className="nav-item" onClick={() => setUi({ help: true })}>
          <Keyboard size={15} /> Shortcuts
          <span className="flex" />
          <kbd>?</kbd>
        </button>
        <div className="sidebar-hint">
          <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>
          <kbd>K</kbd> for commands
        </div>
      </div>
    </nav>
  )
}
