import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildSnapshot } from '../graph.js'
import { getState, renameChat, useApp } from '../storage.js'
import { activeAI } from '../providers.js'
import { MAX_IMAGES, MAX_PDFS, prepareMessage, readAttachment } from '../attachments.js'
import { chatTitle, onToolEvent, useNav } from '../nav.js'
import { canRegenerate, regenerate, send, stop } from '../ai.js'
import { copyText } from '../native.js'
import { promptDialog } from '../dialog.js'
import { renderMarkdown } from '../markdown.js'
import { fill, t } from '../i18n.js'
import { ClockIcon, ProgressRing, StarIcon, TreeIcon, reviewQueue, richToPlain, stats } from '../tree.js'
import { AlertIcon, BackIcon, ChevronIcon, CloseSmallIcon, CopyIcon, FileIcon, PaperclipIcon, RetryIcon, SendIcon, StopIcon } from '../icons.jsx'

function Markdown({ text }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}

const LEVEL = l => t(`level.${l}`)

/** Copy (and, for the latest reply, write again) under an AI message. */
function MessageActions({ text, onRegenerate }) {
  const nav = useNav()
  const copy = async () => nav.toast(t((await copyText(text)) ? 'chat.copied' : 'chat.copyFailed'))
  return (
    <div className="msg-actions">
      <button type="button" className="msg-action" aria-label={t('chat.copy')} title={t('chat.copy')} onClick={copy}><CopyIcon size={16} /></button>
      {onRegenerate && <button type="button" className="msg-action" aria-label={t('chat.regenerate')} title={t('chat.regenerate')} onClick={onRegenerate}><RetryIcon size={16} /></button>}
    </div>
  )
}

/** "Tree planned" card: the goal, its size, live progress and a way in. */
function PlanCard({ display, knowledge, onOpenTree }) {
  const nodes = knowledge.nodes[display.goal.id] ? buildSnapshot(knowledge, [display.goal], Date.now()).nodes : []
  const s = stats(nodes)
  const total = nodes.length || display.total || display.added + display.merged
  return (
    <button type="button" className="plan-card" onClick={onOpenTree}>
      <span className="plan-card-icon"><TreeIcon size={22} /></span>
      <span className="plan-card-body">
        <b>{fill(t('chat.plan.title'), { name: richToPlain(display.goal.name) })}</b>
        <span className="plan-card-meta">
          {fill(t('chat.plan.meta'), { total })}
          {s.lit > 0 && <em>{fill(t('chat.plan.known'), { n: s.lit })}</em>}
        </span>
        <span className="bar"><i style={{ width: `${total ? (s.lit / total) * 100 : 0}%` }} /></span>
      </span>
      <span className="plan-card-go">{t('chat.plan.open')}<ChevronIcon size={16} /></span>
    </button>
  )
}

function ToolPill({ display, onOpenTree, knowledge }) {
  if (!display) return null
  if (display.type === 'plan') return <PlanCard display={display} knowledge={knowledge} onOpenTree={onOpenTree} />
  if (display.type === 'record') {
    if (display.level >= 1) {
      return (
        <button type="button" className={`pill pill-lit pill-m-${display.level}`} onClick={onOpenTree}>
          <StarIcon />
          <span>{fill(t('chat.tool.record'), { name: richToPlain(display.name), level: LEVEL(display.level) })}{display.weak ? ` · ${t('flag.weak')}` : ''}</span>
        </button>
      )
    }
    return <div className="pill">{fill(t(display.weak ? 'chat.tool.weak' : 'chat.tool.unlight'), { name: richToPlain(display.name) })}</div>
  }
  if (display.type === 'merge') {
    return (
      <button type="button" className={`pill pill-merge${display.mastery >= 1 ? ` pill-merge-${display.mastery}` : ''}`} onClick={onOpenTree}>
        <TreeIcon size={16} />
        <span>{fill(t('chat.tool.merge'), { from: richToPlain(display.from), into: richToPlain(display.into) })}{display.mastery >= 1 ? ` · ${LEVEL(display.mastery)}` : ''}</span>
      </button>
    )
  }
  // Rejected tool calls (e.g. lighting before the learner answered) are the AI's business; it explains in its reply.
  return null
}

