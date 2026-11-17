export const jqlString = (s: string) => `"${s.replace(/["\\]/g, '\\$&')}"`

/**
 * First sync for a team: everything still open, plus whatever changed recently, plus all
 * epics (they back the Projects view even when old).
 */
export function initialSyncJql(teamKey: string, windowDays: number, epicTypeIds: string[]): string {
  const epics = epicTypeIds.length ? ` OR issuetype in (${epicTypeIds.join(', ')})` : ''
  return `project = ${jqlString(teamKey)} AND (statusCategory != Done OR updated >= -${windowDays}d${epics}) ORDER BY updated DESC`
}

/**
 * Incremental sync. Relative minutes avoid JQL's timezone handling (absolute dates in JQL are
 * read in the user's Jira profile timezone).
 */
export function deltaSyncJql(teamKey: string, lastSyncAt: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((now - lastSyncAt) / 60000) + 2)
  return `project = ${jqlString(teamKey)} AND updated >= -${minutes}m ORDER BY updated ASC`
}

export function textSearchJql(text: string, teamKeys: string[]): string {
  const scope = teamKeys.length ? `project in (${teamKeys.map(jqlString).join(', ')}) AND ` : ''
  const t = text.trim()
  if (/^[A-Z][A-Z0-9_]+-\d+$/i.test(t)) return `${scope}(key = ${jqlString(t.toUpperCase())} OR text ~ ${jqlString(t)}) ORDER BY updated DESC`
  return `${scope}text ~ ${jqlString(t + '*')} ORDER BY updated DESC`
}

export function epicChildrenJql(epicKey: string): string {
  return `parent = ${jqlString(epicKey)} ORDER BY updated DESC`
}

export function sprintJql(sprintId: number): string {
  return `sprint = ${sprintId} ORDER BY updated DESC`
}
