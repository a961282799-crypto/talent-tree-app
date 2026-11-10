/**
 * Talking to the AI: an OpenAI-compatible chat-completions client with
 * streaming and tool calls, and the per-turn loop that runs the talent-tree
 * tools locally until the model gives its answer.
 */
import { TOOLS, executeTool, systemPrompt } from './tutor.js'
import { addUsage, getState, replaceGoalEverywhere, setKnowledge, setLive, updateChat } from './storage.js'
import { fill, t } from './i18n.js'
import { activeAI, providerById } from './providers.js'

/** How many earlier messages go to the model with each request. */
const HISTORY = 40
/** Characters of history sent with each request (roughly 20–60k tokens): long chats drop their oldest turns. */
export const HISTORY_CHARS = 60000
/** Attachments keep their full text for this many learner messages; older ones are cut to a short opening. */
export const ATTACH_FULL_TURNS = 3
const ATTACH_KEEP_CHARS = 1500
/** How often a reply being written is redrawn. */
const LIVE_MS = 90
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
  const message = { content: '', reasoning: '', toolCalls: [], finishReason: null, usage: null }
  return {
    message,
    add(chunk) {
      // Token counts come in the last chunk (OpenAI style) when the service reports them.
      if (chunk?.usage && typeof chunk.usage === 'object') {
        message.usage = { input: Number(chunk.usage.prompt_tokens) || 0, output: Number(chunk.usage.completion_tokens) || 0 }
      }
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

const base = baseUrl => baseUrl.trim().replace(/\/+$/, '')
const endpoint = baseUrl => `${base(baseUrl)}/chat/completions`

/**
 * Turn an error reply into something a learner can act on.
 * @returns {{ message: string, code: string }} code: 'no-key' (fix in Settings), 'model', 'balance', 'rate', 'too-long', 'server' or 'http'
 */
export function describeHttpError(status, detail = '') {
  const d = String(detail)
  if (status === 401 || status === 403) return { message: t('error.auth'), code: 'no-key' }
  if (status === 402 || /insufficient|balance|quota|欠费|余额|arrear/i.test(d)) return { message: t('error.balance'), code: 'balance' }
  if (status === 429) return { message: t('error.rate'), code: 'rate' }
  if (/context.{0,20}(length|window)|maximum.{0,20}tokens|too (long|many tokens)|超出.{0,6}(长度|上下文)/i.test(d)) return { message: t('error.tooLong'), code: 'too-long' }
  if (status === 404 || /model.{0,40}(not.{0,10}(exist|found|support)|invalid|unknown)|(invalid|unknown|unsupported).{0,10}model|模型.{0,10}(不存在|无效)/i.test(d)) return { message: t('error.model'), code: 'model' }
  if (status >= 500) return { message: t('error.server'), code: 'server' }
  return { message: fill(t('error.http'), { status, detail: d.slice(0, 200) }), code: 'http' }
}

const originOf = url => {
  try { return new URL(url).origin } catch { return url }
}

/**
 * Build the request function. With CapacitorHttp on, window.fetch goes through
 * native code (no CORS, but the body arrives in one piece). The WebView's own
 * fetch streams but needs CORS, so it is tried first. When it fails, the native
 * fetch is tried: if that one gets through, the provider blocks the WebView
 * (CORS) and its address skips the WebView from then on; if it fails too, the
 * network was down and nothing is remembered, so streaming comes back once the
 * connection does.
 * @param {() => ((url: string, init: object) => Promise<Response>) | undefined} getWebFetch
 * @param {(url: string, init: object) => Promise<Response>} nativeFetch
 */
export function makePost(getWebFetch, nativeFetch) {
  const blocked = new Set()
  return async function post(url, init) {
    const webFetch = getWebFetch()
    const origin = originOf(url)
    if (webFetch && !blocked.has(origin)) {
      try {
        return await webFetch(url, init)
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        const response = await nativeFetch(url, init)
        // Only a successful reply proves CORS was the problem: error replies often lack CORS headers.
        if (response.ok) blocked.add(origin)
        return response
      }
    }
    return nativeFetch(url, init)
  }
}

const post = makePost(() => (typeof window !== 'undefined' ? window.CapacitorWebFetch : undefined), (url, init) => fetch(url, init))

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
      body: JSON.stringify({
        model: settings.model, messages, tools, stream: true,
        // Ask for token counts where the service is known to accept the option.
        ...(providerById(settings.provider).usage ? { stream_options: { include_usage: true } } : {}),
      }),
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
    const { message, code } = describeHttpError(response.status, detail)
    const error = new AiError(message, code)
    error.detail = `${response.status}${detail ? ` · ${String(detail).slice(0, 300)}` : ''}`
    throw error
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

/** A learner message with attachments, cut to their words plus the opening of the attached text. */
function shortenAttachments(m) {
  const content = String(m.content ?? '')
  if (content.length <= ATTACH_KEEP_CHARS + 200) return content
  const words = m.label ?? ''
  const rest = words && content.startsWith(words) ? content.slice(words.length) : content
  return `${words}${rest.slice(0, ATTACH_KEEP_CHARS)}…\n【${t('attach.block.trimmed')}】`
}

const sizeOf = m => String(m.content ?? '').length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0)

/**
 * Strip app-only fields and trim history to what the model needs: at most
 * `limit` messages and `chars` characters, always starting at a learner
 * message and always keeping the latest exchange. Attachments in older learner
 * messages are cut to their opening so a long PDF is not resent every turn.
 */
export function apiMessages(all, limit = HISTORY, chars = HISTORY_CHARS) {
  const messages = all.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
  let start = Math.max(0, messages.length - limit)
  // Never begin mid tool exchange: start at a user message.
  while (start > 0 && messages[start].role !== 'user') start--
  // Thinking models want their reasoning back while a tool exchange is still running,
  // i.e. after the learner's latest message; earlier reasoning is dropped.
  let lastUser = -1
  messages.forEach((m, i) => { if (m.role === 'user') lastUser = i })
  const userIndexes = messages.map((m, i) => (m.role === 'user' ? i : -1)).filter(i => i >= 0)
  const fullFrom = userIndexes.length > ATTACH_FULL_TURNS ? userIndexes[userIndexes.length - ATTACH_FULL_TURNS] : 0
  const contentOf = (m, i) => (m.role === 'user' && m.attachments?.length && i < fullFrom ? shortenAttachments(m) : m.content)
  // Over the character budget: move the start forward to a later learner message, never past the latest one.
  const size = i => (messages[i].role === 'user' ? String(contentOf(messages[i], i) ?? '').length : sizeOf(messages[i]))
  let total = 0
  for (let i = start; i < messages.length; i++) total += size(i)
  while (total > chars && start < lastUser) {
    let next = start + 1
    while (next < lastUser && messages[next].role !== 'user') next++
    for (let i = start; i < next; i++) total -= size(i)
    start = next
  }
  return messages.slice(start).map((m, i) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
    if (m.role === 'assistant') {
      const out = { role: 'assistant', content: m.content || '' }
      if (m.tool_calls?.length) out.tool_calls = m.tool_calls
      if (m.reasoning && start + i > lastUser) out.reasoning_content = m.reasoning
      return out
    }
    return { role: m.role, content: contentOf(m, start + i) }
  })
}

