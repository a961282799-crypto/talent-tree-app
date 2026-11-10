/**
 * App state kept on the phone: the knowledge map, conversations and settings.
 *
 * Everything lives in memory for synchronous reads and is written through to
 * three stores (see `nativeBackend` / `webBackend`):
 * - files: the knowledge map and each conversation, one JSON file per key in the
 *   app's private data folder (they grow large; Preferences is for small values);
 * - prefs: settings, without API keys (Capacitor Preferences);
 * - secrets: API keys, encrypted with a key held by the Android Keystore / iOS Keychain.
 * In a desktop browser (development) all three are localStorage.
 * Components read state with useApp(selector); writers call the helpers below.
 */
import { useSyncExternalStore } from 'react'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { emptyStore, mergeNodes, mergeStores } from './graph.js'
import { DEFAULT_PROVIDER, PROVIDERS } from './providers.js'
import { setLanguage } from './i18n.js'

const K_KNOWLEDGE = 'tt.knowledge.v1'
const K_SETTINGS = 'tt.settings.v1'
const K_CHAT_INDEX = 'tt.chats.v1'
const K_CHAT = id => `tt.chat.${id}`
const K_SECRET = providerId => `apikey.${providerId}`

export const DEFAULT_SETTINGS = {
  /** 'system' | 'zh' | 'en' */
  language: 'system',
  /** Which AI service to use (see providers.js). */
  provider: DEFAULT_PROVIDER,
  /** Per service: { apiKey, model, baseUrl, visionModel }; switching services keeps each key. */
  providers: {},
  /** Reading size of chat replies and point cards: 'normal' | 'large' | 'xlarge'. */
  textSize: 'normal',
  /** Daily review reminder (phones only). */
  reminder: { enabled: false, time: '20:00' },
  /** Tokens reported by the AI services since `since`. */
  usage: { input: 0, output: 0, since: 0 },
}

/** Settings saved by version 1.0 kept one DeepSeek key, address and model at the top level. */
export function migrateSettings(saved) {
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_SETTINGS }
  const { apiKey, baseUrl, model, ...rest } = saved
  const out = { ...DEFAULT_SETTINGS, ...rest, providers: { ...(rest.providers ?? {}) } }
  if (apiKey || model || (baseUrl && baseUrl !== 'https://api.deepseek.com')) {
    const legacyModel = model === 'deepseek-chat' || model === 'deepseek-reasoner' ? '' : model
    out.providers.deepseek = { apiKey: apiKey ?? '', model: legacyModel ?? '', baseUrl: baseUrl === 'https://api.deepseek.com' ? '' : baseUrl ?? '', ...out.providers.deepseek }
  }
  return out
}

// ---- backends ----------------------------------------------------------------

const localBackend = prefix => ({
  async get(key) { try { return localStorage.getItem(prefix + key) } catch { return null } },
  async set(key, value) { localStorage.setItem(prefix + key, value) },
  async remove(key) { try { localStorage.removeItem(prefix + key) } catch {} },
})

const nativePrefs = {
  async get(key) { return (await Preferences.get({ key })).value },
  async set(key, value) { await Preferences.set({ key, value }) },
  async remove(key) { await Preferences.remove({ key }) },
}

const DIR = Directory.Data
const fileOf = key => `store/${key}.json`
/**
 * One JSON file per key. A write goes to `.tmp` first and is then renamed, so a
 * crash mid-write leaves either the old file or the new one, never half of one.
 */
const nativeFiles = {
  async get(key) {
    for (const path of [fileOf(key), `${fileOf(key)}.tmp`]) {
      try {
        const { data } = await Filesystem.readFile({ path, directory: DIR, encoding: Encoding.UTF8 })
        if (typeof data === 'string' && data) {
          JSON.parse(data)
          return data
        }
      } catch {}
    }
    return null
  },
  async set(key, value) {
    const path = fileOf(key)
    await Filesystem.writeFile({ path: `${path}.tmp`, data: value, directory: DIR, encoding: Encoding.UTF8, recursive: true })
    await Filesystem.deleteFile({ path, directory: DIR }).catch(() => {})
    await Filesystem.rename({ from: `${path}.tmp`, to: path, directory: DIR, toDirectory: DIR })
  },
  async remove(key) {
    for (const path of [fileOf(key), `${fileOf(key)}.tmp`]) await Filesystem.deleteFile({ path, directory: DIR }).catch(() => {})
  },
}

