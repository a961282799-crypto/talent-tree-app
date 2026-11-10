import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeTool, systemPrompt, MAX_LIT_PER_TURN } from '../src/tutor.js'
import { buildSnapshot, emptyStore, goalsContaining, likelyDuplicates, mapDigest, mergeNodes, nameSimilarity } from '../src/graph.js'

const n = (id, name, pre = []) => ({ id, name, type: 'concept', summary: 's', hook: 'h', prerequisites: pre })
const now = 1_800_000_000_000
const run = (k, name, args, extra = {}) => executeTool(name, args, { knowledge: k, goals: [], now, ...extra })

function lagrangeMap() {
  let k = emptyStore()
  k = run(k, 'techtree_plan', { goal_id: 'lagrange', nodes: [n('limit', '极限'), n('derivative', '导数的定义', ['limit']), n('lagrange', '拉格朗日中值定理', ['derivative'])] }).knowledge
  k = run(k, 'techtree_record', { node_id: 'limit', level: 1, evidence: 'ok' }).knowledge
  k = run(k, 'techtree_record', { node_id: 'derivative', level: 2, evidence: 'ok' }).knowledge
  return k
}

test('names: different wordings of one idea score high, unrelated ones low', () => {
  assert.equal(nameSimilarity('导数的定义', '导数定义'), 1)
  assert.ok(nameSimilarity('连续性', '函数的连续性') >= 0.72)
  assert.ok(nameSimilarity('罗尔定理', '拉格朗日中值定理') < 0.5)
  assert.ok(nameSimilarity('矩阵乘法', '矩阵转置') < 0.5)
})

test('a second goal that words a learned point differently is told about the likely duplicate', () => {
  const k = lagrangeMap()
  const r = run(k, 'techtree_plan', { goal_id: 'taylor', nodes: [n('derivative_definition', '导数定义'), n('taylor', '泰勒公式', ['derivative_definition'])] })
  assert.match(r.text, /Possible duplicates/)
  assert.match(r.text, /derivative_definition "导数定义" -> derivative "导数的定义"/)
  assert.deepEqual(likelyDuplicates(r.knowledge, ['derivative_definition', 'taylor']).map(d => d.existingId), ['derivative'])
})

test('merging carries the learned level over, and the second tree lights up', () => {
  let k = lagrangeMap()
  let r = run(k, 'techtree_plan', { goal_id: 'taylor', nodes: [n('derivative_definition', '导数定义'), n('taylor', '泰勒公式', ['derivative_definition'])] })
  k = r.knowledge
  assert.equal(buildSnapshot(k, [{ id: 'taylor' }], now).nodes.find(x => x.name === '导数定义').mastery, 0)
  r = executeTool('techtree_merge', { from_id: 'derivative_definition', into_id: 'derivative', reason: 'same' }, { knowledge: k, goals: [{ id: 'taylor', name: '泰勒公式' }], now })
  assert.equal(r.display.type, 'merge')
  const tree = buildSnapshot(r.knowledge, [{ id: 'taylor' }], now).nodes
  assert.deepEqual(tree.map(x => [x.id, x.mastery]), [['limit', 1], ['derivative', 2], ['taylor', 0]])
  assert.equal(r.knowledge.nodes.derivative_definition, undefined)
  assert.ok(r.knowledge.nodes.derivative.aliases.includes('导数定义'))
  assert.deepEqual(goalsContaining(r.knowledge, 'derivative').map(g => g.id).sort(), ['lagrange', 'taylor'])
})

test('merge keeps the better mastery whichever way round, moves goals and refuses cycles', () => {
  let k = emptyStore()
  k = run(k, 'techtree_plan', { goal_id: 'b', nodes: [n('a', 'A'), n('b', 'B', ['a'])] }).knowledge
  k = run(k, 'techtree_plan', { goal_id: 'a2', nodes: [n('a2', 'A two')] }).knowledge
  k = run(k, 'techtree_record', { node_id: 'a2', level: 3, evidence: 'ok' }).knowledge
  const m = mergeNodes(k, 'a2', 'a')
  assert.equal(m.nodes.a.mastery, 3)
  assert.equal(m.goals.a2, undefined)
  assert.ok(m.goals.a)
  assert.throws(() => mergeNodes(k, 'a', 'b'), /prerequisite of the other/)
  assert.throws(() => mergeNodes(k, 'a', 'a'), /itself/)
  assert.throws(() => mergeNodes(k, 'nope', 'a'), /unknown/)
})

test('the model sees the knowledge map in its instructions', () => {
  const k = lagrangeMap()
  assert.match(mapDigest(k), /derivative · 导数的定义 · 2/)
  const prompt = systemPrompt(k)
  assert.match(prompt, /The learner's knowledge map/)
  assert.ok(prompt.indexOf('derivative · 导数的定义') > prompt.indexOf('Teaching'), 'map comes last so the fixed part stays cacheable')
  assert.match(systemPrompt(emptyStore()), /\(empty/)
})

test('lighting rules: only after the learner answers, one level per reply', () => {
  const k = lagrangeMap()
  const ctx = answered => ({ knowledge: k, goals: [], now, turn: { learnerAnswered: answered, raised: new Set() } })
  // An app button (no learner words yet) cannot light anything.
  let r = executeTool('techtree_record', { node_id: 'lagrange', level: 1, evidence: 'x' }, ctx(false))
  assert.match(r.text, /^Error: the learner has not answered/)
  assert.equal(r.knowledge, k)
  // ...but marking a node unlit is always allowed.
  r = executeTool('techtree_record', { node_id: 'limit', level: 0, evidence: 'forgot' }, ctx(false))
  assert.equal(r.knowledge.nodes.limit.mastery, 0)
  // Skipping levels is refused.
  r = executeTool('techtree_record', { node_id: 'lagrange', level: 3, evidence: 'x' }, ctx(true))
  assert.match(r.text, /at most one level/)
  // One step is fine, a second step for the same node in the same reply is not.
  const c = ctx(true)
  r = executeTool('techtree_record', { node_id: 'limit', level: 2, evidence: 'explained why' }, c)
  assert.equal(r.knowledge.nodes.limit.mastery, 2)
  r = executeTool('techtree_record', { node_id: 'limit', level: 3, evidence: 'x' }, { ...c, knowledge: r.knowledge })
  assert.match(r.text, /already went up a level/)
})

test('lighting rules: a skip-ahead answer can light a handful of points, not a whole tree', () => {
  let k = emptyStore()
  const nodes = Array.from({ length: 10 }, (_, i) => n(`p${i}`, `点${i}`, i ? [`p${i - 1}`] : []))
  k = run(k, 'techtree_plan', { goal_id: 'p9', nodes }).knowledge
  const turn = { learnerAnswered: true, raised: new Set() }
  let lit = 0
  for (let i = 0; i < 10; i++) {
    const r = executeTool('techtree_record', { node_id: `p${i}`, level: 1, evidence: 'ok' }, { knowledge: k, goals: [], now, turn })
    if (!r.text.startsWith('Error')) { k = r.knowledge; lit++ }
  }
  assert.equal(lit, MAX_LIT_PER_TURN)
})
