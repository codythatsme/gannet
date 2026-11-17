// MV3 service worker. Keep this file free of imports from the app (it is bundled alone).

const SETTINGS_KEY = 'gannet.settings'
const SEEN_KEY = 'gannet.seenSites'
const APP = 'app.html'
const ORIGIN_RULE_ID = 1

const appUrl = (path = '') => chrome.runtime.getURL(APP) + (path ? `#${path}` : '')

function issueKeyFromUrl(url?: string): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('.atlassian.net')) return undefined
    return u.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/)?.[1] ?? u.searchParams.get('selectedIssue') ?? undefined
  } catch {
    return undefined
  }
}

async function openApp(path = '', replaceTabId?: number) {
  const url = appUrl(path)
  if (replaceTabId != null) {
    await chrome.tabs.update(replaceTabId, { url })
    return
  }
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] })
  const existing = contexts.find((c) => c.documentUrl?.startsWith(chrome.runtime.getURL(APP)) && c.tabId >= 0)
  if (existing) {
    await chrome.tabs.update(existing.tabId, { active: true, ...(path ? { url } : {}) })
    await chrome.windows.update(existing.windowId, { focused: true })
    return
  }
  await chrome.tabs.create({ url })
}

chrome.action.onClicked.addListener((tab) => {
  const key = issueKeyFromUrl(tab.url)
  void openApp(key ? `/issue/${key}` : '')
})

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'site-seen' && typeof msg.host === 'string') {
    void chrome.storage.local.get(SEEN_KEY).then((s) => {
      const list = (s[SEEN_KEY] as string[] | undefined) ?? []
      if (list[0] !== msg.host) void chrome.storage.local.set({ [SEEN_KEY]: [msg.host, ...list.filter((h) => h !== msg.host)].slice(0, 5) })
    })
  }
  if (msg?.type === 'open') {
    void openApp(typeof msg.path === 'string' ? msg.path : '', msg.replaceTab ? sender.tab?.id : undefined)
  }
})

/**
 * Jira's XSRF protection compares the Origin header with the site. Requests from the
 * extension page carry chrome-extension://..., so rewrite it for requests Gannet makes.
 */
async function syncOriginRule() {
  const s = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as { site?: string | null } | undefined
  const site = s?.site && s.site.endsWith('.atlassian.net') ? s.site : null
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ORIGIN_RULE_ID],
    addRules: site
      ? [
          {
            id: ORIGIN_RULE_ID,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              requestHeaders: [{ header: 'origin', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: `https://${site}` }],
            },
            condition: {
              requestDomains: [site],
              initiatorDomains: [chrome.runtime.id],
              resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST],
            },
          },
        ]
      : [],
  })
}

chrome.runtime.onInstalled.addListener(() => {
  void syncOriginRule()
  void chrome.storage.local.get(SETTINGS_KEY).then((s) => {
    if (!(s[SETTINGS_KEY] as { site?: string } | undefined)?.site) void openApp()
  })
})
chrome.runtime.onStartup.addListener(() => void syncOriginRule())
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && SETTINGS_KEY in changes) void syncOriginRule()
})
