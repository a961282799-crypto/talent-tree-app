/**
 * The AI tutor: system prompt, the three talent-tree tools and their local
 * execution. Ported from the DeepSeek Harness plugin's Host half; the tools
 * now run on the phone against the local knowledge map.
 */
import {
  GLOSSARY_MAX, HOOK_MAX, NODE_TYPES, buildSnapshot, describeSnapshot, mergePlan, recordMastery, rememberGoal, validatePlan,
} from './graph.js'

export const TUTOR_PROMPT = `# Learning talent tree (techtree tools)

The learner keeps a personal "talent tree": a prerequisite graph of knowledge points shown in a sidebar, where mastered points light up like a game.

When the learner says they want to learn or understand something (e.g. "我想学会拉格朗日中值定理"):
1. Ask at most two quick diagnostic questions only if the right depth is unclear; otherwise plan right away.
2. Call techtree_plan with the goal and the knowledge points needed to truly understand it, each with its direct prerequisites. Include concepts, theorems, methods and the key proof ideas or tricks (for example "constructing an auxiliary function"). Go 2-4 layers deep, stopping at material a student at the learner's level surely knows. Reuse ids returned by earlier techtree calls for the same knowledge. A prerequisite must be strictly more basic than the node that needs it.
3. Tell the learner which nodes are learnable now and suggest where to start. Do not restate the whole tree; the sidebar shows it.

Every node gets a "hook": the single most intriguing formula, idea or question about it — the thing that makes a learner want to open it (e.g. "e^(iπ) + 1 = 0：五个最重要的数为什么能凑成一个等式？", "为什么点积大就说明两个向量'像'？"). One line, concrete, surprising.

Math notation: in node names, summaries and hooks, write every formula as LaTeX between single dollar signs, e.g. "缩放因子 $\\frac{1}{\\sqrt{d_k}}$", "$e^{i\\pi}+1=0$", "$\\mathrm{softmax}(x)_i=\\frac{e^{x_i}}{\\sum_j e^{x_j}}$"; the sidebar typesets it. Never write bare x_k or 1/√d outside dollars. If existing names, summaries or hooks show formulas without dollar signs (like 1/√d_k), rewrite those nodes through techtree_plan with the same ids. When techtree_view lists nodes marked no-hook, add hooks by calling techtree_plan again with those same nodes (same ids and prerequisites, plus hook).

Skip-ahead challenge: when the learner asks to skip ahead to a locked node, give one or two integrated questions that can only be solved by also knowing its key prerequisites. If they succeed, light the node and every prerequisite the answers clearly demonstrated (techtree_record per node, citing the answer as evidence); if not, say which prerequisite is missing and start there.

Writing for the learner: the summary is one or two plain sentences that someone who has learned only this node's prerequisites can follow. Say what the idea is in everyday words or with a tiny concrete example; when you say why the goal needs it, describe that later use in plain words, without symbols that later nodes introduce (not "理解缩放因子 1/√d_k 需要……" but "后面要回答'很多个随机数加起来，结果会大到什么程度'，这里学的方差就是答案"). Every symbol that appears in the node's name, summary or hook gets a glossary entry: the symbol as LaTeX in $…$ and its meaning in plain words with a typical value when one helps (e.g. term "$d_k$", meaning "每个查询/键向量里有多少个数（维度），常见是 64"). When techtree_view marks nodes plain-math or no-glossary, or a summary would confuse a learner at that point, rewrite those nodes through techtree_plan with the same ids.

Teaching a node: open with its hook, then intuition, then the precise statement, an example, common pitfalls, and one practice question. Prefer Socratic questions over lecturing.

Lighting a node: call techtree_record with level >= 1 ONLY after the learner has demonstrated understanding in this conversation — explaining it in their own words (Feynman check) or answering a check question correctly. Never light a node because the learner merely says they know it; quiz them first. Levels: 1 bronze = can state and explain it; 2 silver = explains why it holds or how it connects to its prerequisites; 3 gold = applies it correctly to a new problem. When an answer reveals a gap, call techtree_record on the prerequisite at fault with weak=true (keep its level) and repair that gap first.

Use techtree_view to read current progress, including review needs, before choosing what to teach next. Reply in the learner's language.`

