import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLibrary, buildSnapshot, describeSnapshot, emptyStore, findCycle, goalsOf, isFading, mergePlan, nodeState, recordMastery, rememberGoal, validatePlan,
} from '../src/graph.js'

const lagrange = {
  goal_id: 'lagrange_mvt',
  nodes: [
    { id: 'limit', name: '极限', type: 'concept', summary: '', prerequisites: [] },
    { id: 'continuity', name: '连续性', type: 'concept', summary: '', prerequisites: ['limit'] },
    { id: 'derivative', name: '导数的定义', type: 'concept', summary: '', prerequisites: ['limit'] },
    { id: 'extreme_value_theorem', name: '最值定理', type: 'theorem', summary: '', prerequisites: ['continuity'] },
    { id: 'fermat_lemma', name: '费马引理', type: 'theorem', summary: '', prerequisites: ['derivative'] },
    { id: 'rolle_theorem', name: '罗尔定理', type: 'theorem', summary: '', prerequisites: ['fermat_lemma', 'extreme_value_theorem'] },
    { id: 'auxiliary_function', name: '构造辅助函数', type: 'method', summary: '', prerequisites: [] },
    { id: 'lagrange_mvt', name: '拉格朗日中值定理', type: 'theorem', summary: '', prerequisites: ['rolle_theorem', 'auxiliary_function'], est_minutes: 40 },
  ],
}

test('validatePlan accepts a well-formed plan and rejects bad ones', () => {
  const plan = validatePlan(lagrange)
  assert.equal(plan.goal.name, '拉格朗日中值定理')
  assert.equal(plan.nodes.length, 8)
  assert.throws(() => validatePlan({ ...lagrange, goal_id: 'Bad Id' }), /lower_snake_case/)
  assert.throws(() => validatePlan({ ...lagrange, goal_id: 'missing' }), /must itself appear/)
  assert.throws(() => validatePlan({ goal_id: 'a', nodes: [{ id: 'a', name: 'A', type: 'nope', prerequisites: [] }] }), /type must be/)
  assert.throws(() => validatePlan({ goal_id: 'a', nodes: [{ id: 'a', name: 'A', prerequisites: ['a'] }] }), /itself/)
})

test('mergePlan builds the DAG, rejects unknown prerequisites and cycles', () => {
  const { store, added } = mergePlan(emptyStore(), validatePlan(lagrange))
  assert.equal(added.length, 8)
  assert.equal(findCycle(store.nodes), undefined)
  assert.throws(() => mergePlan(emptyStore(), validatePlan({ goal_id: 'a', nodes: [{ id: 'a', name: 'A', prerequisites: ['ghost'] }] })), /unknown prerequisite/)
  const cyclic = validatePlan({ goal_id: 'limit', nodes: [{ id: 'limit', name: '极限', prerequisites: ['lagrange_mvt'] }] })
  assert.throws(() => mergePlan(store, cyclic), /cycle/)
})

test('a second goal reuses nodes by id and by name and keeps mastery', () => {
  let { store } = mergePlan(emptyStore(), validatePlan(lagrange))
  store = recordMastery(store, { node_id: 'derivative', level: 2, evidence: 'explained the difference quotient' }, 1000)
  const taylor = validatePlan({
    goal_id: 'taylor',
    nodes: [
      { id: 'derivative_def', name: '导数的定义 ', type: 'concept', prerequisites: [] }, // same name, new id
      { id: 'lagrange_mvt', name: '拉格朗日中值定理', type: 'theorem', prerequisites: [] },
      { id: 'taylor', name: '泰勒公式', type: 'theorem', prerequisites: ['derivative_def', 'lagrange_mvt'] },
    ],
  })
  const merged = mergePlan(store, taylor)
  assert.deepEqual(merged.remapped, { derivative_def: 'derivative' })
  assert.deepEqual(merged.store.nodes.taylor.prerequisites, ['derivative', 'lagrange_mvt'])
  assert.equal(merged.store.nodes.derivative.mastery, 2)
  assert.deepEqual(merged.added, ['taylor'])
  // The existing goal keeps its original prerequisites (union, not replace).
  assert.deepEqual(merged.store.nodes.lagrange_mvt.prerequisites, ['rolle_theorem', 'auxiliary_function'])
})

test('mergePlan does not mutate its input store', () => {
  const { store } = mergePlan(emptyStore(), validatePlan(lagrange))
  const before = JSON.stringify(store)
  mergePlan(store, validatePlan({ goal_id: 'x', nodes: [{ id: 'x', name: 'X', prerequisites: ['limit'] }] }))
  assert.equal(JSON.stringify(store), before)
})

test('snapshot states: lit, available frontier, locked; fading and weak', () => {
  let { store } = mergePlan(emptyStore(), validatePlan(lagrange))
  const day = 86_400_000
  store = recordMastery(store, { node_id: 'limit', level: 1, evidence: 'ok' }, 0)
  store = recordMastery(store, { node_id: 'continuity', level: 3, weak: true, evidence: 'gap on one-sided limits' }, 0)
  const snap = buildSnapshot(store, [{ id: 'lagrange_mvt', name: '' }], 5 * day)
  assert.equal(snap.goals[0].name, '拉格朗日中值定理')
  // prerequisite-first ordering
  const order = snap.nodes.map(n => n.id)
  for (const n of snap.nodes) for (const p of n.prerequisites) assert.ok(order.indexOf(p) < order.indexOf(n.id))
  const byId = Object.fromEntries(snap.nodes.map(n => [n.id, n]))
  assert.equal(nodeState(byId.limit, byId), 'lit')
  assert.equal(nodeState(byId.derivative, byId), 'available')
  assert.equal(nodeState(byId.extreme_value_theorem, byId), 'available')
  assert.equal(nodeState(byId.rolle_theorem, byId), 'locked')
  assert.equal(nodeState(byId.auxiliary_function, byId), 'available')
  assert.equal(isFading(byId.limit, 5 * day), true) // bronze fades after 3 days
  assert.equal(isFading(byId.continuity, 5 * day), false) // gold lasts 21 days
  assert.equal(byId.continuity.weak, true)
  const text = describeSnapshot(snap, 5 * day)
  assert.match(text, /Progress: 2\/8 lit/)
  assert.match(text, /Learnable now .*derivative/)
  assert.match(text, /FADING/)
  assert.match(text, /WEAK/)
})

