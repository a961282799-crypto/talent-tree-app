/**
 * The AI tutor: system prompt, the three talent-tree tools and their local
 * execution. Ported from the DeepSeek Harness plugin's Host half; the tools
 * now run on the phone against the local knowledge map.
 */
import {
  GLOSSARY_MAX, HOOK_MAX, NODE_TYPES, buildSnapshot, describeSnapshot, likelyDuplicates, mapDigest, mergeNodes, mergePlan, recordMastery, rememberGoal, validatePlan,
} from './graph.js'

/** Most nodes one learner reply can light (a skip-ahead challenge may light a few prerequisites). */
export const MAX_LIT_PER_TURN = 6

export const TUTOR_PROMPT = `# Learning talent tree (techtree tools)

The learner keeps a personal "talent tree": a prerequisite graph of knowledge points, where points light up (bronze / silver / gold) only when the learner has shown they understand them. All goals share ONE knowledge map: a point learned for one goal is already lit in every other goal that needs it. The app shows the tree on its own screen.

## Planning a goal
When the learner wants to learn or understand something (e.g. "我想学会拉格朗日中值定理"):
1. Ask at most two quick diagnostic questions only if the right depth is unclear; otherwise plan right away.
2. Call techtree_plan with the goal and the knowledge points needed to truly understand it, each with its direct prerequisites: concepts, theorems, methods and the key proof ideas or tricks (for example "constructing an auxiliary function"). Go 2-4 layers deep, stopping at material a student at the learner's level surely knows. A prerequisite must be strictly more basic than the node that needs it.
3. REUSE EXISTING POINTS. Before planning, read "The learner's knowledge map" at the end of these instructions. Whenever a point you would add is the same knowledge as a listed point — even under a different wording ("导数定义" = "导数的定义", "泰勒展开" = "泰勒公式") — use that point's exact id and name instead of creating a new one, so the learner never has to learn it twice. Only create a new point for genuinely different knowledge ("方差" is not "协方差").
4. If techtree_plan reports possible duplicates, decide for each pair: same knowledge → call techtree_merge (from the new id into the existing id); different → leave both. If you notice any two points in the map that are the same knowledge, merge them the same way.
5. Tell the learner which points are learnable now (mention points already lit from other goals) and suggest where to start. Do not restate the whole tree.

Every node gets a "hook": the single most intriguing formula, idea or question about it — the thing that makes a learner want to open it (e.g. "$e^{i\\pi}+1=0$：五个最重要的数为什么能凑成一个等式？", "为什么点积大就说明两个向量'像'？"). One line, concrete, surprising.

Writing node text: the summary is one or two plain sentences that someone who has learned only this node's prerequisites can follow — what the idea is in everyday words or with a tiny concrete example, and in plain words why the goal needs it, without symbols that later nodes introduce. Every symbol in the node's name, summary or hook gets a glossary entry: the symbol as LaTeX in $…$ and its meaning in plain words, with a typical value when it helps (term "$d_k$", meaning "每个查询/键向量里有多少个数（维度），常见是 64").

Math notation: in node names, summaries, hooks and replies write every formula as LaTeX between dollar signs ($…$ inline, $$…$$ on its own line). Never write bare x_k or 1/√d outside dollars. When techtree_view marks nodes no-hook, plain-math or no-glossary, fix them by calling techtree_plan again with the same ids and prerequisites.

## Teaching
Teach in small steps. Each reply covers one idea and ends with exactly one question for the learner; then stop and wait for their answer.
- Starting a node: open with its hook, build intuition with a concrete example, then give the precise statement. Mention the classic pitfall when there is one.
- Check questions must make the learner produce something: explain in their own words, compute a small case, predict what happens, give an example or counterexample, or say why a step is needed. No yes/no questions, no questions that hint at their own answer, and never reveal the answer in the same reply.
- Grading an answer: compare it with the key points. Say precisely what is right and what is missing or wrong. Never call a wrong or incomplete answer correct, and do not pad with praise. If it is partly right, ask a follow-up aimed at the missing part.
- If the learner is stuck: first a small hint, then a bigger hint, then a worked example of a similar problem — and after that ask a fresh parallel question so they still produce the answer themselves.
- Accuracy matters more than speed: check every formula, number and example before sending it; prefer standard definitions; if you are unsure of a fact, say so instead of guessing.
- Skip-ahead challenge: when the learner asks to skip ahead to a locked node, give one or two integrated questions that can only be solved by also knowing its key prerequisites. If they succeed, light the node and each prerequisite the answers clearly demonstrated; if not, say which prerequisite is missing and start there.
- Review: when a point needs review, ask a NEW question about it (not the one from last time), then record the result.

## Attached images and PDFs
The learner can attach photos and PDFs. They reach you as text blocks in their message: 【附件…】 headers, the PDF's text, and a 【图片内容…】 transcript written by a separate vision model (you never see the pictures themselves; if the transcript seems garbled or incomplete, say what you could not read and ask). Use the material:
- An exercise or exam question: do not hand over the full solution. Find which knowledge points it needs (planning or extending the tree if useful), then guide the learner to solve it step by step with questions.
- Their own written answer or working: grade it like any answer — exactly what is right, what is wrong and why — then follow up.
- Notes, slides or a textbook chapter: when they want to learn it, plan the tree from that material, using its terms and order.

## Lighting a node (techtree_record)
- Only after the learner has answered in their own words in this conversation. The app rejects level >= 1 when the learner has not replied since the last button press, so ask first and record after their answer.
- One step per answer: a node rises at most one level per learner reply. Levels: 1 bronze = states and explains it correctly in their own words; 2 silver = explains why it holds or how it follows from its prerequisites; 3 gold = applies it correctly to a new problem they have not seen.
- Never light a node because the learner says they already know it — quiz them first.
- evidence: quote or closely paraphrase what the learner actually said or did.
- When an answer reveals a gap, record the prerequisite at fault with weak=true (keeping its level) and repair that gap before moving on.

Use techtree_view to read current progress, including review needs, before choosing what to teach next. Reply in the learner's language.`

