import { create } from 'zustand'
import type { AuthConfig } from '../jira/client'
import type { StatusType } from '../domain/types'
import { onStorageChange, storageGet, storageSet } from '../lib/platform'

/** Also read by src/content/jira.ts and src/background.ts (by key name; they can't import). */
export const SETTINGS_KEY = 'gannet.settings'
export const DEMO_SITE = 'demo'

export interface Settings {
  /** Jira Cloud host, e.g. "acme.atlassian.net", or "demo". */
  site: string | null
  auth: AuthConfig
  /** Jira project keys shown as teams, in sidebar order. */
  teamKeys: string[]
  theme: 'system' | 'dark' | 'light'
  /** Per team, per Jira status id: which Gannet status type it maps to. */
  statusOverrides: Record<string, Record<string, StatusType>>
  /** Done issues older than this aren't synced up front. */
  syncWindowDays: number
  maxIssuesPerTeam: number
  /** Per team: default Jira issue type id for new issues. */
  defaultTypes: Record<string, string>
  /** Open Jira issue links in Gannet instead (content script). */
  redirectJiraLinks: boolean
  /** Show the small "Open in Gannet" button on Jira pages. */
  showJiraButton: boolean
}

export const defaultSettings: Settings = {
  site: null,
  auth: { mode: 'session' },
  teamKeys: [],
  theme: 'system',
  statusOverrides: {},
  syncWindowDays: 30,
  maxIssuesPerTeam: 4000,
  defaultTypes: {},
  redirectJiraLinks: false,
  showJiraButton: true,
}

interface SettingsState {
  settings: Settings
  loaded: boolean
  update: (patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => void
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  loaded: false,
  update(patch) {
    const cur = get().settings
    const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }
    set({ settings: next })
    void storageSet(SETTINGS_KEY, next)
  },
}))

export async function loadSettings() {
  const stored = await storageGet<Partial<Settings>>(SETTINGS_KEY)
  useSettings.setState({ settings: { ...defaultSettings, ...stored }, loaded: true })
  onStorageChange(SETTINGS_KEY, (v) => {
    if (v && JSON.stringify(v) !== JSON.stringify(useSettings.getState().settings)) {
      useSettings.setState({ settings: { ...defaultSettings, ...(v as Partial<Settings>) } })
    }
  })
}

export const getSettings = () => useSettings.getState().settings

export function siteBaseUrl(site: string) {
  return `https://${site}`
}

/** Normalise whatever the user pasted ("https://acme.atlassian.net/jira/..." or "acme") to a host. */
export function normalizeSite(input: string): string | null {
  let s = input.trim().toLowerCase()
  if (!s) return null
  if (s === DEMO_SITE) return DEMO_SITE
  s = s.replace(/^https?:\/\//, '').split(/[/?#]/)[0]
  if (!s.includes('.')) s = `${s}.atlassian.net`
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.atlassian\.net$/.test(s) ? s : null
}
