import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cx, fuzzyScore } from '../lib/cx'

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  hint?: ReactNode
  keywords?: string
  disabled?: boolean
  selected?: boolean
  section?: string
  /** Always shown regardless of query (e.g. "Create label"). */
  sticky?: boolean
}

/**
 * Searchable, keyboard-driven list used by every picker. Arrow keys move, Enter picks,
 * Escape closes. In `multi` mode Enter toggles and the menu stays open.
 */
export function Menu({
  items,
  onSelect,
  onClose,
  placeholder = 'Search…',
  multi = false,
  query: controlledQuery,
  onQueryChange,
  filter = true,
  emptyText = 'No results',
  header,
  footer,
  autoFocus = true,
}: {
  items: MenuItem[]
  onSelect: (item: MenuItem) => void
  onClose: () => void
  placeholder?: string
  multi?: boolean
  query?: string
  onQueryChange?: (q: string) => void
  filter?: boolean
  emptyText?: string
  header?: ReactNode
  footer?: ReactNode
  autoFocus?: boolean
}) {
  const [ownQuery, setOwnQuery] = useState('')
  const query = controlledQuery ?? ownQuery
  const setQuery = (q: string) => {
    setOwnQuery(q)
    onQueryChange?.(q)
  }
  const visible = useMemo(() => {
    if (!filter || !query.trim()) return items
    return items
      .map((it, i) => ({ it, i, s: it.sticky ? 1 : fuzzyScore(`${it.label} ${it.keywords ?? ''}`, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => (a.it.sticky ? 1 : 0) - (b.it.sticky ? 1 : 0) || b.s - a.s || a.i - b.i)
      .map((x) => x.it)
  }, [items, query, filter])

  const firstEnabled = () => Math.max(0, visible.findIndex((v) => !v.disabled))
  const [active, setActive] = useState(firstEnabled)
  useEffect(() => setActive(firstEnabled()), [query]) // eslint-disable-line react-hooks/exhaustive-deps
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const move = (d: number) => {
    if (!visible.length) return
    let i = active
    for (let n = 0; n < visible.length; n++) {
      i = (i + d + visible.length) % visible.length
      if (!visible[i].disabled) break
    }
    setActive(i)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = visible[active]
      if (it && !it.disabled) onSelect(it)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  let lastSection: string | undefined
  return (
    <div className="menu" onKeyDown={onKeyDown}>
      {header}
      <input
        className="menu-search"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />
      <div className="menu-list" ref={listRef} role="listbox">
        {visible.length === 0 && <div className="menu-empty">{emptyText}</div>}
        {visible.map((it, i) => {
          const showSection = it.section && it.section !== lastSection
          lastSection = it.section
          return (
            <div key={it.id}>
              {showSection && <div className="menu-section">{it.section}</div>}
              <div
                data-index={i}
                role="option"
                aria-selected={i === active}
                className={cx('menu-item', i === active && 'active', it.disabled && 'disabled')}
                onMouseMove={() => !it.disabled && i !== active && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => !it.disabled && onSelect(it)}
              >
                {multi && <span className={cx('menu-check', it.selected && 'on')}>{it.selected && <Check size={11} strokeWidth={3} />}</span>}
                {it.icon && <span className="menu-icon">{it.icon}</span>}
                <span className="menu-label">{it.label}</span>
                {it.hint && <span className="menu-hint">{it.hint}</span>}
                {!multi && it.selected && <Check size={14} className="menu-selected" />}
              </div>
            </div>
          )
        })}
      </div>
      {footer}
    </div>
  )
}
