/**
 * Things the AI tutor can show besides text. A reply may contain fenced blocks:
 *
 *   ```plot     a function graph (JSON), optionally with a slider the learner drags
 *   ```flow     a chain of steps:  A -> B -> C  (one chain per line)
 *   ```choices  tappable answers, one per line
 *
 * This file is the pure part: splitting a reply into blocks, parsing each
 * block, and a small safe evaluator for the formulas in a plot (no eval).
 */

export const BLOCK_TYPES = ['plot', 'flow', 'choices']

const FENCE = /```[ \t]*(plot|flow|choices)[^\n]*\n([\s\S]*?)(?:\n?```|$)/g

/**
 * Split a reply into Markdown text and special blocks, in order.
 * A block whose closing fence has not arrived yet (the reply is still
 * streaming) comes back with `pending: true`.
 * @returns {{ type: 'md'|'plot'|'flow'|'choices', text?: string, raw?: string, pending?: boolean }[]}
 */
export function splitBlocks(text) {
  const out = []
  if (!text) return out
  let last = 0
  for (const m of text.matchAll(FENCE)) {
    const before = text.slice(last, m.index)
    if (before.trim()) out.push({ type: 'md', text: before })
    const closed = m[0].slice(3).endsWith('```')
    out.push({ type: m[1], raw: m[2], pending: !closed })
    last = m.index + m[0].length
  }
  const rest = text.slice(last)
  if (rest.trim()) out.push({ type: 'md', text: rest })
  return out
}

/* ---------- Formula evaluator ---------- */

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10, lg: Math.log10, log2: Math.log2,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
}
const CONSTS = { pi: Math.PI, e: Math.E }

function tokenize(src) {
  const tokens = []
  const s = String(src).replace(/\*\*/g, '^').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi').replace(/−/g, '-')
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      const n = Number(s.slice(i, j))
      if (!Number.isFinite(n)) throw new Error(`bad number "${s.slice(i, j)}"`)
      tokens.push({ t: 'num', v: n })
      i = j
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < s.length && /[A-Za-z_0-9]/.test(s[j])) j++
      tokens.push({ t: 'id', v: s.slice(i, j) })
      i = j
    } else if ('+-*/^(),'.includes(c)) {
      tokens.push({ t: c })
      i++
    } else {
      throw new Error(`unexpected "${c}"`)
    }
  }
  return tokens
}

/**
 * Compile a formula such as "x^2 - 2x + 1" or "sin(2*pi*x)/x" into a function
 * of a scope object ({ x: 1, h: 0.5 }). Supports + - * / ^, brackets, the
 * usual functions, pi and e, and implied multiplication (2x, 3(x+1), 2sin(x)).
 * Throws on anything it does not understand.
 */
export function compileExpr(src) {
  const tokens = tokenize(src)
  let pos = 0
  const peek = () => tokens[pos]
  const eat = t => {
    if (peek()?.t !== t) throw new Error(`expected "${t}"`)
    pos++
  }
  const startsValue = tok => tok && (tok.t === 'num' || tok.t === 'id' || tok.t === '(')

  function sum() {
    let left = product()
    while (peek()?.t === '+' || peek()?.t === '-') {
      const op = tokens[pos++].t
      const a = left
      const b = product()
      left = op === '+' ? s => a(s) + b(s) : s => a(s) - b(s)
    }
    return left
  }
  function product() {
    let left = unary()
    for (;;) {
      const tok = peek()
      if (tok?.t === '*' || tok?.t === '/') {
        pos++
        const a = left
        const b = unary()
        left = tok.t === '*' ? s => a(s) * b(s) : s => a(s) / b(s)
      } else if (startsValue(tok)) {
        // Implied multiplication: 2x, 3(x+1), x sin(x)
        const a = left
        const b = power()
        left = s => a(s) * b(s)
      } else return left
    }
  }
  function unary() {
    if (peek()?.t === '-') { pos++; const a = unary(); return s => -a(s) }
    if (peek()?.t === '+') { pos++; return unary() }
    return power()
  }
  function power() {
    const base = atom()
    if (peek()?.t === '^') {
      pos++
      const exponent = unary()
      return s => Math.pow(base(s), exponent(s))
    }
    return base
  }
  function atom() {
    const tok = peek()
    if (!tok) throw new Error('formula ends too early')
    if (tok.t === 'num') { pos++; return () => tok.v }
    if (tok.t === '(') {
      pos++
      const inner = sum()
      eat(')')
      return inner
    }
    if (tok.t === 'id') {
      pos++
      const name = tok.v
      const fn = Object.hasOwn(FUNCS, name.toLowerCase()) ? FUNCS[name.toLowerCase()] : null
      if (fn && peek()?.t === '(') {
        pos++
        const arg = sum()
        eat(')')
        return s => fn(arg(s))
      }
      const lower = name.toLowerCase()
      // A slider may be called e; the constant applies only when the scope has no such name.
      if (Object.hasOwn(CONSTS, lower)) return s => (s && Object.hasOwn(s, name) && typeof s[name] === 'number' ? s[name] : CONSTS[lower])
      return s => {
        const v = s && Object.hasOwn(s, name) ? s[name] : NaN
        return typeof v === 'number' ? v : NaN
      }
    }
    throw new Error(`unexpected "${tok.t}"`)
  }

  const fn = sum()
  if (pos < tokens.length) throw new Error(`unexpected "${tokens[pos].v ?? tokens[pos].t}"`)
  return fn
}

