import { useMemo, useState } from 'react'
import { closure, nameSimilarity } from '../graph.js'
import { mergeKnowledge, useApp } from '../storage.js'
import { useNav } from '../nav.js'
import { fill, t } from '../i18n.js'
import { Rich, richToPlain } from '../tree.js'
import { confirmAction } from '../native.js'

/**
 * Pick the point that is the same knowledge as `node` and merge it in.
 * Points that build on each other are left out: they cannot be the same knowledge.
 */
export function MergeSheet({ node, onClose, onMerged }) {
  const nav = useNav()
  const knowledge = useApp(s => s.knowledge)
  const [query, setQuery] = useState('')
  const candidates = useMemo(() => {
    const below = closure(knowledge, [node.id])
    return Object.values(knowledge.nodes)
      .filter(n => n.id !== node.id && !below.has(n.id) && !closure(knowledge, [n.id]).has(node.id))
      .map(n => ({ node: n, score: Math.max(...[n.name, ...(n.aliases ?? [])].map(x => nameSimilarity(node.name, x))) }))
      .sort((a, b) => b.score - a.score)
  }, [knowledge, node])
  const q = query.trim().toLowerCase()
  const shown = q
    ? candidates.filter(c => [c.node.name, c.node.id, ...(c.node.aliases ?? [])].some(x => richToPlain(x).toLowerCase().includes(q))).slice(0, 30)
    : candidates.filter(c => c.score >= 0.3).slice(0, 12)

  const pick = async other => {
    if (!(await confirmAction(fill(t('merge.confirm'), { from: richToPlain(other.name), into: richToPlain(node.name) })))) return
    try {
      const kept = mergeKnowledge(other.id, node.id)
      nav.toast(fill(t('merge.done'), { name: richToPlain(kept.name) }))
      onMerged?.(other.id, node.id)
      onClose()
    } catch (error) {
      nav.toast(fill(t('merge.failed'), { message: error.message }))
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={t('merge.title')} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>{t('merge.title')}</h3>
        <p className="muted small">{fill(t('merge.desc'), { name: richToPlain(node.name) })}</p>
        <input className="sheet-search" type="search" placeholder={t('merge.search')} value={query} onChange={e => setQuery(e.target.value)} />
        {!q && shown.length > 0 && <div className="sheet-label">{t('merge.similar')}</div>}
        <div className="sheet-list">
          {shown.length === 0 && <p className="muted small pad">{t('merge.none')}</p>}
          {shown.map(({ node: n }) => (
            <button key={n.id} type="button" className="sheet-item" onClick={() => pick(n)}>
              <span className="sheet-item-name"><Rich text={n.name} /></span>
              {n.mastery >= 1 && <span className={`medal-dot m-${n.mastery}`}>{t(`medal.${n.mastery}`)}</span>}
              <code>{n.id}</code>
            </button>
          ))}
        </div>
        <button type="button" className="btn sheet-cancel" onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </div>
  )
}