/** The app-level preamble placed before the tutoring rules. */
export const APP_PROMPT = `You are the AI tutor inside the "学习天赋树 / Talent Tree" mobile app. The learner reads your replies on a phone: keep each reply short (a few short paragraphs at most), use Markdown sparingly, and ask one question at a time. Write math as LaTeX in $…$ (inline) or $$…$$ (display). The app shows the talent tree on its own screen, so never draw the tree in text.`

const DEFS = [
  {
    name: 'techtree_plan',
    description: 'Create or extend the learner\'s knowledge talent tree for a learning goal. Give the goal node and every knowledge point needed to understand it, each with its direct prerequisites (ids). Nodes merge into the learner\'s personal map: matching ids or names reuse existing nodes and keep their mastery.',
    parameters: {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'Id of the goal node; it must also appear in nodes.' },
        nodes: {
          type: 'array',
          description: 'Knowledge points, goal included. Prerequisites must be more basic than the node.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable lower_snake_case ASCII id, e.g. "rolle_theorem".' },
              name: { type: 'string', description: 'Display name in the learner\'s language, e.g. "罗尔定理"; formulas as LaTeX in $…$.' },
              type: { type: 'string', enum: NODE_TYPES, description: 'concept, theorem, method (technique), proof_idea, or skill.' },
              summary: { type: 'string', description: 'One or two plain sentences a learner who knows only the prerequisites can follow: what it is (everyday words or a tiny example) and, in plain words, why the goal needs it. No symbols from later nodes.' },
              glossary: {
                type: 'array',
                maxItems: GLOSSARY_MAX,
                description: 'Every symbol used in name, summary or hook, explained in plain words. Empty when there are no symbols.',
                items: {
                  type: 'object',
                  properties: {
                    term: { type: 'string', description: 'The symbol as LaTeX in $…$, e.g. "$d_k$".' },
                    meaning: { type: 'string', description: 'Plain-words meaning, with a typical value when it helps, e.g. "每个向量里有多少个数（维度），常见是 64".' },
                  },
                  required: ['term', 'meaning'],
                },
              },
              hook: { type: 'string', maxLength: HOOK_MAX, description: 'The most intriguing formula, idea or question about this point, to spark curiosity. One line; formulas as LaTeX in $…$.' },
              prerequisites: { type: 'array', items: { type: 'string' }, description: 'Ids of direct prerequisites only.' },
              est_minutes: { type: 'integer', description: 'Rough study time for a first pass.' },
            },
            required: ['id', 'name', 'type', 'summary', 'hook', 'prerequisites'],
          },
        },
      },
      required: ['goal_id', 'nodes'],
    },
  },
  {
    name: 'techtree_record',
    description: 'Record the learner\'s verified mastery of one knowledge point. Level 1-3 lights it (bronze: explains it; silver: explains why/connections; gold: applies it to new problems); 0 un-lights it. Only after the learner demonstrated it in this conversation. Set weak=true when an answer exposed a gap in this node.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Id of the knowledge point.' },
        level: { type: 'integer', enum: [0, 1, 2, 3], description: '0 none, 1 bronze, 2 silver, 3 gold.' },
        weak: { type: 'boolean', description: 'True when the learner showed a gap here that needs reinforcement.' },
        evidence: { type: 'string', description: 'What the learner said or did that justifies this judgement.' },
      },
      required: ['node_id', 'level', 'evidence'],
    },
  },
  {
    name: 'techtree_view',
    description: 'Show the current talent tree for this conversation: every node with its state (lit level, learnable, locked, weak, fading/needs review). Pass goal_id to bring an existing goal from the learner\'s map into this conversation.',
    parameters: {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'Optional id of an existing node to show as a goal.' },
      },
    },
  },
]

/** OpenAI-style tool list for chat completions. */
export const TOOLS = DEFS.map(d => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters } }))