/** A number, or a formula in the slider variable ("1+h"), as a function of scope. */
function valueOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return () => v
  if (typeof v === 'string' && v.trim()) return compileExpr(v)
  throw new Error('a coordinate must be a number or a formula')
}

const pair = v => {
  if (!Array.isArray(v) || v.length !== 2) throw new Error('a point is [x, y]')
  return [valueOf(v[0]), valueOf(v[1])]
}

const COLORS = ['blue', 'gold', 'green', 'red', 'gray']
const colorOf = (c, i) => (COLORS.includes(c) ? c : COLORS[i % 3])
const text = (v, max = 40) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function range(v, fallback) {
  if (Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n)) && v[1] > v[0]) return [v[0], v[1]]
  return fallback
}

/**
 * Parse a ```plot block. Throws when the spec is unusable.
 * Spec (JSON): {
 *   title?, x: [min, max], y?: [min, max], equal?: boolean,
 *   curves?:   [{ fn: "x^2", label?, color?, dash? }],
 *   points?:   [{ x, y, label?, color? }],
 *   segments?: [{ from: [x, y], to: [x, y], label?, color?, dash?, extend? }],
 *   areas?:    [{ fn, from, to, color? }],
 *   slider?:   { name: "h", min, max, value?, step?, label? }
 * }
 * Coordinates may be formulas in the slider variable, e.g. "1+h".
 */
export function parsePlot(raw) {
  let spec
  try {
    spec = JSON.parse(raw)
  } catch {
    throw new Error('not valid JSON')
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('not an object')
  const list = v => (Array.isArray(v) ? v : v ? [v] : [])
  const plot = {
    title: text(spec.title, 60),
    x: range(spec.x, [-5, 5]),
    y: range(spec.y, null),
    equal: spec.equal === true,
    curves: list(spec.curves).slice(0, 6).map((c, i) => ({ fn: compileExpr(c.fn), label: text(c.label), color: colorOf(c.color, i), dash: c.dash === true })),
    points: list(spec.points).slice(0, 12).map(p => ({ x: valueOf(p.x), y: valueOf(p.y), label: text(p.label, 24), color: colorOf(p.color, 1) })),
    segments: list(spec.segments).slice(0, 12).map(s => {
      const [x1, y1] = pair(s.from)
      const [x2, y2] = pair(s.to)
      return { x1, y1, x2, y2, label: text(s.label, 24), color: colorOf(s.color, 4), dash: s.dash === true, extend: s.extend === true }
    }),
    areas: list(spec.areas).slice(0, 4).map(a => ({ fn: compileExpr(a.fn), from: valueOf(a.from), to: valueOf(a.to), color: colorOf(a.color, 0) })),
    slider: null,
  }
  if (spec.slider && typeof spec.slider === 'object') {
    const { name, min, max } = spec.slider
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) || name === 'x') throw new Error('slider.name must be a letter other than x')
    if (![min, max].every(n => typeof n === 'number' && Number.isFinite(n)) || max <= min) throw new Error('slider needs min < max')
    const value = typeof spec.slider.value === 'number' ? Math.min(max, Math.max(min, spec.slider.value)) : (min + max) / 2
    const step = typeof spec.slider.step === 'number' && spec.slider.step > 0 ? spec.slider.step : (max - min) / 100
    plot.slider = { name, min, max, value, step, label: text(spec.slider.label, 30) || name }
  }
  if (!plot.curves.length && !plot.points.length && !plot.segments.length) throw new Error('nothing to draw')
  if (!plot.y) plot.y = autoY(plot)
  return plot
}

