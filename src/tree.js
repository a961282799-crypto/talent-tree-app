/**
 * The talent-tree canvas: math typesetting, layout, the pannable / zoomable
 * stage (drag, pinch, wheel, buttons), node cards, detail sheet, learning
 * routes, recommendations, light-up celebrations and PNG export.
 * Ported from the DeepSeek Harness plugin's browser half.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'
import { buzz, saveFile } from './native.js'
import { NODE_TYPES, isFading as fading, nextReviewAt, nodeState as stateOf } from './graph.js'

const h = React.createElement
export const NODE_W = 168
export const NODE_H = 60
const GAP_X = 22
const GAP_Y = 58
const MIN_ZOOM = 0.3
const MAX_ZOOM = 2.4

const katexCache = new Map()
/** KaTeX HTML for one formula, or null when it cannot be typeset. */
export function katexHtml(tex) {
  if (katexCache.has(tex)) return katexCache.get(tex)
  let html = null
  try { html = katex.renderToString(tex, { throwOnError: true, output: 'html', strict: false }) } catch {}
  if (katexCache.size > 500) katexCache.clear()
  katexCache.set(tex, html)
  return html
}

// ---- icons --------------------------------------------------------------

function svg(size, children, extra) {
  return h('svg', Object.assign({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, extra), ...children)
}

/** Skill-tree glyph: a lit path (bronze → silver → gold star) and a still-open branch. */
function TreeIcon(props) {
  const size = props && props.size ? props.size : 16
  return svg(size, [
    h('path', { key: 'o', d: 'M12 19.8 16.35 14.51M16.33 10.52 12 5.4', stroke: 'var(--dsw-alias-label-tertiary, #a3a8b0)', strokeWidth: 1.5 }),
    h('path', { key: 'l', d: 'M12 19.8 6 12.5 12 5.4', strokeWidth: 1.6 }),
    h('circle', { key: 'a', cx: 6, cy: 12.5, r: 2.1, fill: 'currentColor', stroke: 'none' }),
    h('circle', { key: 'b', cx: 18, cy: 12.5, r: 1.9, strokeWidth: 1.4 }),
    h('circle', { key: 'c', cx: 12, cy: 19.8, r: 2.1, fill: 'currentColor', stroke: 'none' }),
    h('path', { key: 'd', d: 'M12.00 1.50 L12.97 4.07 L15.71 4.19 L13.57 5.91 L14.29 8.56 L12.00 7.05 L9.71 8.56 L10.43 5.91 L8.29 4.19 L11.03 4.07Z', fill: 'currentColor', stroke: 'none' }),
  ], { className: props && props.className })
}
const LockIcon = () => svg(15, [h('rect', { key: 'r', x: 5, y: 11, width: 14, height: 9, rx: 2 }), h('path', { key: 'p', d: 'M8 11V8a4 4 0 0 1 8 0v3' })])
const SparkIcon = ({ size }) => svg(size || 16, [h('path', { key: 'p', d: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18' })])
const StarIcon = () => svg(16, [h('path', { key: 'p', d: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z', fill: 'currentColor', stroke: 'none' })])
const FlagIcon = () => svg(16, [h('path', { key: 'p', d: 'M5 21V4M5 4h11l-2 4 2 4H5' })])
const PlusIcon = () => svg(15, [h('path', { key: 'p', d: 'M12 5v14M5 12h14' })])
const MinusIcon = () => svg(15, [h('path', { key: 'p', d: 'M5 12h14' })])
const FitIcon = () => svg(15, [h('path', { key: 'p', d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' })])
const CloseIcon = () => svg(15, [h('path', { key: 'p', d: 'M6 6l12 12M18 6 6 18' })])
const TargetIcon = () => svg(15, [h('circle', { key: 'a', cx: 12, cy: 12, r: 7 }), h('circle', { key: 'b', cx: 12, cy: 12, r: 2.5, fill: 'currentColor' }), h('path', { key: 'c', d: 'M12 2v3M12 19v3M2 12h3M19 12h3' })])
const BoltIcon = () => svg(14, [h('path', { key: 'p', d: 'M13 2 4 14h7l-1 8 9-12h-7z', fill: 'currentColor', stroke: 'none' })])
const ClockIcon = () => svg(14, [h('circle', { key: 'c', cx: 12, cy: 12, r: 8.5 }), h('path', { key: 'p', d: 'M12 7.5V12l3 2' })])
const RefreshIcon = () => svg(15, [h('path', { key: 'p', d: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4' })])

// ---- math ---------------------------------------------------------------
// Text may carry TeX between $…$ (or \( … \)). The app's own Markdown
// renderer typesets it with KaTeX when the shared primitives are present;
// otherwise a small built-in renderer draws fractions, roots, sub/superscripts
// and symbols. Plain text also gets light touches (√x, x_k, x^2) so older
// Unicode formulas read as math too.

const TEX_SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥',
  geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', propto: '∝', infty: '∞', sum: '∑', prod: '∏', int: '∫',
  oint: '∮', partial: '∂', nabla: '∇', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔',
  mapsto: '↦', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', forall: '∀', exists: '∃', emptyset: '∅',
  cdots: '⋯', ldots: '…', dots: '…', top: '⊤', perp: '⊥', angle: '∠', circ: '∘', star: '⋆', langle: '⟨', rangle: '⟩',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', mid: '|', '|': '‖', quad: ' ', qquad: '  ', ',': ' ',
  ';': ' ', ' ': ' ', '{': '{', '}': '}', '%': '%', '$': '$', '#': '#', '&': '&', _: '_',
  lim: 'lim', log: 'log', ln: 'ln', exp: 'exp', sin: 'sin', cos: 'cos', tan: 'tan', max: 'max', min: 'min', det: 'det',
  arg: 'arg', sup: 'sup', inf: 'inf', Pr: 'Pr', E: 'E', Var: 'Var',
}
const TEX_SKIP = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'displaystyle', 'textstyle', 'limits', '!'])
const TEX_TEXT = new Set(['text', 'mathrm', 'operatorname', 'mathit', 'mathbf', 'boldsymbol', 'textbf', 'mathsf', 'mathcal', 'mathbb', 'vec', 'hat', 'bar', 'overline', 'tilde', 'dot'])
const BLACKBOARD = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', E: '𝔼', P: 'ℙ' }
const ACCENT = { vec: '⃗', hat: '̂', bar: '̅', overline: '̅', tilde: '̃', dot: '̇' }
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', T: 'ᵀ', k: 'ᵏ', x: 'ˣ', '⊤': 'ᵀ', '′': '′' }
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' }

/** Parse TeX into a small tree: strings, {frac}, {sqrt}, {sup}, {sub}, {accent}. */
function parseTex(src) {
  let i = 0
  const group = () => {
    while (src[i] === ' ') i++
    if (src[i] === '{') {
      i++
      const out = seq('}')
      i++
      return out
    }
    if (src[i] === '\\') return seq(null, 1)
    const ch = src[i]
    i++
    return ch === undefined ? [] : [ch]
  }
  const seq = (end, limit) => {
    const out = []
    while (i < src.length && src[i] !== end && (limit === undefined || out.length < limit)) {
      const ch = src[i]
      if (ch === '\\') {
        const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i))
        const name = m ? m[1] : ''
        i += m ? m[0].length : 1
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') out.push({ frac: [group(), group()] })
        else if (name === 'sqrt') {
          let index = null
          if (src[i] === '[') { const close = src.indexOf(']', i); index = src.slice(i + 1, close); i = close + 1 }
          out.push({ sqrt: group(), index })
        } else if (name === 'mathbb') {
          const g = group()
          out.push(g.map(x => (typeof x === 'string' && BLACKBOARD[x] ? BLACKBOARD[x] : x)).join(''))
        } else if (ACCENT[name]) out.push({ accent: ACCENT[name], body: group() })
        else if (TEX_TEXT.has(name)) out.push(...group())
        else if (TEX_SKIP.has(name)) continue
        else if (TEX_SYMBOLS[name] !== undefined) out.push(TEX_SYMBOLS[name])
        else out.push(name)
      } else if (ch === '^' || ch === '_') {
        i++
        out.push({ [ch === '^' ? 'sup' : 'sub']: group() })
      } else if (ch === '{') {
        i++
        out.push(...seq('}'))
        i++
      } else {
        out.push(ch === "'" ? '′' : ch === '-' ? '−' : ch)
        i++
      }
    }
    return out
  }
  return seq(undefined)
}

/** TeX as Unicode text (for canvas export and plain fallbacks). */
function texToUnicode(src) {
  const flat = list => list.map(one).join('')
  const script = (map, body, mark) => {
    const s = flat(body)
    return Array.from(s).every(c => map[c]) ? Array.from(s).map(c => map[c]).join('') : `${mark}${s.length > 1 ? `(${s})` : s}`
  }
  // A single token (x, 10, dₖ, √x, (a+b)) needs no parentheses around it.
  const atom = s => /^[\p{L}\p{N}.]+[\u2070-\u209f\u1d40-\u1d6a\u02e3\u2071\u207f\u2c7c′]*$/u.test(s) || /^√?\([^()]*\)$/u.test(s) || /^√[^\s/()+\-−=]+$/u.test(s)
  const wrap = s => (atom(s) ? s : `(${s})`)
  function one(x) {
    if (typeof x === 'string') return x
    if (x.frac) return `${wrap(flat(x.frac[0]))}/${wrap(flat(x.frac[1]))}`
    if (x.sqrt) return `${x.index ? script(SUP, [x.index], '^') : ''}√${wrap(flat(x.sqrt))}`
    if (x.sup) return script(SUP, x.sup, '^')
    if (x.sub) return script(SUB, x.sub, '_')
    if (x.accent) return flat(x.body) + x.accent
    return ''
  }
  return flat(parseTex(src))
}

function texToReact(src) {
  let k = 0
  const many = list => list.map(one)
  function one(x) {
    const key = k++
    if (typeof x === 'string') return x
    if (x.frac) return h('span', { key, className: 'tt-frac' }, h('span', null, many(x.frac[0])), h('span', null, many(x.frac[1])))
    if (x.sqrt) return h('span', { key, className: 'tt-sqrt' }, x.index ? h('span', { className: 'tt-sqrt-index' }, x.index) : null, h('span', { className: 'tt-sr' }, '√'), many(x.sqrt))
    if (x.sup) return h('sup', { key }, many(x.sup))
    if (x.sub) return h('sub', { key }, many(x.sub))
    if (x.accent) return h('span', { key }, many(x.body), x.accent)
    return null
  }
  return h('span', { className: 'tt-tex-lite' }, many(parseTex(src)))
}

/** Split text into plain and math parts: $…$, $$…$$ and \( … \). */
function splitMath(text) {
  const parts = []
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) })
    parts.push({ tex: (m[1] || m[2] || m[3]).trim() })
    last = re.lastIndex
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/** Plain text with light math touches: √x gets a vinculum, x_k / x^2 become sub/superscripts. */
function prettyPlain(text, keyBase) {
  const out = []
  const re = /√\(([^()]+)\)|√([A-Za-z0-9]+(?:_\{?[A-Za-z0-9]+\}?)?)|([A-Za-z0-9)\]])_\{([^{}]+)\}|([A-Za-z0-9)\]])_([A-Za-z0-9])(?![A-Za-z0-9])|([A-Za-z0-9)\]])\^\{([^{}]+)\}|([A-Za-z0-9)\]])\^([A-Za-z0-9]+)/g
  let last = 0
  let m
  let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = `${keyBase}-${k++}`
    if (m[1] !== undefined || m[2] !== undefined) {
      const body = m[1] !== undefined ? m[1] : m[2]
      out.push(h('span', { key, className: 'tt-sqrt' }, h('span', { className: 'tt-sr' }, '√'), prettyPlain(body, key)))
    } else if (m[3] !== undefined) out.push(m[3], h('sub', { key }, m[4]))
    else if (m[5] !== undefined) out.push(m[5], h('sub', { key }, m[6]))
    else if (m[7] !== undefined) out.push(m[7], h('sup', { key }, m[8]))
    else out.push(m[9], h('sup', { key }, m[10]))
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Text with inline math. Formulas use KaTeX when available, otherwise the built-in renderer. */
function Rich({ text }) {
  if (typeof text !== 'string' || text === '') return null
  return h('span', { className: 'tt-rich' }, splitMath(text).map((part, i) => {
    if (part.text !== undefined) return h(React.Fragment, { key: i }, prettyPlain(part.text, i))
    const html = katexHtml(part.tex)
    if (html) return h('span', { key: i, className: 'tt-tex', dangerouslySetInnerHTML: { __html: html } })
    return h(React.Fragment, { key: i }, texToReact(part.tex))
  }))
}

/** Plain-string form of rich text (aria labels, canvas export). */
function richToPlain(text) {
  if (typeof text !== 'string') return ''
  return splitMath(text).map(p => (p.text !== undefined ? p.text : texToUnicode(p.tex))).join('')
}

// ---- pure helpers -------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Layered layout: foundations on top, goals at the bottom. */
function layout(nodes) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  const depth = {}
  const depthOf = id => {
    if (depth[id] !== undefined) return depth[id]
    depth[id] = 0 // cycle guard; the Host rejects cycles
    const pre = byId[id].prerequisites.filter(p => byId[p])
    depth[id] = pre.length ? 1 + Math.max(...pre.map(depthOf)) : 0
    return depth[id]
  }
  nodes.forEach(n => depthOf(n.id))
  const layers = []
  nodes.forEach(n => { (layers[depth[n.id]] = layers[depth[n.id]] || []).push(n.id) })
  // Barycenter passes, downward then upward, to reduce crossings.
  const pos = {}
  layers.forEach(layer => layer.forEach((id, i) => { pos[id] = i }))
  const children = {}
  nodes.forEach(n => n.prerequisites.forEach(p => { (children[p] = children[p] || []).push(n.id) }))
  for (let pass = 0; pass < 3; pass++) {
    for (let d = 1; d < layers.length; d++) {
      const bary = id => {
        const pre = byId[id].prerequisites.filter(p => pos[p] !== undefined)
        return pre.length ? pre.reduce((s, p) => s + pos[p], 0) / pre.length : pos[id]
      }
      layers[d].sort((a, b) => bary(a) - bary(b))
      layers[d].forEach((id, i) => { pos[id] = i })
    }
    for (let d = layers.length - 2; d >= 0; d--) {
      const bary = id => {
        const ch = (children[id] || []).filter(c => pos[c] !== undefined)
        return ch.length ? ch.reduce((s, c) => s + pos[c], 0) / ch.length : pos[id]
      }
      layers[d].sort((a, b) => bary(a) - bary(b))
      layers[d].forEach((id, i) => { pos[id] = i })
    }
  }
  const widest = Math.max(1, ...layers.map(l => l.length))
  const width = widest * NODE_W + (widest - 1) * GAP_X
  const coords = {}
  layers.forEach((layer, d) => {
    const rowW = layer.length * NODE_W + (layer.length - 1) * GAP_X
    const x0 = (width - rowW) / 2
    layer.forEach((id, i) => { coords[id] = { x: x0 + i * (NODE_W + GAP_X), y: d * (NODE_H + GAP_Y) } })
  })
  return { coords, width, height: Math.max(NODE_H, layers.length * NODE_H + (layers.length - 1) * GAP_Y) }
}

function related(nodes, id) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  const set = new Set([id])
  const up = x => (byId[x] ? byId[x].prerequisites : []).forEach(p => { if (!set.has(p)) { set.add(p); up(p) } })
  const down = x => nodes.forEach(n => { if (n.prerequisites.includes(x) && !set.has(n.id)) { set.add(n.id); down(n.id) } })
  up(id)
  down(id)
  return set
}

/** The goal node and everything it depends on. */
function closure(nodes, goalId) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  const keep = new Set()
  const walk = id => {
    if (keep.has(id) || !byId[id]) return
    keep.add(id)
    byId[id].prerequisites.forEach(walk)
  }
  walk(goalId)
  return nodes.filter(n => keep.has(n.id))
}

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (values[k] !== undefined ? String(values[k]) : m))
}

