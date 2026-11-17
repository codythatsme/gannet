import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, Search, X } from 'lucide-react'
import { StatusGlyph, TeamIcon, Spinner } from '../components/icons'
import { api } from '../jira/api'
import { JiraError, type AuthConfig } from '../jira/client'
import type { JProject } from '../jira/types'
import { STATUS_TYPES, STATUS_TYPE_LABEL, type StatusType } from '../domain/types'
import { clearCache, useData } from '../store/data'
import { DEMO_SITE, normalizeSite, siteBaseUrl, useSettings, type Settings } from '../store/settings'
import { applyStatusOverrides, makeClient, recentProjects, searchProjects, syncAll } from '../store/sync'
import { confirmAction, toast } from '../store/ui'
import { useDebounced } from '../lib/hooks'
import { cx } from '../lib/cx'
import { isExtension, openExternal, storageGet } from '../lib/platform'

// ---------------------------------------------------------------- shared pieces

export function TeamChooser({ selected, onChange }: { selected: string[]; onChange: (keys: string[]) => void }) {
  const [query, setQuery] = useState('')
  const q = useDebounced(query, 250)
  const [results, setResults] = useState<JProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const connection = useData((s) => s.connection)
  useEffect(() => {
    if (connection !== 'ok') return
    let alive = true
    setError(null)
    ;(q.trim() ? searchProjects(q) : recentProjects().then(async (r) => (r.length ? r : searchProjects(''))))
      .then((r) => alive && setResults(r))
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
  }, [q, connection])
  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key])
  return (
    <div className="team-chooser">
      <label className="search-field">
        <Search size={14} />
        <input placeholder="Search Jira projects…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {error && <div className="error-text">{error}</div>}
      {!results && !error && <Spinner />}
      <div className="team-results">
        {results?.map((p) => (
          <label key={p.key} className={cx('team-result', selected.includes(p.key) && 'on')}>
            <input type="checkbox" checked={selected.includes(p.key)} onChange={() => toggle(p.key)} />
            <TeamIcon teamKey={p.key} size={18} />
            <span className="truncate">{p.name}</span>
            <span className="row-key">{p.key}</span>
          </label>
        ))}
        {results?.length === 0 && <div className="muted small">No projects found</div>}
      </div>
    </div>
  )
}