/** Scope for evaluating a plot at a slider position. */
export function scopeOf(plot, sliderValue) {
  return plot.slider ? { [plot.slider.name]: sliderValue ?? plot.slider.value } : {}
}

/** Pick a y-range that shows the curves and points without being blown up by poles. */
function autoY(plot) {
  const ys = []
  const positions = plot.slider ? [plot.slider.min, plot.slider.value, plot.slider.max] : [undefined]
  for (const at of positions) {
    const scope = scopeOf(plot, at)
    for (const c of plot.curves) {
      for (let i = 0; i <= 80; i++) {
        const y = c.fn({ ...scope, x: plot.x[0] + ((plot.x[1] - plot.x[0]) * i) / 80 })
        if (Number.isFinite(y)) ys.push(y)
      }
    }
    for (const p of plot.points) { const y = p.y(scope); if (Number.isFinite(y)) ys.push(y) }
    for (const s of plot.segments) if (!s.extend) for (const f of [s.y1, s.y2]) { const y = f(scope); if (Number.isFinite(y)) ys.push(y) }
  }
  if (!ys.length) return [-1, 1]
  ys.sort((a, b) => a - b)
  // Trim the extreme 4% on each side so 1/x and tan do not flatten everything else.
  const cut = ys.length > 60 ? Math.floor(ys.length * 0.04) : 0
  let lo = ys[cut]
  let hi = ys[ys.length - 1 - cut]
  if (lo > 0 && lo < (hi - lo) * 0.6) lo = 0
  if (hi < 0 && -hi < (hi - lo) * 0.6) hi = 0
  if (hi - lo < 1e-9) { lo -= 1; hi += 1 }
  const pad = (hi - lo) * 0.12
  return [lo - pad, hi + pad]
}

/** Tick positions at round numbers, about `count` of them. */
export function ticks(min, max, count = 5) {
  const span = max - min
  if (!(span > 0)) return []
  const rough = span / count
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const unit = [1, 2, 5, 10].find(u => u * pow >= rough) * pow
  const out = []
  for (let v = Math.ceil(min / unit) * unit; v <= max + unit * 1e-9; v += unit) out.push(Math.abs(v) < unit * 1e-9 ? 0 : Number(v.toPrecision(12)))
  return out
}

/**
 * Sample a curve into polylines in data coordinates, breaking at gaps and
 * jumps (so 1/x is two branches, not a vertical line through the pole).
 * @returns {[number, number][][]}
 */
export function sampleCurve(fn, scope, [x0, x1], [y0, y1], steps = 240) {
  const lines = []
  let line = []
  const span = y1 - y0
  let prev = null
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps
    const y = fn({ ...scope, x })
    const ok = Number.isFinite(y)
    const jump = ok && prev !== null && Math.abs(y - prev) > span * 2 && (y > y1 || y < y0 || prev > y1 || prev < y0)
    if (!ok || jump) {
      if (line.length > 1) lines.push(line)
      line = []
    }
    if (ok) {
      // Keep far-away values from producing absurd path numbers; the box clips the rest.
      line.push([x, Math.max(y0 - span * 3, Math.min(y1 + span * 3, y))])
      prev = y
    } else prev = null
  }
  if (line.length > 1) lines.push(line)
  return lines
}

/**
 * Parse a ```flow block: each line is a chain "A -> B -> C".
 * @returns {string[][]} rows of steps
 */
export function parseFlow(raw) {
  const rows = String(raw).split('\n').map(line => line.split(/\s*(?:->|→|=>|⇒)\s*/).map(s => s.replace(/^\s*[-*]\s+/, '').trim().slice(0, 60)).filter(Boolean)).filter(r => r.length > 0)
  if (!rows.length) throw new Error('empty flow')
  return rows.slice(0, 6).map(r => r.slice(0, 8))
}

/**
 * Parse a ```choices block: one option per line; "A." / "1)" / "-" prefixes are dropped.
 * @returns {string[]}
 */
export function parseChoices(raw) {
  const options = String(raw).split('\n').map(s => s.replace(/^\s*(?:[-*•]|[A-Ha-h1-8][.)、．])\s*/, '').trim().slice(0, 80)).filter(Boolean)
  if (options.length < 2) throw new Error('need at least two choices')
  return options.slice(0, 5)
}
