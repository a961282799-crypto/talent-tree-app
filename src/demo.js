/**
 * Example data for the web preview (built with VITE_DEMO=1): one talent tree
 * with some progress and the conversation that produced it, so the app can be
 * explored without an API key.
 */
import { executeTool } from './tutor.js'
import { emptyStore } from './graph.js'
import { createChat, getState, setKnowledge, updateChat } from './storage.js'

const DAY = 86_400_000

const plan = {
  goal_id: 'lagrange_mvt',
  nodes: [
    { id: 'limit', name: '极限', type: 'concept', summary: '当 $x$ 无限靠近某个数时，函数值会靠近哪里。', hook: '$0.999\\ldots$ 真的等于 $1$ 吗？', glossary: [{ term: '$x$', meaning: '自变量，可以随便取值的那个数' }], prerequisites: [], est_minutes: 20 },
    { id: 'continuity', name: '连续性', type: 'concept', summary: '画函数图像时笔不用离开纸，中间没有断开或跳跃。', hook: '一笔画完的曲线有什么魔力？', prerequisites: ['limit'], est_minutes: 15 },
    { id: 'derivative', name: '导数的定义', type: 'concept', summary: '某一刻变化有多快，就像汽车速度表上的读数。', hook: '速度表上的数字到底是怎么算出来的？', prerequisites: ['limit'], est_minutes: 25 },
    { id: 'extreme_value_theorem', name: '最值定理', type: 'theorem', summary: '在闭区间上连续的函数，一定能取到最高点和最低点。', hook: '为什么一定存在最高点？', prerequisites: ['continuity'], est_minutes: 15 },
    { id: 'fermat_lemma', name: '费马引理', type: 'theorem', summary: '光滑的山顶或谷底处，切线一定是水平的。', hook: '山顶为什么是平的？', prerequisites: ['derivative'], est_minutes: 15 },
    { id: 'rolle_theorem', name: '罗尔定理', type: 'theorem', summary: '两端一样高的光滑曲线，中间必有一点切线水平。', hook: '$f(a)=f(b)$ 就一定有 $f\'(\\xi)=0$ 吗？', glossary: [{ term: '$f(a)$', meaning: '函数在左端点 $a$ 的高度' }, { term: '$\\xi$', meaning: '读作"克西"，中间某个点' }], prerequisites: ['fermat_lemma', 'extreme_value_theorem'], est_minutes: 20 },
    { id: 'auxiliary_function', name: '构造辅助函数', type: 'method', summary: '把一个新问题改造成已经会解的问题。', hook: '减掉一条直线，问题就变简单了？', prerequisites: [], est_minutes: 20 },
    { id: 'lagrange_mvt', name: '拉格朗日中值定理', type: 'theorem', summary: '平均速度是 60，那一路上一定有某一刻速度表正好指着 60。', hook: '平均速度 $60$ km/h，一定有一刻正好 $60$？', glossary: [{ term: '$\\frac{f(b)-f(a)}{b-a}$', meaning: '从 $a$ 到 $b$ 的平均变化率，也就是平均速度' }], prerequisites: ['rolle_theorem', 'auxiliary_function'], est_minutes: 40 },
  ],
}

/** Seed the example once, only when the map is empty. */
export function seedDemo() {
  if (Object.keys(getState().knowledge.nodes).length > 0) return
  const now = Date.now()
  let ctx = { knowledge: emptyStore(), goals: [], now: now - 6 * DAY }
  const run = (name, args, at) => {
    const result = executeTool(name, args, { ...ctx, now: at })
    ctx = { knowledge: result.knowledge, goals: result.goals }
    return result
  }
  const planned = run('techtree_plan', plan, now - 6 * DAY)
  run('techtree_record', { node_id: 'continuity', level: 1, evidence: '能说出"笔不离开纸"的直观含义' }, now - 5 * DAY)
  run('techtree_record', { node_id: 'derivative', level: 3, evidence: '自己算出了 $x^2$ 在 $x=3$ 处的导数' }, now - 1 * DAY)
  run('techtree_record', { node_id: 'auxiliary_function', level: 1, weak: true, evidence: '知道思路，但构造时减错了直线' }, now - 1 * DAY)
  const lit = run('techtree_record', { node_id: 'limit', level: 2, evidence: '能解释 $0.999\\ldots=1$：差距可以任意小' }, now - 600_000)
  // A second goal that reuses 极限 and 导数的定义: they are already lit there too.
  run('techtree_plan', {
    goal_id: 'taylor_formula',
    nodes: [
      { id: 'limit', name: '极限', type: 'concept', summary: plan.nodes[0].summary, hook: plan.nodes[0].hook, prerequisites: [] },
      { id: 'derivative', name: '导数的定义', type: 'concept', summary: plan.nodes[2].summary, hook: plan.nodes[2].hook, prerequisites: ['limit'] },
      { id: 'higher_derivative', name: '高阶导数', type: 'concept', summary: '对导数再求导，看变化的快慢本身变得多快。', hook: '加速度是速度的导数，那"加速度的变化"叫什么？', prerequisites: ['derivative'] },
      { id: 'polynomial_approx', name: '多项式逼近', type: 'method', summary: '用最简单的多项式去模仿一个复杂函数在某点附近的样子。', hook: '计算器是怎么算出 $\\sin 0.1$ 的？', prerequisites: ['derivative'] },
      { id: 'taylor_formula', name: '泰勒公式', type: 'theorem', summary: '只要知道一点处各阶导数，就能在附近用多项式近似整个函数。', hook: '$e^x = 1 + x + \\frac{x^2}{2!} + \\cdots$ 为什么能一直写下去？', prerequisites: ['higher_derivative', 'polynomial_approx', 'lagrange_mvt'] },
    ],
  }, now - 2 * DAY)
  setKnowledge(ctx.knowledge)

  const chat = createChat({ goals: ctx.goals.filter(g => g.id === 'lagrange_mvt'), title: '拉格朗日中值定理' })
  const call = (id, name, args) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
  updateChat(chat.id, c => ({
    ...c,
    messages: [
      { role: 'user', content: '我想学会「拉格朗日中值定理」。请用 techtree_plan 帮我生成学习天赋树，然后告诉我从哪里开始。', label: '我想学会「拉格朗日中值定理」' },
      call('c1', 'techtree_plan', plan),
      { role: 'tool', tool_call_id: 'c1', content: planned.text, display: planned.display },
      { role: 'assistant', content: '天赋树生成好了，一共 **8** 个知识点 🌳\n\n现在可以学的是 **极限** 和 **构造辅助函数**。先从极限开始：\n\n> 💡 $0.999\\ldots$ 真的等于 $1$ 吗？\n\n你觉得呢？提示：想想 $$\\lim_{n\\to\\infty}\\left(1-\\frac{1}{10^n}\\right)$$ 等于多少。' },
      { role: 'user', content: '等于 1，因为 0.999… 和 1 的差距可以小于任何正数，所以只能是 0。' },
      call('c2', 'techtree_record', { node_id: 'limit', level: 2, evidence: '能解释 0.999…=1：差距可以任意小' }),
      { role: 'tool', tool_call_id: 'c2', content: lit.text, display: lit.display },
      { role: 'assistant', content: '完全正确 🎉 你抓住了极限的核心：**差距可以任意小**。极限点亮为银色！\n\n你的「连续性」已经 5 天没复习了，有空记得点一下"今日复习"。下一个推荐学 **费马引理**——山顶为什么是平的？' },
    ],
  }))
}
