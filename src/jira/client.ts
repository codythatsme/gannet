export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type AuthConfig = { mode: 'session' } | { mode: 'token'; email: string; token: string }

export class JiraError extends Error {
  constructor(
    public status: number,
    message: string,
    public messages: string[] = [],
    public fieldErrors: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'JiraError'
  }
  get isAuth() {
    return this.status === 401 || this.status === 403
  }
  get isNetwork() {
    return this.status === 0
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Thin wrapper over fetch for the Jira Cloud REST API.
 *
 * In "session" mode it relies on the browser's existing Jira login cookies; the extension
 * has host permissions for *.atlassian.net and a declarativeNetRequest rule rewrites the
 * Origin header, so Jira treats the request as same-origin. "token" mode uses Basic auth
 * with an Atlassian API token instead.
 */
export class JiraClient {
  constructor(
    public readonly baseUrl: string,
    private readonly auth: AuthConfig,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {}

  url(path: string) {
    return path.startsWith('http') ? path : this.baseUrl.replace(/\/$/, '') + path
  }

  async request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Atlassian-Token': 'no-check',
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.auth.mode === 'token') headers.Authorization = 'Basic ' + btoa(`${this.auth.email}:${this.auth.token}`)

    let res: Response
    try {
      res = await this.fetchImpl(this.url(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: this.auth.mode === 'session' ? 'include' : 'omit',
        redirect: 'follow',
      })
    } catch (e) {
      throw new JiraError(0, `Can't reach Jira (${(e as Error).message})`)
    }

    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      const retryAfter = Number(res.headers.get('Retry-After'))
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt
      await sleep(Math.min(wait, 15000))
      return this.request<T>(method, path, body, attempt + 1)
    }

    // A redirect to the Atlassian login page means the session has expired.
    if (res.redirected && /id\.atlassian\.com|\/login/.test(res.url)) {
      throw new JiraError(401, 'Not logged in to Jira')
    }

    if (!res.ok) throw await toError(res)
    if (res.status === 204) return undefined as T
    const text = await res.text()
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      // Jira answered with HTML (usually a login page) instead of JSON.
      throw new JiraError(401, 'Jira returned a non-JSON response; you may need to log in')
    }
  }

  get<T>(path: string) {
    return this.request<T>('GET', path)
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body ?? {})
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body ?? {})
  }
  delete<T>(path: string) {
    return this.request<T>('DELETE', path)
  }
}

async function toError(res: Response): Promise<JiraError> {
  let messages: string[] = []
  let fieldErrors: Record<string, string> = {}
  try {
    const data = await res.json()
    messages = Array.isArray(data?.errorMessages) ? data.errorMessages : []
    fieldErrors = data?.errors && typeof data.errors === 'object' ? data.errors : {}
    if (typeof data?.message === 'string') messages.push(data.message)
  } catch {
    /* body is not JSON */
  }
  const parts = [...messages, ...Object.entries(fieldErrors).map(([k, v]) => `${k}: ${v}`)]
  const fallback =
    res.status === 401 ? 'Not logged in to Jira' : res.status === 403 ? 'Jira refused this request (no permission)' : `Jira error ${res.status}`
  return new JiraError(res.status, parts.join(' · ') || fallback, messages, fieldErrors)
}

export const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  const out = s.toString()
  return out ? `?${out}` : ''
}
