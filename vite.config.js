import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// pdf.js needs its worker and character maps (CJK text in PDFs) served next to the app.
const copyPdfMaps = {
  name: 'copy-pdf-cmaps',
  buildStart() {
    const from = fileURLToPath(new URL('./node_modules/pdfjs-dist/cmaps', import.meta.url))
    const to = fileURLToPath(new URL('./public/pdfjs/cmaps', import.meta.url))
    if (existsSync(from) && !existsSync(to)) cpSync(from, to, { recursive: true })
    // The worker ships as .js: some app web servers do not label .mjs as JavaScript.
    const worker = fileURLToPath(new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url))
    const workerTo = fileURLToPath(new URL('./public/pdfjs/pdf.worker.min.js', import.meta.url))
    if (existsSync(worker)) cpSync(worker, workerTo)
  },
}

// Some hosts reject files containing a literal U+FFFD; escape it in emitted JS.
const escapeReplacementChar = {
  name: 'escape-replacement-char',
  generateBundle(_, bundle) {
    for (const file of Object.values(bundle)) if (file.type === 'chunk') file.code = file.code.replaceAll('\uFFFD', '\\uFFFD')
  },
}

export default defineConfig({
  plugins: [react(), escapeReplacementChar, copyPdfMaps],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 1500 },
  server: { host: true },
})
