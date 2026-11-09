import { useApp, deleteChat } from '../storage.js'
import { useNav } from '../nav.js'
import { ago, richToPlain } from '../tree.js'
import { t } from '../i18n.js'
import { PlusIcon, TrashIcon } from '../icons.jsx'
import { confirmAction } from '../native.js'

function preview(chat) {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i]
    if ((m.role === 'assistant' || m.role === 'user') && m.content) return (m.label || m.content).replace(/\$+/g, '').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').slice(0, 80)
  }
  return ''
}

export function Chats() {
  const nav = useNav()
  const chats = useApp(s => s.chats)
  const live = useApp(s => s.live)
  const list = Object.values(chats).sort((a, b) => b.updatedAt - a.updatedAt)
  const now = Date.now()
  const remove = async (event, id) => {
    event.stopPropagation()
    if (await confirmAction(t('chats.deleteConfirm'))) deleteChat(id)
  }
  return (
    <div className="screen">
      <header className="topbar topbar-home">
        <div className="brand"><span>{t('chats.title')}</span></div>
        <button type="button" className="btn btn-small btn-primary" onClick={nav.newChat}><PlusIcon size={16} />{t('chats.new')}</button>
      </header>
      <div className="scroll">
        {list.length === 0
          ? <p className="muted pad">{t('chats.empty')}</p>
          : (
            <div className="list">
              {list.map(c => (
                <div key={c.id} role="button" tabIndex={0} className="list-item" onClick={() => nav.openChat(c.id)} onKeyDown={e => { if (e.key === 'Enter') nav.openChat(c.id) }}>
                  <div className="list-main">
                    <div className="list-title">
                      <span>{c.goals.length ? c.goals.map(g => richToPlain(g.name)).join(' · ') : c.title || t('chat.untitled')}</span>
                      {live[c.id] && <i className="live-dot" />}
                    </div>
                    <div className="list-sub">{preview(c)}</div>
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
