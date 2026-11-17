import { branchName, copyText } from '../lib/cx'
import { openExternal } from '../lib/platform'
import { data } from '../store/data'
import { deleteIssues, setAssignee } from '../store/mutations'
import { getSettings, useSettings } from '../store/settings'
import { jiraIssueUrl, syncAll } from '../store/sync'
import { confirmAction, setUi, targetIds, toast, ui, type CreateDraft } from '../store/ui'
import { currentRoute, navigate } from './router'

// Commands shared by keyboard shortcuts, the command palette and context menus.

const issuesFor = (ids: string[]) => ids.map((id) => data().issues[id]).filter(Boolean)

export function currentTeamKey(): string | undefined {
  const r = currentRoute()
  if ('teamKey' in r) return r.teamKey
  if (r.name === 'issue' || r.name === 'project') return r.key.split('-')[0]
  const focused = ui().focusedId ? data().issues[ui().focusedId!] : undefined
  return focused?.teamKey ?? getSettings().teamKeys[0]
}

export async function copyKeys(ids = targetIds()) {
  const list = issuesFor(ids)
  if (!list.length) return
  if (await copyText(list.map((i) => i.key).join(', '))) toast(list.length === 1 ? `Copied ${list[0].key}` : `Copied ${list.length} keys`, 'success')
}

export async function copyBranch(ids = targetIds()) {
  const [i] = issuesFor(ids)
  if (!i) return
  const name = branchName(i.key, i.title)
  if (await copyText(name)) toast(`Copied branch name ${name}`, 'success')
}

export async function copyUrl(ids = targetIds()) {
  const list = issuesFor(ids)
  const urls = list.map((i) => jiraIssueUrl(i.key)).filter(Boolean)
  if (!urls.length) return toast('No Jira URL in demo mode')
  if (await copyText(urls.join('\n'))) toast(urls.length === 1 ? 'Copied Jira link' : `Copied ${urls.length} links`, 'success')
}

export function openInJira(ids = targetIds()) {
  const [i] = issuesFor(ids)
  if (!i) return
  const url = jiraIssueUrl(i.key)
  // ?gannet=0 stops the content script from bouncing the link straight back here.
  if (url) openExternal(getSettings().redirectJiraLinks ? `${url}?gannet=0` : url)
  else toast('Demo issues have no Jira page')
}

export function assignToMe(ids = targetIds()) {
  const me = data().me?.id
  if (!me || !ids.length) return
  const list = issuesFor(ids)
  const allMine = list.every((i) => i.assigneeId === me)
  void setAssignee(ids, allMine ? null : me)
}

export function confirmDelete(ids = targetIds()) {
  const list = issuesFor(ids)
  if (!list.length) return
  confirmAction({
    title: list.length === 1 ? `Delete ${list[0].key}?` : `Delete ${list.length} issues?`,
    body: 'This deletes the issue in Jira, including its sub-tasks. It cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
    run: () => {
      const r = currentRoute()
      if (r.name === 'issue' && list.some((i) => i.key === r.key)) history.back()
      setUi({ selected: new Set(), focusedId: null })
      void deleteIssues(list.map((i) => i.id))
    },
  })
}

export function openCreate(draft: CreateDraft = {}) {
  setUi({ create: { teamKey: currentTeamKey(), ...draft }, paletteOpen: false, picker: null })
}

export function syncNow() {
  toast('Syncing with Jira…')
  void syncAll().then(() => toast('Up to date', 'success'))
}

export function cycleTheme() {
  const { settings, update } = useSettings.getState()
  const next = settings.theme === 'dark' ? 'light' : settings.theme === 'light' ? 'system' : 'dark'
  update({ theme: next })
  toast(`Theme: ${next}`)
}

export function goTeam(section: 'issues' | 'cycles' | 'projects', teamKey = currentTeamKey()) {
  if (!teamKey) return navigate('#/settings')
  if (section === 'issues') navigate({ name: 'team', teamKey, tab: 'all' })
  else if (section === 'cycles') navigate({ name: 'cycles', teamKey })
  else navigate({ name: 'projects', teamKey })
}