function stats(nodes) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  const medals = { 1: 0, 2: 0, 3: 0 }
  let lit = 0
  let frontier = 0
  nodes.forEach(n => {
    if (n.mastery >= 1) { lit++; medals[n.mastery] = (medals[n.mastery] || 0) + 1 }
    else if (stateOf(n, byId) === 'available') frontier++
  })
  return { lit, frontier, medals, total: nodes.length }
}

function ago(t, at, now) {
  const m = Math.round((now - at) / 60000)
  if (!(m >= 1)) return t('time.now')
  if (m < 60) return fill(t('time.minutes'), { n: m })
  if (m < 60 * 24) return fill(t('time.hours'), { n: Math.round(m / 60) })
  return fill(t('time.days'), { n: Math.round(m / 1440) })
}

/**
 * The unlit nodes standing between the learner and `targetId`, target
 * included, in a learnable order: each step's prerequisites are lit or come
 * earlier. Shallow foundations first.
 */
function learningRoute(nodes, targetId) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  if (!byId[targetId] || byId[targetId].mastery >= 1) return []
  const need = new Set()
  const walk = id => {
    const n = byId[id]
    if (!n || need.has(id) || n.mastery >= 1) return
    need.add(id)
    n.prerequisites.forEach(walk)
  }
  walk(targetId)
  const depth = {}
  const depthOf = id => {
    if (depth[id] !== undefined) return depth[id]
    depth[id] = 0
    const pre = byId[id].prerequisites.filter(p => need.has(p))
    depth[id] = pre.length ? 1 + Math.max(...pre.map(depthOf)) : 0
    return depth[id]
  }
  const order = nodes.map(n => n.id).filter(id => need.has(id))
  order.forEach(depthOf)
  const done = new Set()
  const out = []
  while (out.length < order.length) {
    const ready = order.filter(id => !done.has(id) && byId[id].prerequisites.every(p => !need.has(p) || done.has(p)))
    if (ready.length === 0) break // cycle guard; the Host rejects cycles
    ready.sort((a, b) => depth[a] - depth[b] || (byId[b].weak ? 1 : 0) - (byId[a].weak ? 1 : 0))
    done.add(ready[0])
    out.push(ready[0])
  }
  return out
}