const nativeSecrets = {
  async get(key) {
    try {
      return await SecureStorage.getItem(key)
    } catch {
      // Unreadable, e.g. restored from a backup without its Keystore key: drop it, the learner re-enters the key.
      await SecureStorage.removeItem(key).catch(() => {})
      return null
    }
  },
  async set(key, value) { await SecureStorage.setItem(key, value) },
  async remove(key) { await SecureStorage.removeItem(key).catch(() => {}) },
}

/** On a phone. `legacy` is where version 1.1 and earlier kept the map and chats. */
const nativeBackend = () => ({ prefs: nativePrefs, files: nativeFiles, secrets: nativeSecrets, legacy: nativePrefs })
/** In a desktop browser, with the same keys earlier versions used. */
const webBackend = () => ({ prefs: localBackend(''), files: localBackend(''), secrets: localBackend('tt.secret.'), legacy: null })

let backend = Capacitor.isNativePlatform() ? nativeBackend() : webBackend()

const parse = (raw, fallback) => {
  try {
    const value = JSON.parse(raw)
    return value ?? fallback
  } catch {
    return fallback
  }
}

// ---- state -------------------------------------------------------------------

const initialState = () => ({
  ready: false,
  knowledge: emptyStore(),
  settings: DEFAULT_SETTINGS,
  /** id -> conversation */
  chats: {},
  /** id -> { content, status } while a reply is being generated */
  live: {},
})

let state = initialState()
const listeners = new Set()

function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach(fn => fn())
}

export function getState() {
  return state
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Subscribe a component to part of the state. */
export function useApp(selector) {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state))
}

/** Tests only: swap the storage backends and start from a clean state. */
export function setBackend(next) {
  backend = next
  state = initialState()
  secureKeys = true
  pending.clear()
}

// ---- writing -----------------------------------------------------------------

const saveErrorListeners = new Set()
/** Be told when something could not be saved (full disk, storage error…). */
export function onSaveError(fn) {
  saveErrorListeners.add(fn)
  return () => saveErrorListeners.delete(fn)
}
const reportSaveError = error => saveErrorListeners.forEach(fn => fn(error))

// Writes are queued per key so the newest value always lands last.
const pending = new Map()
let flushing = Promise.resolve()
function persist(store, key, value) {
  const id = `${store}:${key}`
  pending.set(id, value)
  flushing = flushing.then(async () => {
    if (!pending.has(id)) return
    const v = pending.get(id)
    pending.delete(id)
    try {
      if (v === undefined) await backend[store].remove(key)
      else await backend[store].set(key, typeof v === 'string' ? v : JSON.stringify(v))
    } catch (error) {
      reportSaveError(error)
    }
  })
}

/** Resolves once every queued write has been attempted. */
export function flush() {
  return Promise.all([flushing, secretQueue])
}

// API keys go to the secure store. Should it fail on this device, they stay with the settings rather than get lost.
let secureKeys = true

function persistSettings(settings) {
  const providers = {}
  for (const [id, p] of Object.entries(settings.providers ?? {})) {
    const { apiKey, ...rest } = p ?? {}
    providers[id] = secureKeys ? rest : { ...rest, apiKey }
  }
  persist('prefs', K_SETTINGS, { ...settings, providers })
}

// Key edits arrive per keystroke: write them one after another so the last value wins.
let secretQueue = Promise.resolve()
function saveSecret(providerId, apiKey) {
  secretQueue = secretQueue.then(async () => {
    try {
      if (apiKey) await backend.secrets.set(K_SECRET(providerId), apiKey)
      else await backend.secrets.remove(K_SECRET(providerId))
    } catch {
      if (secureKeys) {
        secureKeys = false
        persistSettings(state.settings)
      }
    }
  })
  return secretQueue
}

// ---- loading -----------------------------------------------------------------

