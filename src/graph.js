/**
 * Pure knowledge-graph logic for the talent tree: validation, merging, cycle
 * checks, prerequisite closure, node states and session snapshots.
 * No I/O here, so the Host plugin and the tests share it.
 */

export const NODE_TYPES = ['concept', 'theorem', 'method', 'proof_idea', 'skill']
export const MAX_LEVEL = 3
/** Days before a lit node starts fading, by mastery level (bronze, silver, gold), before any successful review. */
export const REVIEW_DAYS = { 1: 3, 2: 7, 3: 21 }
/** Each successful review on time doubles the wait, up to this many doublings (gold: 21 → 336 days). */
export const MAX_REVIEW_DOUBLINGS = 4
const DAY_MS = 86_400_000

/** Days a lit node can go without review: the level's base interval, doubled for each successful review in a row. */
export function reviewIntervalDays(node) {
  const base = REVIEW_DAYS[node.mastery]
  if (!base) return Infinity
  return base * 2 ** Math.min(Math.max(node.reviews ?? 0, 0), MAX_REVIEW_DOUBLINGS)
}

/** When a lit node starts fading (epoch ms), or null when it is not lit or never reviewed. */
export function nextReviewAt(node) {
  if (!(node.mastery >= 1) || node.reviewedAt === undefined) return null
  return node.reviewedAt + reviewIntervalDays(node) * DAY_MS
}

const ID_RE = /^[a-z0-9][a-z0-9_]{0,63}$/
/** Longest kept "hook": the one formula, idea or question that makes a point intriguing. */
export const HOOK_MAX = 160
/** At most this many glossary entries per node: the symbols its formulas use, each in plain words. */
export const GLOSSARY_MAX = 6

/** Clean a model-written glossary: [{ term, meaning }], both non-empty strings. */
export function cleanGlossary(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(e => e && typeof e.term === 'string' && typeof e.meaning === 'string' && e.term.trim() && e.meaning.trim())
    .slice(0, GLOSSARY_MAX)
    .map(e => ({ term: e.term.trim().slice(0, 60), meaning: e.meaning.trim().slice(0, 160) }))
}

/** Formula-looking text outside $…$ (√x, x_k, x^2): written before formulas were typeset. */
export function hasPlainMath(text) {
  if (typeof text !== 'string') return false
  const outside = text.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)/g, '')
  return /√|[A-Za-z0-9)]_(\{|[A-Za-z0-9](?![A-Za-z0-9]))|[A-Za-z0-9)]\^[A-Za-z0-9{]/.test(outside)
}

const hasMath = text => typeof text === 'string' && /\$[^$]+\$/.test(text)

/** Collapse a display name for duplicate detection: case, spaces and punctuation ignored. */
export function normalizeName(name) {
  return String(name).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** An empty knowledge map. */
export function emptyStore() {
  return { version: 1, nodes: {} }
}

/**
 * Check and clean one plan request from the model.
 * @returns {{ goal: {id: string, name: string}, nodes: object[] }}
 * @throws Error with a model-readable message on any problem.
 */
export function validatePlan(args) {
  if (args === null || typeof args !== 'object') throw new Error('arguments must be an object')
  const goalId = args.goal_id
  if (typeof goalId !== 'string' || !ID_RE.test(goalId)) {
    throw new Error(`goal_id must be lower_snake_case ASCII (got ${JSON.stringify(goalId)})`)
  }
  if (!Array.isArray(args.nodes) || args.nodes.length === 0) throw new Error('nodes must be a non-empty array')
  if (args.nodes.length > 60) throw new Error('at most 60 nodes per plan; plan the deeper layers later with another call')
  const seen = new Set()
  const nodes = args.nodes.map((raw, i) => {
    const where = `nodes[${i}]`
    if (raw === null || typeof raw !== 'object') throw new Error(`${where} must be an object`)
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) throw new Error(`${where}.id must be lower_snake_case ASCII (got ${JSON.stringify(raw.id)})`)
    if (seen.has(raw.id)) throw new Error(`duplicate node id "${raw.id}"`)
    seen.add(raw.id)
    if (typeof raw.name !== 'string' || raw.name.trim() === '') throw new Error(`${where}.name is required`)
    const type = raw.type ?? 'concept'
    if (!NODE_TYPES.includes(type)) throw new Error(`${where}.type must be one of ${NODE_TYPES.join(', ')}`)
    const prerequisites = raw.prerequisites ?? []
    if (!Array.isArray(prerequisites) || prerequisites.some(p => typeof p !== 'string')) {
      throw new Error(`${where}.prerequisites must be an array of node ids`)
    }
    if (prerequisites.includes(raw.id)) throw new Error(`node "${raw.id}" lists itself as a prerequisite`)
    const minutes = raw.est_minutes
    const hook = typeof raw.hook === 'string' ? raw.hook.trim().slice(0, HOOK_MAX) : ''
    const glossary = cleanGlossary(raw.glossary)
    return {
      id: raw.id,
      name: raw.name.trim(),
      type,
      summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
      ...(hook ? { hook } : {}),
      ...(glossary.length ? { glossary } : {}),
      prerequisites: [...new Set(prerequisites)],
      ...(Number.isFinite(minutes) && minutes > 0 ? { est_minutes: Math.round(minutes) } : {}),
    }
  })
  if (!seen.has(goalId)) throw new Error(`the goal "${goalId}" must itself appear in nodes`)
  const goalNode = nodes.find(n => n.id === goalId)
  return { goal: { id: goalId, name: goalNode.name }, nodes }
}

