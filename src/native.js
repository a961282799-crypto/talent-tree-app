/**
 * Thin wrappers over native phone features, each with a browser fallback so
 * the app also runs in a desktop browser during development.
 */
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

export const isNative = Capacitor.isNativePlatform()
export const platform = Capacitor.getPlatform()

/** A short vibration: 'light' | 'medium' | 'heavy' | 'success'. */
export function buzz(kind = 'light') {
  if (!isNative) return
  const run = kind === 'success'
    ? Haptics.notification({ type: NotificationType.Success })
    : Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light })
  run.catch(() => {})
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Hand a generated file to the learner: the system share sheet on phones
 * (save to Photos / Files, send to a chat app…), a download in browsers.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function saveFile(blob, name, mime) {
  if (isNative) {
    const safe = name.replace(/[\\/:*?"<>|\s]+/g, '-')
    const written = await Filesystem.writeFile({ path: safe, data: await blobToBase64(blob), directory: Directory.Cache })
    try {
      await Share.share({ title: name, files: [written.uri], dialogTitle: name })
      return 'shared'
    } catch (error) {
      if (/cancel/i.test(String(error?.message ?? error))) return 'cancelled'
      throw error
    }
  }
  const url = URL.createObjectURL(new Blob([blob], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 15000)
  return 'downloaded'
}

/** Ask a yes/no question. */
export function confirmAction(message) {
  return Promise.resolve(window.confirm(message))
}
