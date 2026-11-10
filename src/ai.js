/**
 * Talking to the AI: an OpenAI-compatible chat-completions client with
 * streaming and tool calls, and the per-turn loop that runs the talent-tree
 * tools locally until the model gives its answer.
 */
import { TOOLS, executeTool, systemPrompt } from './tutor.js'
import { getState, replaceGoalEverywhere, setKnowledge, setLive, updateChat } from './storage.js'
import { fill, t } from './i18n.js'
import { activeAI } from './providers.js'

/** How many earlier messages go to the model with each request. */
const HISTORY = 40
/** Tool rounds per learner message before giving up. */
const MAX_ROUNDS = 8

export class AiError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

/**
 * Incremental parser for a text/event-stream body. Feed it chunks; it calls
 * onData with each parsed `data:` JSON payload and ignores [DONE].
 */
export function createSSEParser(onData) {
  let buffer = ''
  const line = raw => {
    const s = raw.trim()
    if (!s.startsWith('data:')) return
    const data = s.slice(5).trim()
    if (data === '' || data === '[DONE]') return
    try { onData(JSON.parse(data)) } catch {}
  }
  return {
    push(chunk) {
      buffer += chunk
      let i
      while ((i = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, i))
        buffer = buffer.slice(i + 1)
      }
    },
    end() {
      if (buffer) line(buffer)
      buffer = ''
    },
  }
}

/** Fold streamed deltas into one assistant message. */
export function createAccumulator() {
  const message = { content: '', reasoning: '', toolCalls: [], finishReason: null }
  return {
    message,
    add(chunk) {
      const choice = chunk?.choices?.[0]
      if (!choice) return
      const delta = choice.delta ?? choice.message ?? {}
      if (typeof delta.content === 'string') message.content += delta.content
      // Thinking models (DeepSeek, Kimi…) stream their reasoning separately.
      if (typeof delta.reasoning_content === 'string') message.reasoning += delta.reasoning_content
      for (const call of delta.tool_calls ?? []) {
        const index = call.index ?? message.toolCalls.length
        const slot = message.toolCalls[index] ?? (message.toolCalls[index] = { id: '', name: '', arguments: '' })
        if (call.id) slot.id = call.id
        if (call.function?.name) slot.name += call.function.name
        if (call.function?.arguments) slot.arguments += call.function.arguments
      }
      if (choice.finish_reason) message.finishReason = choice.finish_reason
    },
  }
}

const endpoint = baseUrl => `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`

// With CapacitorHttp on, window.fetch goes through native code (no CORS, but the
// body arrives in one piece). The WebView's own fetch streams but needs CORS, so
// try it first and fall back for good if the provider blocks it.
let webFetchWorks = true

async function post(url, init) {
  const webFetch = typeof window !== 'undefined' && window.CapacitorWebFetch
  if (webFetch && webFetchWorks) {
    try {
      return await webFetch(url, init)
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      webFetchWorks = false
    }
  }
  return fetch(url, init)
}

/**
 * One chat-completions request. `settings` is the active service: { apiKey, baseUrl, model }.
 * @returns {Promise<{content: string, toolCalls: {id, name, arguments}[], finishReason: string|null}>}
 */