/**
 * Find a cycle in a prerequisite map, if any.
 * @param {Record<string, {prerequisites: string[]}>} nodes
 * @returns {string[] | undefined} the ids on one cycle.
 */
export function findCycle(nodes) {
  const state = new Map() // 1 = visiting, 2 = done
  const stack = []
  const visit = id => {
    state.set(id, 1)
    stack.push(id)
    for (const p of nodes[id]?.prerequisites ?? []) {
      if (!(p in nodes)) continue
      const s = state.get(p)
      if (s === 1) return [...stack.slice(stack.indexOf(p)), p]
      if (s === undefined) {
        const found = visit(p)
        if (found) return found
      }
    }
    stack.pop()
    state.set(id, 2)
    return undefined
  }
  for (const id of Object.keys(nodes)) {
    if (!state.has(id)) {
      const found = visit(id)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Merge a validated plan into the knowledge map without mutating it.
 * A planned node whose id or normalized name matches an existing node merges
 * into that node: its mastery is kept and new prerequisites are added.
 * @returns {{ store: object, goal: {id, name}, remapped: Record<string,string>, added: string[], merged: string[] }}
 * @throws Error when prerequisites are unknown or the merge would create a cycle.
 */
export function mergePlan(store, plan) {
  const nodes = { ...store.nodes }
  const byName = new Map()
  for (const node of Object.values(nodes)) {
    byName.set(normalizeName(node.name), node.id)
    for (const alias of node.aliases ?? []) byName.set(normalizeName(alias), node.id)
  }
  // Map every planned id to the id it will live under.
  const remapped = {}
  for (const node of plan.nodes) {
    if (node.id in nodes) continue
    const existing = byName.get(normalizeName(node.name))
    if (existing !== undefined) remapped[node.id] = existing
  }
  const resolve = id => remapped[id] ?? id
  const plannedIds = new Set(plan.nodes.map(n => resolve(n.id)))
  for (const node of plan.nodes) {
    for (const p of node.prerequisites) {
      const target = resolve(p)
      if (!plannedIds.has(target) && !(target in nodes)) {
        throw new Error(`node "${node.id}" requires unknown prerequisite "${p}"; include it in nodes or use an existing id`)
      }
    }
  }
  const added = []
  const merged = []
  for (const node of plan.nodes) {
    const id = resolve(node.id)
    const prerequisites = node.prerequisites.map(resolve).filter(p => p !== id)
    const old = nodes[id]
    if (old === undefined) {
      nodes[id] = { ...node, id, prerequisites, mastery: 0 }
      added.push(id)
    } else {
      const aliases = new Set(old.aliases ?? [])
      // Same id: the plan may rename (e.g. to typeset a formula); the old name stays an alias.
      // Matched by name only: keep the existing name and remember the new spelling.
      const renamed = node.id === id && normalizeName(node.name) !== normalizeName(old.name)
      if (normalizeName(node.name) !== normalizeName(old.name)) aliases.add(renamed ? old.name : node.name)
      nodes[id] = {
        ...old,
        ...(renamed ? { name: node.name } : {}),
        // A re-plan may rewrite the summary (e.g. to typeset its formulas); an empty one keeps the old.
        summary: node.summary || old.summary,
        // A re-plan may add or improve a hook; an omitted hook keeps the old one.
        ...(node.hook || old.hook ? { hook: node.hook || old.hook } : {}),
        ...(node.glossary || old.glossary ? { glossary: node.glossary || old.glossary } : {}),
        est_minutes: old.est_minutes ?? node.est_minutes,
        prerequisites: [...new Set([...old.prerequisites, ...prerequisites])],
        ...(aliases.size > 0 ? { aliases: [...aliases] } : {}),
      }
      merged.push(id)
    }
  }
  const cycle = findCycle(nodes)
  if (cycle) throw new Error(`prerequisites form a cycle: ${cycle.join(' -> ')}; a prerequisite must be more basic than the node that needs it`)
  const goalId = resolve(plan.goal.id)
  return { store: { ...store, nodes }, goal: { id: goalId, name: nodes[goalId].name }, remapped, added, merged }
}

/**
 * Record a mastery judgement for one node without mutating the store.
 * @param {{node_id: string, level: number, weak?: boolean, evidence?: string}} args
 * @param {number} now - epoch milliseconds.
 */
export function recordMastery(store, args, now) {
  if (args === null || typeof args !== 'object') throw new Error('arguments must be an object')
  const node = store.nodes[args.node_id]
  if (node === undefined) throw new Error(`unknown node "${args.node_id}"; call techtree_view to see valid ids`)
  const level = args.level
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) throw new Error('level must be an integer 0-3')
  if (typeof args.evidence !== 'string' || args.evidence.trim() === '') {
    throw new Error('evidence is required: say how the learner showed (or failed to show) understanding')
  }
  const history = [...(node.history ?? []), { at: now, level, weak: args.weak === true, evidence: args.evidence.trim().slice(0, 500) }].slice(-20)
  const next = { ...node, mastery: level, weak: args.weak === true, reviewedAt: now, history }
  // Spaced review: holding the same level after at least half the wait counts as a successful review and
  // lengthens the next wait; re-checks soon after learning change nothing; a new level, a drop or a gap starts over.
  const before = node.mastery ?? 0
  const halfDue = node.reviewedAt !== undefined && now - node.reviewedAt >= (reviewIntervalDays(node) * DAY_MS) / 2
  const reviews = level >= 1 && level === before && args.weak !== true
    ? (halfDue ? (node.reviews ?? 0) + 1 : node.reviews ?? 0)
    : 0
  if (reviews > 0) next.reviews = reviews
  else delete next.reviews
  return { ...store, nodes: { ...store.nodes, [node.id]: next } }
}

/** Every id the goals depend on, goals included. */
export function closure(store, goalIds) {
  const out = new Set()
  const walk = id => {
    if (out.has(id) || !(id in store.nodes)) return
    out.add(id)
    for (const p of store.nodes[id].prerequisites) walk(p)
  }
  goalIds.forEach(walk)
  return out
}

/** Whether a lit node is overdue for review. */
export function isFading(node, now) {
  const due = nextReviewAt(node)
  return due !== null && now > due
}

/** 'lit' | 'available' | 'locked' for one node of a snapshot or store. */
export function nodeState(node, byId) {
  if (node.mastery >= 1) return 'lit'
  return node.prerequisites.every(p => (byId[p]?.mastery ?? 0) >= 1) ? 'available' : 'locked'
}

/**
 * The complete per-session view: goals plus every node they need, in
 * prerequisite-first order. Snapshots are what the session log carries.
 */
export function buildSnapshot(store, goals, now) {
  const ids = closure(store, goals.map(g => g.id))
  const order = topoOrder(store.nodes, ids)
  const nodes = order.map(id => {
    const n = store.nodes[id]
    return {
      id: n.id,
      name: n.name,
      type: n.type,
      summary: n.summary,
      ...(n.hook ? { hook: n.hook } : {}),
      ...(n.glossary?.length ? { glossary: n.glossary } : {}),
      prerequisites: n.prerequisites.filter(p => ids.has(p)),
      mastery: n.mastery ?? 0,
      ...(n.weak ? { weak: true } : {}),
      ...(n.reviewedAt !== undefined ? { reviewedAt: n.reviewedAt } : {}),
      ...(n.reviews ? { reviews: n.reviews } : {}),
      ...(n.est_minutes !== undefined ? { est_minutes: n.est_minutes } : {}),
      ...(n.history?.length ? { evidence: n.history[n.history.length - 1].evidence } : {}),
    }
  })
  return { version: 1, goals: goals.map(g => ({ id: g.id, name: store.nodes[g.id]?.name ?? g.name })), nodes, at: now }
}

/** Prerequisite-first order of the given ids (stable by insertion). */
export function topoOrder(nodes, ids) {
  const out = []
  const done = new Set()
  const visit = id => {
    if (done.has(id)) return
    done.add(id)
    for (const p of nodes[id].prerequisites) if (ids.has(p)) visit(p)
    out.push(id)
  }
  ids.forEach(visit)
  return out
}

const LEVEL_NAMES = ['未点亮', '铜·了解', '银·理解', '金·会用']

/** A compact model-facing description of a snapshot. */
export function describeSnapshot(snapshot, now) {
  const byId = Object.fromEntries(snapshot.nodes.map(n => [n.id, n]))
  const lines = []
  const lit = snapshot.nodes.filter(n => n.mastery >= 1).length
  lines.push(`Goals: ${snapshot.goals.map(g => `${g.name} (${g.id})`).join(', ')}`)
  lines.push(`Progress: ${lit}/${snapshot.nodes.length} lit`)
  const frontier = []
  for (const n of snapshot.nodes) {
    const state = nodeState(n, byId)
    const flags = [
      state === 'lit' ? LEVEL_NAMES[n.mastery] : state,
      n.weak ? 'WEAK' : '',
      isFading(n, now) ? 'FADING-needs-review' : '',
      n.hook ? '' : 'no-hook',
      [n.name, n.summary, n.hook].some(hasPlainMath) ? 'plain-math' : '',
      [n.name, n.summary, n.hook].some(hasMath) && !n.glossary?.length ? 'no-glossary' : '',
    ].filter(Boolean).join(', ')
    const pre = n.prerequisites.length ? ` <- ${n.prerequisites.join(', ')}` : ''
    lines.push(`- ${n.id} "${n.name}" [${n.type}] {${flags}}${pre}`)
    if (state === 'available') frontier.push(n.id)
  }
  lines.push(`Learnable now (all prerequisites lit): ${frontier.length ? frontier.join(', ') : 'none'}`)
  return lines.join('\n')
}

/**
 * Record a planned goal so the learner's map can list it outside any conversation.
 * Older maps have no goal list; {@link goalsOf} infers one for them.
 */
export function rememberGoal(store, goal, now) {
  const goals = { ...(store.goals ?? {}), [goal.id]: { id: goal.id, name: goal.name, at: now } }
  return { ...store, goals }
}

/** Goals of the map, most recent first: the recorded ones, else the nodes nothing depends on. */
export function goalsOf(store) {
  const recorded = Object.values(store.goals ?? {}).filter(g => g && g.id in store.nodes)
  if (recorded.length) return recorded.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).map(g => ({ ...g, name: store.nodes[g.id].name }))
  const needed = new Set(Object.values(store.nodes).flatMap(n => n.prerequisites))
  return Object.values(store.nodes)
    .filter(n => !needed.has(n.id) && n.prerequisites.length > 0)
    .map(n => ({ id: n.id, name: n.name, at: n.reviewedAt ?? 0 }))
    .sort((a, b) => b.at - a.at)
}

/** Every goal with its own tree: what the left-Sidebar panel shows. */
export function buildLibrary(store, now) {
  return {
    version: 1,
    at: now,
    goals: goalsOf(store).map(goal => {
      const snapshot = buildSnapshot(store, [goal], now)
      return { goal: snapshot.goals[0], nodes: snapshot.nodes, at: goal.at || now }
    }),
  }
}

// ---- reusing knowledge across goals ------------------------------------------

/** A name reduced for fuzzy matching: normalized, minus filler characters that wording often adds. */
function looseName(name) {
  return normalizeName(String(name).replace(/\$[^$]*\$/g, m => m.replace(/\\[a-z]+/gi, ''))).replace(/[的之与和及]/g, '')
}

function bigrams(s) {
  const out = new Set()
  if (s.length === 1) out.add(s)
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

/**
 * How alike two knowledge-point names are, 0-1. Containment ("导数" in "导数的定义")
 * and character-pair overlap both count, so different wordings of one idea score high.
 */
export function nameSimilarity(a, b) {
  const x = looseName(a)
  const y = looseName(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length >= 2 && long.includes(short)) return 0.6 + 0.4 * (short.length / long.length)
  const A = bigrams(x)
  const B = bigrams(y)
  let shared = 0
  for (const g of A) if (B.has(g)) shared++
  return (2 * shared) / (A.size + B.size)
}

/** Score at or above which two names are worth asking about. */
export const SIMILAR_AT = 0.72

/**
 * Newly added points that look like points the map already had, best match first.
 * @param {object} store - the map after merging the plan
 * @param {string[]} addedIds - ids the plan created
 * @returns {{ id: string, name: string, existingId: string, existingName: string, score: number }[]}
 */
export function likelyDuplicates(store, addedIds) {
  const added = new Set(addedIds)
  const existing = Object.values(store.nodes).filter(n => !added.has(n.id))
  const out = []
  for (const id of addedIds) {
    const node = store.nodes[id]
    if (!node) continue
    let best = null
    for (const other of existing) {
      const names = [other.name, ...(other.aliases ?? [])]
      const score = Math.max(...names.map(n => nameSimilarity(node.name, n)))
      if (score >= SIMILAR_AT && (!best || score > best.score)) best = { id, name: node.name, existingId: other.id, existingName: other.name, score }
    }
    if (best) out.push(best)
  }
  return out.sort((a, b) => b.score - a.score)
}

/**
 * Merge one knowledge point into another without mutating the store: the
 * learner keeps the better mastery, every reference and goal moves to `intoId`,
 * and the old name stays as an alias.
 * @throws Error when either id is unknown, they are the same, or the merge would form a cycle.
 */
export function mergeNodes(store, fromId, intoId) {
  const from = store.nodes[fromId]
  const into = store.nodes[intoId]
  if (!from) throw new Error(`unknown node "${fromId}"`)
  if (!into) throw new Error(`unknown node "${intoId}"`)
  if (fromId === intoId) throw new Error('cannot merge a node into itself')
  // One building on the other means they are different knowledge.
  if (closure(store, [intoId]).has(fromId) || closure(store, [fromId]).has(intoId)) {
    throw new Error(`"${from.name}" and "${into.name}" are not the same knowledge: one is a prerequisite of the other`)
  }
  const keep = (from.mastery ?? 0) > (into.mastery ?? 0) ? from : into
  const aliases = new Set([...(into.aliases ?? []), ...(from.aliases ?? []), from.name])
  aliases.delete(into.name)
  const history = [...(into.history ?? []), ...(from.history ?? [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-20)
  const reviewed = [into.reviewedAt, from.reviewedAt].filter(v => v !== undefined)
  const merged = {
    ...into,
    summary: into.summary || from.summary,
    ...(into.hook || from.hook ? { hook: into.hook || from.hook } : {}),
    ...(into.glossary?.length || from.glossary?.length ? { glossary: into.glossary?.length ? into.glossary : from.glossary } : {}),
    est_minutes: into.est_minutes ?? from.est_minutes,
    prerequisites: [...new Set([...into.prerequisites, ...from.prerequisites])].filter(p => p !== intoId && p !== fromId),
    mastery: keep.mastery ?? 0,
    weak: keep.weak === true,
    ...(reviewed.length ? { reviewedAt: Math.max(...reviewed) } : {}),
    ...(history.length ? { history } : {}),
    ...(aliases.size ? { aliases: [...aliases] } : {}),
  }
  if (merged.est_minutes === undefined) delete merged.est_minutes
  if (!merged.weak) delete merged.weak
  const nodes = {}
  for (const [id, node] of Object.entries(store.nodes)) {
    if (id === fromId) continue
    if (id === intoId) { nodes[id] = merged; continue }
    nodes[id] = node.prerequisites.includes(fromId)
      ? { ...node, prerequisites: [...new Set(node.prerequisites.map(p => (p === fromId ? intoId : p)))].filter(p => p !== id) }
      : node
  }
  const cycle = findCycle(nodes)
  if (cycle) throw new Error(`merging would form a cycle: ${cycle.join(' -> ')}; these are probably not the same knowledge`)
  const goals = { ...(store.goals ?? {}) }
  if (goals[fromId]) {
    if (!goals[intoId]) goals[intoId] = { ...goals[fromId], id: intoId, name: merged.name }
    delete goals[fromId]
  }
  const next = { ...store, nodes, ...(store.goals ? { goals } : {}) }
  if (store.hidden) next.hidden = [...new Set(store.hidden.map(id => (id === fromId ? intoId : id)))]
  return next
}

/**
 * Add an imported map to the learner's own, without mutating either. Points only
 * in the import are added; for points in both, the existing structure (name,
 * prerequisites) stays and the better mastery wins. Goals are combined.
 * Existing prerequisites never change, so no cycle can appear.
 */
export function mergeStores(base, incoming) {
  const nodes = { ...base.nodes }
  for (const [id, node] of Object.entries(incoming.nodes ?? {})) {
    const mine = nodes[id]
    if (!mine) {
      nodes[id] = node
      continue
    }
    if ((node.mastery ?? 0) > (mine.mastery ?? 0)) {
      const { mastery, weak, reviewedAt, reviews, history } = node
      nodes[id] = { ...mine, mastery, weak, reviewedAt, reviews, history }
      for (const key of ['weak', 'reviewedAt', 'reviews', 'history']) if (nodes[id][key] === undefined) delete nodes[id][key]
    }
  }
  // A prerequisite of an added point may be missing from both maps: drop it rather than leave a dangling link.
  for (const [id, node] of Object.entries(nodes)) {
    if (node.prerequisites.some(p => !(p in nodes))) nodes[id] = { ...node, prerequisites: node.prerequisites.filter(p => p in nodes) }
  }
  const goals = { ...(incoming.goals ?? {}), ...(base.goals ?? {}) }
  const visibleIncoming = new Set(Object.keys(incoming.goals ?? {}).filter(id => !(incoming.hidden ?? []).includes(id)))
  const hidden = (base.hidden ?? []).filter(id => !visibleIncoming.has(id))
  const next = { ...base, nodes }
  if (base.goals || incoming.goals) next.goals = goals
  if (base.hidden || hidden.length) next.hidden = hidden
  return next
}

/**
 * The map as a compact list for the model, so a plan in a new conversation can
 * reuse existing points. Lit and recently studied points come first.
 */
export function mapDigest(store, limit = 400) {
  const all = Object.values(store.nodes)
  if (all.length === 0) return ''
  const ordered = [...all].sort((a, b) => ((b.mastery ?? 0) >= 1) - ((a.mastery ?? 0) >= 1) || (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0))
  const lines = ordered.slice(0, limit).map(n => `${n.id} · ${n.name} · ${n.mastery ?? 0}${n.weak ? 'w' : ''}`)
  if (all.length > limit) lines.push(`(${all.length - limit} more points not listed)`)
  return lines.join('\n')
}

/** Goals (from the map's goal list) whose trees contain the node. */
export function goalsContaining(store, nodeId) {
  return goalsOf(store).filter(g => closure(store, [g.id]).has(nodeId))
}
