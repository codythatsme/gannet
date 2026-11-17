// Small seam between the Chrome extension runtime and a plain browser tab (npm run dev).

export const isExtension =
  typeof chrome !== 'undefined' && !!chrome.runtime?.id && typeof location !== 'undefined' && location.protocol === 'chrome-extension:'

export async function storageGet<T>(key: string): Promise<T | undefined> {
  if (isExtension) {
    const out = await chrome.storage.local.get(key)
    return out[key] as T | undefined
  }
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  if (isExtension) return chrome.storage.local.set({ [key]: value })
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

export function onStorageChange(key: string, cb: (value: unknown) => void): () => void {
  if (isExtension) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && key in changes) cb(changes[key].newValue)
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }
  const listener = (e: StorageEvent) => {
    if (e.key === key) cb(e.newValue ? JSON.parse(e.newValue) : undefined)
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}

/** Per-viewer UI conveniences (view options, collapsed groups). Never throws. */
export const local = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key)
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  },
}

export function openExternal(url: string) {
  window.open(url, '_blank', 'noopener')
}
