import { formatDisplayDate, formatDisplayDateTime, formatMoney } from '../invoice-utils.js'

export function InvoiceHistory({
  ewayError,
  ewayLoading,
  filteredInvoiceHistory,
  handleDeleteInvoice,
  historyActionBusyKey,
  historyError,
  historyLoading,
  historySearch,
  invoiceHistory,
  loadInvoiceForEdit,
  markingPaid,
  onDownloadProtectedFile,
  onOpenPaymentModal,
  onRefreshEwayReadiness,
  onRefreshHistory,
  onRenderEwayJsonAction,
  paymentError,
  paymentStatus,
  paymentSummary,
  setHistorySearch,
  onOpenPreview,
  previewLoading,
}) {
  return (
    <section className="panel history-panel">
      <div className="panel-header panel-header-row">
        <div>
          <h2>Invoice History</h2>
          <p>Review generated invoices, download files, and clear the payment counter when paid.</p>
        </div>
        <div className="panel-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={onOpenPaymentModal}
            disabled={markingPaid || paymentSummary.unpaidInvoices === 0}
          >
            {markingPaid ? 'Marking paid...' : 'Mark Paid'}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              onRefreshHistory()
              onRefreshEwayReadiness()
            }}
            disabled={historyLoading || ewayLoading}
          >
            {historyLoading ? 'Refreshing...' : 'Refresh history'}
          </button>
        </div>
      </div>

      <div className="history-overview">
        <article>
          <span>Records</span>
          <strong>{invoiceHistory.length}</strong>
        </article>
        <article>
          <span>Non Paid Invoices</span>
          <strong>{paymentSummary.unpaidInvoices}</strong>
        </article>
        <article>
          <span>Amount Due</span>
          <strong>{formatMoney(paymentSummary.amountDue)}</strong>
        </article>
      </div>

      <p className="hint-text">
        Paid so far: {formatMoney(paymentSummary.paidAmountTotal)} at {formatMoney(paymentSummary.invoiceRate)} per invoice.
      </p>

      <label className="search-field history-search">
        <span>Search history</span>
        <div className="search-input-wrapper">
          <input
            value={historySearch}
            onChange={(event) => setHistorySearch(event.target.value)}
            placeholder="Invoice no, buyer, date, vehicle, GSTIN"
          />
          {historySearch ? (
            <button
              className="clear-search-button"
              type="button"
              onClick={() => setHistorySearch('')}
            >
              &times;
            </button>
          ) : null}
        </div>
      </label>

      {historyError ? <p className="error-banner">{historyError}</p> : null}
      {paymentError ? <p className="error-banner">{paymentError}</p> : null}
      {paymentStatus ? <p className="success-banner">{paymentStatus}</p> : null}
      {ewayError ? <p className="error-banner">{ewayError}</p> : null}
      {historyLoading ? <p className="hint-text">Loading invoice history...</p> : null}
      {!historyLoading && !filteredInvoiceHistory.length ? (
        <p className="hint-text">No invoices found for the current filter.</p>
      ) : null}

      {!historyLoading && filteredInvoiceHistory.length ? (
        <div className="history-results">
          <div className="history-table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Buyer</th>
                  <th>Vehicle</th>
                  <th>Lines</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Files</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoiceHistory.map((invoice) => (
                  <tr key={invoice.invoiceNumber}>
                    <td>
                      <strong>{invoice.invoiceNumber}</strong>
                      <small>{formatDisplayDateTime(invoice.createdAt)}</small>
                    </td>
                    <td>{formatDisplayDate(invoice.invoiceDate)}</td>
                    <td>
                      <strong>{invoice.buyerName}</strong>
                      <small>{invoice.buyerCode}</small>
                    </td>
                    <td>{invoice.vehicleNumber}</td>
                    <td>{invoice.lineCount}</td>
                    <td className="history-total-cell">{formatMoney(invoice.total)}</td>
                    <td>
                      <span className={`payment-pill ${invoice.isPaid ? 'payment-pill-paid' : 'payment-pill-unpaid'}`}>
                        {invoice.isPaid ? 'Paid' : 'Non paid'}
                      </span>
                      {invoice.paidAt ? <small>{formatDisplayDateTime(invoice.paidAt)}</small> : null}
                    </td>
                    <td>
                      <div className="history-downloads">
                        <button
                          className="text-button history-action-preview"
                          type="button"
                          aria-label={`Preview invoice ${invoice.invoiceNumber}`}
                          title={`Preview invoice ${invoice.invoiceNumber}`}
                          onClick={() => onOpenPreview(invoice)}
                          disabled={historyActionBusyKey === invoice.invoiceKey || previewLoading}
                        >
                          {previewLoading && historyActionBusyKey === invoice.invoiceKey ? 'Loading...' : 'Preview'}
                        </button>
                        <button
                          className="text-button history-action-edit"
                          type="button"
                          aria-label={`Edit invoice ${invoice.invoiceNumber}`}
                          title={`Edit invoice ${invoice.invoiceNumber}`}
                          onClick={() => loadInvoiceForEdit(invoice)}
                          disabled={historyActionBusyKey === invoice.invoiceKey}
                        >
                          {historyActionBusyKey === invoice.invoiceKey ? 'Opening...' : 'Edit'}
                        </button>
                        <button
                          className="text-button history-action-delete"
                          type="button"
                          aria-label={`Delete invoice ${invoice.invoiceNumber}`}
                          title="Only the latest invoice can be deleted"
                          onClick={() => handleDeleteInvoice(invoice)}
                          disabled={historyActionBusyKey === invoice.invoiceKey}
                        >
                          {historyActionBusyKey === invoice.invoiceKey ? 'Deleting...' : 'Delete'}
                        </button>
                        {invoice.excelAvailable ? (
                          <button
                            className="text-button history-action-file history-action-excel"
                            type="button"
                            onClick={() => onDownloadProtectedFile(invoice.files.excel, `${invoice.invoiceKey}.xlsx`)}
                          >
                            Excel
                          </button>
                        ) : (
                          <span className="history-file-missing history-action-excel">Excel missing</span>
                        )}
                        {invoice.pdfAvailable ? (
                          <button
                            className="text-button history-action-file history-action-pdf"
                            type="button"
                            onClick={() => onDownloadProtectedFile(invoice.files.pdf, `${invoice.invoiceKey}.pdf`)}
                          >
                            PDF
                          </button>
                        ) : (
                          <span className="history-file-missing history-action-pdf">PDF missing</span>
                        )}
                        {onRenderEwayJsonAction(invoice)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="history-mobile-list">
            {filteredInvoiceHistory.map((invoice) => (
              <article className="history-mobile-card" key={`${invoice.invoiceNumber}-mobile`}>
                <div className="history-mobile-head">
                  <strong>{invoice.invoiceNumber}</strong>
                  <span>{formatDisplayDate(invoice.invoiceDate)}</span>
                </div>

                <dl className="history-mobile-meta">
                  <div>
                    <dt>Buyer</dt>
                    <dd>{invoice.buyerName}</dd>
                  </div>
                  <div>
                    <dt>Code</dt>
                    <dd>{invoice.buyerCode}</dd>
                  </div>
                  <div>
                    <dt>Vehicle</dt>
                    <dd>{invoice.vehicleNumber || '--'}</dd>
                  </div>
                  <div>
                    <dt>Lines</dt>
                    <dd>{invoice.lineCount}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>{formatMoney(invoice.total)}</dd>
                  </div>
                  <div>
                    <dt>Payment</dt>
                    <dd>{invoice.isPaid ? 'Paid' : 'Non paid'}</dd>
                  </div>
                  <div>
                    <dt>Generated</dt>
                    <dd>{formatDisplayDateTime(invoice.createdAt)}</dd>
                  </div>
                </dl>

                <div className="history-downloads">
                  <button
                    className="text-button history-action-preview"
                    type="button"
                    aria-label={`Preview invoice ${invoice.invoiceNumber}`}
                    title={`Preview invoice ${invoice.invoiceNumber}`}
                    onClick={() => onOpenPreview(invoice)}
                    disabled={historyActionBusyKey === invoice.invoiceKey || previewLoading}
                  >
                    {previewLoading && historyActionBusyKey === invoice.invoiceKey ? 'Loading...' : 'Preview'}
                  </button>
                  <button
                    className="text-button history-action-edit"
                    type="button"
                    aria-label={`Edit invoice ${invoice.invoiceNumber}`}
                    title={`Edit invoice ${invoice.invoiceNumber}`}
                    onClick={() => loadInvoiceForEdit(invoice)}
                    disabled={historyActionBusyKey === invoice.invoiceKey}
                  >
                    {historyActionBusyKey === invoice.invoiceKey ? 'Opening...' : 'Edit'}
                  </button>
                  <button
                    className="text-button history-action-delete"
                    type="button"
                    aria-label={`Delete invoice ${invoice.invoiceNumber}`}
                    title="Only the latest invoice can be deleted"
                    onClick={() => handleDeleteInvoice(invoice)}
                    disabled={historyActionBusyKey === invoice.invoiceKey}
                  >
                    {historyActionBusyKey === invoice.invoiceKey ? 'Deleting...' : 'Delete'}
                  </button>
                  {invoice.excelAvailable ? (
                    <button
                      className="text-button history-action-file history-action-excel"
                      type="button"
                      onClick={() => onDownloadProtectedFile(invoice.files.excel, `${invoice.invoiceKey}.xlsx`)}
                    >
                      Excel
                    </button>
                  ) : (
                    <span className="history-file-missing history-action-excel">Excel missing</span>
                  )}
                  {invoice.pdfAvailable ? (
                    <button
                      className="text-button history-action-file history-action-pdf"
                      type="button"
                      onClick={() => onDownloadProtectedFile(invoice.files.pdf, `${invoice.invoiceKey}.pdf`)}
                    >
                      PDF
                    </button>
                  ) : (
                    <span className="history-file-missing history-action-pdf">PDF missing</span>
                  )}
                  {onRenderEwayJsonAction(invoice)}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
