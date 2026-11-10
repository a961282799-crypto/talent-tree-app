import { useMemo, useState } from 'react'
import { buildSnapshot, goalsContaining } from '../graph.js'
import { MergeSheet } from './MergeSheet.jsx'
import { chatForGoal, forgetGoal, useApp } from '../storage.js'
import { useNav } from '../nav.js'
import { fill, t } from '../i18n.js'
import { Empty, Hero, Stage, reviewPrompt, richToPlain } from '../tree.js'
import { BackIcon, ChatIcon, TrashIcon } from '../icons.jsx'
import { confirmAction } from '../native.js'

/** One talent tree, full screen. `chatId` is set when opened from a conversation. */
export function TreeScreen({ goals: initialGoals, chatId }) {
  const nav = useNav()
  const knowledge = useApp(s => s.knowledge)
  // A merge can replace one of these goals with the point it was merged into.
  const [goals, setGoals] = useState(initialGoals)
  const [merging, setMerging] = useState(null)
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
    if (!(await confirmAction(fill(t('tree.deleteConfirm'), { name: title })))) return
    shown.forEach(g => forgetGoal(g.id))
    nav.back()
  }
  return (
    <div className="screen screen-tree">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={nav.back}><BackIcon /></button>
        <div className="topbar-title">{title}</div>
        {!chatId && <button type="button" className="icon-btn" aria-label={t('tree.delete')} onClick={remove}><TrashIcon size={20} /></button>}
        <button type="button" className="icon-btn" aria-label={t('tree.chat')} onClick={openChat}><ChatIcon /></button>
      </header>
      <div className="tt-scope tt-root tree-body">
        {nodes.length === 0
          ? <Empty t={t} />
          : (
            <>
              <Hero
                t={t}
                title={title}
                nodes={nodes}
                onReview={due => act(reviewPrompt(t, due), fill(t('label.reviewBatch'), { n: due.length }))}
                extra={<button type="button" className="tt-btn tt-btn-primary" onClick={continueLearning}>{t('tree.continue')}</button>}
              />
              <Stage t={t} title={title} nodes={nodes} goalIds={goalIds} act={act} fitKey={`${goalKey}:${nodes.length}`} alsoInOf={alsoInOf} onOpenGoal={g => nav.openTree([g])} onMerge={setMerging} />
            </>
          )}
      </div>
      {merging && <MergeSheet node={merging} onClose={() => setMerging(null)} onMerged={onMerged} />}
    </div>
  )
}
