import { formatMoney } from '../invoice-utils.js'

function PaymentModal({
  paymentSummary,
  paymentPasswordInput,
  setPaymentPasswordInput,
  paymentError,
  markingPaid,
  onClose,
  onConfirm,
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={() => onClose()}>
      <form
        className="panel modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-modal-title"
        onSubmit={(event) => {
          event.preventDefault()
          onConfirm()
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-header">
          <h2 id="payment-modal-title">Confirm Payment</h2>
          <p>Confirm this payment batch.</p>
        </div>

        <div className="history-overview modal-metrics">
          <article>
            <span>Non Paid Invoices</span>
            <strong>{paymentSummary.unpaidInvoices}</strong>
          </article>
          <article>
            <span>Amount Due</span>
            <strong>{formatMoney(paymentSummary.amountDue)}</strong>
          </article>
          <article>
            <span>Rate</span>
            <strong>{formatMoney(paymentSummary.invoiceRate)}</strong>
          </article>
        </div>

        <p className="hint-text">
          Mark {paymentSummary.unpaidInvoices} invoices as paid for {formatMoney(paymentSummary.amountDue)}.
        </p>

        <label className="search-field">
          <span>Payment Password</span>
          <input
            type="password"
            value={paymentPasswordInput}
            onChange={(event) => setPaymentPasswordInput(event.target.value)}
            placeholder="Enter payment password"
            autoComplete="current-password"
            autoFocus
          />
        </label>

        {paymentError ? <p className="error-banner">{paymentError}</p> : null}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={() => onClose()} disabled={markingPaid}>
            Cancel
          </button>
          <button
            className="primary-button modal-primary"
            type="submit"
            disabled={markingPaid || !paymentPasswordInput.trim()}
          >
            {markingPaid ? 'Confirming...' : 'Confirm Payment'}
          </button>
        </div>
      </form>
    </div>
  )
}

export { PaymentModal }