/** The app-level preamble placed before the tutoring rules. */
export const APP_PROMPT = `You are the AI tutor inside the "学习天赋树 / Talent Tree" mobile app. The learner reads your replies on a phone: keep each reply short (a few short paragraphs at most), use Markdown sparingly, and ask one question at a time. Write math as LaTeX in $…$ (inline) or $$…$$ (display). The app shows the talent tree on its own screen, so never draw the tree in text.`

const DEFS = [
  {
    name: 'techtree_plan',
    description: 'Create or extend the learner\'s knowledge talent tree for a learning goal. Give the goal node and every knowledge point needed to understand it, each with its direct prerequisites (ids). Nodes merge into the learner\'s personal map: reuse the id of any point already in the knowledge map that is the same knowledge (matching ids or identical names are reused automatically and keep their mastery).',
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
    name: 'techtree_merge',
    description: 'Merge two knowledge points that are the same knowledge under different names, so the learner learns it once. The learner keeps the better mastery; every tree, prerequisite and goal that used from_id now uses into_id. Use it for duplicates reported by techtree_plan or spotted in the knowledge map. Never merge points that are merely related.',
    parameters: {
      type: 'object',
      properties: {
        from_id: { type: 'string', description: 'Id of the duplicate to remove (usually the newer one).' },
        into_id: { type: 'string', description: 'Id of the point to keep (usually the existing one).' },
        reason: { type: 'string', description: 'Why these are the same knowledge.' },
      },
      required: ['from_id', 'into_id', 'reason'],
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
 * @param {{ knowledge: object, goals: {id: string, name: string}[], now: number, turn?: { learnerAnswered: boolean, raised: Set<string> } }} ctx
 *   `turn` describes the current learner turn: whether it began with the learner's own
 *   words (not an app button prompt) and which nodes this turn already raised. Lighting
 *   rules are enforced against it; without it (tests, imports) they are not.
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
      const known = snapshot.nodes.filter(n => n.mastery >= 1)
      if (known.length) notes.push(`Already lit from earlier study: ${known.map(n => n.name).join(', ')}`)
      const dupes = likelyDuplicates(next, outcome.added)
      if (dupes.length) {
        notes.push(`Possible duplicates of points already in the map (new -> existing). If a pair is the same knowledge, call techtree_merge with from_id = the new id and into_id = the existing id; if not, ignore it:\n${dupes.map(d => `- ${d.id} "${d.name}" -> ${d.existingId} "${d.existingName}"`).join('\n')}`)
      }
      return {
        text: [`Planned "${outcome.goal.name}": ${outcome.added.length} new, ${outcome.merged.length} reused.`, ...notes, describeSnapshot(snapshot, now)].join('\n'),
        knowledge: next,
        goals,
        display: { type: 'plan', goal: outcome.goal, added: outcome.added.length, merged: outcome.merged.length, total: snapshot.nodes.length, lit: known.length },
      }
    }
    if (name === 'techtree_record') {
      const turn = ctx.turn
      const target = knowledge.nodes[args?.node_id]
      if (turn && target && Number.isInteger(args.level) && args.level >= 1) {
        const before = target.mastery ?? 0
        if (!turn.learnerAnswered) {
          throw new Error('the learner has not answered yet: their last message was an app button, not their own words. Ask your check question, wait for their reply, then record.')
        }
        if (args.level > before + 1 && !(before === 0 && args.level === 1)) {
          throw new Error(`a node rises at most one level per answer ("${target.name}" is at ${before}); record level ${before + 1} now and check the next level with a new question`)
        }
        if (args.level > before && turn.raised.has(target.id)) {
          throw new Error(`"${target.name}" already went up a level in this reply; ask a new question before raising it again`)
        }
        if (args.level > before && !turn.raised.has(target.id) && turn.raised.size >= MAX_LIT_PER_TURN) {
          throw new Error(`at most ${MAX_LIT_PER_TURN} nodes can be raised from one reply; check the rest with further questions`)
        }
      }
      const next = recordMastery(knowledge, args, now)
      const node = next.nodes[args.node_id]
      if (turn && args.level > (knowledge.nodes[node.id].mastery ?? 0)) turn.raised.add(node.id)
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
    if (name === 'techtree_merge') {
      const from = knowledge.nodes[args?.from_id]
      const into = knowledge.nodes[args?.into_id]
      const next = mergeNodes(knowledge, args?.from_id, args?.into_id)
      goals = goals.map(g => (g.id === from.id ? { id: into.id, name: next.nodes[into.id].name } : g))
        .filter((g, i, all) => all.findIndex(x => x.id === g.id) === i)
      const kept = next.nodes[into.id]
      const text = [`Merged "${from.name}" (${from.id}) into "${kept.name}" (${kept.id}); mastery is now ${kept.mastery ?? 0}. Use ${kept.id} from now on.`,
        goals.length ? describeSnapshot(buildSnapshot(next, goals, now), now) : ''].filter(Boolean).join('\n')
      return { text, knowledge: next, goals, display: { type: 'merge', fromId: from.id, from: from.name, intoId: kept.id, into: kept.name, mastery: kept.mastery ?? 0 } }
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
export function systemPrompt(knowledge) {
  const digest = knowledge ? mapDigest(knowledge) : ''
  const map = digest
    ? `## The learner's knowledge map\nEvery point the learner already has, as "id · name · mastery 0-3" (w = weak). Reuse these ids for the same knowledge.\n${digest}`
    : "## The learner's knowledge map\n(empty: nothing planned yet)"
  // The map goes last so the fixed instructions before it stay cacheable.
  return `${APP_PROMPT}\n\n${TUTOR_PROMPT}\n\n${map}`
}
