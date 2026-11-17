// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// jsdom gaps (and Node 25's own experimental localStorage, which shadows jsdom's)
const mem = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  },
})
window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView ??= function () {}

const errors: unknown[] = []
const origError = console.error
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    // Background sync updates state outside act(); that's expected here.
    if (String(args[0]).includes('not wrapped in act')) return
    errors.push(args)
    origError(...args)
  }
  localStorage.setItem('gannet.settings', JSON.stringify({ site: 'demo', teamKeys: ['WEB', 'API', 'MOB'] }))
})
afterAll(() => {
  console.error = origError
})

const tick = (ms = 20) => act(() => new Promise((r) => setTimeout(r, ms)))

async function go(hash: string) {
  await act(async () => {
    location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  await tick(50)
}

describe('app smoke test (demo mode)', () => {
  let root: Root
  let container: HTMLDivElement

  it('boots, syncs and renders every route and overlay without errors', async () => {
    const { loadSettings } = await import('../src/store/settings')
    const { App } = await import('../src/app/App')
    const { useData } = await import('../src/store/data')
    const { setUi } = await import('../src/store/ui')
    const { disconnect, syncAll } = await import('../src/store/sync')
    await loadSettings()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(useData.getState().connection).toBe('ok'), { timeout: 3000 })
    await act(() => syncAll())
    expect(Object.keys(useData.getState().issues).length).toBeGreaterThan(50)

    await go('#/my-issues/assigned')
    expect(container.textContent).toContain('My issues')

    await go('#/team/WEB/all')
    expect(container.textContent).toContain('Web App')
    await go('#/team/WEB/active')
    await go('#/team/WEB/backlog')

    // Board layout for a team view.
    localStorage.setItem('gannet.view.team-API-all', JSON.stringify({ display: { layout: 'board' }, filters: [{ field: 'priority', op: 'isNot', values: ['5'] }], collapsed: [] }))
    await go('#/team/API/all')
    expect(container.querySelector('.board')).toBeTruthy()
    expect(container.querySelector('.card')).toBeTruthy()
    expect(container.textContent).toContain('Priority')

    await go('#/team/WEB/cycles')
    expect(container.textContent).toContain('Current')
    const sprint = Object.values(useData.getState().sprints).find((s) => s.teamKey === 'WEB' && s.state === 'active')!
    await go(`#/team/WEB/cycle/${sprint.id}`)
    await go('#/team/WEB/projects')
    expect(container.textContent).toContain('New navigation')
    await go('#/project/WEB-1')
    expect(container.textContent).toContain('New navigation')

    await go('#/issue/WEB-7')
    await vi.waitFor(() => expect(container.querySelector('.activity')?.textContent).toContain('created the issue'))
    expect(container.querySelector('.title-input')).toBeTruthy()

    await go('#/issue/NOPE-1')
    await vi.waitFor(() => expect(container.textContent).toMatch(/doesn't exist|Mock/))

    await go('#/settings')
    expect(container.textContent).toContain('Workflow mapping')

    // Overlays.
    const webIssue = Object.values(useData.getState().issues).find((i) => i.teamKey === 'WEB')!
    await act(async () => setUi({ paletteOpen: true, palettePage: 'root', focusedId: webIssue.id }))
    expect(document.body.textContent).toContain('Change status…')
    await act(async () => setUi({ paletteOpen: false }))
    for (const kind of ['status', 'priority', 'assignee', 'labels', 'sprint', 'project', 'estimate', 'dueDate'] as const) {
      await act(async () => setUi({ picker: { kind, issueIds: [webIssue.id] } }))
      expect(document.body.querySelector('.picker-modal .menu-item')).toBeTruthy()
      await act(async () => setUi({ picker: null }))
    }
    await act(async () => setUi({ create: { teamKey: 'WEB' } }))
    expect(document.body.textContent).toContain('Create issue')
    await act(async () => setUi({ create: null, help: true }))
    expect(document.body.textContent).toContain('Keyboard shortcuts')
    await act(async () => setUi({ help: false, selected: new Set([webIssue.id]) }))
    expect(document.body.textContent).toContain('1 selected')

    await act(async () => root.unmount())
    disconnect()
    expect(errors).toEqual([])
  }, 15000)
})
