import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phoneBackends } from './helpers.js'
import * as storage from '../src/storage.js'

const node = (id, extra = {}) => ({ id, name: id.toUpperCase(), type: 'concept', summary: '', prerequisites: [], ...extra })

test('data from version 1.1 moves from Preferences to files, and API keys to the secure store', async () => {
  const chat = { id: 'c1', title: 'x', goals: [], messages: [{ role: 'user', content: 'hi' }], createdAt: 1, updatedAt: 1 }
  const b = phoneBackends({
    prefs: {
      'tt.settings.v1': JSON.stringify({ provider: 'deepseek', providers: { deepseek: { apiKey: 'sk-old', model: '' }, qwen: { apiKey: 'qw' } } }),
      'tt.knowledge.v1': JSON.stringify({ version: 1, nodes: { a: node('a') } }),
      'tt.chats.v1': JSON.stringify(['c1']),
      'tt.chat.c1': JSON.stringify(chat),
    },
  })
  storage.setBackend(b)
  await storage.loadState()
  await storage.flush()
  const s = storage.getState()
  assert.deepEqual(Object.keys(s.knowledge.nodes), ['a'])
  assert.equal(s.chats.c1.messages[0].content, 'hi')
  assert.equal(s.settings.providers.deepseek.apiKey, 'sk-old', 'the key is still usable in memory')
  // Moved: files hold the map and chats; Preferences no longer do.
  assert.ok(b.files.map.has('tt.knowledge.v1') && b.files.map.has('tt.chat.c1') && b.files.map.has('tt.chats.v1'))
  assert.ok(!b.prefs.map.has('tt.knowledge.v1') && !b.prefs.map.has('tt.chat.c1'))
  // Keys live only in the secure store.
  assert.equal(b.secrets.map.get('apikey.deepseek'), 'sk-old')
  assert.equal(b.secrets.map.get('apikey.qwen'), 'qw')
  assert.doesNotMatch(b.prefs.map.get('tt.settings.v1'), /sk-old|"qw"/)

  // Next start: everything comes back from the new places.
  storage.setBackend(b)
  await storage.loadState()
  assert.equal(storage.getState().settings.providers.deepseek.apiKey, 'sk-old')
  assert.equal(storage.getState().chats.c1.id, 'c1')
})

test('editing a key writes it to the secure store only; the last keystroke wins', async () => {
  const b = phoneBackends()
  storage.setBackend(b)
  await storage.loadState()
  for (const value of ['s', 'sk', 'sk-1']) storage.updateProvider('kimi', { apiKey: value })
  await storage.flush()
  assert.equal(b.secrets.map.get('apikey.kimi'), 'sk-1')
  assert.doesNotMatch(b.prefs.map.get('tt.settings.v1'), /sk-1/)
  storage.updateProvider('kimi', { apiKey: '' })
  await storage.flush()
  assert.equal(b.secrets.map.has('apikey.kimi'), false)
})

test('when the secure store fails, keys stay with the settings instead of being lost', async () => {
  const b = phoneBackends({ failSecrets: true })
  storage.setBackend(b)
  await storage.loadState()
  storage.updateProvider('deepseek', { apiKey: 'sk-keep' })
  await storage.flush()
  assert.match(b.prefs.map.get('tt.settings.v1'), /sk-keep/)
})

test('a failed write is reported', async () => {
  const b = phoneBackends({ failFiles: true })
  storage.setBackend(b)
  await storage.loadState()
  const errors = []
  const off = storage.onSaveError(e => errors.push(e.message))
  storage.setKnowledge({ version: 1, nodes: { a: node('a') } })
  await storage.flush()
  off()
  assert.deepEqual(errors, ['disk full'])
})