function Section({ title, children, description }: { title: string; children: React.ReactNode; description?: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {description && <p className="muted">{description}</p>}
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- settings

export function SettingsView() {
  const { settings, update } = useSettings()
  const teams = useData((s) => s.teams)
  const connection = useData((s) => s.connection)
  const connectionError = useData((s) => s.connectionError)
  const me = useData((s) => s.me)
  const siteInfo = useData((s) => s.siteInfo)
  const [adding, setAdding] = useState(false)

  const move = (key: string, d: number) => {
    const keys = [...settings.teamKeys]
    const i = keys.indexOf(key)
    const j = i + d
    if (j < 0 || j >= keys.length) return
    ;[keys[i], keys[j]] = [keys[j], keys[i]]
    update({ teamKeys: keys })
  }

  const setOverride = (teamKey: string, statusId: string, type: StatusType | '') => {
    const cur = { ...(settings.statusOverrides[teamKey] ?? {}) }
    if (type) cur[statusId] = type
    else delete cur[statusId]
    update({ statusOverrides: { ...settings.statusOverrides, [teamKey]: cur } })
    setTimeout(() => applyStatusOverrides(teamKey), 0)
  }

  return (
    <div className="view">
      <header className="view-header">
        <div className="view-title">
          <h1>Settings</h1>
        </div>
      </header>
      <div className="view-body scroll">
        <div className="settings">
          <Section title="Jira site">
            <div className="settings-row">
              <div>
                <div className="strong">{settings.site === DEMO_SITE ? 'Demo data' : settings.site}</div>
                <div className="muted small">
                  {connection === 'ok'
                    ? `Connected${me ? ` as ${me.name}` : ''}${settings.site !== DEMO_SITE ? ` · ${settings.auth.mode === 'token' ? 'API token' : 'browser session'}` : ''}`
                    : connection === 'auth'
                      ? 'Not logged in'
                      : connectionError ?? 'Connecting…'}
                </div>
              </div>
              <span className="flex" />
              {siteInfo?.baseUrl && (
                <button className="btn ghost" onClick={() => openExternal(siteInfo.baseUrl)}>
                  <ExternalLink size={13} /> Open Jira
                </button>
              )}
              <button
                className="btn"
                onClick={() =>
                  confirmAction({
                    title: 'Disconnect this site?',
                    body: 'You can reconnect any time. Cached issues for this site are kept until you clear them.',
                    confirmLabel: 'Disconnect',
                    run: () => update({ site: null, teamKeys: [] }),
                  })
                }
              >
                Change site
              </button>
            </div>
          </Section>

          <Section title="Teams" description="Each Jira project you add here appears as a team in the sidebar.">
            {settings.teamKeys.map((k, i) => (
              <div key={k} className="settings-row team-row">
                <TeamIcon teamKey={k} team={teams[k]} size={18} />
                <span>{teams[k]?.name ?? k}</span>
                <span className="row-key">{k}</span>
                <span className="muted small">{teams[k] ? (teams[k].sprintsEnabled ? 'Scrum board · cycles on' : teams[k].boardType ? `${teams[k].boardType} board` : 'No board') : ''}</span>
                <span className="flex" />
                <button className="icon-btn" disabled={i === 0} onClick={() => move(k, -1)} title="Move up">
                  <ArrowUp size={14} />
                </button>
                <button className="icon-btn" disabled={i === settings.teamKeys.length - 1} onClick={() => move(k, 1)} title="Move down">
                  <ArrowDown size={14} />
                </button>
                <button className="icon-btn" onClick={() => update({ teamKeys: settings.teamKeys.filter((x) => x !== k) })} title="Remove">
                  <X size={14} />
                </button>
              </div>
            ))}
            {adding ? (
              <>
                <TeamChooser selected={settings.teamKeys} onChange={(keys) => update({ teamKeys: keys })} />
                <button className="btn" onClick={() => setAdding(false)}>
                  Done
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setAdding(true)}>
                Add teams…
              </button>
            )}
          </Section>

          <Section
            title="Workflow mapping"
            description="Jira only has three status categories. Gannet guesses which of its five status types each Jira status belongs to; correct it here. This changes grouping and the Active/Backlog tabs, not Jira."
          >
            {settings.teamKeys.map((k) => {
              const team = teams[k]
              if (!team) return null
              const overrides = settings.statusOverrides[k] ?? {}
              return (
                <details key={k} className="mapping">
                  <summary>
                    <TeamIcon teamKey={k} team={team} size={16} /> {team.name}
                  </summary>
                  {team.statuses.map((s) => (
                    <div key={s.id} className="settings-row compact">
                      <StatusGlyph status={s} team={team} />
                      <span>{s.name}</span>
                      <span className="muted small">Jira: {s.category === 'new' ? 'To Do' : s.category === 'indeterminate' ? 'In Progress' : 'Done'}</span>
                      <span className="flex" />
                      <select value={overrides[s.id] ?? ''} onChange={(e) => setOverride(k, s.id, e.target.value as StatusType | '')}>
                        <option value="">Auto ({STATUS_TYPE_LABEL[s.type]})</option>
                        {STATUS_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {STATUS_TYPE_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <div className="settings-row compact">
                    <span>Default type for new issues</span>
                    <span className="flex" />
                    <select
                      value={settings.defaultTypes[k] ?? ''}
                      onChange={(e) => update({ defaultTypes: { ...settings.defaultTypes, [k]: e.target.value } })}
                    >
                      <option value="">Auto</option>
                      {team.issueTypes
                        .filter((t) => t.hierarchyLevel === 0)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </details>
              )
            })}
          </Section>

          <Section title="Sync" description="Gannet keeps a local copy of open issues plus anything changed recently, and checks Jira for changes every minute.">
            <div className="settings-row">
              <span>Keep closed issues for</span>
              <span className="flex" />
              <select value={settings.syncWindowDays} onChange={(e) => update({ syncWindowDays: Number(e.target.value) })}>
                {[7, 14, 30, 60, 90, 180].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <span>Max issues per team</span>
              <span className="flex" />
              <select value={settings.maxIssuesPerTeam} onChange={(e) => update({ maxIssuesPerTeam: Number(e.target.value) })}>
                {[1000, 2000, 4000, 8000, 15000].map((d) => (
                  <option key={d} value={d}>
                    {d.toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <button className="btn" onClick={() => void syncAll({ full: true }).then(() => toast('Resync complete', 'success'))}>
                Full resync
              </button>
              <button
                className="btn ghost"
                onClick={() =>
                  confirmAction({
                    title: 'Clear the local cache?',
                    body: 'Gannet will download everything again from Jira.',
                    confirmLabel: 'Clear cache',
                    run: async () => {
                      if (settings.site) await clearCache(settings.site)
                      void syncAll({ full: true })
                    },
                  })
                }
              >
                Clear local cache
              </button>
            </div>
          </Section>

          <Section title="Appearance">
            <div className="settings-row">
              <span>Theme</span>
              <span className="flex" />
              <div className="segmented small">
                {(['system', 'dark', 'light'] as const).map((t) => (
                  <button key={t} className={cx(settings.theme === t && 'on')} onClick={() => update({ theme: t })}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="On Jira pages" description="Gannet's content script runs on your Jira site only.">
            <label className="settings-row">
              <span>Show an “Open in Gannet” button</span>
              <span className="flex" />
              <input type="checkbox" className="switch" checked={settings.showJiraButton} onChange={(e) => update({ showJiraButton: e.target.checked })} />
            </label>
            <label className="settings-row">
              <div>
                <div>Open Jira issue links in Gannet</div>
                <div className="muted small">Visiting /browse/KEY-123 opens the issue in Gannet instead. Add ?gannet=0 to a URL to skip this.</div>
              </div>
              <span className="flex" />
              <input type="checkbox" className="switch" checked={settings.redirectJiraLinks} onChange={(e) => update({ redirectJiraLinks: e.target.checked })} />
            </label>
          </Section>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- onboarding

export function Onboarding() {
  const { settings, update } = useSettings()
  const [step, setStep] = useState<'site' | 'teams'>(settings.site ? 'teams' : 'site')
  const [site, setSite] = useState(settings.site ?? '')
  const [seen, setSeen] = useState<string[]>([])
  const [mode, setMode] = useState<AuthConfig['mode']>('session')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; auth: boolean } | null>(null)
  const [connected, setConnected] = useState<Pick<Settings, 'site' | 'auth'> | null>(settings.site ? { site: settings.site, auth: settings.auth } : null)
  const [teamKeys, setTeamKeys] = useState<string[]>([])

  useEffect(() => {
    void storageGet<string[]>('gannet.seenSites').then((s) => {
      if (s?.length) {
        setSeen(s)
        setSite((cur) => cur || s[0])
      }
    })
  }, [])

  const connect = async () => {
    const host = normalizeSite(site)
    if (!host) return setError({ message: 'Enter your Jira Cloud address, like acme.atlassian.net', auth: false })
    const auth: AuthConfig = mode === 'token' ? { mode: 'token', email: email.trim(), token: token.trim() } : { mode: 'session' }
    setBusy(true)
    setError(null)
    try {
      const c = await makeClient({ site: host, auth })
      await api.myself(c)
      setConnected({ site: host, auth })
      // Temporarily point the app's client at this site so the project picker works.
      update({ site: host, auth, teamKeys: [] })
      setStep('teams')
    } catch (e) {
      const err = e as JiraError
      setError({
        auth: err instanceof JiraError && err.isAuth,
        message:
          err instanceof JiraError && err.isAuth
            ? mode === 'session'
              ? `You don't seem to be logged in to ${host} in this browser.`
              : 'Jira rejected that email and API token.'
            : err instanceof JiraError && err.isNetwork
              ? `Couldn't reach ${host}. Check the address${isExtension ? '' : ' (outside the extension, browsers block cross-site requests; try the demo)'}.`
              : err.message,
      })
    } finally {
      setBusy(false)
    }
  }

  if (step === 'teams' && connected) {
    return (
      <div className="onboarding">
        <div className="onboarding-card">
          <h1>Pick your teams</h1>
          <p className="muted">Choose the Jira projects you work in. Each becomes a team in Gannet. You can change this later in settings.</p>
          <TeamChooser selected={teamKeys} onChange={setTeamKeys} />
          <div className="onboarding-actions">
            <button
              className="btn ghost"
              onClick={() => {
                update({ site: null })
                setStep('site')
              }}
            >
              Back
            </button>
            <button className="btn primary" disabled={!teamKeys.length} onClick={() => update({ teamKeys })}>
              Continue with {teamKeys.length || 'no'} team{teamKeys.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="brand">
          <img src="/icons/icon-128.png" width={44} height={44} alt="" />
        </div>
        <h1>Connect Gannet to Jira</h1>
        <p className="muted">Gannet is a fast, keyboard-first interface for issue tracking. Your data stays in Jira; Gannet reads and writes it directly from this browser.</p>
        <label className="field">
          <span>Jira site</span>
          <input
            autoFocus
            placeholder="acme.atlassian.net"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void connect()}
            list="gannet-seen-sites"
          />
          <datalist id="gannet-seen-sites">
            {seen.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <div className="segmented">
          <button className={cx(mode === 'session' && 'on')} onClick={() => setMode('session')}>
            Use my Jira login
          </button>
          <button className={cx(mode === 'token' && 'on')} onClick={() => setMode('token')}>
            Use an API token
          </button>
        </div>
        {mode === 'session' ? (
          <p className="muted small">Uses the session you already have in this browser. Nothing to set up; log in to Jira in a tab first.</p>
        ) : (
          <>
            <label className="field">
              <span>Atlassian email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <label className="field">
              <span>
                API token ·{' '}
                <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">
                  create one
                </a>
              </span>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            </label>
            <p className="muted small">Stored only in this browser's extension storage.</p>
          </>
        )}
        {error && (
          <div className="error-box">
            {error.message}
            {error.auth && mode === 'session' && normalizeSite(site) && (
              <button className="link-btn" onClick={() => openExternal(siteBaseUrl(normalizeSite(site)!))}>
                Open Jira to log in
              </button>
            )}
          </div>
        )}
        <div className="onboarding-actions">
          <button className="btn ghost" onClick={() => update({ site: DEMO_SITE, auth: { mode: 'session' }, teamKeys: ['WEB', 'API', 'MOB'] })}>
            Try with demo data
          </button>
          <button className="btn primary" disabled={busy || !site.trim()} onClick={() => void connect()}>
            {busy ? <Spinner size={13} /> : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}
