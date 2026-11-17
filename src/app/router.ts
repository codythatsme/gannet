import { useSyncExternalStore } from 'react'

// A tiny hash router: extension pages can't use path-based routing (reloads would 404).

export type Route =
  | { name: 'my-issues'; tab: 'assigned' | 'created' | 'all' }
  | { name: 'team'; teamKey: string; tab: 'all' | 'active' | 'backlog' }
  | { name: 'cycles'; teamKey: string }
  | { name: 'cycle'; teamKey: string; sprintId: number }
  | { name: 'projects'; teamKey: string }
  | { name: 'project'; key: string }
  | { name: 'issue'; key: string }
  | { name: 'settings' }

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent)
  const [a, b, c, d] = parts
  switch (a) {
    case 'team':
      if (b && c === 'cycles') return { name: 'cycles', teamKey: b }
      if (b && c === 'cycle' && d) return { name: 'cycle', teamKey: b, sprintId: Number(d) }
      if (b && c === 'projects') return { name: 'projects', teamKey: b }
      if (b) return { name: 'team', teamKey: b, tab: c === 'active' || c === 'backlog' ? c : 'all' }
      break
    case 'project':
      if (b) return { name: 'project', key: b }
      break
    case 'issue':
      if (b) return { name: 'issue', key: b.toUpperCase() }
      break
    case 'settings':
      return { name: 'settings' }
    case 'my-issues':
      return { name: 'my-issues', tab: b === 'created' || b === 'all' ? b : 'assigned' }
  }
  return { name: 'my-issues', tab: 'assigned' }
}

export function toHash(r: Route): string {
  switch (r.name) {
    case 'my-issues':
      return `#/my-issues/${r.tab}`
    case 'team':
      return `#/team/${r.teamKey}/${r.tab}`
    case 'cycles':
      return `#/team/${r.teamKey}/cycles`
    case 'cycle':
      return `#/team/${r.teamKey}/cycle/${r.sprintId}`
    case 'projects':
      return `#/team/${r.teamKey}/projects`
    case 'project':
      return `#/project/${r.key}`
    case 'issue':
      return `#/issue/${r.key}`
    case 'settings':
      return '#/settings'
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
let cachedHash = ''
let cachedRoute: Route = parseHash('')
export function currentRoute(): Route {
  if (location.hash !== cachedHash) {
    cachedHash = location.hash
    cachedRoute = parseHash(cachedHash)
  }
  return cachedRoute
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute)
}

/** The last non-issue route, so Escape in an issue returns to the list it came from. */
let lastListHash = '#/my-issues/assigned'
window.addEventListener('hashchange', () => {
  if (currentRoute().name !== 'issue') lastListHash = location.hash
})

export function navigate(r: Route | string, opts: { replace?: boolean } = {}) {
  const hash = typeof r === 'string' ? r : toHash(r)
  if (hash === location.hash) return
  if (currentRoute().name !== 'issue') lastListHash = location.hash || lastListHash
  if (opts.replace) location.replace(hash)
  else location.hash = hash
}

export function backToList() {
  navigate(lastListHash)
}
