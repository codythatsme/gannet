import { useEffect } from 'react'
import { useSettings } from '../store/settings'
import { useData } from '../store/data'
import { connect, reconnect, syncAll } from '../store/sync'
import { openPicker, setUi, ui } from '../store/ui'
import { useRoute, navigate } from './router'
import { useHotkeys } from './hotkeys'
import { assignToMe, confirmDelete, copyBranch, copyKeys, goTeam, openCreate, openInJira } from './actions'
import { Sidebar } from '../components/Sidebar'
import { CommandPalette } from '../components/CommandPalette'
import { IssuePickerHost } from '../components/pickers'
import { CreateIssueHost } from '../components/CreateIssue'
import { ConfirmDialog, HelpDialog, SelectionBar, Toasts } from '../components/Overlays'
import { Spinner } from '../components/icons'
import { IssueDetailView } from '../views/IssueDetailView'
import { CycleView, CyclesView, MyIssuesView, ProjectView, ProjectsView, TeamIssuesView } from '../views/ScopedViews'
import { Onboarding, SettingsView } from '../views/SettingsView'
import { openExternal } from '../lib/platform'

function useTheme() {
  const theme = useSettings((s) => s.settings.theme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

function GlobalHotkeys() {
  useHotkeys(
    {
      'mod+k': () => setUi({ paletteOpen: !ui().paletteOpen, palettePage: 'root', picker: null }),
    },
    { always: true },
  )
  useHotkeys({
    '/': () => setUi({ paletteOpen: true, palettePage: 'issues' }),
    c: () => openCreate(),
    'shift+/': () => setUi({ help: true }),
    'g m': () => navigate({ name: 'my-issues', tab: 'assigned' }),
    'g i': () => goTeam('issues'),
    'g c': () => goTeam('cycles'),
    'g p': () => goTeam('projects'),
    'g s': () => navigate('#/settings'),
    s: () => openPicker('status'),
    p: () => openPicker('priority'),
    a: () => openPicker('assignee'),
    l: () => openPicker('labels'),
    e: () => openPicker('estimate'),
    'shift+c': () => openPicker('sprint'),
    'shift+p': () => openPicker('project'),
    'shift+d': () => openPicker('dueDate'),
    i: () => assignToMe(),
    'mod+.': () => void copyKeys(),
    'mod+shift+.': () => void copyBranch(),
    'shift+o': () => openInJira(),
    'mod+backspace': () => confirmDelete(),
    'mod+delete': () => confirmDelete(),
  })
  return null
}

function ConnectionBanner() {
  const connection = useData((s) => s.connection)
  const error = useData((s) => s.connectionError)
  const site = useSettings((s) => s.settings.site)
  const hasData = useData((s) => Object.keys(s.issues).length > 0)
  if (connection === 'ok' || connection === 'unknown') return null
  return (
    <div className={`banner ${connection}`}>
      {connection === 'auth' ? (
        <>
          You're not logged in to {site} in this browser{hasData ? '; showing cached issues' : ''}.
          <button className="link-btn" onClick={() => openExternal(`https://${site}`)}>
            Log in to Jira
          </button>
        </>
      ) : connection === 'offline' ? (
        <>Can't reach Jira{hasData ? '; showing cached issues' : ''}.</>
      ) : (
        <>Jira error: {error}</>
      )}
      <button className="link-btn" onClick={() => void reconnect()}>
        Retry
      </button>
    </div>
  )
}

function RouteView() {
  const route = useRoute()
  switch (route.name) {
    case 'my-issues':
      return <MyIssuesView tab={route.tab} />
    case 'team':
      return <TeamIssuesView key={route.teamKey} teamKey={route.teamKey} tab={route.tab} />
    case 'cycles':
      return <CyclesView teamKey={route.teamKey} />
    case 'cycle':
      return <CycleView key={route.sprintId} teamKey={route.teamKey} sprintId={route.sprintId} />
    case 'projects':
      return <ProjectsView teamKey={route.teamKey} />
    case 'project':
      return <ProjectView key={route.key} epicKey={route.key} />
    case 'issue':
      return <IssueDetailView key={route.key} issueKey={route.key} />
    case 'settings':
      return <SettingsView />
  }
}

export function App() {
  useTheme()
  const settings = useSettings((s) => s.settings)
  const hydrated = useData((s) => s.hydrated)
  const connection = useData((s) => s.connection)
  const authKey = JSON.stringify(settings.auth)
  const teamsKey = settings.teamKeys.join(',')

  useEffect(() => {
    void connect(useSettings.getState().settings)
  }, [settings.site, authKey])

  useEffect(() => {
    if (connection === 'ok' && teamsKey) void syncAll()
  }, [teamsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!settings.site || !settings.teamKeys.length) {
    return (
      <>
        <Onboarding />
        <Toasts />
      </>
    )
  }

  return (
    <div className="app">
      <GlobalHotkeys />
      <Sidebar />
      <main className="main">
        <ConnectionBanner />
        {hydrated ? <RouteView /> : <div className="view center-message"><Spinner size={18} /></div>}
      </main>
      <SelectionBar />
      <CommandPalette />
      <IssuePickerHost />
      <CreateIssueHost />
      <HelpDialog />
      <ConfirmDialog />
      <Toasts />
    </div>
  )
}
