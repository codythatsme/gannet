import type { CSSProperties } from 'react'
import type { PriorityLevel, Status, StatusType, Team, User } from '../domain/types'
import { cx, hashHue, initials } from '../lib/cx'

// Gannet's own small glyphs for status, priority, people, teams and projects.

export function StatusIcon({ type, progress = 0.5, size = 14, className }: { type: StatusType | undefined; progress?: number; size?: number; className?: string }) {
  const t = type ?? 'unstarted'
  const r = 5.25
  const c = 7
  const style = { color: `var(--status-${t})` } as CSSProperties
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className={cx('status-icon', className)} style={style} aria-hidden>
      {t === 'backlog' && <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.6 1.75" />}
      {t === 'unstarted' && <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {t === 'started' && (
        <>
          <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d={piePath(c, c, 2.75, Math.max(0.15, Math.min(0.85, progress)))} fill="currentColor" />
        </>
      )}
      {t === 'completed' && (
        <>
          <circle cx={c} cy={c} r={6} fill="currentColor" />
          <path d="M4.4 7.2 6.2 9 9.7 5.3" fill="none" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {t === 'canceled' && (
        <>
          <circle cx={c} cy={c} r={6} fill="currentColor" />
          <path d="M5 5l4 4M9 5l-4 4" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

function piePath(cx: number, cy: number, r: number, frac: number) {
  if (frac >= 0.999) return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`
  const a = frac * Math.PI * 2 - Math.PI / 2
  const x = cx + r * Math.cos(a)
  const y = cy + r * Math.sin(a)
  return `M${cx},${cy}L${cx},${cy - r}A${r},${r} 0 ${frac > 0.5 ? 1 : 0},1 ${x},${y}Z`
}

/** How far along the workflow a started status is (drives the pie fill). */
export function statusProgress(status: Status | undefined, team: Team | undefined) {
  if (!status || status.type !== 'started' || !team) return 0.5
  const started = team.statuses.filter((s) => s.type === 'started')
  const i = started.findIndex((s) => s.id === status.id)
  return (i + 1) / (started.length + 1)
}

export function StatusGlyph({ status, team, size }: { status: Status | undefined; team?: Team; size?: number }) {
  return <StatusIcon type={status?.type} progress={statusProgress(status, team)} size={size} />
}

export function PriorityIcon({ level, size = 14 }: { level: PriorityLevel | number; size?: number }) {
  if (level === 1) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" className="priority-icon urgent" aria-hidden>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
        <path d="M7 3.8v4" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10.1" r="0.95" fill="var(--bg)" />
      </svg>
    )
  }
  if (!level) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" className="priority-icon none" aria-hidden>
        {[3, 7, 11].map((x) => (
          <rect key={x} x={x - 1} y="6.25" width="2" height="1.5" rx="0.5" fill="currentColor" />
        ))}
      </svg>
    )
  }
  const filled = 5 - level // high=3, medium=2, low=1
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="priority-icon" aria-hidden>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width="3" height={3.5 + i * 3} rx="0.8" fill="currentColor" opacity={i < filled ? 1 : 0.28} />
      ))}
    </svg>
  )
}

export function Avatar({ user, size = 18, className }: { user: User | undefined | null; size?: number; className?: string }) {
  if (!user) {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" className={cx('avatar avatar-empty', className)} aria-label="No assignee">
        <circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray="2 2" />
        <circle cx="9" cy="7.3" r="2.2" fill="currentColor" opacity="0.8" />
        <path d="M5.2 13.2c.8-1.6 2.2-2.4 3.8-2.4s3 .8 3.8 2.4" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.8" />
      </svg>
    )
  }
  const hue = hashHue(user.id)
  return (
    <span
      className={cx('avatar', className)}
      title={user.name}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue} 45% 42%)` }}
    >
      {user.avatarUrl && !/\/default|initials/.test(user.avatarUrl) ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials(user.name)}
    </span>
  )
}

export function TeamIcon({ team, teamKey, size = 18 }: { team?: Team; teamKey: string; size?: number }) {
  const hue = hashHue(teamKey)
  return (
    <span className="team-icon" style={{ width: size, height: size, fontSize: size * 0.5, background: `hsl(${hue} 55% 45% / 0.2)`, color: `hsl(${hue} 70% 65%)` }}>
      {(team?.name ?? teamKey)[0]?.toUpperCase()}
    </span>
  )
}

export function ProjectIcon({ id, size = 14, done }: { id: string; size?: number; done?: boolean }) {
  const hue = hashHue(id)
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="project-icon" style={{ color: done ? 'var(--status-completed)' : `hsl(${hue} 65% 60%)` }} aria-hidden>
      <path d="M7 1.2 12.2 4v6L7 12.8 1.8 10V4z" fill="currentColor" opacity="0.18" />
      <path d="M7 1.2 12.2 4v6L7 12.8 1.8 10V4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M1.8 4 7 6.9 12.2 4M7 6.9v5.9" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
    </svg>
  )
}

export function CycleIcon({ state, size = 14 }: { state?: 'active' | 'future' | 'closed'; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className={cx('cycle-icon', state)} aria-hidden>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray={state === 'future' ? '2 1.7' : undefined} />
      {state === 'active' && <path d={piePath(7, 7, 3, 0.5)} fill="currentColor" />}
      {state === 'closed' && <path d="M4.6 7.1 6.3 8.8 9.4 5.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="kbd-group">
      {keys.map((k, i) => (k === 'then' ? <span key={i} className="kbd-then">then</span> : <kbd key={i}>{k}</kbd>))}
    </span>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="spinner" aria-label="Loading">
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <path d="M7 1.5a5.5 5.5 0 0 1 5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