/**
 * Call `fn` at most once per `ms`, always with the latest value; `flush` delivers
 * a pending value right away and `cancel` drops it.
 */
export function throttle(fn, ms) {
  let timer = null
  let last = 0
  let value
  let waiting = false
  const run = () => {
    timer = null
    if (!waiting) return
    waiting = false
    last = Date.now()
    fn(value)
  }
  return {
    call(v) {
      value = v
      waiting = true
      if (timer) return
      const wait = Math.max(0, ms - (Date.now() - last))
      if (wait === 0) run()
      else timer = setTimeout(run, wait)
    },
    flush() {
      if (timer) clearTimeout(timer)
      run()
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      waiting = false
    },
  }
}

/** Tool results that changed the learner's map: a reply that made them cannot simply be written again. */
const CHANGES_MAP = new Set(['plan', 'record', 'merge'])

/**
 * Whether the latest reply can be written again: the chat ends with the AI's
 * answer (or an error) to a learner message, and that turn changed nothing in
 * the knowledge map (no tree planned, no point lit or merged).
 */
export function canRegenerate(messages) {
  let lastUser = -1
  messages.forEach((m, i) => { if (m.role === 'user') lastUser = i })
  if (lastUser < 0) return false
  const after = messages.slice(lastUser + 1)
  if (!after.some(m => (m.role === 'assistant' && m.content) || m.role === 'error')) return false
  return !after.some(m => m.role === 'tool' && CHANGES_MAP.has(m.display?.type))
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
      title: c.title || (label || opts.attachments?.[0]?.name || text).replace(/\s+/g, ' ').slice(0, 40),
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
  // Redrawing the whole Markdown on every streamed piece makes long replies stutter: redraw a few times a second.
  const live = throttle(content => setLive(chatId, { content, status: 'writing' }), LIVE_MS)
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
        onText: content => live.call(content),
      })
      live.cancel()
      addUsage(reply.usage)
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
      push({ role: 'error', content: error.message || String(error), code: error.code || 'unknown', ...(error.detail ? { detail: error.detail } : {}), at: Date.now() })
    }
  } finally {
    // Keep the newest streamed text, so a stopped reply saves everything written so far.
    live.flush()
    // A reply cut off mid-stream keeps what was written so far.
    const partial = getState().live[chatId]
    if (controller.signal.aborted && partial?.content) push({ role: 'assistant', content: partial.content, at: Date.now() })
    controllers.delete(chatId)
    setLive(chatId, null)
  }
}

/** Write the latest reply again (see canRegenerate). */
export function regenerate(chatId, onEvent) {
  const chat = getState().chats[chatId]
  if (!chat || controllers.has(chatId) || !canRegenerate(chat.messages)) return
  let lastUser = -1
  chat.messages.forEach((m, i) => { if (m.role === 'user') lastUser = i })
  updateChat(chatId, c => ({ ...c, messages: c.messages.slice(0, lastUser + 1) }))
  return send(chatId, null, onEvent)
}

/**
 * The models a service offers, from its OpenAI-style /models list.
 * @returns {Promise<string[]>} model ids, sorted
 */
export async function fetchModels(settings) {
  if (!settings.apiKey) throw new AiError(t('error.noKey'), 'no-key')
  let response
  try {
    response = await fetch(`${base(settings.baseUrl)}/models`, { headers: { authorization: `Bearer ${settings.apiKey.trim()}` } })
  } catch {
    throw new AiError(t('error.network'), 'network')
  }
  if (!response.ok) {
    let detail = ''
    try { detail = (await response.text()).slice(0, 200) } catch {}
    throw new AiError(describeHttpError(response.status, detail).message, 'http')
  }
  const body = await response.json().catch(() => null)
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
  return [...new Set(list.map(m => (typeof m === 'string' ? m : m?.id)).filter(id => typeof id === 'string' && id))].sort()
}

/** Check a service ({ apiKey, baseUrl, model }) with a tiny request. Resolves on success, throws AiError. */
export async function testConnection(settings) {
  const reply = await complete({ settings, messages: [{ role: 'user', content: 'ping' }], onText: null })
  return reply.content
}