export async function complete({ settings, messages, tools, signal, onText }) {
  if (!settings.apiKey) throw new AiError(t('error.noKey'), 'no-key')
  if (!settings.baseUrl || !settings.model) throw new AiError(t('error.noModel'), 'no-key')
  let response
  try {
    response = await post(endpoint(settings.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey.trim()}`, accept: 'text/event-stream' },
      // No temperature: several newer models only accept their default.
      body: JSON.stringify({ model: settings.model, messages, tools, stream: true }),
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new AiError(t('error.network'), 'network')
  }
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.text()
      detail = JSON.parse(body)?.error?.message ?? body
    } catch {}
    throw new AiError(fill(t('error.http'), { status: response.status, detail: String(detail).slice(0, 200) }), response.status === 401 ? 'no-key' : 'http')
  }
  const acc = createAccumulator()
  const parser = createSSEParser(chunk => { acc.add(chunk); onText?.(acc.message.content) })
  const type = response.headers.get('content-type') || ''
  if (response.body && typeof response.body.getReader === 'function' && !type.includes('application/json')) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.end()
  } else {
    // Buffered body: either the whole event stream, or plain JSON when the server ignored stream.
    const text = await response.text()
    if (type.includes('application/json')) {
      try { acc.add(JSON.parse(text)) } catch {}
      onText?.(acc.message.content)
    } else {
      parser.push(text)
      parser.end()
    }
  }
  acc.message.toolCalls = acc.message.toolCalls.filter(Boolean)
  return acc.message
}

/** Strip app-only fields and trim history to what the model needs. */
export function apiMessages(all, limit = HISTORY) {
  const messages = all.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
  let start = Math.max(0, messages.length - limit)
  // Never begin mid tool exchange: start at a user message.
  while (start > 0 && messages[start].role !== 'user') start--
  // Thinking models want their reasoning back while a tool exchange is still running,
  // i.e. after the learner's latest message; earlier reasoning is dropped.
  let lastUser = -1
  messages.forEach((m, i) => { if (m.role === 'user') lastUser = i })
  return messages.slice(start).map((m, i) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
    if (m.role === 'assistant') {
      const out = { role: 'assistant', content: m.content || '' }
      if (m.tool_calls?.length) out.tool_calls = m.tool_calls
      if (m.reasoning && start + i > lastUser) out.reasoning_content = m.reasoning
      return out
    }
    return { role: m.role, content: m.content }
  })
}

const controllers = new Map()

export function isRunning(chatId) {
  return controllers.has(chatId)
}

export function stop(chatId) {
  controllers.get(chatId)?.abort()
}

/**
 * Send a learner message and run the model, executing tool calls locally,
 * until it answers. Progress is published through storage (chat messages and
 * the `live` entry), so screens can come and go while it runs.
 * @param {(event: object) => void} [onEvent] - called with each tool display event
 * @param {string|{ label?: string, action?: boolean, attachments?: object[] }} [extra]
 *   A string is the label of an app button (a prompt written for the model, shown as
 *   `label`); an object carries the shown text and attachments of the learner's own message.
 */
export async function send(chatId, text, onEvent, extra) {
  const opts = typeof extra === 'string' ? { label: extra, action: true } : (extra || {})
  const label = opts.label
  if (controllers.has(chatId)) return
  const controller = new AbortController()
  controllers.set(chatId, controller)
  const push = message => updateChat(chatId, c => ({ ...c, messages: [...c.messages, message] }))
  if (text) {
    updateChat(chatId, c => ({
      ...c,
      title: c.title || (label || text).replace(/\s+/g, ' ').slice(0, 40) || (opts.attachments?.[0]?.name ?? ''),
      messages: [...c.messages.filter(m => m.role !== 'error'), { role: 'user', content: text, ...(label !== undefined ? { label } : {}), action: opts.action === true, ...(opts.attachments?.length ? { attachments: opts.attachments } : {}), at: Date.now() }],
    }))
  } else {
    updateChat(chatId, c => ({ ...c, messages: c.messages.filter(m => m.role !== 'error') }))
  }
  // Lighting rules for this turn: only the learner's own words can light a node,
  // and each node rises at most one level per reply (see executeTool).
  const lastUser = [...getState().chats[chatId].messages].reverse().find(m => m.role === 'user')
  // Messages saved before the `action` flag existed carried a label only when they came from a button.
  const turn = { learnerAnswered: Boolean(lastUser && !(lastUser.action ?? Boolean(lastUser.label))), raised: new Set() }
  try {
    for (let round = 0; ; round++) {
      if (round >= MAX_ROUNDS) throw new AiError(t('error.loop'), 'loop')
      setLive(chatId, { content: '', status: 'thinking' })
      const chat = getState().chats[chatId]
      const reply = await complete({
        settings: activeAI(getState().settings),
        messages: [{ role: 'system', content: systemPrompt(getState().knowledge) }, ...apiMessages(chat.messages)],
        tools: TOOLS,
        signal: controller.signal,
        onText: content => setLive(chatId, { content, status: 'writing' }),
      })
      const calls = reply.toolCalls.map((c, i) => ({ id: c.id || `call_${Date.now()}_${i}`, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } }))
      push({ role: 'assistant', content: reply.content, ...(calls.length ? { tool_calls: calls } : {}), ...(reply.reasoning ? { reasoning: reply.reasoning } : {}), model: activeAI(getState().settings).model, at: Date.now() })
      if (calls.length === 0) break
      setLive(chatId, { content: '', status: 'tools' })
      for (const call of calls) {
        let args
        try { args = JSON.parse(call.function.arguments) } catch { args = null }
        const current = getState()
        const result = args === null
          ? { text: 'Error: arguments are not valid JSON', knowledge: current.knowledge, goals: current.chats[chatId].goals, display: { type: 'error', message: 'invalid JSON' } }
          : executeTool(call.function.name, args, { knowledge: current.knowledge, goals: current.chats[chatId].goals, now: Date.now(), turn })
        if (result.knowledge !== current.knowledge) setKnowledge(result.knowledge)
        // A merged point may be a goal in other conversations too.
        if (result.display?.type === 'merge') replaceGoalEverywhere(result.display.fromId, result.display.intoId, result.display.into)
        updateChat(chatId, c => ({
          ...c,
          goals: result.goals,
          messages: [...c.messages, { role: 'tool', tool_call_id: call.id, content: result.text, display: result.display, at: Date.now() }],
        }))
        onEvent?.(result.display)
      }
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      push({ role: 'error', content: error.message || String(error), code: error.code || 'unknown', at: Date.now() })
    }
  } finally {
    // A reply cut off mid-stream keeps what was written so far.
    const live = getState().live[chatId]
    if (controller.signal.aborted && live?.content) push({ role: 'assistant', content: live.content, at: Date.now() })
    controllers.delete(chatId)
    setLive(chatId, null)
  }
}

/** Check a service ({ apiKey, baseUrl, model }) with a tiny request. Resolves on success, throws AiError. */
export async function testConnection(settings) {
  const reply = await complete({ settings, messages: [{ role: 'user', content: 'ping' }], onText: null })
  return reply.content
}
