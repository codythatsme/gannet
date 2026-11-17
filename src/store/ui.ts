import { create } from 'zustand'
import type { StatusType } from '../domain/types'

export type PickerKind = 'status' | 'priority' | 'assignee' | 'labels' | 'sprint' | 'project' | 'estimate' | 'dueDate' | 'parent'

export interface PickerState {
  kind: PickerKind
  issueIds: string[]
  /** Anchor element rect; when absent the picker opens centered (keyboard). */
  anchor?: { x: number; y: number; w: number; h: number }
}

export interface CreateDraft {
  teamKey?: string
  typeId?: string
  statusId?: string
  statusType?: StatusType
  priorityId?: string
  assigneeId?: string
  labels?: string[]
  sprintId?: number
  parentKey?: string
  parentTitle?: string
}

export interface Toast {
  id: number
  kind: 'info' | 'error' | 'success'
  message: string
  action?: { label: string; run: () => void }
}

interface UiState {
  /** Ordered ids of the list currently on screen (for j/k and detail prev/next). */
  navList: string[]
  navLabel: string
  focusedId: string | null
  selected: Set<string>
  paletteOpen: boolean
  palettePage: 'root' | 'issues'
  picker: PickerState | null
  create: CreateDraft | null
  help: boolean
  confirm: { title: string; body?: string; confirmLabel: string; danger?: boolean; run: () => void } | null
  toasts: Toast[]
  sidebarCollapsed: boolean
}

export const useUi = create<UiState>(() => ({
  navList: [],
  navLabel: '',
  focusedId: null,
  selected: new Set(),
  paletteOpen: false,
  palettePage: 'root',
  picker: null,
  create: null,
  help: false,
  confirm: null,
  toasts: [],
  sidebarCollapsed: false,
}))

export const ui = () => useUi.getState()
export const setUi = useUi.setState

let toastId = 1
export function toast(message: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const t: Toast = { id: toastId++, kind, message, action }
  setUi({ toasts: [...ui().toasts.slice(-3), t] })
  setTimeout(() => dismissToast(t.id), kind === 'error' ? 7000 : 3500)
}
export function dismissToast(id: number) {
  setUi({ toasts: ui().toasts.filter((t) => t.id !== id) })
}

/** Issues an action applies to: the selection if any, else the focused issue. */
export function targetIds(): string[] {
  const { selected, focusedId } = ui()
  if (selected.size) return [...selected]
  return focusedId ? [focusedId] : []
}

export function toggleSelected(id: string) {
  const next = new Set(ui().selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  setUi({ selected: next })
}

export function clearSelection() {
  if (ui().selected.size) setUi({ selected: new Set() })
}

export function openPicker(kind: PickerKind, issueIds = targetIds(), anchorEl?: Element | null) {
  if (!issueIds.length) return
  const r = anchorEl?.getBoundingClientRect()
  setUi({ picker: { kind, issueIds, anchor: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : undefined }, paletteOpen: false })
}

export function confirmAction(c: NonNullable<UiState['confirm']>) {
  setUi({ confirm: c })
}
