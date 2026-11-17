import { useEffect, useRef } from 'react'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { Modal } from './Popover'
import { Kbd, PriorityIcon, StatusIcon } from './icons'
import { dismissToast, openPicker, setUi, useUi } from '../store/ui'
import { comboLabel } from '../app/hotkeys'
import { confirmDelete } from '../app/actions'
import { cx } from '../lib/cx'

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', t.kind)}>
          {t.kind === 'error' ? <CircleAlert size={15} /> : t.kind === 'success' ? <CircleCheck size={15} /> : null}
          <span className="toast-msg">{t.message}</span>
          {t.action && (
            <button
              className="link-btn"
              onClick={() => {
                t.action!.run()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="icon-btn tiny" onClick={() => dismissToast(t.id)}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function ConfirmDialog() {
  const c = useUi((s) => s.confirm)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (c) setTimeout(() => btn.current?.focus(), 0)
  }, [c])
  if (!c) return null
  const close = () => setUi({ confirm: null })
  return (
    <Modal onClose={close} className="confirm" top="22vh">
      <h3>{c.title}</h3>
      {c.body && <p className="muted">{c.body}</p>}
      <div className="confirm-actions">
        <button className="btn ghost" onClick={close}>
          Cancel
        </button>
        <button
          ref={btn}
          className={cx('btn', c.danger ? 'danger' : 'primary')}
          onClick={() => {
            close()
            c.run()
          }}
        >
          {c.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    'General',
    [
      ['mod+k', 'Command menu'],
      ['/', 'Search issues'],
      ['c', 'Create issue'],
      ['shift+/', 'Keyboard shortcuts'],
      ['escape', 'Back / clear selection'],
    ],
  ],
  [
    'Navigation',
    [
      ['g m', 'My issues'],
      ['g i', 'Team issues'],
      ['g c', 'Team cycles'],
      ['g p', 'Team projects'],
      ['g s', 'Settings'],
    ],
  ],
  [
    'Lists',
    [
      ['j', 'Next issue'],
      ['k', 'Previous issue'],
      ['enter', 'Open issue'],
      ['x', 'Select issue'],
      ['shift+j', 'Extend selection down'],
      ['mod+a', 'Select all'],
      ['f', 'Filter'],
      ['shift+f', 'Clear filters'],
      ['mod+b', 'Toggle list / board'],
      ['shift+v', 'Display options'],
    ],
  ],
  [
    'Issue',
    [
      ['s', 'Change status'],
      ['p', 'Change priority'],
      ['a', 'Assign'],
      ['i', 'Assign to me'],
      ['l', 'Labels'],
      ['shift+c', 'Cycle'],
      ['shift+p', 'Project'],
      ['e', 'Estimate'],
      ['shift+d', 'Due date'],
      ['r', 'Rename (in issue)'],
      ['m', 'Comment (in issue)'],
      ['mod+.', 'Copy issue key'],
      ['mod+shift+.', 'Copy git branch name'],
      ['shift+o', 'Open in Jira'],
      ['mod+backspace', 'Delete'],
    ],
  ],
]

export function HelpDialog() {
  const open = useUi((s) => s.help)
  if (!open) return null
  return (
    <Modal onClose={() => setUi({ help: false })} className="help" top="8vh">
      <div className="help-head">
        <h3>Keyboard shortcuts</h3>
        <button className="icon-btn" onClick={() => setUi({ help: false })}>
          <X size={15} />
        </button>
      </div>
      <div className="help-grid">
        {SHORTCUTS.map(([section, rows]) => (
          <div key={section}>
            <div className="help-section">{section}</div>
            {rows.map(([combo, label]) => (
              <div key={combo} className="help-row">
                <span>{label}</span>
                <Kbd keys={comboLabel(combo)} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  )
}

/** Floating bar shown while issues are selected. */
export function SelectionBar() {
  const selected = useUi((s) => s.selected)
  if (!selected.size) return null
  const ids = [...selected]
  const btn = (label: string, kind: Parameters<typeof openPicker>[0], icon?: React.ReactNode) => (
    <button className="btn ghost small" onClick={(e) => openPicker(kind, ids, e.currentTarget)}>
      {icon}
      {label}
    </button>
  )
  return (
    <div className="selection-bar">
      <span className="selection-count">{selected.size} selected</span>
      {btn('Status', 'status', <StatusIcon type="started" size={13} />)}
      {btn('Priority', 'priority', <PriorityIcon level={2} size={13} />)}
      {btn('Assignee', 'assignee')}
      {btn('Labels', 'labels')}
      {btn('Cycle', 'sprint')}
      {btn('Project', 'project')}
      <button className="btn ghost small danger-text" onClick={() => confirmDelete(ids)}>
        Delete
      </button>
      <button className="icon-btn" title="Clear selection (Esc)" onClick={() => setUi({ selected: new Set() })}>
        <X size={14} />
      </button>
    </div>
  )
}
