import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyStore, isFading, mergePlan, nextReviewAt, recordMastery, reviewIntervalDays, validatePlan } from '../src/graph.js'
import { planReminder, parseTime } from '../src/reminders.js'

const DAY = 86_400_000
const plan = validatePlan({ goal_id: 'b', nodes: [
  { id: 'a', name: 'A', type: 'concept', summary: 's', hook: 'h', prerequisites: [] },
  { id: 'b', name: 'B', type: 'concept', summary: 's', hook: 'h', prerequisites: ['a'] },
] })
const start = () => mergePlan(emptyStore(), plan).store
const rec = (store, level, at, extra = {}) => recordMastery(store, { node_id: 'a', level, evidence: 'said so', ...extra }, at)

test('reviews on time stretch the wait; early re-checks, new levels and gaps do not', () => {
  let s = rec(start(), 3, 0)
  assert.equal(reviewIntervalDays(s.nodes.a), 21)
  assert.equal(nextReviewAt(s.nodes.a), 21 * DAY)
  // Re-checked the next day: too early to count.
  s = rec(s, 3, 1 * DAY)
  assert.equal(s.nodes.a.reviews, undefined)
  // Reviewed when due: the wait doubles, again and again, up to 16×.
  let at = 1 * DAY
  for (const expected of [42, 84, 168, 336, 336]) {
    at += reviewIntervalDays(s.nodes.a) * DAY
    s = rec(s, 3, at)
    assert.equal(reviewIntervalDays(s.nodes.a), expected)
  }
  assert.equal(isFading(s.nodes.a, at + 335 * DAY), false)
  assert.equal(isFading(s.nodes.a, at + 337 * DAY), true)
  // A gap resets it.
  s = rec(s, 3, at + 400 * DAY, { weak: true })
  assert.equal(reviewIntervalDays(s.nodes.a), 21)
  // So does a new level.
  let t = rec(start(), 1, 0)
  t = rec(t, 1, 3 * DAY)
  assert.equal(reviewIntervalDays(t.nodes.a), 6)
  t = rec(t, 2, 10 * DAY)
  assert.equal(reviewIntervalDays(t.nodes.a), 7)
})

test('the reminder goes off at the chosen time on the first day with something due', () => {
  const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime()
  const lit = (reviewedAt, mastery = 1) => ({ id: `n${reviewedAt}`, mastery, reviewedAt, prerequisites: [] })
  // Due already: tonight at 20:00.
  assert.deepEqual(planReminder([lit(at(1, 9))], '20:00', at(10, 9)), { at: at(10, 20), count: 1 })
  // After 20:00: tomorrow.
  assert.equal(planReminder([lit(at(1, 9))], '20:00', at(10, 21)).at, at(11, 20))
  // Due in four days at 9:00: that evening, not earlier.
  const later = planReminder([lit(at(10, 9))], '20:00', at(10, 10))
  assert.equal(later.at, at(13, 20))
  assert.equal(later.count, 1)
  // Weak points count right away; nothing lit means no reminder.
  assert.equal(planReminder([{ id: 'w', mastery: 0, weak: true, prerequisites: [] }], '07:30', at(10, 6)).at, at(10, 7, 30))
  assert.equal(planReminder([{ id: 'x', mastery: 0, prerequisites: [] }], '20:00', at(10, 6)), null)
  assert.deepEqual(parseTime('bad'), [20, 0])
  assert.deepEqual(parseTime('7:05'), [7, 5])
})
