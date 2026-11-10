import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeTool, TOOLS, systemPrompt } from '../src/tutor.js'
import { emptyStore } from '../src/graph.js'
import { apiMessages, createAccumulator, createSSEParser } from '../src/ai.js'

const plan = {
  goal_id: 'rolle_theorem',
  nodes: [
    { id: 'derivative', name: '导数', type: 'concept', summary: '变化率', hook: '速度表指的是什么？', prerequisites: [] },
    { id: 'fermat_lemma', name: '费马引理', type: 'theorem', summary: '极值点导数为零', hook: '山顶为什么是平的？', prerequisites: ['derivative'] },
    { id: 'rolle_theorem', name: '罗尔定理', type: 'theorem', summary: '两端等高必有水平切线', hook: '$f(a)=f(b)$ 一定有平点吗？', prerequisites: ['fermat_lemma'] },
  ],
}

test('tools are exposed in OpenAI function format', () => {
  assert.deepEqual(TOOLS.map(t => t.function.name), ['techtree_plan', 'techtree_record', 'techtree_merge', 'techtree_view'])
  assert.equal(TOOLS[0].type, 'function')
  assert.ok(TOOLS[0].function.parameters.properties.nodes)
  assert.match(systemPrompt(), /techtree_plan/)
})

test('plan → record → view runs against the local map', () => {
  const now = 1_800_000_000_000
  const planned = executeTool('techtree_plan', plan, { knowledge: emptyStore(), goals: [], now })
  assert.equal(planned.display.type, 'plan')
  assert.equal(planned.display.added, 3)
  assert.deepEqual(planned.goals, [{ id: 'rolle_theorem', name: '罗尔定理' }])
  assert.equal(Object.keys(planned.knowledge.nodes).length, 3)
  assert.match(planned.text, /Learnable now.*derivative/)

  const lit = executeTool('techtree_record', { node_id: 'derivative', level: 2, evidence: '能用自己的话解释' }, { knowledge: planned.knowledge, goals: planned.goals, now })
  assert.deepEqual(lit.display, { type: 'record', id: 'derivative', name: '导数', level: 2, before: 0, weak: false })
  assert.equal(lit.knowledge.nodes.derivative.mastery, 2)

  const view = executeTool('techtree_view', {}, { knowledge: lit.knowledge, goals: lit.goals, now })
  assert.match(view.text, /Progress: 1\/3 lit/)
  assert.equal(view.knowledge, lit.knowledge)
})

test('tool errors come back as text for the model, map untouched', () => {
  const knowledge = emptyStore()
  const bad = executeTool('techtree_record', { node_id: 'nope', level: 1, evidence: 'x' }, { knowledge, goals: [], now: 1 })
  assert.match(bad.text, /^Error: unknown node/)
  assert.equal(bad.display.type, 'error')
  assert.equal(bad.knowledge, knowledge)
  const cycle = executeTool('techtree_plan', { goal_id: 'a', nodes: [{ id: 'a', name: 'A', type: 'concept', summary: '', hook: '', prerequisites: ['b'] }, { id: 'b', name: 'B', type: 'concept', summary: '', hook: '', prerequisites: ['a'] }] }, { knowledge, goals: [], now: 1 })
  assert.match(cycle.text, /cycle/)
})

test('re-planning a removed goal brings it back', () => {
  const first = executeTool('techtree_plan', plan, { knowledge: emptyStore(), goals: [], now: 1 })
  const hidden = { ...first.knowledge, hidden: ['rolle_theorem'] }
  const again = executeTool('techtree_plan', plan, { knowledge: hidden, goals: [], now: 2 })
  assert.deepEqual(again.knowledge.hidden, [])
})

