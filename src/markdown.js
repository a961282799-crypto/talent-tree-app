/**
 * Markdown with math for chat replies: marked for Markdown, KaTeX for
 * $…$ / $$…$$ / \(…\) / \[…\], DOMPurify so model output can never inject
 * scripts into the app.
 */
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'

const marked = new Marked({ gfm: true, breaks: true })

const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?![\s$])([^$\n]+?)(?<!\s)\$/g

function typeset(tex, display) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html', strict: false })
  } catch {
    return tex.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  }
}

/** Render a chat message to safe HTML. */
export function renderMarkdown(text) {
  if (!text) return ''
  const formulas = []
  // Leave code alone: math inside `code` or ``` blocks is not typeset.
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
  const prepared = parts.map((part, i) => (i % 2 === 1 ? part : part.replace(MATH, (m, d1, d2, i1, i2) => {
    const display = d1 !== undefined || d2 !== undefined
    formulas.push(typeset((d1 ?? d2 ?? i1 ?? i2).trim(), display))
    return `\uE000${formulas.length - 1}\uE000`
  }))).join('')
  const html = marked.parse(prepared).replace(/\uE000(\d+)\uE000/g, (m, i) => formulas[Number(i)] ?? '')
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input', 'iframe'] })
}