/** The node to study next: the first step toward the first unfinished goal, else one due for review. */
function recommend(nodes, goalIds) {
  const sinks = nodes.filter(n => !nodes.some(m => m.prerequisites.includes(n.id))).map(n => n.id)
  for (const id of goalIds.length ? goalIds : sinks) {
    const route = learningRoute(nodes, id)
    if (route.length) return route[0]
  }
  const now = Date.now()
  const due = nodes.find(n => fading(n, now))
  return due ? due.id : null
}

/** Today's review queue: points that need shoring up first, then lit points whose review is due (oldest first). */
function reviewQueue(nodes, now) {
  return nodes
    .filter(n => n.weak || fading(n, now))
    .sort((a, b) => (b.weak ? 1 : 0) - (a.weak ? 1 : 0) || (a.reviewedAt || 0) - (b.reviewedAt || 0))
}

function reviewPrompt(t, due) {
  return fill(t('prompt.reviewBatch'), { list: due.map(n => `${richToPlain(n.name)}（${n.id}）`).join('、'), n: due.length })
}

// ---- export -------------------------------------------------------------

const EXPORT_FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif'
const EXPORT_MEDAL = ['', '#c8834c', '#93a4bd', '#eeb031']
const EXPORT_TINT = ['', '#f7e9dc', '#e8eef6', '#fcf1d4']

/** Card corner radii per knowledge type (matches the .tt-shape-* styles). */
function exportRadii(type, h) {
  if (type === 'theorem') return 5
  if (type === 'proof_idea') return [22, 5, 22, 5]
  if (type === 'skill') return h / 2
  return 15
}

/** Badge outline per knowledge type (matches the .tt-bshape-* styles). */
function exportBadgePath(c, type, x, y, r) {
  c.beginPath()
  if (type === 'theorem') c.roundRect(x - r, y - r, 2 * r, 2 * r, 9)
  else if (type === 'method') { const d = r * 1.2; c.moveTo(x, y - d); c.lineTo(x + d, y); c.lineTo(x, y + d); c.lineTo(x - d, y); c.closePath() }
  else if (type === 'proof_idea') c.roundRect(x - r, y - r, 2 * r, 2 * r, [r, 5, r, 5])
  else if (type === 'skill') c.roundRect(x - r, y - r, 2 * r, 2 * r, [r, r, r * 1.3, r * 1.3])
  else c.arc(x, y, r, 0, Math.PI * 2)
}

function fitText(c, text, max) {
  if (c.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && c.measureText(s + '…').width > max) s = s.slice(0, -1)
  return s + '…'
}

function wrapText(c, text, max, lines) {
  const out = []
  let line = ''
  for (const ch of Array.from(text)) {
    if (c.measureText(line + ch).width > max && line) {
      out.push(line)
      line = ch
      if (out.length === lines) break
    } else line += ch
  }
  if (out.length < lines && line) out.push(line)
  if (out.length === lines && out.join('').length < text.length) out[lines - 1] = fitText(c, out[lines - 1] + '…', max)
  return out
}

