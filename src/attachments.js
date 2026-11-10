/**
 * Images and PDFs the learner attaches to a chat message.
 *
 * Everything is turned into text before it reaches the tutor model, so any
 * model (with tools) can use it:
 * - a PDF's text layer is extracted on the phone;
 * - images, and the pages of scanned PDFs, are transcribed by the service's
 *   vision model (questions verbatim, formulas as LaTeX, diagrams described).
 */
import { complete, AiError } from './ai.js'
import { fill, t } from './i18n.js'

export const MAX_IMAGES = 4
export const MAX_PDFS = 2
/** Characters of PDF text passed on per message. */
export const PDF_CHAR_LIMIT = 30000
/** A PDF with less text than this per page is treated as scanned (pictures of pages). */
const SCANNED_CHARS_PER_PAGE = 25
/** Pages of a scanned PDF sent to the vision model. */
export const SCAN_PAGES = 4
const IMAGE_MAX_SIDE = 1600
const THUMB_SIDE = 240

let nextId = 0
const newId = () => `a${Date.now().toString(36)}${nextId++}`

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('attach.badImage'))) }
    img.src = url
  })
}

/** Draw a picture (image or canvas) scaled so its longer side is at most `side`; JPEG data URL. */
function scaled(source, width, height, side, quality = 0.85) {
  const k = Math.min(1, side / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * k))
  canvas.height = Math.max(1, Math.round(height * k))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

let pdfjs
async function loadPdfjs() {
  if (!pdfjs) {
    // Loaded on first use: the PDF library is large and most chats never need it.
    const lib = await import('pdfjs-dist/legacy/build/pdf.min.mjs')
    // Copied to public/pdfjs/ at build time (see vite.config.js).
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.min.js', document.baseURI).href
    pdfjs = lib
  }
  return pdfjs
}

async function readPdf(file) {
  const lib = await loadPdfjs()
  const task = lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // Character maps: without them text from many Chinese PDFs comes out garbled.
    cMapUrl: new URL('pdfjs/cmaps/', document.baseURI).href,
    cMapPacked: true,
  })
  const doc = await task.promise
  const pages = doc.numPages
  let text = ''
  let readPages = 0
  for (let i = 1; i <= pages && text.length < PDF_CHAR_LIMIT; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    // Some PDFs use look-alike radicals and compatibility ideographs (⽇ for 日): map those, and only those, to normal characters.
    const pageText = content.items.map(item => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join('').replace(/[\u2E80-\u2FDF\uF900-\uFAFF]/g, c => c.normalize('NFKC')).replace(/[ \t]+\n/g, '\n').trim()
    text += `${text ? '\n\n' : ''}— ${fill(t('attach.page'), { n: i })} —\n${pageText}`
    readPages = i
  }
  const meaningful = text.replace(/— [^—]+ —/g, '').replace(/\s+/g, '').length
  const scanned = meaningful < SCANNED_CHARS_PER_PAGE * Math.min(readPages, pages)
  const scans = []
  const first = await doc.getPage(1)
  const v = first.getViewport({ scale: 1 })
  const renderPage = async (page, width) => {
    const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport, background: '#ffffff' }).promise
    return canvas
  }
  const thumbCanvas = await renderPage(first, 220)
  const thumb = scaled(thumbCanvas, thumbCanvas.width, thumbCanvas.height, THUMB_SIDE, 0.75)
  if (scanned) {
    for (let i = 1; i <= Math.min(pages, SCAN_PAGES); i++) {
      const canvas = await renderPage(await doc.getPage(i), 1400)
      scans.push(scaled(canvas, canvas.width, canvas.height, IMAGE_MAX_SIDE))
    }
  }
  await task.destroy()
  return { pages, readPages, text: scanned ? '' : text.slice(0, PDF_CHAR_LIMIT), scanned, scans, thumb, ratio: v.height / v.width }
}

/**
 * Read a picked file into an attachment the composer can show and send.
 * @returns {Promise<{ id, kind: 'image'|'pdf', name, thumb, image?, pages?, readPages?, text?, scanned?, scans? }>}
 */
