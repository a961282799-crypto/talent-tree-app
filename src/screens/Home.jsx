import { useMemo, useState } from 'react'
import { useApp } from '../storage.js'
import { activeAI } from '../providers.js'
import { libraryOf, useNav } from '../nav.js'
import { fill, t } from '../i18n.js'
import { Rich, SparkIcon, TreeIcon, reviewQueue, stats } from '../tree.js'
import { ChevronIcon, KeyIcon } from '../icons.jsx'

const MEDAL = ['', '#c8834c', '#93a4bd', '#eeb031']

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

export function Home() {
  const nav = useNav()
  const knowledge = useApp(s => s.knowledge)
  const hasKey = useApp(s => Boolean(activeAI(s.settings).apiKey))
  const now = Date.now()
  const entries = useMemo(() => libraryOf(knowledge, now), [knowledge])
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
        </section>

        {import.meta.env.VITE_DEMO && <p className="banner banner-info">{t('home.preview')}</p>}
        {!hasKey && !import.meta.env.VITE_DEMO && (
          <button type="button" className="banner" onClick={nav.openSettings}>
            <KeyIcon size={20} />
            <span>{t('home.noKey')}</span>
            <b>{t('home.noKey.action')}</b>
          </button>
        )}

        <h2 className="section-title">{t('library.title')}</h2>
        {entries.length === 0
          ? <p className="muted pad">{t('library.empty')}</p>
          : (
            <div className="cards">
              {entries.map(e => {
                const s = stats(e.nodes)
                const due = reviewQueue(e.nodes, now).length
                return (
                  <button key={e.goal.id} type="button" className="goal-card" onClick={() => nav.openTree([e.goal])}>
                    <div className="goal-card-head">
                      <span className="goal-card-name"><Rich text={e.goal.name} /></span>
                      {due > 0 && <b className="due">{fill(t('review.short'), { n: due })}</b>}
                      <ChevronIcon size={18} className="chev" />
                    </div>
                    <span className="bar"><i style={{ width: `${s.total ? (s.lit / s.total) * 100 : 0}%` }} /></span>
                    <div className="goal-card-row">
                      <span>{fill(t('progress'), { lit: s.lit, total: s.total })} · {fill(t('frontier'), { n: s.frontier })}</span>
                      <span className="medals">
                        {[1, 2, 3].map(l => <span key={l}><i style={{ background: MEDAL[l] }} />{s.medals[l]}</span>)}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
      </div>
    </div>
  )
}