/** Load everything from storage, moving data written by older versions to its new place. Call once before rendering. */
export async function loadState() {
  const moved = []
  const read = async key => {
    let raw = await backend.files.get(key).catch(() => null)
    if (raw == null && backend.legacy) {
      raw = await backend.legacy.get(key).catch(() => null)
      if (raw != null) moved.push([key, raw])
    }
    return raw
  }

  const settings = migrateSettings(parse(await backend.prefs.get(K_SETTINGS).catch(() => null), null))
  setLanguage(settings.language)
  // Keys saved with the settings by older versions move to the secure store.
  let keysMoved = false
  for (const [id, p] of Object.entries(settings.providers)) {
    if (!p?.apiKey) continue
    try {
      await backend.secrets.set(K_SECRET(id), p.apiKey)
      keysMoved = true
    } catch {
      secureKeys = false
    }
  }
  for (const p of PROVIDERS) {
    if (settings.providers[p.id]?.apiKey) continue
    const key = await backend.secrets.get(K_SECRET(p.id)).catch(() => null)
    if (key) settings.providers[p.id] = { ...settings.providers[p.id], apiKey: key }
  }

  const knowledge = parse(await read(K_KNOWLEDGE), null)
  const index = parse(await read(K_CHAT_INDEX), [])
  const ids = Array.isArray(index) ? index : []
  const loaded = await Promise.all(ids.map(async id => [id, parse(await read(K_CHAT(id)), null)]))
  const chats = {}
  for (const [id, chat] of loaded) if (chat && chat.id === id) chats[id] = chat

  set({
    ready: true,
    knowledge: knowledge && typeof knowledge.nodes === 'object' && knowledge.nodes !== null ? knowledge : emptyStore(),
    settings,
    chats,
  })
  if (keysMoved) persistSettings(settings)
  // Copy what came from the old store into files; remove the old copy only once the new one is written.
  for (const [key, raw] of moved) {
    try {
      await backend.files.set(key, raw)
      await backend.legacy.remove(key)
    } catch (error) {
      reportSaveError(error)
    }
  }
}

// ---- knowledge map -----------------------------------------------------------

export function setKnowledge(knowledge) {
  set({ knowledge })
  persist('files', K_KNOWLEDGE, knowledge)
}

/** Remove a goal from the list; its nodes and mastery stay in the map. */
export function forgetGoal(goalId) {
  const k = state.knowledge
  const goals = { ...(k.goals ?? {}) }
  delete goals[goalId]
  // Maps without a recorded goal list infer goals from sink nodes; record the rest explicitly.
  setKnowledge({ ...k, goals, hidden: [...new Set([...(k.hidden ?? []), goalId])] })
}

// ---- settings ----------------------------------------------------------------

/** Change the key, model or address of one AI service. */
export function updateProvider(id, patch) {
  const providers = { ...state.settings.providers, [id]: { ...state.settings.providers?.[id], ...patch } }
  updateSettings({ providers })
  if ('apiKey' in patch) saveSecret(id, patch.apiKey)
}

export function updateSettings(patch) {
  const settings = { ...state.settings, ...patch }
  if (patch.language !== undefined) setLanguage(settings.language)
  set({ settings })
  persistSettings(settings)
}

/** Add the tokens one AI reply used: { input, output }. */
export function addUsage(usage) {
  if (!usage || !(usage.input > 0 || usage.output > 0)) return
  const old = state.settings.usage ?? DEFAULT_SETTINGS.usage
  updateSettings({ usage: { input: (old.input || 0) + (usage.input || 0), output: (old.output || 0) + (usage.output || 0), since: old.since || Date.now() } })
}

export function resetUsage() {
  updateSettings({ usage: { input: 0, output: 0, since: Date.now() } })
}

// ---- conversations -----------------------------------------------------------

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

function saveIndex(chats) {
  persist('files', K_CHAT_INDEX, Object.keys(chats))
}

export function createChat({ goals = [], title = '' } = {}) {
  const now = Date.now()
  const chat = { id: newId(), title, goals, messages: [], createdAt: now, updatedAt: now }
  const chats = { ...state.chats, [chat.id]: chat }
  set({ chats })
  saveIndex(chats)
  persist('files', K_CHAT(chat.id), chat)
  return chat
}

export function updateChat(id, change, { touch = true } = {}) {
  const old = state.chats[id]
  if (!old) return undefined
  const chat = { ...change(old), ...(touch ? { updatedAt: Date.now() } : {}) }
  set({ chats: { ...state.chats, [id]: chat } })
  persist('files', K_CHAT(id), chat)
  return chat
}

/** Give a conversation its own name; an empty name goes back to the automatic one. */
export function renameChat(id, name) {
  const value = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  updateChat(id, c => {
    const next = { ...c }
    if (value) next.customTitle = value
    else delete next.customTitle
    return next
  }, { touch: false })
}

