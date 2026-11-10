import { useMemo, useRef, useState } from 'react'
import { buildSnapshot } from '../graph.js'
import { useApp } from '../storage.js'
import { libraryOf, useNav } from '../nav.js'
import { fill, t } from '../i18n.js'
import { Empty, Stage, exportPng, stats } from '../tree.js'
import { BackIcon, MoreIcon } from '../icons.jsx'
import { MergeSheet } from './MergeSheet.jsx'

/**
 * The learner's whole knowledge map: every goal's tree drawn on one canvas, with
 * points that several goals share marked, so the connections between topics show.
 */
export function MapScreen() {
  const nav = useNav()
  const knowledge = useApp(s => s.knowledge)
  const [merging, setMerging] = useState(null)
  const [menu, setMenu] = useState(false)
  const camera = useRef(null)
  const entries = useMemo(() => libraryOf(knowledge), [knowledge])
  const goals = entries.map(e => e.goal)
  const goalIds = useMemo(() => new Set(goals.map(g => g.id)), [goals.map(g => g.id).join(',')])
  const nodes = useMemo(() => buildSnapshot(knowledge, goals, Date.now()).nodes, [knowledge, goalIds])
  // How many goals use each point.
  const shared = useMemo(() => {
    const count = {}
    for (const e of entries) for (const n of e.nodes) count[n.id] = (count[n.id] || 0) + 1
    return count
  }, [entries])
  const sharedCount = Object.values(shared).filter(c => c > 1).length
  const s = stats(nodes)
  const goalsOfNode = id => entries.filter(e => e.nodes.some(n => n.id === id)).map(e => e.goal)
  // Study a point in the conversation of a goal that contains it.
  const act = (text, label, node) => {
    const owners = node ? goalsOfNode(node.id) : []
    nav.learn({ goals: owners.length ? [owners[0]] : goals.slice(0, 1), text, label })
  }
  const alsoInOf = id => goalsOfNode(id)
  const doExport = () => {
    setMenu(false)
    exportPng(t, t('map.title'), nodes, goalIds).then(
      how => { if (how === 'downloaded') nav.toast(t('toast.exported')) },
      () => nav.toast(t('toast.exportFailed')))
  }

  return (
    <div className="screen screen-tree">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={nav.back}><BackIcon /></button>
        <div className="topbar-title">{t('map.title')}</div>
        {nodes.length > 0 && <button type="button" className="icon-btn" aria-label={t('tree.menu')} onClick={() => setMenu(v => !v)}><MoreIcon /></button>}
      </header>
      {menu && (
        <div className="menu-backdrop" onClick={() => setMenu(false)}>
          <div className="menu" role="menu" onClick={e => e.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); camera.current?.fit() }}>{t('tree.fitAll')}</button>
            <button type="button" role="menuitem" onClick={doExport}>{t('tree.export')}</button>
          </div>
        </div>
      )}
      <div className="tt-scope tt-root tree-body">
        {nodes.length === 0
          ? <Empty t={t} body={t('map.empty')} />
          : (
            <>
              <div className="map-summary">
                <span><b>{nodes.length}</b>{t('map.points')}</span>
                <span><b>{s.lit}</b>{t('map.lit')}</span>
                <span><b>{goals.length}</b>{t('map.goals')}</span>
                <span className="map-shared"><b>🔗 {sharedCount}</b>{t('map.shared')}</span>
              </div>
              <Stage
                t={t} title={t('map.title')} nodes={nodes} goalIds={goalIds} act={act} fitKey={`map:${nodes.length}:${goals.length}`}
                alsoInOf={alsoInOf} onOpenGoal={g => nav.openTree([g])} onMerge={setMerging} camera={camera} shared={shared} overview
              />
            </>
          )}
      </div>
      {merging && <MergeSheet node={merging} onClose={() => setMerging(null)} />}
    </div>
  )
}

/** Card on the home page that leads to the map once there is more than one goal. */
export function MapCard({ knowledge, onOpen }) {
  const entries = libraryOf(knowledge)
  if (entries.length < 2) return null
  const all = new Set(entries.flatMap(e => e.nodes.map(n => n.id)))
  const count = {}
  for (const e of entries) for (const n of e.nodes) count[n.id] = (count[n.id] || 0) + 1
  const sharedCount = Object.values(count).filter(c => c > 1).length
  return (
    <button type="button" className="map-card" onClick={onOpen}>
      <span className="map-card-icon">🗺️</span>
      <span className="map-card-body">
        <b>{t('map.title')}</b>
        <span>{fill(t('map.cardMeta'), { points: all.size, goals: entries.length, shared: sharedCount })}</span>
      </span>
      <span className="plan-card-go">{t('chat.plan.open')} ›</span>
    </button>
  )
}