/** Draw the whole tree on a canvas (light theme) and save it as PNG; also copies it when allowed. */
async function exportPng(t, title, nodes, goalIds) {
  const { coords, width, height } = layout(nodes)
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  const hooks = nodes.some(n => n.hook)
  const cardH = hooks ? NODE_H + 38 : NODE_H
  const rowH = NODE_H + GAP_Y
  const layers = Math.round((height - NODE_H) / rowH) + 1
  const pad = 48
  const headH = 104
  const footH = 46
  const contentH = layers * cardH + (layers - 1) * GAP_Y
  const W = Math.max(width + pad * 2, 640)
  const H = headH + contentH + footH + 24
  const ox = (W - width) / 2
  const pos = id => ({ x: ox + coords[id].x, y: headH + Math.round(coords[id].y / rowH) * (cardH + GAP_Y) })
  const scale = clamp(Math.min(2, 8000 / W, 8000 / H), 0.5, 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(W * scale)
  canvas.height = Math.round(H * scale)
  const c = canvas.getContext('2d')
  c.scale(scale, scale)
  c.fillStyle = '#f7f8fa'
  c.fillRect(0, 0, W, H)
  c.fillStyle = '#dfe3ea'
  for (let x = 11; x < W; x += 22) for (let y = headH - 10; y < H - footH; y += 22) { c.beginPath(); c.arc(x, y, 1, 0, Math.PI * 2); c.fill() }
  // Header
  const s = stats(nodes)
  c.textBaseline = 'alphabetic'
  c.fillStyle = '#1f2329'
  c.font = `700 24px ${EXPORT_FONT}`
  c.fillText(fitText(c, title, W - pad * 2), pad, 50)
  c.font = `400 13px ${EXPORT_FONT}`
  c.fillStyle = '#5f6672'
  const meta = `${fill(t('progress'), { lit: s.lit, total: s.total })}   ${fill(t('frontier'), { n: s.frontier })}   ${fill(t('medal.summary'), { b: s.medals[1], s: s.medals[2], g: s.medals[3] })}`
  c.fillText(meta, pad, 76)
  c.fillStyle = '#e6e8ec'
  c.beginPath(); c.roundRect(pad, 86, 220, 6, 3); c.fill()
  const grad = c.createLinearGradient(pad, 0, pad + 220, 0)
  grad.addColorStop(0, '#c8834c'); grad.addColorStop(1, '#eeb031')
  c.fillStyle = grad
  c.beginPath(); c.roundRect(pad, 86, Math.max(6, 220 * (s.total ? s.lit / s.total : 0)), 6, 3); c.fill()
  // Edges
  c.lineCap = 'round'
  nodes.forEach(n => n.prerequisites.forEach(p => {
    if (!byId[p]) return
    const a = pos(p)
    const b = pos(n.id)
    const x1 = a.x + NODE_W / 2
    const y1 = a.y + cardH
    const x2 = b.x + NODE_W / 2
    const y2 = b.y
    const my = (y1 + y2) / 2
    const fromLit = byId[p].mastery >= 1
    const toLit = n.mastery >= 1
    c.setLineDash(fromLit && toLit ? [] : fromLit ? [7, 7] : [3, 6])
    c.strokeStyle = fromLit && toLit ? EXPORT_MEDAL[Math.min(byId[p].mastery, n.mastery)] : fromLit ? '#4d6bfe' : '#b8bec8'
    c.lineWidth = fromLit && toLit ? 2.6 : fromLit ? 2.2 : 1.5
    c.beginPath(); c.moveTo(x1, y1); c.bezierCurveTo(x1, my, x2, my, x2, y2); c.stroke()
  }))
  c.setLineDash([])
  // Nodes
  nodes.forEach(n => {
    const { x, y } = pos(n.id)
    const state = stateOf(n, byId)
    const m = n.mastery || 0
    c.save()
    if (state === 'lit') { c.shadowColor = EXPORT_MEDAL[m]; c.shadowBlur = 14 }
    const radii = exportRadii(n.type, cardH)
    c.beginPath(); c.roundRect(x, y, NODE_W, cardH, radii)
    if (state === 'lit') {
      const g = c.createLinearGradient(x, y, x + NODE_W, y + cardH)
      g.addColorStop(0, EXPORT_TINT[m]); g.addColorStop(0.75, '#ffffff')
      c.fillStyle = g
    } else c.fillStyle = state === 'available' ? '#eef1ff' : '#f1f2f4'
    c.fill()
    c.restore()
    c.setLineDash(state === 'available' ? [5, 4] : [])
    c.lineWidth = goalIds.has(n.id) ? 2.4 : 1.5
    c.strokeStyle = n.weak ? '#f08a24' : state === 'lit' ? EXPORT_MEDAL[m] : state === 'available' ? '#4d6bfe' : '#d5d9df'
    c.lineWidth = n.type === 'theorem' ? Math.max(c.lineWidth, 2) : c.lineWidth
    c.beginPath(); c.roundRect(x, y, NODE_W, cardH, radii); c.stroke()
    if (n.type === 'method') {
      c.fillStyle = c.strokeStyle
      c.beginPath(); c.roundRect(x, y + 6, 5, cardH - 12, 2.5); c.fill()
    }
    c.setLineDash([])
    // Badge
    const bx = x + 26
    const by = y + NODE_H / 2
    c.fillStyle = state === 'lit' ? EXPORT_MEDAL[m] : state === 'available' ? '#dfe5ff' : '#e6e8ec'
    exportBadgePath(c, n.type, bx, by, 17); c.fill()
    c.fillStyle = state === 'lit' ? '#ffffff' : state === 'available' ? '#4d6bfe' : '#8f959e'
    c.font = `700 15px ${EXPORT_FONT}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(state === 'lit' ? '★' : state === 'available' ? '✦' : goalIds.has(n.id) ? '⚑' : '•', bx, by + 1)
    c.textAlign = 'left'
    c.textBaseline = 'alphabetic'
    // Text
    const tx = x + 52
    const tw = NODE_W - 52 - 10
    c.fillStyle = state === 'locked' ? '#5f6672' : '#1f2329'
    c.font = `650 12.5px ${EXPORT_FONT}`
    const lines = wrapText(c, richToPlain(n.name), tw, 2)
    const top = y + NODE_H / 2 - (lines.length === 2 ? 12 : 4)
    lines.forEach((line, i) => c.fillText(line, tx, top + i * 15))
    c.font = `400 11px ${EXPORT_FONT}`
    c.fillStyle = state === 'lit' ? EXPORT_MEDAL[m] : '#8f959e'
    c.fillText(fitText(c, state === 'lit' ? t(`level.${m}`) : `${t(`type.${n.type}`)} · ${t(`state.${state}`)}`, tw), tx, top + lines.length * 15 + 1)
    if (hooks && n.hook) {
      c.fillStyle = state === 'locked' ? '#8f959e' : '#8a5a00'
      c.font = `400 10.5px ${EXPORT_FONT}`
      const hookLines = wrapText(c, `💡 ${richToPlain(n.hook)}`, NODE_W - 20, 2)
      hookLines.forEach((line, i) => c.fillText(line, x + 10, y + NODE_H + 4 + i * 14))
    }
    if (goalIds.has(n.id)) {
      c.font = `700 10.5px ${EXPORT_FONT}`
      const label = t('flag.goal')
      const lw = c.measureText(label).width + 16
      c.fillStyle = '#eeb031'
      c.beginPath(); c.roundRect(x + NODE_W - lw - 12, y - 9, lw, 18, 9); c.fill()
      c.fillStyle = '#5b3a00'
      c.fillText(label, x + NODE_W - lw - 4, y + 4)
    }
  })
  // Footer
  c.font = `400 12px ${EXPORT_FONT}`
  c.fillStyle = '#8f959e'
  c.fillText(`${t('export.footer')} · ${new Date().toLocaleDateString()}`, pad, H - 22)
  const blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'))
  const name = `${t('export.filename')}-${title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'tree'}.png`
  return saveFile(blob, name, 'image/png')
}

function ProgressRing({ lit, total, size }) {
  const s = size || 52
  const mini = s < 32
  const stroke = mini ? 3 : 5
  const r = s / 2 - stroke / 2 - 1
  const c = 2 * Math.PI * r
  const ratio = total ? lit / total : 0
  return h('div', { className: 'tt-ring', style: { width: s, height: s }, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': lit },
    h('svg', { width: s, height: s, viewBox: `0 0 ${s} ${s}`, 'aria-hidden': true },
      h('defs', null, h('linearGradient', { id: 'tt-ring-grad', x1: 0, y1: 0, x2: 1, y2: 1 },
        h('stop', { offset: '0%', stopColor: '#c8834c' }), h('stop', { offset: '100%', stopColor: '#eeb031' }))),
      h('circle', { cx: s / 2, cy: s / 2, r, fill: 'none', stroke: 'var(--tt-bg2)', strokeWidth: stroke }),
      h('circle', { cx: s / 2, cy: s / 2, r, fill: 'none', stroke: 'url(#tt-ring-grad)', strokeWidth: stroke, strokeLinecap: 'round', strokeDasharray: c, strokeDashoffset: c * (1 - ratio) })),
    mini ? null : h('b', null, `${Math.round(ratio * 100)}%`))
}

function Hero({ t, title, nodes, extra, onReview }) {
  const s = stats(nodes)
  const due = reviewQueue(nodes, Date.now())
  const review = due.length && onReview
    ? h('button', { type: 'button', className: 'tt-review', title: due.map(n => richToPlain(n.name)).join('、'), onClick: () => onReview(due) },
      h(ClockIcon), fill(t('review.today'), { n: due.length }))
    : null
  return h('div', { className: 'tt-hero' },
    h(ProgressRing, { lit: s.lit, total: s.total }),
    h('div', { className: 'tt-hero-text' },
      h('div', { className: 'tt-goal', title }, title),
      h('div', { className: 'tt-meta' },
        h('span', null, fill(t('progress'), { lit: s.lit, total: s.total })),
        h('span', null, fill(t('frontier'), { n: s.frontier })),
        h('span', { className: 'tt-medals' }, [1, 2, 3].map(level => h('span', { key: level, className: 'tt-medal', title: t(`level.${level}`) },
          h('i', { style: { background: ['', '#c8834c', '#93a4bd', '#eeb031'][level] } }), `${t(`medal.${level}`)} ${s.medals[level]}`))))),
    review,
    extra || null)
}

/**
 * Pannable, zoomable stage. Drag anywhere (also on nodes) to pan; a drag
 * suppresses the click it would otherwise produce. Wheel zooms around the
 * cursor (trackpad two-finger scroll pans, pinch zooms). `camera` receives
 * flyTo/fit so the stage can move the view; `focus` is the canvas point the
 * automatic fit zooms in on when the whole tree would be too small to read.
 * `children` may be a function of the current view.
 */
function Viewport({ t, width, height, fitKey, focus, camera, children, overlay, tools, onBlankTap }) {
  const ref = useRef(null)
  const [view, setView] = useState({ x: 24, y: 24, k: 1 })
  const [dragging, setDragging] = useState(false)
  const viewRef = useRef(view)
  const drag = useRef(null)
  const touched = useRef(false)
  const suppress = useRef(false)
  const anim = useRef(0)
  const focusRef = useRef(focus)
  focusRef.current = focus

  const put = useCallback(v => {
    viewRef.current = v
    setView(v)
  }, [])
  const stop = () => {
    if (anim.current && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(anim.current)
    anim.current = 0
  }
  const update = fn => {
    stop()
    put(fn(viewRef.current))
  }

  const fitView = useCallback(() => {
    const el = ref.current
    if (!el || !el.clientWidth || !el.clientHeight) return null
    // Room for the legend / zoom bar above and the hint below.
    // Phones keep room for the floating "continue" button at the bottom.
    const padX = 28
    const padTop = 92
    const padBottom = el.clientWidth < 520 ? 88 : 40
    const k = clamp(Math.min((el.clientWidth - padX * 2) / width, (el.clientHeight - padTop - padBottom) / height, 1), MIN_ZOOM, 1)
    return { k, x: (el.clientWidth - width * k) / 2, y: Math.max(padTop, padTop + (el.clientHeight - padTop - padBottom - height * k) / 2) }
  }, [width, height])

  /** Center canvas point (cx, cy) at zoom k; animated unless instant. */
  const flyTo = useCallback((cx, cy, options) => {
    const el = ref.current
    if (!el || !el.clientWidth) return
    const opts = options || {}
    touched.current = true
    const from = viewRef.current
    const k = clamp(opts.k !== undefined ? opts.k : Math.max(from.k, 0.8), MIN_ZOOM, MAX_ZOOM)
    const anchorY = opts.anchorY !== undefined ? opts.anchorY : 0.45
    const to = { k, x: el.clientWidth / 2 - cx * k, y: el.clientHeight * anchorY - cy * k }
    stop()
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (opts.instant || reduce || typeof requestAnimationFrame !== 'function') { put(to); return }
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const duration = 520
    const step = now => {
      const p = clamp((now - start) / duration, 0, 1)
      const e = 1 - Math.pow(1 - p, 3)
      // Ease zoom in log space so zooming feels even.
      const kk = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e)
      put({ k: kk, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e })
      anim.current = p < 1 ? requestAnimationFrame(step) : 0
    }
    anim.current = requestAnimationFrame(step)
  }, [put])

  const fit = useCallback(smart => {
    const v = fitView()
    if (!v) return
    const f = focusRef.current
    const el = ref.current
    // On a phone, a whole tree squeezed into the screen is too small to read:
    // open at normal size on the recommended point instead (the fit button shows everything).
    const narrow = el.clientWidth < 520
    const readable = narrow ? 0.88 : 0.62
    if (smart && f && v.k < readable) {
      const k = narrow ? 1 : 0.9
      put({ k, x: el.clientWidth / 2 - f.x * k, y: el.clientHeight * 0.4 - f.y * k })
    } else put(v)
  }, [fitView, put])

  /**
   * Make sure a node centred on canvas point (cx, cy) is fully visible in the part of
   * the view that `bottomInset` pixels of detail card leave free; fly there if not.
   */
  const reveal = (cx, cy, bottomInset) => {
    const el = ref.current
    if (!el || !el.clientWidth) return
    const v = viewRef.current
    const top = 52
    const bottom = el.clientHeight - (bottomInset || 0) - 14
    const k = el.clientWidth < 520 ? Math.max(v.k, 0.85) : v.k
    const sx = cx * v.k + v.x
    const sy = cy * v.k + v.y
    const half = (NODE_H / 2 + 26) * v.k
    if (k === v.k && sx > 30 && sx < el.clientWidth - 30 && sy - half > top && sy + half < bottom) return
    flyTo(cx, cy, { k, anchorY: clamp((top + bottom) / 2 / el.clientHeight, 0.12, 0.6) })
  }
  if (camera) camera.current = { flyTo, reveal, fit: () => { touched.current = false; stop(); fit(false) } }

  const zoomAt = useCallback((px, py, factor) => {
    touched.current = true
    stop()
    const v = viewRef.current
    const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM)
    put({ k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) })
  }, [put])

  const zoomCenter = factor => {
    const el = ref.current
    if (el) zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor)
  }

  // Released on unmount too, so an interrupted drag never leaves the page unselectable.
  useEffect(() => () => { lockSelection(false); stop() }, [])

  // Fit when the tree changes, and on resize until the learner moves the view.
  useEffect(() => {
    touched.current = false
    fit(true)
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => { if (!touched.current) fit(true) })
    observer.observe(el)
    return () => observer.disconnect()
  }, [fitKey, fit])

  // Wheel needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const onWheel = event => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      // A mouse wheel moves in notches (wheelDelta multiples of 120, or line/page mode); with
      // display scaling its pixel delta is fractional, so the delta alone cannot tell it apart.
      const notch = typeof event.wheelDeltaY === 'number' && event.wheelDeltaY !== 0 && event.wheelDeltaY % 120 === 0
      const mouseWheel = event.deltaMode !== 0 || (event.deltaX === 0 && (notch || Math.abs(event.deltaY) >= 50))
      if (event.ctrlKey || event.metaKey || mouseWheel) {
        zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-clamp(event.deltaY, -60, 60) * (event.ctrlKey ? 0.01 : 0.004)))
      } else {
        touched.current = true
        update(v => ({ k: v.k, x: v.x - event.deltaX, y: v.y - event.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Touch: one finger pans, two fingers pinch-zoom around their midpoint.
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const local = event => {
    const rect = ref.current.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const startPinch = () => {
    const [p, q] = [...pointers.current.values()]
    const v = viewRef.current
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
    pinch.current = { dist: Math.max(10, Math.hypot(p.x - q.x, p.y - q.y)), cx: (mid.x - v.x) / v.k, cy: (mid.y - v.y) / v.k, k: v.k }
  }
  const onPointerDown = event => {
    if (event.button !== 0) return
    if (event.target.closest && event.target.closest('.tt-overlay, .tt-card')) return
    // Keep the browser from starting a text selection (or a native drag) that
    // would follow the pointer out of the canvas; focus the canvas ourselves.
    if (event.pointerType === 'mouse') {
      event.preventDefault()
      if (ref.current && typeof ref.current.focus === 'function') ref.current.focus({ preventScroll: true })
    }
    stop()
    pointers.current.set(event.pointerId, local(event))
    if (pointers.current.size === 2) {
      // A second finger turns the gesture into a pinch; the tap it started is cancelled.
      if (drag.current) drag.current.moved = true
      touched.current = true
      setDragging(true)
      try { ref.current.setPointerCapture(event.pointerId) } catch {}
      startPinch()
      return
    }
    if (pointers.current.size > 2) return
    drag.current = { id: event.pointerId, sx: event.clientX, sy: event.clientY, x: viewRef.current.x, y: viewRef.current.y, moved: false, slop: event.pointerType === 'mouse' ? 4 : 9 }
  }
  const onPointerMove = event => {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, local(event))
    if (pinch.current && pointers.current.size >= 2) {
      const [p, q] = [...pointers.current.values()]
      const s = pinch.current
      const k = clamp(s.k * Math.hypot(p.x - q.x, p.y - q.y) / s.dist, MIN_ZOOM, MAX_ZOOM)
      const mx = (p.x + q.x) / 2
      const my = (p.y + q.y) / 2
      put({ k, x: mx - s.cx * k, y: my - s.cy * k })
      return
    }
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    const dx = event.clientX - d.sx
    const dy = event.clientY - d.sy
    if (!d.moved) {
      if (Math.hypot(dx, dy) < d.slop) return
      d.moved = true
      touched.current = true
      setDragging(true)
      lockSelection(true)
      try { ref.current.setPointerCapture(event.pointerId) } catch {}
    }
    put({ k: viewRef.current.k, x: d.x + dx, y: d.y + dy })
  }
  const endDrag = event => {
    pointers.current.delete(event.pointerId)
    if (pinch.current) {
      if (pointers.current.size >= 2) { startPinch(); return }
      pinch.current = null
      // The finger still down carries on panning from where it is.
      const [rest] = [...pointers.current.entries()]
      if (rest) {
        const rect = ref.current.getBoundingClientRect()
        drag.current = { id: rest[0], sx: rest[1].x + rect.left, sy: rest[1].y + rect.top, x: viewRef.current.x, y: viewRef.current.y, moved: true, slop: 0 }
        return
      }
      drag.current = null
      suppress.current = true
      setTimeout(() => { suppress.current = false }, 0)
      setDragging(false)
      return
    }
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    drag.current = null
    lockSelection(false)
    if (d.moved) {
      suppress.current = true
      setTimeout(() => { suppress.current = false }, 0)
      setDragging(false)
    }
  }
  const onClickCapture = event => {
    if (!suppress.current) return
    event.stopPropagation()
    event.preventDefault()
  }
  const onClick = event => {
    if (onBlankTap && !(event.target.closest && event.target.closest('.tt-node, .tt-overlay, .tt-card'))) onBlankTap()
  }
  const onDoubleClick = event => {
    if (event.target.closest && event.target.closest('.tt-node, .tt-overlay, .tt-card')) return
    touched.current = false
    stop()
    fit(false)
  }
  const onKeyDown = event => {
    if (event.target !== ref.current) return
    const stepPx = 60
    const moves = { ArrowLeft: [stepPx, 0], ArrowRight: [-stepPx, 0], ArrowUp: [0, stepPx], ArrowDown: [0, -stepPx] }
    if (moves[event.key]) {
      event.preventDefault()
      touched.current = true
      update(v => ({ k: v.k, x: v.x + moves[event.key][0], y: v.y + moves[event.key][1] }))
    } else if (event.key === '+' || event.key === '=') zoomCenter(1.2)
    else if (event.key === '-') zoomCenter(1 / 1.2)
    else if (event.key === '0') { touched.current = false; stop(); fit(false) }
  }

  const grid = 22 * view.k
  return h(React.Fragment, null,
    h('div', {
      ref, tabIndex: 0, className: 'tt-viewport' + (dragging ? ' tt-dragging' : ''),
      style: { backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` },
      onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag,
      onClickCapture, onClick, onDoubleClick, onKeyDown,
    },
    h('div', { className: 'tt-canvas', style: { width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` } },
      typeof children === 'function' ? children(view) : children)),
    h('div', { className: 'tt-overlay tt-zoom' },
      tools || null,
      h('button', { type: 'button', className: 'tt-icon-btn', title: t('view.zoomOut'), 'aria-label': t('view.zoomOut'), onClick: () => zoomCenter(1 / 1.25) }, h(MinusIcon)),
      h('span', { className: 'tt-zoom-val' }, `${Math.round(view.k * 100)}%`),
      h('button', { type: 'button', className: 'tt-icon-btn', title: t('view.zoomIn'), 'aria-label': t('view.zoomIn'), onClick: () => zoomCenter(1.25) }, h(PlusIcon)),
      h('button', { type: 'button', className: 'tt-icon-btn', title: t('view.fit'), 'aria-label': t('view.fit'), onClick: () => { touched.current = false; stop(); fit(false) } }, h(FitIcon))),
    overlay)
}

function lockSelection(on) {
  try {
    document.documentElement.classList.toggle('tt-grabbing', on)
    if (on) window.getSelection().removeAllRanges()
  } catch {}
}

function Badge({ state, node, isGoal }) {
  const icon = state === 'lit' ? h(StarIcon) : state === 'available' ? h(SparkIcon, { size: 16 }) : isGoal ? h(FlagIcon) : h(LockIcon)
  const shape = `tt-bshape-${NODE_TYPES.includes(node.type) ? node.type : 'concept'}`
  const cls = state === 'lit' ? `tt-badge tt-badge-lit tt-m-${node.mastery}` : state === 'available' ? 'tt-badge tt-badge-available' : isGoal ? 'tt-badge tt-badge-goal' : 'tt-badge'
  return h('span', { className: `${cls} ${shape}` }, h('span', { className: 'tt-badge-icon' }, icon),
    node.weak ? h('i', { className: 'tt-dot tt-dot-weak' }) : fading(node, Date.now()) ? h('i', { className: 'tt-dot tt-dot-fading' }) : null)
}

/** Small badge-shaped swatch per knowledge type, for the legend. */
function TypeLegend({ t, nodes }) {
  const present = NODE_TYPES.filter(type => nodes.some(n => (n.type || 'concept') === type))
  if (present.length < 2) return null
  return h('div', { className: 'tt-legend-row' }, present.map(type => h('span', { key: type, className: 'tt-pill' },
    h('span', { className: `tt-mini tt-bshape-${type}` }), t(`type.${type}`))))
}

const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315]

/** Nodes and edges of one tree, plus the hook bubble, in canvas coordinates. */
function Graph({ t, nodes, goalIds, selected, hover, onSelect, onHover, now, coords, routeSteps, recommended, celebrate, view, shared }) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  const focus = selected && byId[selected] ? related(nodes, selected) : null
  const width = Math.max(...nodes.map(n => coords[n.id].x + NODE_W), NODE_W)
  const height = Math.max(...nodes.map(n => coords[n.id].y + NODE_H), NODE_H)
  const medalColor = ['', '#c8834c', '#93a4bd', '#eeb031']
  const onRoute = id => routeSteps && routeSteps[id] !== undefined
  const edges = []
  nodes.forEach(n => n.prerequisites.forEach(p => {
    if (!coords[p]) return
    const a = coords[p]
    const b = coords[n.id]
    const x1 = a.x + NODE_W / 2
    const y1 = a.y + NODE_H
    const x2 = b.x + NODE_W / 2
    const y2 = b.y
    const my = (y1 + y2) / 2
    const fromLit = byId[p].mastery >= 1
    const toLit = n.mastery >= 1
    const route = onRoute(n.id) && (onRoute(p) || fromLit)
    const dim = !route && focus && !(focus.has(p) && focus.has(n.id))
    const kind = fromLit && toLit ? 'lit' : fromLit ? 'flow' : 'locked'
    const ignite = celebrate && celebrate.ids.has(p)
    edges.push(h('path', {
      key: `${p}>${n.id}`,
      className: `tt-edge tt-edge-${kind}` + (route ? ' tt-edge-route' : '') + (ignite ? ' tt-edge-ignite' : '') + (dim ? ' tt-edge-dim' : ''),
      d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`,
      stroke: kind === 'lit' && !route ? medalColor[Math.min(byId[p].mastery, n.mastery)] : undefined,
    }))
  }))
  const bubbleId = hover && byId[hover] && byId[hover].hook ? hover : null
  const bubbleScale = view ? clamp(1 / view.k, 1, 2.4) : 1
  const bubbleBelow = bubbleId !== null && coords[bubbleId].y < NODE_H
  return h(React.Fragment, null,
    h('svg', { className: 'tt-edges', width, height, 'aria-hidden': true }, edges),
    nodes.map(n => {
      const state = stateOf(n, byId)
      const isGoal = goalIds.has(n.id)
      const fade = fading(n, now)
      const lit = celebrate && celebrate.ids.has(n.id)
      const cls = ['tt-node', `tt-shape-${NODE_TYPES.includes(n.type) ? n.type : 'concept'}`,
        state === 'lit' ? `tt-lit-${n.mastery}` : `tt-${state}`,
        fade ? 'tt-fading' : '',
        n.weak ? 'tt-weak' : '',
        isGoal ? 'tt-goal-node' : '',
        selected === n.id ? 'tt-selected' : '',
        onRoute(n.id) ? 'tt-on-route' : '',
        focus && !focus.has(n.id) && !onRoute(n.id) ? 'tt-dim' : '',
        lit ? 'tt-celebrate' : '',
      ].filter(Boolean).join(' ')
      const sub = state === 'lit' ? t(`level.${n.mastery}`) : `${t(`type.${n.type}`)} · ${t(`state.${state}`)}`
      const flags = [n.weak ? t('flag.weak') : '', fade ? t('flag.fading') : ''].filter(Boolean)
      return h('button', {
        key: lit ? `${n.id}:${celebrate.key}` : n.id, type: 'button', className: cls, 'data-node': n.id,
        style: { left: coords[n.id].x, top: coords[n.id].y },
        'aria-label': n.hook ? `${richToPlain(n.name)}：${richToPlain(n.hook)}` : richToPlain(n.name),
        'aria-pressed': selected === n.id,
        onClick: () => onSelect(selected === n.id ? null : n.id),
        onPointerEnter: event => { if (event.pointerType !== 'touch') onHover(n.id) },
        onPointerLeave: () => onHover(null),
      },
      isGoal ? h('span', { className: 'tt-goal-tag' }, t('flag.goal')) : null,
      shared && shared[n.id] > 1 ? h('span', { className: 'tt-shared', title: fill(t('map.sharedBy'), { n: shared[n.id] }) }, '🔗', shared[n.id]) : null,
      onRoute(n.id) ? h('span', { className: 'tt-step' }, routeSteps[n.id] + 1) : null,
      recommended === n.id ? h('span', { className: 'tt-rec' }, h('i', null, '▼'), t('flag.recommended')) : null,
      h(Badge, { state, node: n, isGoal }),
      h('span', { className: 'tt-node-text' },
        h('span', { className: 'tt-node-name' }, h(Rich, { text: n.name })),
        h('span', { className: 'tt-node-sub' }, flags.length ? `${sub} · ${flags.join(' · ')}` : sub)),
      lit ? h('span', { className: 'tt-burst', 'aria-hidden': true }, SPARKS.map(a => h('i', { key: a, style: { '--a': `${a}deg` } }))) : null)
    }),
    bubbleId ? h('div', {
      key: `bubble:${bubbleId}`, className: 'tt-bubble' + (bubbleBelow ? ' tt-bubble-below' : ''),
      style: bubbleBelow
        ? { left: coords[bubbleId].x + NODE_W / 2, top: coords[bubbleId].y + NODE_H + 10, transform: `translate(-50%, 0) scale(${bubbleScale})` }
        : { left: coords[bubbleId].x + NODE_W / 2, top: coords[bubbleId].y - (recommended === bubbleId ? 26 : 10), transform: `translate(-50%, -100%) scale(${bubbleScale})` },
    }, h('b', null, '💡'), h(Rich, { text: byId[bubbleId].hook }),
    Array.isArray(byId[bubbleId].glossary) && byId[bubbleId].glossary.length ? h('span', { className: 'tt-bubble-gloss' },
      byId[bubbleId].glossary.slice(0, 3).map((g, i) => h(React.Fragment, { key: i },
        h('span', { className: 'tt-gloss-term' }, h(Rich, { text: g.term })),
        h('span', null, h(Rich, { text: g.meaning }))))) : null) : null)
}