export async function readAttachment(file) {
  const name = file.name || (file.type === 'application/pdf' ? 'document.pdf' : 'image.jpg')
  if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
    const pdf = await readPdf(file).catch(error => { throw new Error(fill(t('attach.badPdf'), { message: error?.message || String(error) })) })
    return { id: newId(), kind: 'pdf', name, ...pdf }
  }
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(name)) throw new Error(t('attach.unsupported'))
  const img = await loadImage(file)
  return {
    id: newId(), kind: 'image', name,
    image: scaled(img, img.naturalWidth, img.naturalHeight, IMAGE_MAX_SIDE),
    thumb: scaled(img, img.naturalWidth, img.naturalHeight, THUMB_SIDE, 0.75),
  }
}

export const TRANSCRIBE_PROMPT = `You transcribe images for a tutor who cannot see them. For each image:
- Copy every piece of text exactly, in its original language, including handwriting. Keep the layout of questions (numbering, options A/B/C/D, sub-questions).
- Write every formula as LaTeX in $…$ (or $$…$$ for displayed equations).
- Describe diagrams, graphs, tables and figures precisely: what is drawn, axes and labels, values, arrows, which parts are marked or highlighted.
- If something is unreadable, say so instead of guessing.
Do not solve, explain or comment. Start each image with its label (e.g. "图1：").`

/** Ask the service's vision model to transcribe a batch of pictures. */
async function transcribe(ai, images, signal) {
  if (!ai.visionModel) throw new AiError(t('attach.noVision'), 'no-vision')
  const content = [{ type: 'text', text: images.map((img, i) => `图${i + 1}：${img.label}`).join('\n') }]
  for (const img of images) content.push({ type: 'image_url', image_url: { url: img.url } })
  try {
    const reply = await complete({
      settings: { ...ai, model: ai.visionModel },
      messages: [{ role: 'system', content: TRANSCRIBE_PROMPT }, { role: 'user', content }],
      signal,
    })
    return reply.content.trim()
  } catch (error) {
    if (error?.code === 'http') throw new AiError(fill(t('attach.visionFailed'), { model: ai.visionModel, message: error.message }), 'vision')
    throw error
  }
}

/**
 * Turn the learner's words plus attachments into the message the tutor reads.
 * @param {{ text: string, attachments: object[], ai: { apiKey, baseUrl, model, visionModel }, signal?: AbortSignal }} input
 * @returns {Promise<{ content: string, meta: object[] }>} `meta` is what the chat bubble shows.
 */
export async function prepareMessage({ text, attachments, ai, signal }) {
  const pictures = []
  attachments.forEach((a, i) => {
    if (a.kind === 'image') pictures.push({ owner: a.id, url: a.image, label: a.name })
    if (a.kind === 'pdf' && a.scanned) a.scans.forEach((url, p) => pictures.push({ owner: a.id, url, label: `${a.name} ${fill(t('attach.page'), { n: p + 1 })}` }))
  })
  const transcript = pictures.length ? await transcribe(ai, pictures, signal) : ''
  const blocks = []
  let pictureNo = 0
  for (const a of attachments) {
    if (a.kind === 'image') {
      pictureNo++
      blocks.push(`【${fill(t('attach.block.image'), { n: pictureNo, name: a.name })}】`)
    } else if (a.scanned) {
      const count = a.scans.length
      blocks.push(`【${fill(t('attach.block.scanned'), { name: a.name, pages: a.pages, n: count, from: pictureNo + 1, to: pictureNo + count })}】`)
      pictureNo += count
    } else {
      const partial = a.readPages < a.pages || a.text.length >= PDF_CHAR_LIMIT
      blocks.push(`【${fill(t(partial ? 'attach.block.pdfPartial' : 'attach.block.pdf'), { name: a.name, pages: a.pages, read: a.readPages })}】\n${a.text}`)
    }
  }
  if (transcript) blocks.push(`【${t('attach.block.transcript')}】\n${transcript}`)
  const words = text.trim() || t('attach.noText')
  const content = `${words}\n\n${blocks.join('\n\n')}`
  const meta = attachments.map(a => ({ kind: a.kind, name: a.name, thumb: a.thumb, ...(a.kind === 'pdf' ? { pages: a.pages } : {}) }))
  return { content, meta }
}
