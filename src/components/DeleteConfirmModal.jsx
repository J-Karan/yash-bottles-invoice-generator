function DeleteConfirmModal({
  title,
  message,
  detail,
  confirmLabel = 'Delete',
  busy = false,
  onCancel,
  onConfirm,
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={() => (busy ? null : onCancel())}>
      <section
        className="panel modal-card delete-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-header">
          <p className="mini-label delete-modal-kicker">Delete confirmation</p>
          <h2 id="delete-modal-title">{title}</h2>
          <p>{message}</p>
        </div>

        {detail ? <p className="delete-modal-detail">{detail}</p> : null}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="danger-button modal-danger" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

export { DeleteConfirmModal }
