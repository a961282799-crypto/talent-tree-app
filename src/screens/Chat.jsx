import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildSnapshot } from '../graph.js'
import { useApp } from '../storage.js'
import { onToolEvent, useNav } from '../nav.js'
import { send, stop } from '../ai.js'
import { renderMarkdown } from '../markdown.js'
import { fill, t } from '../i18n.js'
import { ClockIcon, ProgressRing, StarIcon, TreeIcon, reviewQueue, richToPlain, stats } from '../tree.js'
import { AlertIcon, BackIcon, ChevronIcon, SendIcon, StopIcon } from '../icons.jsx'

function Markdown({ text }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}

const LEVEL = l => t(`level.${l}`)

/** A one-line status for a tool call; plans and light-ups stand out. */
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

function Composer({ running, onSend, onStop }) {
  const [text, setText] = useState('')
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [text])
  const submit = event => {
    event?.preventDefault()
    const value = text.trim()
    if (!value || running) return
    onSend(value)
    setText('')
  }
  return (
    <form className="composer" onSubmit={submit}>
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
        : <button type="submit" className="send" aria-label={t('chat.send')} disabled={!text.trim()}><SendIcon size={20} /></button>}
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

  const goals = chat?.goals ?? []
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
  const doSend = (text, label) => { stick.current = true; send(chatId, text, onToolEvent, label) }
  const title = goals.length ? goals.map(g => richToPlain(g.name)).join(' · ') : chat.title || t('chat.untitled')

  return (
    <div className="screen screen-chat">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={nav.back}><BackIcon /></button>
        <div className="topbar-title">{title}</div>
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
          if (m.role === 'user') return <div key={i} className="msg msg-user"><div className="bubble">{m.label || m.content}</div></div>
          if (m.role === 'assistant') return m.content ? <div key={i} className="msg msg-ai"><Markdown text={m.content} /></div> : null
          if (m.role === 'tool') return <div key={i} className="msg msg-tool"><ToolPill display={m.display} onOpenTree={openTree} knowledge={knowledge} /></div>
          if (m.role === 'error') {
            return (
              <div key={i} className="msg msg-error">
                <AlertIcon size={18} />
                <div>
                  <p>{fill(t('chat.error'), { message: m.content })}</p>
                  <div className="row">
                    {m.code === 'no-key'
                      ? <button type="button" className="btn btn-small btn-primary" onClick={nav.openSettings}>{t('chat.openSettings')}</button>
                      : <button type="button" className="btn btn-small" onClick={() => doSend(null)}>{t('chat.retry')}</button>}
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