function upsertGoal(goals, goal) {
  return goals.some(g => g.id === goal.id) ? goals : [...goals, goal]
}

/**
 * Run one tool call against the knowledge map, without side effects.
 * @param {string} name
 * @param {object} args - parsed JSON arguments
 * @param {{ knowledge: object, goals: {id: string, name: string}[], now: number }} ctx
 * @returns {{ text: string, knowledge: object, goals: object[], display: object }}
 *   `text` goes back to the model; `display` drives the chat's status pill.
 */
export function executeTool(name, args, ctx) {
  const { knowledge, now } = ctx
  let goals = ctx.goals
  try {
    if (name === 'techtree_plan') {
      const plan = validatePlan(args)
      const outcome = mergePlan(knowledge, plan)
      const remembered = rememberGoal(outcome.store, outcome.goal, now)
      // Planning a goal again brings it back if the learner had removed it from the list.
      const next = remembered.hidden?.includes(outcome.goal.id) ? { ...remembered, hidden: remembered.hidden.filter(id => id !== outcome.goal.id) } : remembered
      goals = upsertGoal(goals, outcome.goal)
      const snapshot = buildSnapshot(next, goals, now)
      const notes = []
      const remaps = Object.entries(outcome.remapped)
      if (remaps.length) notes.push(`Merged into existing nodes (use these ids from now on): ${remaps.map(([a, b]) => `${a} -> ${b}`).join(', ')}`)
      const known = snapshot.nodes.filter(n => n.mastery >= 1).map(n => n.name)
      if (known.length) notes.push(`Already lit from earlier study: ${known.join(', ')}`)
      return {
        text: [`Planned "${outcome.goal.name}": ${outcome.added.length} new, ${outcome.merged.length} reused.`, ...notes, describeSnapshot(snapshot, now)].join('\n'),
        knowledge: next,
        goals,
        display: { type: 'plan', goal: outcome.goal, added: outcome.added.length, merged: outcome.merged.length },
      }
    }
    if (name === 'techtree_record') {
      const next = recordMastery(knowledge, args, now)
      const node = next.nodes[args.node_id]
      if (goals.length === 0) goals = [{ id: node.id, name: node.name }]
      const snapshot = buildSnapshot(next, goals, now)
      const verb = args.level >= 1 ? `Lit "${node.name}" at level ${args.level}` : `Set "${node.name}" to unlit`
      const before = knowledge.nodes[node.id].mastery ?? 0
      return {
        text: `${verb}${args.weak ? ' (marked weak)' : ''}.\n${describeSnapshot(snapshot, now)}`,
        knowledge: next,
        goals,
        display: { type: 'record', id: node.id, name: node.name, level: args.level, before, weak: args.weak === true },
      }
    }
    if (name === 'techtree_view') {
      if (typeof args?.goal_id === 'string') {
        const node = knowledge.nodes[args.goal_id]
        if (node === undefined) throw new Error(`unknown node "${args.goal_id}"`)
        goals = upsertGoal(goals, { id: node.id, name: node.name })
      }
      if (goals.length === 0) {
        const all = Object.values(knowledge.nodes)
        const text = all.length === 0
          ? 'This conversation has no talent tree yet and the learner\'s map is empty. Use techtree_plan.'
          : `This conversation has no talent tree yet. The learner's map has ${all.length} nodes (${all.filter(n => n.mastery >= 1).length} lit). Pass goal_id to show one, or use techtree_plan.`
        return { text, knowledge, goals, display: { type: 'view' } }
      }
      return { text: describeSnapshot(buildSnapshot(knowledge, goals, now), now), knowledge, goals, display: { type: 'view' } }
    }
    throw new Error(`unknown tool "${name}"`)
  } catch (error) {
    return { text: `Error: ${error.message}`, knowledge, goals, display: { type: 'error', message: error.message } }
  }
}

/** The full system prompt for a conversation. */
export function systemPrompt() {
  return `${APP_PROMPT}\n\n${TUTOR_PROMPT}`
}