/** After a merge: every conversation that showed `fromId` as a goal shows `intoId` instead. */
export function replaceGoalEverywhere(fromId, intoId, intoName) {
  for (const chat of Object.values(state.chats)) {
    if (!chat.goals.some(g => g.id === fromId)) continue
    updateChat(chat.id, c => ({
      ...c,
      goals: c.goals.map(g => (g.id === fromId ? { id: intoId, name: intoName } : g)).filter((g, i, all) => all.findIndex(x => x.id === g.id) === i),
    }))
  }
}

/** Merge two knowledge points by hand (from a node's detail card). */
export function mergeKnowledge(fromId, intoId) {
  const next = mergeNodes(state.knowledge, fromId, intoId)
  setKnowledge(next)
  replaceGoalEverywhere(fromId, intoId, next.nodes[intoId].name)
  return next.nodes[intoId]
}

export function deleteChat(id) {
  const chats = { ...state.chats }
  delete chats[id]
  set({ chats })
  saveIndex(chats)
  persist('files', K_CHAT(id), undefined)
}

/** Most recently used conversation that already shows this goal. */
export function chatForGoal(goalId) {
  return Object.values(state.chats)
    .filter(c => c.goals.some(g => g.id === goalId))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

export function setLive(id, value) {
  const live = { ...state.live }
  if (value === null) delete live[id]
  else live[id] = value
  set({ live })
}

// ---- whole-app data ----------------------------------------------------------

/** Everything worth a backup: the knowledge map and every conversation. Settings and API keys stay out. */
export function exportData() {
  return { app: 'talent-tree', version: 2, exportedAt: new Date().toISOString(), knowledge: state.knowledge, chats: Object.values(state.chats) }
}

const validChat = c => c && typeof c === 'object' && typeof c.id === 'string' && c.id && Array.isArray(c.messages) && Array.isArray(c.goals)

/**
 * Check an exported file without changing anything. Accepts version 1 files
 * (map only), version 2 files (map and conversations) and a bare map.
 * @returns {{ knowledge: object, chats: object[] }}
 * @throws Error when the file is not learning data.
 */
export function parseImport(data) {
  const knowledge = data && data.knowledge ? data.knowledge : data
  if (!knowledge || typeof knowledge.nodes !== 'object' || knowledge.nodes === null || Array.isArray(knowledge.nodes)) throw new Error('invalid data')
  for (const node of Object.values(knowledge.nodes)) {
    if (!node || typeof node.id !== 'string' || !Array.isArray(node.prerequisites)) throw new Error('invalid node')
  }
  if (data.chats !== undefined && !Array.isArray(data.chats)) throw new Error('invalid chats')
  const chats = (data.chats ?? []).filter(validChat)
  return { knowledge, chats }
}

/**
 * Bring in an exported file.
 * - 'replace': the file's map replaces this one; its conversations, when it has any, replace these.
 * - 'merge': points and conversations not here yet are added; for shared points the better mastery wins.
 * @returns {{ nodes: number, chats: number }} how many points and conversations the file brought
 */
export function importData(data, mode = 'replace') {
  const { knowledge, chats } = parseImport(data)
  if (mode === 'merge') {
    setKnowledge(mergeStores(state.knowledge, knowledge))
    const next = { ...state.chats }
    let added = 0
    for (const chat of chats) {
      if (next[chat.id]) continue
      next[chat.id] = chat
      persist('files', K_CHAT(chat.id), chat)
      added++
    }
    set({ chats: next })
    saveIndex(next)
    return { nodes: Object.keys(knowledge.nodes).length, chats: added }
  }
  setKnowledge({ version: 1, ...knowledge })
  if (chats.length) {
    for (const id of Object.keys(state.chats)) persist('files', K_CHAT(id), undefined)
    const next = Object.fromEntries(chats.map(c => [c.id, c]))
    for (const chat of chats) persist('files', K_CHAT(chat.id), chat)
    set({ chats: next, live: {} })
    saveIndex(next)
  }
  return { nodes: Object.keys(knowledge.nodes).length, chats: chats.length }
}

export function clearAll() {
  for (const id of Object.keys(state.chats)) persist('files', K_CHAT(id), undefined)
  set({ knowledge: emptyStore(), chats: {}, live: {} })
  persist('files', K_KNOWLEDGE, undefined)
  persist('files', K_CHAT_INDEX, [])
}
