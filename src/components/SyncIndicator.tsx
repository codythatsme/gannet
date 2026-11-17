import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useData } from '../store/data'
import { useSettings } from '../store/settings'
import { syncAll, syncTeam } from '../store/sync'
import { relativeTime } from '../lib/time'
import { useTick } from '../lib/hooks'
import { Spinner } from './icons'

export function SyncIndicator({ teamKey }: { teamKey?: string }) {
  useTick(30_000)
  const sync = useData((s) => s.sync)
  const teamKeys = useSettings((s) => s.settings.teamKeys)
  const keys = teamKey ? [teamKey] : teamKeys
  const infos = keys.map((k) => sync[k]).filter(Boolean)
  const syncing = infos.some((i) => i.syncing)
  const error = infos.find((i) => i.error)?.error
  const last = Math.min(...infos.map((i) => i.lastSyncAt ?? 0))
  const truncated = infos.some((i) => i.truncated)
  const run = () => void (teamKey ? syncTeam(teamKey, { full: true }) : syncAll({ full: true }))
  const title = error
    ? `Sync failed: ${error}`
    : `${last ? `Synced ${relativeTime(last)}` : 'Not synced yet'}${truncated ? ' · issue limit reached, older issues load on demand' : ''}. Click for a full resync.`
  return (
    <button className="icon-btn sync-indicator" title={title} onClick={run}>
      {syncing ? <Spinner size={13} /> : error ? <AlertTriangle size={13} className="warn" /> : <RefreshCw size={13} />}
    </button>
  )
}
