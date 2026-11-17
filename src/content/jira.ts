// Content script on *.atlassian.net. Loaded as a classic script: no imports allowed.
// It (1) tells Gannet which Jira sites you use, (2) optionally redirects issue links into Gannet,
// and (3) adds a small "Open in Gannet" button.

;(() => {
  const SETTINGS_KEY = 'gannet.settings'
  const host = location.host
  const params = new URLSearchParams(location.search)

  const issueKey = () =>
    location.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/)?.[1] ?? new URLSearchParams(location.search).get('selectedIssue') ?? undefined

  const send = (msg: unknown) => {
    try {
      void chrome.runtime.sendMessage(msg).catch(() => undefined)
    } catch {
      /* extension was reloaded; ignore */
    }
  }

  send({ type: 'site-seen', host })

  void chrome.storage.local.get(SETTINGS_KEY).then((stored) => {
    const s = (stored[SETTINGS_KEY] ?? {}) as { site?: string; redirectJiraLinks?: boolean; showJiraButton?: boolean }
    const key = issueKey()
    if (s.redirectJiraLinks && s.site === host && key && /\/browse\//.test(location.pathname) && params.get('gannet') !== '0') {
      send({ type: 'open', path: `/issue/${key}`, replaceTab: true })
      return
    }
    if (s.showJiraButton !== false) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectButton, { once: true })
      else injectButton()
    }
  })

  function injectButton() {
    if (document.getElementById('gannet-open-host')) return
    const hostEl = document.createElement('div')
    hostEl.id = 'gannet-open-host'
    hostEl.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;'
    const root = hostEl.attachShadow({ mode: 'closed' })
    root.innerHTML = `
      <style>
        button{all:unset;cursor:pointer;display:flex;align-items:center;gap:6px;height:28px;padding:0 11px 0 9px;border-radius:14px;
          font:500 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff;background:#5e6ad2;
          box-shadow:0 2px 10px rgba(0,0,0,.25);opacity:.88;transition:opacity .15s,transform .15s}
        button:hover{opacity:1;transform:translateY(-1px)}
        svg{display:block}
      </style>
      <button title="Open in Gannet (Alt+Shift+G)">
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M1.6 8.4C2.6 6 4.6 5 7 7.6 9.4 5 11.4 6 12.4 8.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>
        Open in Gannet
      </button>`
    root.querySelector('button')!.addEventListener('click', () => {
      const key = issueKey()
      send({ type: 'open', path: key ? `/issue/${key}` : '' })
    })
    document.documentElement.appendChild(hostEl)
  }
})()