/** Thumbnails of attached files, in the composer (removable) or in a sent message. */
function AttachmentStrip({ items, onRemove }) {
  return (
    <div className="attach-strip">
      {items.map((a, i) => (
        <div key={a.id || i} className={`attach-item attach-${a.kind}`}>
          {a.thumb ? <img src={a.thumb} alt={a.name} /> : <span className="attach-icon"><FileIcon size={22} /></span>}
          {a.kind === 'pdf' && <span className="attach-badge">PDF{a.pages ? ` · ${fill(t('attach.pages'), { n: a.pages })}` : ''}</span>}
          {onRemove && <button type="button" className="attach-remove" aria-label={t('attach.remove')} onClick={() => onRemove(a.id)}><CloseSmallIcon size={14} /></button>}
        </div>
      ))}
    </div>
  )
}

function Composer({ running, onSend, onStop }) {
  const nav = useNav()
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState('')
  const ref = useRef(null)
  const picker = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [text])

  const add = async event => {
    const picked = [...(event.target.files ?? [])]
    event.target.value = ''
    if (!picked.length) return
    setBusy(t('attach.reading'))
    const next = [...files]
    for (const file of picked) {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      if (isPdf ? next.filter(f => f.kind === 'pdf').length >= MAX_PDFS : next.filter(f => f.kind === 'image').length >= MAX_IMAGES) {
        nav.toast(fill(t(isPdf ? 'attach.tooManyPdfs' : 'attach.tooManyImages'), { n: isPdf ? MAX_PDFS : MAX_IMAGES }))
        continue
      }
      try {
        next.push(await readAttachment(file))
      } catch (error) {
        nav.toast(error.message)
      }
    }
    setFiles(next)
    setBusy('')
  }

  const submit = async event => {
    event?.preventDefault()
    const value = text.trim()
    if ((!value && files.length === 0) || running || busy) return
    if (files.length === 0) {
      onSend(value)
      setText('')
      return
    }
    setBusy(files.some(f => f.kind === 'image' || f.scanned) ? t('attach.looking') : t('attach.preparing'))
    try {
      const { content, meta } = await prepareMessage({ text: value, attachments: files, ai: activeAI(getState().settings) })
      onSend(content, { label: value, action: false, attachments: meta })
      setText('')
      setFiles([])
    } catch (error) {
      nav.toast(error.message)
    } finally {
      setBusy('')
    }
  }
  const canSend = (text.trim() || files.length > 0) && !busy
  return (
    <form className="composer-wrap" onSubmit={submit}>
      {files.length > 0 && <AttachmentStrip items={files} onRemove={id => setFiles(list => list.filter(f => f.id !== id))} />}
      {busy && <div className="composer-busy"><span className="typing"><i /><i /><i /></span>{busy}</div>}
      <div className="composer">
        <button type="button" className="attach-btn" aria-label={t('attach.add')} disabled={running || Boolean(busy)} onClick={() => picker.current?.click()}><PaperclipIcon size={22} /></button>
        <input ref={picker} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={add} />
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={t('chat.placeholder')}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) submit(e) }}
        />
        {running
          ? <button type="button" className="send stop" aria-label={t('chat.stop')} onClick={onStop}><StopIcon size={18} /></button>
          : <button type="submit" className="send" aria-label={t('chat.send')} disabled={!canSend}><SendIcon size={20} /></button>}
      </div>
    </form>
  )
}

