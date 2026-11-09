import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { NavContext, makeNav } from './nav.js'
import { useApp } from './storage.js'
import { isNative } from './native.js'
import { t } from './i18n.js'
import { TreeIcon } from './tree.js'
import { ChatIcon, GearIcon } from './icons.jsx'
import { Home } from './screens/Home.jsx'
import { TreeScreen } from './screens/TreeScreen.jsx'
import { Chat } from './screens/Chat.jsx'
import { Chats } from './screens/Chats.jsx'
import { Settings } from './screens/Settings.jsx'

const TABS = [
  { id: 'trees', icon: TreeIcon, label: 'tab.trees' },
  { id: 'chats', icon: ChatIcon, label: 'tab.chats' },
  { id: 'settings', icon: GearIcon, label: 'tab.settings' },
]

export function App() {
  const [tab, setTab] = useState('trees')
  const [stack, setStack] = useState([])
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(0)

  const showToast = useCallback(text => {
    clearTimeout(toastTimer.current)
    setToast({ text, key: Date.now() })
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])
  const nav = useMemo(() => makeNav(setStack, setTab, showToast), [showToast])

  // Android back button: close the top screen, then go to the first tab, then leave.
  const state = useRef({ stack, tab })
  state.current = { stack, tab }
  useEffect(() => {
    if (!isNative) return undefined
    const handle = CapApp.addListener('backButton', () => {
      const { stack: s, tab: current } = state.current
      if (document.querySelector('.tt-card')) {
        document.querySelector('.tt-card .tt-icon-btn')?.click()
      } else if (s.length) setStack(x => x.slice(0, -1))
      else if (current !== 'trees') setTab('trees')
      else CapApp.exitApp()
    })
    return () => { handle.then(h => h.remove()) }
  }, [])

  const top = stack[stack.length - 1]
  // Changing the language re-mounts the screens (tab and stack are kept) so every label updates.
  const language = useApp(s => s.settings.language ?? 'system')
  return (
    <NavContext.Provider value={nav}>
      <div className="app" key={language}>
        <div className="tab-content" hidden={Boolean(top)}>
          {tab === 'trees' && <Home />}
          {tab === 'chats' && <Chats />}
          {tab === 'settings' && <Settings />}
          <nav className="tabbar">
            {TABS.map(({ id, icon: Icon, label }) => (
              <button key={id} type="button" className={id === tab ? 'active' : ''} aria-current={id === tab ? 'page' : undefined} onClick={() => setTab(id)}>
                <Icon size={24} />
                <span>{t(label)}</span>
              </button>
            ))}
          </nav>
        </div>
        {top && (
          <div className="pushed" key={top.key}>
            {top.type === 'tree' && <TreeScreen goals={top.goals} chatId={top.chatId} />}
            {top.type === 'chat' && <Chat chatId={top.chatId} />}
          </div>
        )}
        {toast && <div className="app-toast" key={toast.key} role="status">{toast.text}</div>}
      </div>
    </NavContext.Provider>
  )
}
