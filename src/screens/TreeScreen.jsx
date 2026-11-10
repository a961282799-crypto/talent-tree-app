import { useMemo, useRef, useState } from 'react'
import { buildSnapshot, goalsContaining } from '../graph.js'
import { chatForGoal, forgetGoal, useApp } from '../storage.js'
import { useNav } from '../nav.js'
import { fill, t } from '../i18n.js'
import { ClockIcon, Empty, ProgressRing, Stage, exportPng, reviewPrompt, reviewQueue, richToPlain, stats } from '../tree.js'
import { BackIcon, ChatIcon, ChevronIcon, MoreIcon, TrashIcon } from '../icons.jsx'
import { confirmAction } from '../native.js'
import { MergeSheet } from './MergeSheet.jsx'

const MEDAL = ['', '#c8834c', '#93a4bd', '#eeb031']

/** One line of progress: ring, counts, medals, and the review shortcut. */
function ProgressRow({ nodes, onReview }) {
  const s = stats(nodes)
  const due = reviewQueue(nodes, Date.now())
  return (
    <div className="tree-progress tt-scope">
      <ProgressRing lit={s.lit} total={s.total} size={40} />
      <div className="tree-progress-text">
        <b>{fill(t('hero.progress'), { lit: s.lit, total: s.total })}</b>
        <span>{fill(t('hero.frontier'), { n: s.frontier })}</span>
        <span className="tree-medals">
          {[1, 2, 3].map(l => <span key={l} title={t(`level.${l}`)}><i style={{ background: MEDAL[l] }} />{s.medals[l]}</span>)}
        </span>
      </div>
      {due.length > 0 && (
        <button type="button" className="tt-review" onClick={() => onReview(due)} title={due.map(n => richToPlain(n.name)).join('、')}>
          <ClockIcon />{fill(t('hero.review'), { n: due.length })}
        </button>
      )}
    </div>
  )
}

/** One talent tree, full screen. `chatId` is set when opened from a conversation. */
export function TreeScreen({ goals: initialGoals, chatId }) {
  const nav = useNav()
  const knowledge = useApp(s => s.knowledge)
  // A merge can replace one of these goals with the point it was merged into.
  const [goals, setGoals] = useState(initialGoals)
  const [merging, setMerging] = useState(null)
  const [menu, setMenu] = useState(false)
  const stageCamera = useRef(null)
  // Inside a chat, follow that chat's goals as the AI adds them.
  const chatGoals = useApp(s => (chatId ? s.chats[chatId]?.goals : undefined))
  const shown = chatGoals && chatGoals.length ? chatGoals : goals
  const snapshot = useMemo(() => buildSnapshot(knowledge, shown, Date.now()), [knowledge, shown])
  const nodes = snapshot.nodes
  const goalKey = shown.map(g => g.id).join(',')
  const goalIds = useMemo(() => new Set(shown.map(g => g.id)), [goalKey])
  const title = snapshot.goals.map(g => richToPlain(g.name)).join(' · ')
  const hidden = new Set(knowledge.hidden ?? [])
  const alsoInOf = id => goalsContaining(knowledge, id).filter(g => !goalIds.has(g.id) && !hidden.has(g.id))
  const onMerged = (fromId, intoId) => setGoals(list => list.map(g => (g.id === fromId ? { ...g, id: intoId } : g)))
  const act = (text, label) => nav.learn({ goals: snapshot.goals, chatId, text, label })
  const continueLearning = () => nav.learn({ goals: snapshot.goals, chatId, text: t('prompt.next'), newText: t('prompt.continue'), label: t('label.next') })
  const openChat = () => {
    if (chatId) return nav.back()
    const existing = chatForGoal(shown[0].id)
    return existing ? nav.openChat(existing.id) : continueLearning()
  }
  const remove = async () => {
    setMenu(false)
    if (!(await confirmAction(fill(t('tree.deleteConfirm'), { name: title })))) return
    shown.forEach(g => forgetGoal(g.id))
    nav.back()
  }
  const doExport = () => {
    setMenu(false)
    exportPng(t, title, nodes, goalIds).then(
      how => { if (how === 'downloaded') nav.toast(t('toast.exported')) },
      () => nav.toast(t('toast.exportFailed')))
  }
  const fitAll = () => { setMenu(false); stageCamera.current?.fit() }

  return (
    <div className="screen screen-tree">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={nav.back}><BackIcon /></button>
        <div className="topbar-title">{title}</div>
        <button type="button" className="icon-btn" aria-label={t('tree.chat')} onClick={openChat}><ChatIcon /></button>
        <button type="button" className="icon-btn" aria-label={t('tree.menu')} aria-expanded={menu} onClick={() => setMenu(v => !v)}><MoreIcon /></button>
      </header>
      {menu && (
        <div className="menu-backdrop" onClick={() => setMenu(false)}>
          <div className="menu" role="menu" onClick={e => e.stopPropagation()}>
            {nodes.length > 0 && <button type="button" role="menuitem" onClick={fitAll}>{t('tree.fitAll')}</button>}
            {nodes.length > 0 && <button type="button" role="menuitem" onClick={doExport}>{t('tree.export')}</button>}
            {!chatId && <button type="button" role="menuitem" className="danger" onClick={remove}><TrashIcon size={18} />{t('tree.delete')}</button>}
          </div>
        </div>
      )}
      <div className="tt-scope tt-root tree-body">
        {nodes.length === 0
          ? <Empty t={t} />
          : (
            <>
              <ProgressRow nodes={nodes} onReview={due => act(reviewPrompt(t, due), fill(t('label.reviewBatch'), { n: due.length }))} />
              <Stage
                t={t} title={title} nodes={nodes} goalIds={goalIds} act={act} fitKey={`${goalKey}:${nodes.length}`}
                alsoInOf={alsoInOf} onOpenGoal={g => nav.openTree([g])} onMerge={setMerging} camera={stageCamera}
                fab={<button type="button" className="fab" onClick={continueLearning}>{t('tree.continue')}<ChevronIcon size={18} /></button>}
              />
            </>
          )}
      </div>
      {merging && <MergeSheet node={merging} onClose={() => setMerging(null)} onMerged={onMerged} />}
    </div>
  )
}
