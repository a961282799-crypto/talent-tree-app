import { createRoot } from 'react-dom/client'
import { StatusBar, Style } from '@capacitor/status-bar'
import 'katex/dist/katex.min.css'
import './tree.css'
import './app.css'
import { loadState } from './storage.js'
import { isNative } from './native.js'
import { lang } from './i18n.js'
import { App } from './App.jsx'

document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
if (import.meta.env.VITE_DEMO) document.documentElement.classList.add('preview')

function syncStatusBar() {
  if (!isNative) return
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
}

loadState().then(async () => {
  // Web preview build: show an example tree so the app can be explored without a key.
  if (import.meta.env.VITE_DEMO) (await import('./demo.js')).seedDemo()
}).finally(() => {
  syncStatusBar()
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncStatusBar)
  createRoot(document.getElementById('root')).render(<App />)
})