test('recordMastery validates input', () => {
  const { store } = mergePlan(emptyStore(), validatePlan(lagrange))
  assert.throws(() => recordMastery(store, { node_id: 'nope', level: 1, evidence: 'x' }, 0), /unknown node/)
  assert.throws(() => recordMastery(store, { node_id: 'limit', level: 5, evidence: 'x' }, 0), /0-3/)
  assert.throws(() => recordMastery(store, { node_id: 'limit', level: 1 }, 0), /evidence/)
})

test('goalsOf prefers remembered goals and infers them for older maps', () => {
  const merged = mergePlan(emptyStore(), validatePlan(lagrange))
  // Older map: no goal list, so the node nothing depends on is the goal.
  assert.deepEqual(goalsOf(merged.store).map(g => g.id), ['lagrange_mvt'])
  const withGoals = rememberGoal(rememberGoal(merged.store, { id: 'rolle_theorem', name: '罗尔定理' }, 1), merged.goal, 2)
  assert.deepEqual(goalsOf(withGoals).map(g => g.id), ['lagrange_mvt', 'rolle_theorem'])
  const lib = buildLibrary(withGoals, 10)
  assert.equal(lib.goals[0].nodes.length, 8)
  assert.equal(lib.goals[1].nodes.length, 6) // rolle and its prerequisites
})

test('hooks are trimmed, capped and merged', () => {
  const plan = validatePlan({ goal_id: 'a', nodes: [{ id: 'a', name: 'A', prerequisites: [], hook: '  ' + 'x'.repeat(300) }] })
  assert.equal(plan.nodes[0].hook.length, 160)
  const first = mergePlan(emptyStore(), validatePlan({ goal_id: 'a', nodes: [{ id: 'a', name: 'A', prerequisites: [] }] })).store
  assert.equal(first.nodes.a.hook, undefined)
  const second = mergePlan(first, validatePlan({ goal_id: 'a', nodes: [{ id: 'a', name: 'A', prerequisites: [], hook: '为什么？' }] })).store
  assert.equal(second.nodes.a.hook, '为什么？')
  assert.equal(buildSnapshot(second, [{ id: 'a', name: 'A' }], 0).nodes[0].hook, '为什么？')
})

test('re-planning a node under its own id renames it and keeps the old name as an alias', () => {
  const first = mergePlan(emptyStore(), validatePlan({ goal_id: 'scale', nodes: [{ id: 'scale', name: '缩放因子 1/√d_k', summary: '旧', prerequisites: [] }] })).store
  const second = mergePlan(first, validatePlan({ goal_id: 'scale', nodes: [{ id: 'scale', name: '缩放因子 $\\frac{1}{\\sqrt{d_k}}$', summary: '新 $d_k$', prerequisites: [] }] })).store
  assert.equal(second.nodes.scale.name, '缩放因子 $\\frac{1}{\\sqrt{d_k}}$')
  assert.equal(second.nodes.scale.summary, '新 $d_k$')
  assert.deepEqual(second.nodes.scale.aliases, ['缩放因子 1/√d_k'])
})

test('glossary is cleaned and merged; view flags plain formulas and missing glossaries', () => {
  const plan = validatePlan({ goal_id: 's', nodes: [{ id: 's', name: '缩放因子', summary: '除以 $\\sqrt{d_k}$', prerequisites: [],
    glossary: [{ term: '$d_k$', meaning: '每个向量里有多少个数，常见是 64' }, { term: '', meaning: 'x' }, 'bad'] }] })
  assert.deepEqual(plan.nodes[0].glossary, [{ term: '$d_k$', meaning: '每个向量里有多少个数，常见是 64' }])
  const store = mergePlan(emptyStore(), plan).store
  const kept = mergePlan(store, validatePlan({ goal_id: 's', nodes: [{ id: 's', name: '缩放因子', summary: '除以 $\\sqrt{d_k}$', prerequisites: [] }] })).store
  assert.equal(kept.nodes.s.glossary.length, 1, 'a re-plan without glossary keeps the old one')
  const snap = buildSnapshot(kept, [{ id: 's', name: '缩放因子' }], 0)
  assert.equal(snap.nodes[0].glossary[0].term, '$d_k$')
  const old = mergePlan(emptyStore(), validatePlan({ goal_id: 'p', nodes: [{ id: 'p', name: '概率', summary: '理解缩放因子 1/√d_k 需要方差', prerequisites: [] }] })).store
  const text = describeSnapshot(buildSnapshot(old, [{ id: 'p', name: '概率' }], 0), 0)
  assert.match(text, /plain-math/)
  const noGloss = mergePlan(emptyStore(), validatePlan({ goal_id: 'q', nodes: [{ id: 'q', name: 'Q', summary: '$x^2$', prerequisites: [] }] })).store
  assert.match(describeSnapshot(buildSnapshot(noGloss, [{ id: 'q', name: 'Q' }], 0), 0), /no-glossary/)
  assert.doesNotMatch(describeSnapshot(snap, 0), /plain-math|no-glossary/)
})