export function Chat({ chatId }) {
  const nav = useNav()
  const chat = useApp(s => s.chats[chatId])
  const live = useApp(s => s.live[chatId])
  const knowledge = useApp(s => s.knowledge)
  const scroller = useRef(null)
  const stick = useRef(true)

  const goals = useMemo(() => chat?.goals ?? [], [chat?.goals])
  const nodes = useMemo(() => (goals.length ? buildSnapshot(knowledge, goals, Date.now()).nodes : []), [knowledge, goals])
  const s = stats(nodes)
  const due = reviewQueue(nodes, Date.now()).length
  const openTree = () => { if (goals.length) nav.openTree(goals, chatId) }

  // Follow new content while the learner is at the bottom.
  const onScroll = () => {
    const el = scroller.current
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [chat?.messages.length, live?.content, live?.status])

  if (!chat) return null
  const doSend = (text, extra) => { stick.current = true; send(chatId, text, onToolEvent, extra) }
  const title = chatTitle(chat)
  const rename = async () => {
    const name = await promptDialog({ title: t('chat.rename'), message: t('chat.rename.hint'), value: chat.customTitle ?? title, placeholder: title })
    if (name !== null) renameChat(chatId, name)
  }
  // Only the latest reply can be written again, and only when it changed nothing in the map.
  const regenerable = !live && canRegenerate(chat.messages)
  // The button sits under the reply to the learner's latest message, never under an older one.
  let lastAi = -1
  let lastUser = -1
  chat.messages.forEach((m, i) => {
    if (m.role === 'assistant' && m.content) lastAi = i
    if (m.role === 'user') lastUser = i
  })
  if (lastAi < lastUser) lastAi = -1
  const redo = () => { stick.current = true; regenerate(chatId, onToolEvent) }

  return (
    <div className="screen screen-chat">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={nav.back}><BackIcon /></button>
        <button type="button" className="topbar-title topbar-title-btn" onClick={rename} aria-label={`${title} · ${t('chat.rename')}`}>{title}</button>
        {nodes.length > 0 && (
          <button type="button" className="tree-chip" onClick={openTree} aria-label={t('chip.open')}>
            <span className="tt-scope"><ProgressRing lit={s.lit} total={s.total} size={22} /></span>
            <span>{s.lit}/{s.total}</span>
            {due > 0 && <b className="due" title={fill(t('review.today'), { n: due })}><ClockIcon />{due}</b>}
          </button>
        )}
      </header>

      <div className="scroll messages" ref={scroller} onScroll={onScroll}>
        {chat.messages.length === 0 && !live && (
          <div className="chat-empty">
            <TreeIcon size={40} />
            <p>{t('chat.empty')}</p>
            {goals.length === 0 && (
              <div className="examples">
                {[t('home.example.1'), t('home.example.2'), t('home.example.3')].map(x => (
                  <button key={x} type="button" className="chip" onClick={() => doSend(fill(t('goal.prompt'), { goal: x }), fill(t('label.goal'), { goal: x }))}>{x}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {chat.messages.map((m, i) => {
          if (m.role === 'user') {
            const shown = m.label !== undefined ? m.label : m.content
            return (
              <div key={i} className="msg msg-user">
                {m.attachments?.length > 0 && <AttachmentStrip items={m.attachments} />}
                {shown && <div className="bubble">{shown}</div>}
              </div>
            )
          }
          if (m.role === 'assistant') {
            if (!m.content) return null
            return (
              <div key={i} className="msg msg-ai">
                <Markdown text={m.content} />
                {!live && <MessageActions text={m.content} onRegenerate={i === lastAi && regenerable ? redo : null} />}
              </div>
            )
          }
          if (m.role === 'tool') return <div key={i} className="msg msg-tool"><ToolPill display={m.display} onOpenTree={openTree} knowledge={knowledge} /></div>
          if (m.role === 'error') {
            return (
              <div key={i} className="msg msg-error">
                <AlertIcon size={18} />
                <div>
                  <p>{m.content}</p>
                  {m.detail && <p className="msg-error-detail">{m.detail}</p>}
                  <div className="row">
                    {['no-key', 'model', 'balance'].includes(m.code) && <button type="button" className="btn btn-small btn-primary" onClick={nav.openSettings}>{t('chat.openSettings')}</button>}
                    {m.code !== 'no-key' && <button type="button" className="btn btn-small" onClick={() => doSend(null)}>{t('chat.retry')}</button>}
                  </div>
                </div>
              </div>
            )
          }
          return null
        })}
        {live && (
          live.content
            ? <div className="msg msg-ai"><Markdown text={live.content} /><span className="caret" /></div>
            : <div className="msg msg-ai"><span className="typing"><i /><i /><i /></span><span className="muted">{t(live.status === 'tools' ? 'chat.tool.running' : 'chat.thinking')}</span></div>
        )}
      </div>

      {goals.length > 0 && !live && chat.messages.length > 0 && (
        <div className="quick">
          <button type="button" className="chip" onClick={openTree}><TreeIcon size={15} /> {t('chip.open')}</button>
          <button type="button" className="chip" onClick={() => doSend(t('prompt.next'), t('label.next'))}>{t('tree.continue')}</button>
          {due > 0 && <button type="button" className="chip chip-due" onClick={() => doSend(fill(t('prompt.reviewBatch'), { n: due, list: reviewQueue(nodes, Date.now()).map(n => `${richToPlain(n.name)}（${n.id}）`).join('、') }), fill(t('label.reviewBatch'), { n: due }))}>{fill(t('review.today'), { n: due })}</button>}
        </div>
      )}
      <Composer running={Boolean(live)} onSend={doSend} onStop={() => stop(chatId)} />
    </div>
  )
}

