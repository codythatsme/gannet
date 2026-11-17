import { useEffect, useRef } from 'react'
import { ui } from '../store/ui'

// Keyboard handling. Combos are written as [mod+][alt+][shift+]key, where `mod` is ⌘ on
// macOS and Ctrl elsewhere, and key is a lowercase letter/digit, punctuation or a key name
// (enter, escape, arrowdown, backspace...). Two-key sequences are written "g i".

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const CODE_KEYS: Record<string, string> = {
  Period: '.', Slash: '/', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
}

export function comboOf(e: KeyboardEvent): string {
  let key: string
  if (e.code.startsWith('Key')) key = e.code.slice(3).toLowerCase()
  else if (e.code.startsWith('Digit')) key = e.code.slice(5)
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code]
  else key = e.key.toLowerCase()
  const mod = isMac ? e.metaKey : e.ctrlKey
  return `${mod ? 'mod+' : ''}${e.altKey ? 'alt+' : ''}${e.shiftKey ? 'shift+' : ''}${key}`
}

export function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

let popovers = 0
/** Popovers (filter/display menus) count as overlays while open. */
export function trackPopover(open: boolean) {
  popovers = Math.max(0, popovers + (open ? 1 : -1))
}

export function overlayOpen() {
  const s = ui()
  return popovers > 0 || s.paletteOpen || !!s.picker || !!s.create || s.help || !!s.confirm
}

let seqKey = ''
let seqAt = 0

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void | boolean>

/**
 * Register hotkeys while mounted. Handlers don't fire while typing in a field or while an
 * overlay is open, unless `always` is set. Return false from a handler to let the event through.
 */
export function useHotkeys(map: HotkeyMap, opts: { always?: boolean; enabled?: boolean } = {}) {
  const ref = useRef(map)
  ref.current = map
  const { always = false, enabled = true } = opts
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      if (!always && (isTyping(e.target) || overlayOpen())) return
      const combo = comboOf(e)
      const now = Date.now()
      const seq = seqKey && now - seqAt < 1000 ? `${seqKey} ${combo}` : ''
      const handler = (seq && ref.current[seq]) || ref.current[combo]
      if (handler) {
        if (handler(e) === false) return
        e.preventDefault()
        e.stopPropagation()
        seqKey = ''
        return
      }
      // Remember a possible sequence prefix (only plain single keys).
      if (/^[a-z]$/.test(combo) && Object.keys(ref.current).some((k) => k.startsWith(combo + ' '))) {
        seqKey = combo
        seqAt = now
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [always, enabled])
}

/** Render a combo for display: "mod+shift+." -> ["⌘", "⇧", "."] */
export function comboLabel(combo: string): string[] {
  return combo.split(' ').flatMap((part, i) => [
    ...(i > 0 ? ['then'] : []),
    ...part.split('+').map((k) =>
      k === 'mod' ? (isMac ? '⌘' : 'Ctrl') : k === 'shift' ? '⇧' : k === 'alt' ? (isMac ? '⌥' : 'Alt') : k === 'enter' ? '↵' : k === 'backspace' ? '⌫' : k === 'escape' ? 'Esc' : k === 'arrowup' ? '↑' : k === 'arrowdown' ? '↓' : k.length === 1 ? k.toUpperCase() : k,
    ),
  ])
}
