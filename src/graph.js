/**
 * Pure knowledge-graph logic for the talent tree: validation, merging, cycle
 * checks, prerequisite closure, node states and session snapshots.
 * No I/O here, so the Host plugin and the tests share it.
 */

export const NODE_TYPES = ['concept', 'theorem', 'method', 'proof_idea', 'skill']
export const MAX_LEVEL = 3
/** Days before a lit node starts fading, by mastery level (bronze, silver, gold). */
export const REVIEW_DAYS = { 1: 3, 2: 7, 3: 21 }

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
  if (!(node.mastery >= 1) || node.reviewedAt === undefined) return false
  return now - node.reviewedAt > REVIEW_DAYS[node.mastery] * 86_400_000
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
      ...(n.est_minutes !== undefined ? { est_minutes: n.est_minutes } : {}),
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