function Detail({ t, node, nodes, onJump, onClose, act, now, routeIds, alsoIn, onOpenGoal, onMerge }) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  const state = stateOf(node, byId)
  const unlocks = nodes.filter(n => n.prerequisites.includes(node.id))
  const tags = [
    h('span', { key: 'type', className: 'tt-tag' }, t(`type.${node.type}`)),
    state === 'lit'
      ? h('span', { key: 'state', className: `tt-tag tt-tag-medal tt-m-${node.mastery}` }, t(`level.${node.mastery}`))
      : h('span', { key: 'state', className: 'tt-tag' }, t(`state.${state}`)),
  ]
  if (node.weak) tags.push(h('span', { key: 'weak', className: 'tt-tag tt-tag-warn' }, t('flag.weak')))
  if (fading(node, now)) tags.push(h('span', { key: 'fade', className: 'tt-tag tt-tag-warn' }, t('flag.fading')))
  if (node.est_minutes) tags.push(h('span', { key: 'min', className: 'tt-tag' }, fill(t('detail.minutes'), { n: node.est_minutes })))
  const dueAt = nextReviewAt(node)
  if (dueAt !== null && !fading(node, now)) tags.push(h('span', { key: 'next', className: 'tt-tag' }, fill(t('detail.nextReview'), { n: Math.max(1, Math.ceil((dueAt - now) / 86400000)) })))
  const chip = n => h('button', { key: n.id, type: 'button', className: 'tt-link', onClick: () => onJump(n.id) }, h(Rich, { text: n.name }))
  const links = (label, list) => h('div', { className: 'tt-links' },
    h('span', null, `${label}：`),
    list.length ? list.map(chip) : h('span', null, t('detail.none')))
  const vars = { name: richToPlain(node.name), id: node.id }
  const actOn = (text, label) => act(text, label, node)
  const route = routeIds.map(id => byId[id]).filter(Boolean)
  const routeText = route.map((n, i) => `${i + 1}. ${richToPlain(n.name)}（${n.id}）`).join(' → ')
  const actions = []
  if (state === 'locked') {
    actions.push(h('button', { key: 'route', type: 'button', className: 'tt-btn tt-btn-primary', onClick: () => actOn(fill(t('prompt.route'), { ...vars, route: routeText }), fill(t('label.route'), vars)) }, t('action.route')))
    actions.push(h('button', { key: 'skip', type: 'button', className: 'tt-btn tt-btn-skip', onClick: () => actOn(fill(t('prompt.skip'), vars), fill(t('label.skip'), vars)) }, h(BoltIcon), t('action.skip')))
  } else if (state === 'available') {
    actions.push(h('button', { key: 'learn', type: 'button', className: 'tt-btn tt-btn-primary', onClick: () => actOn(fill(t('prompt.learn'), vars), fill(t('label.learn'), vars)) }, t('action.learn')))
    actions.push(h('button', { key: 'check', type: 'button', className: 'tt-btn', onClick: () => actOn(fill(t('prompt.check'), vars), fill(t('label.check'), vars)) }, t('action.check')))
  } else {
    actions.push(h('button', { key: 'review', type: 'button', className: 'tt-btn tt-btn-primary', onClick: () => actOn(fill(t('prompt.review'), vars), fill(t('label.review'), vars)) }, t('action.review')))
    if (node.mastery < 3) actions.push(h('button', { key: 'check', type: 'button', className: 'tt-btn', onClick: () => actOn(fill(t('prompt.check'), vars), fill(t('label.levelUp'), vars)) }, t('action.levelUp')))
  }
  // Drag the grip or title: down to close, up to give the card more room.
  const [expanded, setExpanded] = useState(false)
  const [dy, setDy] = useState(0)
  const dragStart = useRef(null)
  const grab = {
    onPointerDown: event => {
      if (event.target.closest && event.target.closest('button')) return
      dragStart.current = { y: event.clientY, id: event.pointerId }
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    },
    onPointerMove: event => {
      if (!dragStart.current || dragStart.current.id !== event.pointerId) return
      setDy(event.clientY - dragStart.current.y)
    },
    onPointerUp: event => {
      if (!dragStart.current || dragStart.current.id !== event.pointerId) return
      const moved = event.clientY - dragStart.current.y
      dragStart.current = null
      setDy(0)
      if (moved > 70) onClose()
      else if (moved < -40) setExpanded(true)
      else if (moved > 30 && expanded) setExpanded(false)
    },
  }
  grab.onPointerCancel = () => { dragStart.current = null; setDy(0) }
  return h('div', {
    className: 'tt-card' + (expanded ? ' tt-card-expanded' : '') + (dy ? ' tt-card-dragging' : ''),
    role: 'dialog', 'aria-label': node.name,
    style: dy ? { transform: `translateY(${Math.max(dy, -60)}px)` } : undefined,
  },
    h('div', { className: 'tt-card-grip', ...grab, 'aria-hidden': true }, h('i')),
    h('div', { className: 'tt-card-head', ...grab },
      h(Badge, { state, node, isGoal: false }),
      h('div', { className: 'tt-card-title' }, h(Rich, { text: node.name })),
      h('button', { type: 'button', className: 'tt-icon-btn', title: t('detail.close'), 'aria-label': t('detail.close'), onClick: onClose }, h(CloseIcon))),
    node.hook ? h('div', { className: 'tt-hook' }, h('span', null, '💡'), h('div', null, h(Rich, { text: node.hook }))) : null,
    h('div', { className: 'tt-tags' }, tags),
    node.summary ? h('p', null, h(Rich, { text: node.summary })) : null,
    Array.isArray(node.glossary) && node.glossary.length ? h('div', { className: 'tt-glossary' },
      h('div', { className: 'tt-glossary-title' }, t('detail.glossary')),
      node.glossary.map((g, i) => h('div', { key: i, className: 'tt-gloss-row' },
        h('span', { className: 'tt-gloss-term' }, h(Rich, { text: g.term })),
        h('span', { className: 'tt-gloss-meaning' }, h(Rich, { text: g.meaning }))))) : null,
    route.length > 1 ? h('div', { className: 'tt-route' },
      h('div', { className: 'tt-route-title' }, fill(t('detail.route'), { n: route.length })),
      h('div', { className: 'tt-route-list' }, route.map((n, i) => h('button', { key: n.id, type: 'button', className: 'tt-route-step', onClick: () => onJump(n.id) }, h('b', null, i + 1), h(Rich, { text: n.name }))))) : null,
    links(t('detail.prereqs'), node.prerequisites.map(id => byId[id]).filter(Boolean)),
    links(t('detail.unlocks'), unlocks),
    node.mastery >= 1 && node.evidence ? h('div', { className: 'tt-evidence' }, h('b', null, `${t('detail.evidence')}：`), h(Rich, { text: node.evidence })) : null,
    alsoIn && alsoIn.length ? h('div', { className: 'tt-links tt-also' },
      h('span', null, `${t('detail.alsoIn')}：`),
      alsoIn.map(g => h('button', { key: g.id, type: 'button', className: 'tt-link tt-link-goal', onClick: () => onOpenGoal && onOpenGoal(g) }, h(FlagIcon), h(Rich, { text: g.name })))) : null,
    onMerge ? h('button', { type: 'button', className: 'tt-merge-link', onClick: () => onMerge(node) }, t('merge.open')) : null,
    h('div', { className: 'tt-actions' }, actions))
}

