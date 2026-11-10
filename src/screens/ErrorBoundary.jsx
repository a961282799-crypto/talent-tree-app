import { Component } from 'react'
import { exportData } from '../storage.js'
import { saveFile } from '../native.js'
import { t } from '../i18n.js'

/**
 * Last line of defence: if a screen crashes while drawing, show a way out
 * (reload, or save a backup first) instead of a blank page. The learner's data
 * on the phone is untouched.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[talent-tree] screen crashed', error, info?.componentStack)
  }

  backup = async () => {
    try {
      const blob = new Blob([JSON.stringify(exportData(), null, 1)], { type: 'application/json' })
      await saveFile(blob, `talent-tree-${new Date().toISOString().slice(0, 10)}.json`, 'application/json')
    } catch {}
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash" role="alert">
        <h1>{t('crash.title')}</h1>
        <p>{t('crash.body')}</p>
        <code>{String(this.state.error?.message ?? this.state.error).slice(0, 200)}</code>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>{t('crash.reload')}</button>
        <button type="button" className="btn" onClick={this.backup}>{t('crash.backup')}</button>
      </div>
    )
  }
}
