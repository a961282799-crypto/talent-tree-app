import { useMemo, useState } from 'react'
import { buildSnapshot } from '../graph.js'
import { useApp } from '../storage.js'
import { activeAI } from '../providers.js'
import { libraryOf, useNav } from '../nav.js'
import { fill, t } from '../i18n.js'
import { ClockIcon, ProgressRing, Rich, SparkIcon, TreeIcon, TreeThumb, recommend, reviewQueue, richToPlain, stats } from '../tree.js'
import { ChevronIcon, KeyIcon } from '../icons.jsx'
import { MapCard } from './MapScreen.jsx'
import { hasDemo, removeDemo, seedDemo } from '../demo.js'
import { confirmAction } from '../native.js'

const MEDAL = ['', '#c8834c', '#93a4bd', '#eeb031']
/** Points one review session covers; the rest wait for the next one. */
const REVIEW_BATCH = 8

function GoalForm({ onGoal }) {
  const [goal, setGoal] = useState('')
  const submit = event => {
    event.preventDefault()
    const value = goal.trim()
    if (!value) return
    onGoal(value)
    setGoal('')
  }
  return (
    <form className="goal-form" onSubmit={submit}>
      <label className="goal-input">
        <SparkIcon size={18} />
        <input
          value={goal}
          placeholder={t('goal.placeholder')}
          aria-label={t('goal.placeholder')}
          enterKeyHint="go"
          onChange={e => setGoal(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={goal.trim() === ''}>{t('goal.submit')}</button>
    </form>
  )
}

/** The conversation the learner was last in, with what to learn next. */
function ContinueCard({ chat, knowledge, onOpen }) {
  const nodes = buildSnapshot(knowledge, chat.goals, Date.now()).nodes
  if (!nodes.length) return null
  const s = stats(nodes)
  const next = recommend(nodes, chat.goals.map(g => g.id))
  const nextNode = next ? nodes.find(n => n.id === next) : null
  const done = s.total > 0 && s.lit === s.total
  return (
    <button type="button" className="continue-card" onClick={onOpen}>
      <span className="tt-scope"><ProgressRing lit={s.lit} total={s.total} size={46} /></span>
      <span className="continue-body">
        <span className="continue-label">{t('home.continue')}</span>
        <b>{chat.goals.map(g => richToPlain(g.name)).join(' · ')}</b>
        <span className="continue-next">
          {done ? t('home.allLit') : nextNode ? <>{t('home.next')}<Rich text={nextNode.name} /></> : fill(t('progress'), { lit: s.lit, total: s.total })}
        </span>
      </span>
      <ChevronIcon size={20} className="chev" />
    </button>
  )
}

/** Due points from every goal, reviewed together. */
function ReviewCard({ due, onStart }) {
  const batch = due.slice(0, REVIEW_BATCH)
  return (
    <div className="review-card">
      <div className="review-head">
        <span className="review-icon"><ClockIcon /></span>
        <b>{fill(t('home.reviewTitle'), { n: due.length })}</b>
      </div>
      <p className="review-names">{batch.slice(0, 4).map(n => richToPlain(n.name)).join('、')}{due.length > 4 ? '…' : ''}</p>
      <button type="button" className="btn btn-review" onClick={() => onStart(batch)}>
        {due.length > REVIEW_BATCH ? fill(t('home.reviewStartSome'), { n: REVIEW_BATCH }) : t('home.reviewStart')}
      </button>
    </div>
  )
}

export function Home() {
  const nav = useNav()
  const knowledge = useApp(s => s.knowledge)
  const chats = useApp(s => s.chats)
  const hasKey = useApp(s => Boolean(activeAI(s.settings).apiKey))
  const now = Date.now()
  const entries = useMemo(() => libraryOf(knowledge, Date.now()), [knowledge])
  const lastChat = useMemo(() => Object.values(chats)
    .filter(c => c.goals.length && c.goals.some(g => knowledge.nodes[g.id]))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0], [chats, knowledge])
  const due = useMemo(() => reviewQueue(Object.values(knowledge.nodes).map(n => ({ ...n, mastery: n.mastery ?? 0 })), Date.now()), [knowledge])
  const demo = hasDemo(knowledge)
  const dropDemo = async () => {
    if (await confirmAction(t('demo.removeConfirm'), { ok: t('demo.remove') })) removeDemo()
  }
  const examples = [t('home.example.1'), t('home.example.2'), t('home.example.3')]
  return (
    <div className="screen">
      <header className="topbar topbar-home">
        <div className="brand"><TreeIcon size={26} /><span>{t('app.name')}</span></div>
      </header>
      <div className="scroll">
        <section className="intro">
          <p className="slogan">{t('app.slogan')}</p>
          <h1>{t('home.hello')}</h1>
          <p>{t('home.sub')}</p>
          <GoalForm onGoal={nav.startGoal} />
          {entries.length === 0 && (
            <div className="examples">
              <span>{t('home.examples')}</span>
              {examples.map(x => <button key={x} type="button" className="chip" onClick={() => nav.startGoal(x)}>{x}</button>)}
            </div>
          )}
          {entries.length === 0 && !hasKey && (
            <button type="button" className="link small demo-link" onClick={seedDemo}>{t('demo.open')} ›</button>
          )}
        </section>

        {import.meta.env.VITE_DEMO && <p className="banner banner-info">{t('home.preview')}</p>}
        {demo && !import.meta.env.VITE_DEMO && (
          <div className="banner banner-info demo-banner">
            <span>{t('demo.banner')}</span>
            <button type="button" className="btn btn-small" onClick={dropDemo}>{t('demo.remove')}</button>
          </div>
        )}
        {!hasKey && !import.meta.env.VITE_DEMO && (
          <button type="button" className="banner" onClick={nav.openSettings}>
            <KeyIcon size={20} />
            <span>{t('home.noKey')}</span>
            <b>{t('home.noKey.action')}</b>
          </button>
        )}

        {(lastChat || due.length > 0) && (
          <div className="today">
            {lastChat && <ContinueCard chat={lastChat} knowledge={knowledge} onOpen={() => nav.openChat(lastChat.id)} />}
            {due.length > 0 && <ReviewCard due={due} onStart={nav.reviewAll} />}
          </div>
        )}

        <h2 className="section-title">{t('library.title')}</h2>
        <MapCard knowledge={knowledge} onOpen={nav.openMap} />
        {entries.length === 0
          ? <p className="muted pad">{t('library.empty')}</p>
          : (
            <div className="cards">
              {entries.map(e => {
                const s = stats(e.nodes)
                const dueHere = reviewQueue(e.nodes, now).length
                return (
                  <button key={e.goal.id} type="button" className="goal-card" onClick={() => nav.openTree([e.goal])}>
                    <span className="goal-thumb tt-scope"><TreeThumb nodes={e.nodes} /></span>
                    <span className="goal-card-main">
                      <span className="goal-card-head">
                        <span className="goal-card-name"><Rich text={e.goal.name} /></span>
                        {dueHere > 0 && <b className="due">{fill(t('review.short'), { n: dueHere })}</b>}
                      </span>
                      <span className="bar"><i style={{ width: `${s.total ? (s.lit / s.total) * 100 : 0}%` }} /></span>
                      <span className="goal-card-row">
                        <span>{fill(t('progress'), { lit: s.lit, total: s.total })}</span>
                        <span className="medals">
                          {[1, 2, 3].map(l => <span key={l}><i style={{ background: MEDAL[l] }} />{s.medals[l]}</span>)}
                        </span>
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
      </div>
    </div>
  )
}