test('backups hold the map and chats, never keys; import can replace or merge', async () => {
  const b = phoneBackends()
  storage.setBackend(b)
  await storage.loadState()
  storage.updateProvider('deepseek', { apiKey: 'sk-secret' })
  storage.setKnowledge({ version: 1, nodes: { a: node('a', { mastery: 1, reviewedAt: 5 }), b: node('b') } })
  const mine = storage.createChat({ title: 'mine' })
  const backup = storage.exportData()
  assert.equal(backup.version, 2)
  assert.equal(backup.chats.length, 1)
  assert.doesNotMatch(JSON.stringify(backup), /sk-secret/)

  const other = {
    app: 'talent-tree', version: 2,
    knowledge: { version: 1, nodes: { a: node('a', { mastery: 3, reviewedAt: 9 }), c: node('c', { prerequisites: ['a', 'missing'] }) }, goals: { c: { id: 'c', name: 'C', at: 1 } } },
    chats: [{ id: 'other', title: 'theirs', goals: [], messages: [] }, { broken: true }],
  }
  // Checking alone changes nothing.
  const before = storage.getState().knowledge
  assert.equal(storage.parseImport(other).chats.length, 1)
  assert.equal(storage.getState().knowledge, before)

  const merged = storage.importData(other, 'merge')
  assert.deepEqual(merged, { nodes: 2, chats: 1 })
  const k = storage.getState().knowledge
  assert.deepEqual(Object.keys(k.nodes).sort(), ['a', 'b', 'c'])
  assert.equal(k.nodes.a.mastery, 3, 'the better mastery wins')
  assert.equal(k.nodes.a.name, 'A')
  assert.deepEqual(k.nodes.c.prerequisites, ['a'], 'a prerequisite missing from both maps is dropped')
  assert.ok(k.goals.c)
  assert.deepEqual(Object.keys(storage.getState().chats).sort(), [mine.id, 'other'].sort())

  const replaced = storage.importData(backup, 'replace')
  assert.deepEqual(replaced, { nodes: 2, chats: 1 })
  assert.deepEqual(Object.keys(storage.getState().knowledge.nodes).sort(), ['a', 'b'])
  assert.deepEqual(Object.keys(storage.getState().chats), [mine.id])
  await storage.flush()
  assert.equal(b.files.map.has('tt.chat.other'), false, 'replaced chats are deleted from disk')

  // Version 1 files (map only) replace the map and keep the chats.
  storage.importData({ app: 'talent-tree', version: 1, knowledge: { nodes: { z: node('z') } } })
  assert.deepEqual(Object.keys(storage.getState().knowledge.nodes), ['z'])
  assert.deepEqual(Object.keys(storage.getState().chats), [mine.id])

  for (const bad of [null, {}, { nodes: null }, { nodes: [] }, { knowledge: { nodes: { x: { name: 'no id' } } } }, { knowledge: { nodes: {} }, chats: 'no' }]) {
    assert.throws(() => storage.parseImport(bad))
  }
})

test('renaming a chat keeps its place in the list; an empty name restores the automatic one', async () => {
  storage.setBackend(phoneBackends())
  await storage.loadState()
  const chat = storage.createChat({ title: 'auto' })
  const at = storage.getState().chats[chat.id].updatedAt
  storage.renameChat(chat.id, '  我的  复习 ')
  assert.equal(storage.getState().chats[chat.id].customTitle, '我的 复习')
  assert.equal(storage.getState().chats[chat.id].updatedAt, at)
  storage.renameChat(chat.id, '')
  assert.equal('customTitle' in storage.getState().chats[chat.id], false)
})

test('token usage adds up', async () => {
  storage.setBackend(phoneBackends())
  await storage.loadState()
  storage.addUsage({ input: 100, output: 20 })
  storage.addUsage(null)
  storage.addUsage({ input: 5, output: 1 })
  const u = storage.getState().settings.usage
  assert.deepEqual([u.input, u.output], [105, 21])
  assert.ok(u.since > 0)
  storage.resetUsage()
  assert.equal(storage.getState().settings.usage.input, 0)
})

test('the example can be removed without taking points the learner\'s own tree uses', async () => {
  storage.setBackend(phoneBackends())
  await storage.loadState()
  const { seedDemo, removeDemo, hasDemo } = await import('../src/demo.js')
  seedDemo()
  assert.ok(hasDemo(storage.getState().knowledge))
  assert.equal(Object.keys(storage.getState().chats).length, 1)
  // The learner plans a real tree on top of the example's 极限.
  const k = storage.getState().knowledge
  storage.setKnowledge({ ...k, nodes: { ...k.nodes, series: node('series', { prerequisites: ['limit'] }) }, goals: { ...k.goals, series: { id: 'series', name: 'S', at: 1 } } })
  removeDemo()
  const after = storage.getState().knowledge
  assert.equal(hasDemo(after), false)
  assert.deepEqual(Object.keys(after.nodes).sort(), ['limit', 'series'])
  assert.deepEqual(Object.keys(after.goals), ['series'])
  assert.equal(Object.keys(storage.getState().chats).length, 0)
})
