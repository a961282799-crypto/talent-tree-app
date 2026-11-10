import { useRef, useState } from 'react'
import { clearAll, exportData, getState, importData, parseImport, resetUsage, updateProvider, updateSettings, useApp } from '../storage.js'
import { fetchModels, testConnection } from '../ai.js'
import { useNav } from '../nav.js'
import { PROVIDERS, activeAI, providerById, providerName } from '../providers.js'
import { fill, lang, t } from '../i18n.js'
import { confirmAction, isNative, saveFile } from '../native.js'
import { openDialog } from '../dialog.js'
import { requestReminderPermission } from '../reminders.js'

const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0'
export const PRIVACY_URL = 'https://github.com/a961282799-crypto/talent-tree-app/blob/main/PRIVACY.md'
const LANGUAGES = [
  { id: 'system', label: () => t('settings.language.system') },
  { id: 'zh', label: () => '简体中文' },
  { id: 'en', label: () => 'English' },
]
const TEXT_SIZES = ['normal', 'large', 'xlarge']

const formatTokens = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(n))

/** Pick a model from the list the service reports. */
function ModelPicker({ ai, onPick }) {
  const nav = useNav()
  const [models, setModels] = useState(null)
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try {
      const list = await fetchModels(ai)
      setModels(list)
      if (list.length === 0) nav.toast(t('settings.models.empty'))
    } catch (error) {
      nav.toast(fill(t('settings.models.failed'), { message: error.message }))
    } finally {
      setLoading(false)
    }
  }
  if (models?.length) {
    return (
      <select aria-label={t('settings.models.pick')} value="" onChange={e => { if (e.target.value) onPick(e.target.value) }}>
        <option value="">{fill(t('settings.models.pick'), { n: models.length })}</option>
        {models.map(m => <option key={m} value={m}>{m}{m === ai.model ? ' ✓' : ''}</option>)}
      </select>
    )
  }
  return (
    <button type="button" className="link small link-btn" disabled={loading || !ai.apiKey || !ai.baseUrl} onClick={load}>
      {loading ? t('settings.models.loading') : `${t('settings.models.fetch')} ›`}
    </button>
  )
}

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
  const usage = settings.usage ?? { input: 0, output: 0, since: 0 }
  const reminder = settings.reminder ?? { enabled: false, time: '20:00' }

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
      incoming = parseImport(data)
    } catch {
      nav.toast(t('settings.importFailed'))
      return
    }
    const state = getState()
    const current = Object.keys(state.knowledge.nodes).length
    const currentChats = Object.keys(state.chats).length
    let mode = 'replace'
    // With progress here, ask whether to add the file to it or to replace it.
    if (current > 0 || currentChats > 0) {
      const choice = await openDialog({
        title: t('settings.import.title'),
        message: fill(t('settings.import.body'), { n: Object.keys(incoming.knowledge.nodes).length, c: incoming.chats.length, current, currentChats }),
        actions: [
          { id: null, label: t('common.cancel') },
          { id: 'replace', label: t('settings.import.replace'), danger: true },
          { id: 'merge', label: t('settings.import.merge'), primary: true },
        ],
      })
      if (!choice?.action) return
      mode = choice.action
    }
    const result = importData(data, mode)
    nav.toast(fill(t(result.chats ? 'settings.importedChats' : 'settings.imported'), { n: result.nodes, c: result.chats }))
  }

  const doClear = async () => {
    if (!(await confirmAction(t('settings.clearConfirm'), { ok: t('settings.clear'), danger: true }))) return
    clearAll()
    nav.toast(t('settings.cleared'))
  }

  const toggleReminder = async () => {
    if (reminder.enabled) return updateSettings({ reminder: { ...reminder, enabled: false } })
    if (!(await requestReminderPermission())) {
      nav.toast(t('reminder.denied'))
      return undefined
    }
    updateSettings({ reminder: { ...reminder, enabled: true } })
    nav.toast(fill(t('reminder.on'), { time: reminder.time }))
    return undefined
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
            <ModelPicker key={`${preset.id}:${active.baseUrl}`} ai={active} onPick={m => { setOther(!preset.models.includes(m)); setOwn({ model: m === preset.models[0] ? '' : m }) }} />
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

        <h2 className="section-title">{t('settings.usage')}</h2>
        <div className="group">
          <p className="small usage-line">
            {fill(t('settings.usage.line'), { input: formatTokens(usage.input || 0), output: formatTokens(usage.output || 0) })}
            {usage.since ? <span className="muted">{fill(t('settings.usage.since'), { date: new Date(usage.since).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en') })}</span> : null}
          </p>
          <p className="muted small">{t(preset.usage ? 'settings.usage.note' : 'settings.usage.unsupported')}</p>
          {(usage.input > 0 || usage.output > 0) && <button type="button" className="row-btn" onClick={resetUsage}>{t('settings.usage.reset')}</button>}
        </div>

        {isNative && (
          <>
            <h2 className="section-title">{t('reminder.section')}</h2>
            <div className="group">
              <div className="switch-row">
                <span>
                  <b>{t('reminder.toggle')}</b>
                  <small className="muted">{t('reminder.note')}</small>
                </span>
                <button type="button" role="switch" aria-checked={reminder.enabled} aria-label={t('reminder.toggle')} className="switch" onClick={toggleReminder}><i /></button>
              </div>
              {reminder.enabled && (
                <label className="field field-inline">
                  <span>{t('reminder.time')}</span>
                  <input type="time" value={reminder.time} onChange={e => e.target.value && updateSettings({ reminder: { ...reminder, time: e.target.value } })} />
                </label>
              )}
            </div>
          </>
        )}

        <h2 className="section-title">{t('settings.display')}</h2>
        <div className="group">
          <span className="field-label">{t('settings.language')}</span>
          <div className="segmented" role="radiogroup" aria-label={t('settings.language')}>
            {LANGUAGES.map(l => (
              <button key={l.id} type="button" role="radio" aria-checked={(settings.language ?? 'system') === l.id} onClick={() => updateSettings({ language: l.id })}>
                {l.label()}
              </button>
            ))}
          </div>
          <p className="muted small">{t('settings.language.note')}</p>
          <span className="field-label">{t('settings.textSize')}</span>
          <div className="segmented" role="radiogroup" aria-label={t('settings.textSize')}>
            {TEXT_SIZES.map(size => (
              <button key={size} type="button" role="radio" aria-checked={(settings.textSize ?? 'normal') === size} onClick={() => updateSettings({ textSize: size })}>
                <span className={`size-sample size-${size}`}>{t(`settings.textSize.${size}`)}</span>
              </button>
            ))}
          </div>
          <p className="muted small">{t('settings.textSize.note')}</p>
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
          <a className="row-btn row-link" href={PRIVACY_URL} target="_blank" rel="noreferrer">{t('settings.privacyPolicy')} ›</a>
        </div>
      </div>
    </div>
  )
}