/** Toasts for nodes that lit up and nodes that became learnable. */
function useCelebrations(t, nodes, camera, coords) {
  const previous = useRef(null)
  const [celebrate, setCelebrate] = useState(null)
  const [toasts, setToasts] = useState([])
  useEffect(() => {
    const before = previous.current
    const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
    previous.current = Object.fromEntries(nodes.map(n => [n.id, n.mastery || 0]))
    if (before === null) return undefined
    const raised = nodes.filter(n => (n.mastery || 0) >= 1 && (n.mastery || 0) > (before[n.id] || 0))
    if (raised.length === 0) return undefined
    const wasLit = id => (before[id] || 0) >= 1
    const unlocked = nodes.filter(n => (n.mastery || 0) < 1 && stateOf(n, byId) === 'available'
      && !(n.prerequisites.every(wasLit) && n.prerequisites.every(p => before[p] !== undefined)))
    const key = Date.now()
    setCelebrate({ ids: new Set(raised.map(n => n.id)), key })
    buzz(raised.length > 1 || raised.some(n => n.mastery >= 3) ? 'heavy' : 'medium')
    const messages = raised.map(n => fill(t('toast.lit'), { name: richToPlain(n.name), level: t(`level.${n.mastery}`) }))
    if (unlocked.length) messages.push(fill(t('toast.unlocked'), { n: unlocked.length, names: unlocked.slice(0, 3).map(n => richToPlain(n.name)).join('、') + (unlocked.length > 3 ? '…' : '') }))
    setToasts(list => list.concat(messages.map((text, i) => ({ id: `${key}:${i}`, text, kind: i < raised.length ? 'lit' : 'unlock' }))).slice(-4))
    const first = coords[raised[0].id]
    if (first && camera.current) camera.current.flyTo(first.x + NODE_W / 2, first.y + NODE_H / 2)
    const timer = setTimeout(() => setCelebrate(c => (c && c.key === key ? null : c)), 2400)
    const toastTimer = setTimeout(() => setToasts(list => list.filter(x => !x.id.startsWith(`${key}:`))), 4200)
    return () => { clearTimeout(timer); clearTimeout(toastTimer) }
  }, [nodes]) // eslint-disable-line react-hooks/exhaustive-deps
  const notify = useCallback(text => {
    const id = `n${Date.now()}`
    setToasts(list => list.concat([{ id, text, kind: 'info' }]).slice(-4))
    setTimeout(() => setToasts(list => list.filter(x => x.id !== id)), 3000)
  }, [])
  return { celebrate, toasts, notify }
}

