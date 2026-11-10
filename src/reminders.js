/**
 * The daily review reminder: one local notification at the learner's chosen
 * time on the next day that has points to review. It is rescheduled whenever
 * the knowledge map or the setting changes, so it always reflects what is due.
 */
import { LocalNotifications } from '@capacitor/local-notifications'
import { isFading, nextReviewAt } from './graph.js'
import { fill, t } from './i18n.js'

const ID = 1001
const DAY = 86_400_000

/** "20:00" → [20, 0]; anything invalid falls back to 20:00. */
export function parseTime(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? ''))
  const hours = m ? Number(m[1]) : 20
  const minutes = m ? Number(m[2]) : 0
  return hours < 24 && minutes < 60 ? [hours, minutes] : [20, 0]
}

/** Points that need review at `at`: weak ones, and lit ones whose wait is over. */
export function dueAt(nodes, at) {
  return nodes.filter(n => n.weak || isFading(n, at))
}

/**
 * When to remind, and about how many points: the first daily slot after `now`
 * at which something is due. Null when nothing will ever be due.
 * @param {object[]} nodes - the knowledge map's points
 * @returns {{ at: number, count: number } | null}
 */
export function planReminder(nodes, time, now) {
  const [hours, minutes] = parseTime(time)
  const slot = new Date(now)
  slot.setHours(hours, minutes, 0, 0)
  if (slot.getTime() <= now) slot.setDate(slot.getDate() + 1)
  let count = dueAt(nodes, slot.getTime()).length
  if (count === 0) {
    const upcoming = nodes.map(nextReviewAt).filter(at => at !== null && at > slot.getTime())
    if (upcoming.length === 0) return null
    const first = Math.min(...upcoming)
    // The first slot strictly after that point fades.
    while (slot.getTime() <= first) slot.setDate(slot.getDate() + 1)
    count = dueAt(nodes, slot.getTime()).length
  }
  return count > 0 && slot.getTime() - now < 400 * DAY ? { at: slot.getTime(), count } : null
}

/** Ask for permission to notify. Resolves true when granted. */
export async function requestReminderPermission() {
  try {
    const status = await LocalNotifications.checkPermissions()
    if (status.display === 'granted') return true
    return (await LocalNotifications.requestPermissions()).display === 'granted'
  } catch {
    return false
  }
}

/** Schedule (or cancel) the reminder for the current map and settings. Phones only; never throws. */
export async function syncReminder(knowledge, settings) {
  try {
    await LocalNotifications.cancel({ notifications: [{ id: ID }] })
    if (!settings?.reminder?.enabled) return
    const plan = planReminder(Object.values(knowledge.nodes ?? {}), settings.reminder.time, Date.now())
    if (!plan) return
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return
    await LocalNotifications.schedule({
      notifications: [{
        id: ID,
        title: t('reminder.title'),
        body: fill(t('reminder.body'), { n: plan.count }),
        schedule: { at: new Date(plan.at), allowWhileIdle: true },
        // A reminder can be a few minutes late: no exact-alarm permission needed.
        isExactNotification: false,
        smallIcon: 'ic_stat_tree',
        iconColor: '#c8834c',
      }],
    })
  } catch {}
}
