import { useMemo, useState } from 'react'
import { useApp, deleteChat } from '../storage.js'
import { chatTitle, useNav } from '../nav.js'
import { ago } from '../tree.js'
import { fill, t } from '../i18n.js'
import { PlusIcon, SearchIcon, TrashIcon } from '../icons.jsx'
import { confirmAction } from '../native.js'

const plain = text => String(text ?? '').replace(/\$+/g, '').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ')

/** Where `q` occurs in a conversation's messages, as a short excerpt; '' when only the title matches or nothing does. */
function excerpt(chat, q) {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i]
    if (m.role !== 'assistant' && m.role !== 'user') continue
    const text = plain(m.label || m.content)
    const at = text.toLowerCase().indexOf(q)
    if (at >= 0) return `${at > 20 ? '…' : ''}${text.slice(Math.max(0, at - 20), at + 60)}`
  }
  return ''
}

function preview(chat) {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i]
    if ((m.role === 'assistant' || m.role === 'user') && m.content) return plain(m.label || m.content).slice(0, 80)
  }
  return ''
}

export function Chats() {
  const nav = useNav()
  const chats = useApp(s => s.chats)
  const live = useApp(s => s.live)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const list = useMemo(() => {
    const all = Object.values(chats).sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return all.map(c => ({ chat: c, sub: preview(c) }))
    return all
      .map(c => ({ chat: c, title: chatTitle(c).toLowerCase().includes(q), sub: excerpt(c, q) }))
      .filter(x => x.title || x.sub)
      .map(x => ({ chat: x.chat, sub: x.sub || preview(x.chat) }))
  }, [chats, q])
  const total = Object.keys(chats).length
  const now = Date.now()
  const remove = async (event, id) => {
    event.stopPropagation()
    if (await confirmAction(t('chats.deleteConfirm'), { ok: t('common.delete'), danger: true })) deleteChat(id)
  }
  return (
    <div className="screen">
      <header className="topbar topbar-home">
        <div className="brand"><span>{t('chats.title')}</span></div>
        <button type="button" className="btn btn-small btn-primary" onClick={nav.newChat}><PlusIcon size={16} />{t('chats.new')}</button>
      </header>
      <div className="scroll">
        {total > 0 && (
          <label className="search-box">
            <SearchIcon size={18} />
            <input type="search" value={query} placeholder={t('chats.search')} aria-label={t('chats.search')} onChange={e => setQuery(e.target.value)} />
          </label>
        )}
        {list.length === 0
          ? <p className="muted pad">{total === 0 ? t('chats.empty') : fill(t('search.none'), { q: query.trim() })}</p>
          : (
            <div className="list">
              {list.map(({ chat: c, sub }) => (
                <div key={c.id} role="button" tabIndex={0} className="list-item" onClick={() => nav.openChat(c.id)} onKeyDown={e => { if (e.key === 'Enter') nav.openChat(c.id) }}>
                  <div className="list-main">
                    <div className="list-title">
                      <span>{chatTitle(c)}</span>
                      {live[c.id] && <i className="live-dot" />}
                    </div>
                    <div className="list-sub">{sub}</div>
                  </div>
                  <div className="list-side">
                    <span className="muted small">{ago(t, c.updatedAt, now).trim()}</span>
                    <button type="button" className="icon-btn small" aria-label={t('chats.delete')} onClick={e => remove(e, c.id)}><TrashIcon size={17} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}
