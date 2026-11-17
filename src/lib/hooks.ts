import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData } from '../store/data'
import type { ViewCtx } from '../domain/view'

/** Everything the pure view functions need, memoised on the store slices. */
export function useViewCtx(): ViewCtx {
  const s = useData(
    useShallow((s) => ({
      teams: s.teams,
      statuses: s.statuses,
      priorities: s.priorities,
      users: s.users,
      sprints: s.sprints,
      issueTypes: s.issueTypes,
      issues: s.issues,
      meId: s.me?.id,
    })),
  )
  return useMemo(() => s, [s])
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Re-render every `ms` (for relative timestamps). */
export function useTick(ms = 60_000) {
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}
