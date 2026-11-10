/**
 * App state kept on the phone: the knowledge map, conversations and settings.
 *
 * Everything lives in memory for synchronous reads and is written through to
 * Capacitor Preferences (native) or localStorage (browser). Components read it
 * with useApp(selector); writers call the update helpers below.
 */
import { useSyncExternalStore } from 'react'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { emptyStore, mergeNodes } from './graph.js'
import { DEFAULT_PROVIDER } from './providers.js'
import { setLanguage } from './i18n.js'

const K_KNOWLEDGE = 'tt.knowledge.v1'
const K_SETTINGS = 'tt.settings.v1'
const K_CHAT_INDEX = 'tt.chats.v1'
const K_CHAT = id => `tt.chat.${id}`

export const DEFAULT_SETTINGS = {
  /** 'system' | 'zh' | 'en' */
  language: 'system',
  /** Which AI service to use (see providers.js). */
  provider: DEFAULT_PROVIDER,
  /** Per service: { apiKey, model, baseUrl }; switching services keeps each key. */
  providers: {},
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

const native = Capacitor.isNativePlatform()

async function getRaw(key) {
  if (native) return (await Preferences.get({ key })).value
  try { return localStorage.getItem(key) } catch { return null }
}

async function setRaw(key, value) {
  if (native) return Preferences.set({ key, value })
  try { localStorage.setItem(key, value) } catch {}
}

async function removeRaw(key) {
  if (native) return Preferences.remove({ key })
  try { localStorage.removeItem(key) } catch {}
}

const parse = (raw, fallback) => {
  try {
    const value = JSON.parse(raw)
    return value ?? fallback
  } catch {
    return fallback
  }
}

let state = {
  ready: false,
  knowledge: emptyStore(),
  settings: DEFAULT_SETTINGS,
  /** id -> conversation */
  chats: {},
  /** id -> { content, status } while a reply is being generated */
  live: {},
}
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

// Writes are queued per key so the newest value always lands last.
const pending = new Map()
let flushing = Promise.resolve()
function persist(key, value) {
  pending.set(key, value)
  flushing = flushing.then(async () => {
    if (!pending.has(key)) return
    const v = pending.get(key)
    pending.delete(key)
    if (v === undefined) await removeRaw(key)
    else await setRaw(key, JSON.stringify(v))
  }).catch(() => {})
}

/** Load everything from storage. Call once before rendering. */
export async function loadState() {
  const knowledge = parse(await getRaw(K_KNOWLEDGE), null)
  const settings = migrateSettings(parse(await getRaw(K_SETTINGS), null))
  setLanguage(settings.language)
  const index = parse(await getRaw(K_CHAT_INDEX), [])
  const chats = {}
  for (const id of Array.isArray(index) ? index : []) {
    const chat = parse(await getRaw(K_CHAT(id)), null)
    if (chat && chat.id === id) chats[id] = chat
  }
  set({
    ready: true,
    knowledge: knowledge && typeof knowledge.nodes === 'object' ? knowledge : emptyStore(),
    settings,
    chats,
  })
}

// ---- knowledge map ---------------------------------------------------------

export function setKnowledge(knowledge) {
  set({ knowledge })
  persist(K_KNOWLEDGE, knowledge)
}

/** Remove a goal from the list; its nodes and mastery stay in the map. */
export function forgetGoal(goalId) {
  const k = state.knowledge
  const goals = { ...(k.goals ?? {}) }
  delete goals[goalId]
  // Maps without a recorded goal list infer goals from sink nodes; record the rest explicitly.
  setKnowledge({ ...k, goals, hidden: [...new Set([...(k.hidden ?? []), goalId])] })
}

// ---- settings --------------------------------------------------------------

/** Change the key, model or address of one AI service. */
export function updateProvider(id, patch) {
  const providers = { ...state.settings.providers, [id]: { ...state.settings.providers?.[id], ...patch } }
  updateSettings({ providers })
}

export function updateSettings(patch) {
  const settings = { ...state.settings, ...patch }
  if (patch.language !== undefined) setLanguage(settings.language)
  set({ settings })
  persist(K_SETTINGS, settings)
}

// ---- conversations ---------------------------------------------------------

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

function saveIndex(chats) {
  persist(K_CHAT_INDEX, Object.keys(chats))
}

export function createChat({ goals = [], title = '' } = {}) {
  const now = Date.now()
  const chat = { id: newId(), title, goals, messages: [], createdAt: now, updatedAt: now }
  const chats = { ...state.chats, [chat.id]: chat }
  set({ chats })
  saveIndex(chats)
  persist(K_CHAT(chat.id), chat)
  return chat
}

export function updateChat(id, change) {
  const old = state.chats[id]
  if (!old) return undefined
  const chat = { ...change(old), updatedAt: Date.now() }
  set({ chats: { ...state.chats, [id]: chat } })
  persist(K_CHAT(id), chat)
  return chat
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
  persist(K_CHAT(id), undefined)
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

// ---- whole-app data --------------------------------------------------------

export function exportData() {
  return { app: 'talent-tree', version: 1, exportedAt: new Date().toISOString(), knowledge: state.knowledge }
}

/** Check an exported file and return the knowledge map in it, without changing anything. Throws when invalid. */
export function parseImport(data) {
  const knowledge = data && data.knowledge ? data.knowledge : data
  if (!knowledge || typeof knowledge.nodes !== 'object' || knowledge.nodes === null || Array.isArray(knowledge.nodes)) throw new Error('invalid data')
  for (const node of Object.values(knowledge.nodes)) {
    if (!node || typeof node.id !== 'string' || !Array.isArray(node.prerequisites)) throw new Error('invalid node')
  }
  return knowledge
}

/** Replace the knowledge map with an exported one. Returns the node count. */
export function importData(data) {
  const knowledge = parseImport(data)
  setKnowledge({ version: 1, ...knowledge })
  return Object.keys(knowledge.nodes).length
}

export function clearAll() {
  for (const id of Object.keys(state.chats)) persist(K_CHAT(id), undefined)
  set({ knowledge: emptyStore(), chats: {}, live: {} })
  persist(K_KNOWLEDGE, undefined)
  persist(K_CHAT_INDEX, [])
}
