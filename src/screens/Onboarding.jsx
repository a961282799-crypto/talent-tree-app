import { useState } from 'react'
import { updateProvider, updateSettings, useApp } from '../storage.js'
import { PROVIDERS, providerById, providerName } from '../providers.js'
import { fill, lang, t } from '../i18n.js'
import { TreeIcon } from '../tree.js'
import { seedDemo } from '../demo.js'

/** Page 1: a little tree (basics on top, goal at the bottom, as in the app) lighting up point by point. */
function LightingTree() {
  const nodes = [
    { x: 30, y: 12, d: 0 }, { x: 110, y: 12, d: 1 }, { x: 190, y: 12, d: 2 },
    { x: 70, y: 62, d: 3 }, { x: 150, y: 62, d: 4 }, { x: 110, y: 112, d: 5, goal: true },
  ]
  const edges = [[0, 3], [1, 3], [1, 4], [2, 4], [3, 5], [4, 5]]
  return (
    <svg className="onb-tree" viewBox="0 0 260 150" aria-hidden="true">
      {edges.map(([a, b]) => (
        <line key={`${a}-${b}`} className="onb-edge" style={{ '--d': nodes[b].d }} x1={nodes[a].x + 20} y1={nodes[a].y + 26} x2={nodes[b].x + 20} y2={nodes[b].y} />
      ))}
      {nodes.map((n, i) => (
        <g key={i} className={`onb-node${n.goal ? ' onb-goal' : ''}`} style={{ '--d': n.d }}>
          <rect x={n.x} y={n.y} width="40" height="26" rx="8" />
          <circle cx={n.x + 13} cy={n.y + 13} r="6" />
        </g>
      ))}
    </svg>
  )
}

function Medals() {
  return (
    <div className="onb-medals">
      {[1, 2, 3].map(l => (
        <div key={l} className={`onb-medal m-${l}`}>
          <span className="onb-medal-badge">★</span>
          <b>{t(`level.${l}`)}</b>
          <small>{t(`onb.level.${l}`)}</small>
        </div>
      ))}
    </div>
  )
}

/** First-run guide: what the app does, how points light up, and connecting an AI service. */
export function Onboarding() {
  const settings = useApp(s => s.settings)
  const [page, setPage] = useState(0)
  const preset = providerById(settings.provider)
  const key = settings.providers?.[preset.id]?.apiKey ?? ''
  const finish = () => updateSettings({ onboarded: true })
  const pages = [
    { art: <LightingTree />, title: t('app.slogan'), body: t('onb.1.body') },
    { art: <Medals />, title: t('onb.2.title'), body: t('onb.2.body') },
  ]
  const last = page === pages.length
  return (
    <div className="onboarding" role="dialog" aria-label={t('app.name')}>
      <div className="onb-top">
        <span className="onb-brand"><TreeIcon size={22} />{t('app.name')}</span>
        {!last && <button type="button" className="onb-skip" onClick={() => setPage(pages.length)}>{t('onb.skip')}</button>}
      </div>
      {!last ? (
        <div className="onb-page" key={page}>
          <div className="onb-art">{pages[page].art}</div>
          <h1>{pages[page].title}</h1>
          <p>{pages[page].body}</p>
        </div>
      ) : (
        <div className="onb-page onb-setup" key="setup">
          <h1>{t('onb.3.title')}</h1>
          <p>{t('onb.3.body')}</p>
          <label className="field">
            <span>{t('settings.provider')}</span>
            <select value={preset.id} onChange={e => updateSettings({ provider: e.target.value })}>
              {PROVIDERS.filter(p => p.id !== 'custom').map(p => <option key={p.id} value={p.id}>{providerName(p, lang)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t('settings.apiKey')}</span>
            <input type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder={t('settings.apiKey.placeholder')} value={key} onChange={e => updateProvider(preset.id, { apiKey: e.target.value.trim() })} />
          </label>
          {preset.keyUrl && <a className="link small" href={preset.keyUrl} target="_blank" rel="noreferrer">{fill(t('settings.getKey'), { name: providerName(preset, lang) })} ›</a>}
          <p className="muted small">{t('onb.3.note')}</p>
        </div>
      )}
      <div className="onb-bottom">
        <div className="onb-dots">{[0, 1, 2].map(i => <i key={i} className={i === page ? 'on' : ''} />)}</div>
        {!last
          ? <button type="button" className="btn btn-primary onb-next" onClick={() => setPage(p => p + 1)}>{t('onb.next')}</button>
          : (
            <div className="onb-actions">
              <button type="button" className="btn btn-primary onb-next" onClick={finish} disabled={!key}>{t('onb.start')}</button>
              <button type="button" className="onb-later" onClick={() => { seedDemo(); finish() }}>{t('onb.demo')}</button>
              <button type="button" className="onb-later" onClick={finish}>{t('onb.later')}</button>
            </div>
          )}
      </div>
    </div>
  )
}
