import { useRef, useState } from 'react'
import { clearAll, exportData, getState, importData, parseImport, updateProvider, updateSettings, useApp } from '../storage.js'
import { testConnection } from '../ai.js'
import { useNav } from '../nav.js'
import { PROVIDERS, activeAI, providerById, providerName } from '../providers.js'
import { fill, lang, t } from '../i18n.js'
import { confirmAction, saveFile } from '../native.js'

const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0'
const LANGUAGES = [
  { id: 'system', label: () => t('settings.language.system') },
  { id: 'zh', label: () => '简体中文' },
  { id: 'en', label: () => 'English' },
]

export function Settings() {
  const nav = useNav()
  const settings = useApp(s => s.settings)
  const [show, setShow] = useState(false)
  const [test, setTest] = useState({ status: 'idle', message: '' })
  const file = useRef(null)

  const preset = providerById(settings.provider)
  const active = activeAI(settings)
  const own = settings.providers?.[preset.id] ?? {}
  const custom = preset.id === 'custom'
  // The free-text model field shows for a model outside the suggestions, or when asked for.
  const [other, setOther] = useState(false)
  const otherOpen = preset.models.length === 0 || other || Boolean(own.model && !preset.models.includes(own.model))
  const reset = () => setTest({ status: 'idle', message: '' })
  const setOwn = patch => { updateProvider(preset.id, patch); reset() }

  const runTest = async () => {
    setTest({ status: 'loading', message: '' })
    try {
      await testConnection(active)
      setTest({ status: 'ok', message: t('settings.testOk') })
    } catch (error) {
      setTest({ status: 'error', message: error.message })
    }
  }

  const doExport = async () => {
    const blob = new Blob([JSON.stringify(exportData(), null, 1)], { type: 'application/json' })
    const day = new Date().toISOString().slice(0, 10)
    try { await saveFile(blob, `talent-tree-${day}.json`, 'application/json') } catch { nav.toast(t('toast.exportFailed')) }
  }

  const doImport = async event => {
    const f = event.target.files?.[0]
    event.target.value = ''
    if (!f) return
    let data
    let incoming
    try {
      data = JSON.parse(await f.text())
      incoming = Object.keys(parseImport(data).nodes).length
    } catch {
      nav.toast(t('settings.importFailed'))
      return
    }
    // Importing replaces the whole map: ask first when there is progress to lose.
    const current = Object.keys(getState().knowledge.nodes).length
    if (current > 0 && !(await confirmAction(fill(t('settings.importConfirm'), { n: incoming, current })))) return
    const n = importData(data)
    nav.toast(fill(t('settings.imported'), { n }))
  }

  const doClear = async () => {
    if (!(await confirmAction(t('settings.clearConfirm')))) return
    clearAll()
    nav.toast(t('settings.cleared'))
  }

  return (
    <div className="screen">
      <header className="topbar topbar-home"><div className="brand"><span>{t('settings.title')}</span></div></header>
      <div className="scroll settings">
        <h2 className="section-title">{t('settings.ai')}</h2>
        <div className="group">
          <label className="field">
            <span>{t('settings.provider')}</span>
            <select value={preset.id} onChange={e => { updateSettings({ provider: e.target.value }); setShow(false); setOther(false); reset() }}>
              {PROVIDERS.map(p => <option key={p.id} value={p.id}>{providerName(p, lang)}</option>)}
            </select>
          </label>

          <label className="field">
            <span>{t('settings.apiKey')}</span>
            <div className="field-row">
              <input
                type={show ? 'text' : 'password'} autoComplete="off" autoCapitalize="off" spellCheck={false}
                placeholder={t('settings.apiKey.placeholder')}
                value={own.apiKey ?? ''}
                onChange={e => setOwn({ apiKey: e.target.value.trim() })}
              />
              <button type="button" className="btn btn-small" onClick={() => setShow(v => !v)}>{show ? t('settings.hide') : t('settings.show')}</button>
            </div>
          </label>
          {preset.keyUrl && (
            <a className="link small" href={preset.keyUrl} target="_blank" rel="noreferrer">{fill(t('settings.getKey'), { name: providerName(preset, lang) })} ›</a>
          )}

          <div className="field">
            <span>{t('settings.model')}</span>
            {preset.models.length > 0 && (
              <div className="model-chips" role="radiogroup" aria-label={t('settings.model')}>
                {preset.models.map(m => (
                  <button key={m} type="button" role="radio" aria-checked={!otherOpen && active.model === m} className={`chip${!otherOpen && active.model === m ? ' chip-on' : ''}`} onClick={() => { setOther(false); setOwn({ model: m === preset.models[0] ? '' : m }) }}>
                    {m}
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={otherOpen} className={`chip chip-other${otherOpen ? ' chip-on' : ''}`} onClick={() => setOther(true)}>{t('settings.model.otherChip')}</button>
              </div>
            )}
            {otherOpen && (
              <input
                autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus={preset.models.length > 0}
                placeholder={t('settings.model.placeholder')}
                value={own.model ?? ''}
                aria-label={t('settings.model.other')}
                onChange={e => setOwn({ model: e.target.value.trim() })}
              />
            )}
            {otherOpen && <small className="hint">{t('settings.model.hint')}</small>}
          </div>

          <label className="field">
            <span>{t('settings.visionModel')}</span>
            <input
              autoComplete="off" autoCapitalize="off" spellCheck={false}
              placeholder={preset.visionModel || t('settings.model.placeholder')}
              value={own.visionModel ?? ''}
              onChange={e => setOwn({ visionModel: e.target.value.trim() })}
            />
            <small className="hint">{t(preset.visionModel ? 'settings.visionModel.hint' : 'settings.visionModel.none')}</small>
          </label>

          <label className="field">
            <span>{t('settings.baseUrl')}</span>
            <input
              type="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
              placeholder={preset.baseUrl || 'https://example.com/v1'}
              value={own.baseUrl ?? ''}
              onChange={e => setOwn({ baseUrl: e.target.value.trim() })}
            />
            {!custom && <small className="hint">{t('settings.baseUrl.hint')}</small>}
          </label>

          <div className="field-row">
            <button type="button" className="btn btn-primary" disabled={!active.apiKey || !active.model || !active.baseUrl || test.status === 'loading'} onClick={runTest}>
              {test.status === 'loading' ? t('settings.testing') : t('settings.test')}
            </button>
            {test.message && <span className={`test-result test-${test.status}`}>{test.message}</span>}
          </div>
          <p className="muted small">{t('settings.aiNote')}</p>
        </div>

        <h2 className="section-title">{t('settings.language')}</h2>
        <div className="group">
          <div className="segmented" role="radiogroup" aria-label={t('settings.language')}>
            {LANGUAGES.map(l => (
              <button key={l.id} type="button" role="radio" aria-checked={(settings.language ?? 'system') === l.id} onClick={() => updateSettings({ language: l.id })}>
                {l.label()}
              </button>
            ))}
          </div>
          <p className="muted small">{t('settings.language.note')}</p>
        </div>

        <h2 className="section-title">{t('settings.data')}</h2>
        <div className="group">
          <p className="muted small">{t('settings.dataNote')}</p>
          <button type="button" className="row-btn" onClick={doExport}>{t('settings.export')}</button>
          <button type="button" className="row-btn" onClick={() => file.current?.click()}>{t('settings.import')}</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={doImport} />
          <button type="button" className="row-btn danger" onClick={doClear}>{t('settings.clear')}</button>
        </div>

        <h2 className="section-title">{t('settings.about')}</h2>
        <div className="group">
          <p className="small">{t('app.name')} · {fill(t('settings.version'), { v: VERSION })}</p>
          <p className="muted small">{t('settings.privacy')}</p>
        </div>
      </div>
    </div>
  )
}
