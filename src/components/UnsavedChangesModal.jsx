import { useRef } from 'react'
import { useModalTrap } from '../hooks/useModalTrap.js'

export function UnsavedChangesModal({ busy, error, onCancel, onDiscard, onSave }) {
  const ref = useRef(null)
  useModalTrap(ref, () => { if (!busy) onCancel() })
  return (
    <div className="modal-backdrop" onClick={() => { if (!busy) onCancel() }}>
      <section ref={ref} className="panel modal-card" role="dialog" aria-modal="true"
        aria-labelledby="unsaved-title" tabIndex="-1" onClick={event => event.stopPropagation()}>
        <div className="panel-header">
          <h2 id="unsaved-title">Save your changes?</h2>
          <p>This record has unsaved changes. Save them or discard them before continuing.</p>
        </div>
        {error ? <p className="error-banner" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Keep editing</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={onDiscard}>Discard changes</button>
          <button type="button" className="primary-button modal-primary" disabled={busy} onClick={onSave}>
            {busy ? 'Saving...' : 'Save and continue'}
          </button>
        </div>
      </section>
    </div>
  )
}