/** Tree canvas with legend, tools, the selected node's card and toasts. */
function Stage({ t, title, nodes, goalIds, act, fitKey, alsoInOf, onOpenGoal, onMerge, fab, camera: cameraOut, shared, overview }) {
  const [selected, setSelected] = useState(null)
  const [hover, setHover] = useState(null)
  const camera = useRef(null)
  const stageRef = useRef(null)
  const [legendOpen, setLegendOpen] = useState(false)
  const now = Date.now()
  const byId = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes])
  const { coords, width, height } = useMemo(() => layout(nodes), [nodes])
  const recommended = useMemo(() => recommend(nodes, [...goalIds]), [nodes, goalIds])
  const current = selected && byId[selected] ? byId[selected] : null
  const routeIds = useMemo(() => (current && current.mastery < 1 ? learningRoute(nodes, current.id) : []), [nodes, current])
  const routeSteps = routeIds.length > 1 ? Object.fromEntries(routeIds.map((id, i) => [id, i])) : null
  const { celebrate, toasts } = useCelebrations(t, nodes, camera, coords)
  const center = id => ({ x: coords[id].x + NODE_W / 2, y: coords[id].y + NODE_H / 2 })
  // Once the card for a newly selected node is laid out, keep the node visible above it.
  const revealSelected = useRef(null)
  useEffect(() => {
    const id = revealSelected.current
    revealSelected.current = null
    if (!id || !coords[id] || !camera.current) return
    const card = stageRef.current && stageRef.current.querySelector('.tt-card')
    const c = center(id)
    camera.current.reveal(c.x, c.y, card ? card.offsetHeight + 12 : 0)
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const jump = id => { revealSelected.current = id; setSelected(id) }
  const pick = id => { if (id) revealSelected.current = id; setSelected(id) }
  const locate = () => {
    if (!recommended) return
    const c = center(recommended)
    if (camera.current) camera.current.flyTo(c.x, c.y, { k: 1 })
  }
  // Screens drive the canvas through this handle: fit everything, fly to the next step, or open one point.
  if (cameraOut) cameraOut.current = { fit: () => camera.current && camera.current.fit(), locate, select: id => { if (byId[id]) jump(id) } }
  const legend = !legendOpen
    ? h('button', { type: 'button', className: 'tt-overlay tt-legend-toggle', 'aria-expanded': false, onClick: () => setLegendOpen(true) }, h('i', null, 'i'), t('legend.title'))
    : h('div', { className: 'tt-overlay tt-legend tt-legend-open', role: 'button', tabIndex: 0, 'aria-expanded': true, onClick: () => setLegendOpen(false) },
    h('div', { className: 'tt-legend-row' },
      h('span', { className: 'tt-pill' }, h('i', { style: { background: 'linear-gradient(135deg,#c8834c,#eeb031)' } }), t('legend.lit')),
      h('span', { className: 'tt-pill' }, h('i', { style: { border: '1.5px dashed var(--tt-brand)' } }), t('legend.available')),
      h('span', { className: 'tt-pill' }, h('i', { style: { background: 'var(--tt-line)' } }), t('legend.locked'))),
    h(TypeLegend, { t, nodes }))
  const tools = h(React.Fragment, null,
    recommended ? h('button', { type: 'button', className: 'tt-icon-btn', title: t('action.recommend'), 'aria-label': t('action.recommend'), onClick: locate }, h(TargetIcon)) : null,
    h('span', { className: 'tt-zoom-sep' }))
  return h('div', { className: 'tt-stage', ref: stageRef },
    h(Viewport, {
      t, width, height, fitKey, camera, tools,
      onBlankTap: () => { setSelected(null); setLegendOpen(false) },
      // An overview (the knowledge map) opens showing everything; a single tree opens on its next step.
      focus: recommended && !overview ? center(recommended) : null,
      overlay: h(React.Fragment, null,
        legend,
        toasts.length ? h('div', { className: 'tt-overlay tt-toasts', role: 'status' }, toasts.map(x => h('div', { key: x.id, className: `tt-toast tt-toast-${x.kind}` }, x.kind === 'lit' ? h(StarIcon) : x.kind === 'unlock' ? h(SparkIcon, { size: 15 }) : null, x.text))) : null,
        current
          ? h(Detail, { key: current.id, t, node: current, nodes, onJump: jump, onClose: () => setSelected(null), act, now, routeIds, alsoIn: alsoInOf ? alsoInOf(current.id) : null, onOpenGoal, onMerge })
          : h(React.Fragment, null,
            h('div', { className: 'tt-overlay tt-hint' + (fab ? ' tt-hint-left' : '') }, t('view.hint')),
            fab ? h('div', { className: 'tt-overlay tt-fab' }, fab) : null)),
    }, view => h(Graph, {
      t, nodes, goalIds, selected: current ? selected : null, hover, onSelect: pick, onHover: setHover,
      now, coords, routeSteps, recommended, celebrate, view, shared,
    })))
}

/** A tiny drawing of a tree for list cards: layout as on the canvas, coloured by progress. */
function TreeThumb({ nodes, width = 84, height = 60 }) {
  if (!nodes.length) return null
  const { coords, width: W, height: H } = layout(nodes)
  const pad = 5
  const k = Math.min((width - pad * 2) / W, (height - pad * 2) / H)
  const ox = (width - W * k) / 2
  const oy = (height - H * k) / 2
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  const w = NODE_W * k
  const hh = Math.max(NODE_H * k, 3)
  const medal = ['', '#c8834c', '#93a4bd', '#eeb031']
  return h('svg', { className: 'tt-thumb', width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': true },
    nodes.flatMap(n => n.prerequisites.filter(p => coords[p]).map(p => {
      const a = coords[p]
      const b = coords[n.id]
      const lit = (byId[p].mastery || 0) >= 1 && (n.mastery || 0) >= 1
      return h('line', {
        key: `${p}>${n.id}`, x1: ox + (a.x + NODE_W / 2) * k, y1: oy + (a.y + NODE_H) * k, x2: ox + (b.x + NODE_W / 2) * k, y2: oy + b.y * k,
        stroke: lit ? medal[Math.min(byId[p].mastery, n.mastery)] : 'var(--tt-thumb-line)', strokeWidth: lit ? 1.3 : 1,
      })
    })),
    nodes.map(n => {
      const c = coords[n.id]
      const state = stateOf(n, byId)
      return h('rect', {
        key: n.id, x: ox + c.x * k, y: oy + c.y * k, width: w, height: hh, rx: Math.min(hh / 2, 3),
        fill: state === 'lit' ? medal[n.mastery] : state === 'available' ? 'var(--tt-thumb-avail)' : 'var(--tt-thumb-locked)',
        stroke: state === 'available' ? 'var(--tt-thumb-avail-line)' : 'none', strokeWidth: 1,
      })
    }))
}

function Empty({ t, body }) {
  return h('div', { className: 'tt-empty' },
    h('div', { className: 'tt-empty-icon' }, h(TreeIcon, { size: 34 })),
    h('b', null, t('empty.title')),
    h('p', null, body || t('empty.body')))
}

export {
  TreeIcon, LockIcon, SparkIcon, StarIcon, FlagIcon, CloseIcon, ClockIcon, RefreshIcon, BoltIcon, TargetIcon,
  Rich, richToPlain, splitMath, texToUnicode, stateOf, fading, layout, closure, stats, ago, learningRoute, recommend, reviewQueue, reviewPrompt,
  ProgressRing, Hero, Viewport, Stage, Empty, TreeThumb, exportPng,
}
