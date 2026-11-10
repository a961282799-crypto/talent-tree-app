import { useState } from 'react'
import { closeDialog, useDialog } from '../dialog.js'

function DialogBody({ dialog }) {
  const [text, setText] = useState(dialog.input?.value ?? '')
  const primary = dialog.actions.find(a => a.primary) ?? dialog.actions[dialog.actions.length - 1]
  const choose = action => closeDialog({ action, text })
  return (
    <div className="sheet-backdrop dialog-backdrop" onClick={() => closeDialog(null)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={dialog.title || dialog.message} onClick={e => e.stopPropagation()}>
        {dialog.title && <h3>{dialog.title}</h3>}
        {dialog.message && <p>{dialog.message}</p>}
        {dialog.input && (
          <input
            autoFocus
            value={text}
            placeholder={dialog.input.placeholder}
            aria-label={dialog.title || dialog.input.placeholder}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) choose(primary.id) }}
          />
        )}
        <div className={`dialog-actions${dialog.actions.length > 2 ? ' dialog-actions-stack' : ''}`}>
          {dialog.actions.map(a => (
            <button
              key={String(a.id)}
              type="button"
              className={`btn${a.primary ? ' btn-primary' : ''}${a.danger ? ' btn-danger' : ''}`}
              onClick={() => choose(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Draws the open dialog, if any. Mount once, last in the app. */
export function DialogHost() {
  const dialog = useDialog()
  return dialog ? <DialogBody key={dialog.key} dialog={dialog} /> : null
}
