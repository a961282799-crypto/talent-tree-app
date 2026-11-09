import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Some hosts reject files containing a literal U+FFFD; escape it in emitted JS.
const escapeReplacementChar = {
  name: 'escape-replacement-char',
  generateBundle(_, bundle) {
    for (const file of Object.values(bundle)) if (file.type === 'chunk') file.code = file.code.replaceAll('\uFFFD', '\\uFFFD')
  },
}

export default defineConfig({
  plugins: [react(), escapeReplacementChar],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 1500 },
  server: { host: true },
})
