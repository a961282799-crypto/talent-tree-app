/**
 * In-app dialogs (confirm, prompt, choose one of several actions), drawn by
 * <DialogHost> in the app's own style instead of the browser's window.confirm.
 * The Android back button closes an open dialog like Cancel.
 */
import { useSyncExternalStore } from 'react'
import { t } from './i18n.js'

let current = null
const listeners = new Set()
const emit = () => listeners.forEach(fn => fn())
const subscribe = fn => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The dialog to show, or null. */
export function useDialog() {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

/**
 * Show a dialog.
 * @param {{ title?: string, message?: string, input?: { value?: string, placeholder?: string, label?: string },
 *   actions: { id: any, label: string, primary?: boolean, danger?: boolean }[] }} spec
 * @returns {Promise<{ action: any, text: string } | null>} the chosen action (null when dismissed)
 */
export function openDialog(spec) {
  current?.resolve(null)
  return new Promise(resolve => {
    current = { ...spec, resolve, key: Date.now() }
    emit()
  })
}

/** Close the open dialog with a result (null = dismissed). */
export function closeDialog(result) {
  const open = current
  current = null
  emit()
  open?.resolve(result)
}

/** Ask a yes/no question. `danger` styles the OK button for actions that delete something. */
export async function confirmDialog(message, { title, ok, danger = false } = {}) {
  const result = await openDialog({
    title,
    message,
    actions: [
      { id: false, label: t('common.cancel') },
      { id: true, label: ok || t('common.ok'), primary: !danger, danger },
    ],
  })
  return result?.action === true
}

/** Ask for a line of text. Resolves to the text, or null when cancelled. */
export async function promptDialog({ title, message, value = '', placeholder = '', ok } = {}) {
  const result = await openDialog({
    title,
    message,
    input: { value, placeholder },
    actions: [
      { id: false, label: t('common.cancel') },
      { id: true, label: ok || t('common.ok'), primary: true },
    ],
  })
  return result?.action === true ? result.text : null
}
