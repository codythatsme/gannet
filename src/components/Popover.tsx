import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { trackPopover } from '../app/hotkeys'
import { cx } from '../lib/cx'

export type Rect = { x: number; y: number; w: number; h: number }

// Escape closes only the topmost layer (a picker inside the create modal, say).
const layers: { close: () => void }[] = []
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !layers.length) return
      e.preventDefault()
      e.stopPropagation()
      layers[layers.length - 1].close()
    },
    true,
  )
}

function useLayer(onClose: () => void) {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    const layer = { close: () => ref.current() }
    layers.push(layer)
    return () => {
      const i = layers.indexOf(layer)
      if (i >= 0) layers.splice(i, 1)
    }
  }, [])
}

export function rectOf(el: Element | null | undefined): Rect | undefined {
  const r = el?.getBoundingClientRect()
  return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : undefined
}

/** A floating panel anchored below (or above) a rect. Closes on outside click and Escape. */
export function Popover({
  anchor,
  onClose,
  children,
  width = 260,
  align = 'start',
  className,
}: {
  anchor: Rect
  onClose: () => void
  children: ReactNode
  width?: number
  align?: 'start' | 'end'
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const h = el.offsetHeight
    const below = vh - (anchor.y + anchor.h) - 12
    const above = anchor.y - 12
    const placeBelow = below >= Math.min(h, 320) || below >= above
    const maxHeight = Math.max(160, placeBelow ? below : above)
    const top = placeBelow ? anchor.y + anchor.h + 4 : Math.max(8, anchor.y - 4 - Math.min(h, maxHeight))
    let left = align === 'end' ? anchor.x + anchor.w - width : anchor.x
    left = Math.max(8, Math.min(left, vw - width - 8))
    setPos({ left, top, maxHeight })
  }, [anchor.x, anchor.y, anchor.w, anchor.h, width, align])

  useLayer(onClose)
  useEffect(() => {
    trackPopover(true)
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // Defer so the click that opened us doesn't close us.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => {
      trackPopover(false)
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className={cx('popover', className)}
      style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: pos?.maxHeight, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}

/** Centered modal surface with a dimmed backdrop. */
export function Modal({ onClose, children, className, top = '14vh' }: { onClose: () => void; children: ReactNode; className?: string; top?: string }) {
  useLayer(onClose)
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('modal', className)} style={{ marginTop: top }} role="dialog" aria-modal>
        {children}
      </div>
    </div>,
    document.body,
  )
}