test('SSE stream with split chunks folds into text and tool calls', () => {
  const acc = createAccumulator()
  const parser = createSSEParser(chunk => acc.add(chunk))
  const events = [
    { choices: [{ delta: { content: '好，' } }] },
    { choices: [{ delta: { content: '开始吧' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'techtree_view', arguments: '{"go' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'al_id":"x"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ]
  const text = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
  // Feed in awkward pieces, as a network would.
  for (let i = 0; i < text.length; i += 7) parser.push(text.slice(i, i + 7))
  parser.end()
  assert.equal(acc.message.content, '好，开始吧')
  assert.deepEqual(acc.message.toolCalls, [{ id: 'call_1', name: 'techtree_view', arguments: '{"goal_id":"x"}' }])
  assert.equal(acc.message.finishReason, 'tool_calls')
})

test('a non-streamed JSON reply is accepted too', () => {
  const acc = createAccumulator()
  acc.add({ choices: [{ message: { content: 'hi', tool_calls: [{ id: 'c', function: { name: 'techtree_view', arguments: '{}' } }] }, finish_reason: 'stop' }] })
  assert.equal(acc.message.content, 'hi')
  assert.equal(acc.message.toolCalls[0].name, 'techtree_view')
})

test('history sent to the model starts at a user turn and drops app-only fields', () => {
  const messages = [
    { role: 'user', content: 'a', at: 1 },
    { role: 'assistant', content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'techtree_view', arguments: '{}' } }], at: 2 },
    { role: 'tool', tool_call_id: '1', content: 'ok', display: { type: 'view' }, at: 3 },
    { role: 'assistant', content: 'b', at: 4 },
    { role: 'user', content: 'c', at: 5 },
    { role: 'error', content: 'oops', at: 6 },
    { role: 'assistant', content: 'd', at: 7 },
  ]
  const out = apiMessages(messages, 2)
  assert.equal(out[0].role, 'user')
  assert.equal(out[0].content, 'c')
  assert.ok(out.every(m => m.at === undefined && m.display === undefined))
  const all = apiMessages(messages, 100)
  assert.deepEqual(all[2], { role: 'tool', tool_call_id: '1', content: 'ok' })
  assert.ok(all.every(m => m.role !== 'error'))
})

test('reasoning is replayed only within the running tool exchange', async () => {
  const messages = [
    { role: 'user', content: 'old' },
    { role: 'assistant', content: 'a', reasoning: 'old thoughts' },
    { role: 'user', content: 'new' },
    { role: 'assistant', content: '', reasoning: 'thinking', tool_calls: [{ id: '1', type: 'function', function: { name: 'techtree_view', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: '1', content: 'ok' },
  ]
  const out = apiMessages(messages)
  assert.equal(out[1].reasoning_content, undefined)
  assert.equal(out[3].reasoning_content, 'thinking')
  const acc = createAccumulator()
  acc.add({ choices: [{ delta: { reasoning_content: '想' } }] })
  acc.add({ choices: [{ delta: { reasoning_content: '一想', content: '好' } }] })
  assert.equal(acc.message.reasoning, '想一想')
  assert.equal(acc.message.content, '好')
})

test('provider presets resolve to an address, key and model', async () => {
  const { activeAI, PROVIDERS } = await import('../src/providers.js')
  assert.equal(PROVIDERS[0].id, 'deepseek')
  assert.deepEqual(activeAI({ provider: 'deepseek', providers: {} }), { provider: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', visionModel: 'deepseek-v4-flash-vision-exp' })
  assert.equal(activeAI({ provider: 'glm', providers: { glm: { visionModel: 'my-vl' } } }).visionModel, 'my-vl')
  const kimi = activeAI({ provider: 'kimi', providers: { kimi: { apiKey: 'k', model: '' } } })
  assert.equal(kimi.baseUrl, 'https://api.moonshot.cn/v1')
  assert.equal(kimi.apiKey, 'k')
  const custom = activeAI({ provider: 'custom', providers: { custom: { apiKey: 'x', baseUrl: 'https://my.host/v1', model: 'm' } } })
  assert.deepEqual([custom.baseUrl, custom.model], ['https://my.host/v1', 'm'])
  assert.equal(activeAI({ provider: 'nope', providers: {} }).provider, 'deepseek')
})

test('settings from version 1.0 move into the DeepSeek slot', async () => {
  const { migrateSettings } = await import('../src/storage.js')
  const s = migrateSettings({ apiKey: 'sk-1', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' })
  assert.equal(s.provider, 'deepseek')
  assert.equal(s.language, 'system')
  assert.deepEqual(s.providers.deepseek, { apiKey: 'sk-1', model: '', baseUrl: '' })
  assert.equal(s.apiKey, undefined)
  const fresh = migrateSettings(null)
  assert.deepEqual(fresh.providers, {})
  const kept = migrateSettings({ provider: 'glm', language: 'en', providers: { glm: { apiKey: 'g' } } })
  assert.equal(kept.provider, 'glm')
  assert.equal(kept.language, 'en')
})

test('a network drop does not switch streaming off; a provider that blocks the WebView does', async () => {
  const { makePost } = await import('../src/ai.js')
  const calls = []
  let online = false
  const web = async url => { calls.push(`web ${url}`); if (!online || url.includes('cors')) throw new TypeError('Failed to fetch'); return { ok: true, via: 'web' } }
  const native = async url => { calls.push(`native ${url}`); if (!online) throw new TypeError('offline'); return { ok: true, via: 'native' } }
  const post = makePost(() => web, native)

  // Offline: both fail, so nothing is learned about the provider.
  await assert.rejects(post('https://a.example/v1/chat/completions', {}))
  online = true
  assert.equal((await post('https://a.example/v1/chat/completions', {})).via, 'web')

  // A provider without CORS: the native fetch gets through, and that address skips the WebView afterwards.
  assert.equal((await post('https://cors.example/v1/chat/completions', {})).via, 'native')
  calls.length = 0
  assert.equal((await post('https://cors.example/v1/chat/completions', {})).via, 'native')
  assert.deepEqual(calls, ['native https://cors.example/v1/chat/completions'])
  // Other providers still stream.
  assert.equal((await post('https://a.example/v1/chat/completions', {})).via, 'web')
})

test('an error reply from the native fetch does not mark the provider as blocked', async () => {
  const { makePost } = await import('../src/ai.js')
  let key = 'bad'
  const web = async () => { if (key === 'bad') throw new TypeError('Failed to fetch'); return { ok: true, via: 'web' } }
  const native = async () => (key === 'bad' ? { ok: false, status: 401, via: 'native' } : { ok: true, via: 'native' })
  const post = makePost(() => web, native)
  assert.equal((await post('https://a.example/x', {})).status, 401)
  key = 'good'
  assert.equal((await post('https://a.example/x', {})).via, 'web')
})

test('an aborted request is not retried', async () => {
  const { makePost } = await import('../src/ai.js')
  let nativeCalls = 0
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
  const post = makePost(() => async () => { throw abort }, async () => { nativeCalls++; return { ok: true } })
  await assert.rejects(post('https://a.example/x', {}), { name: 'AbortError' })
  assert.equal(nativeCalls, 0)
})

test('import files are checked before anything is replaced', async () => {
  const { parseImport, importData, getState, setKnowledge } = await import('../src/storage.js')
  const exported = { app: 'talent-tree', version: 1, knowledge: { nodes: { a: { id: 'a', name: 'A', prerequisites: [] } } } }
  assert.deepEqual(Object.keys(parseImport(exported).nodes), ['a'])
  for (const bad of [null, {}, { nodes: null }, { nodes: [] }, { knowledge: { nodes: { x: { name: 'no id' } } } }]) {
    assert.throws(() => parseImport(bad))
  }
  const before = { version: 1, nodes: { keep: { id: 'keep', name: 'Keep', prerequisites: [] } } }
  setKnowledge(before)
  // Checking alone changes nothing.
  parseImport(exported)
  assert.equal(getState().knowledge, before)
  assert.throws(() => importData({ nodes: [] }))
  assert.equal(getState().knowledge, before)
  assert.equal(importData(exported), 1)
  assert.deepEqual(Object.keys(getState().knowledge.nodes), ['a'])
})
