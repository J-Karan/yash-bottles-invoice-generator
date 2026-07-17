import { useMemo, useRef } from 'react'
import { useModalTrap } from '../hooks/useModalTrap.js'
import { formatDisplayDate, formatMoney, buildShipToOptions, calculateInvoiceDetails } from '../invoice-utils.js'

export function InvoicePreviewModal({ invoice, buyers, items, onClose }) {
  const modalRef = useRef(null)
  useModalTrap(modalRef, onClose)

  const selectedBuyer = useMemo(
    () => buyers.find((buyer) => buyer.Buyer_Code === invoice.buyerCode),
    [buyers, invoice.buyerCode],
  )

  const shipToOptions = useMemo(() => buildShipToOptions(selectedBuyer), [selectedBuyer])
  const selectedShipToOption = useMemo(
    () => shipToOptions.find((option) => option.id === invoice.shipToOptionId) || shipToOptions[0] || null,
    [invoice.shipToOptionId, shipToOptions],
  )

  const { computedLines, computedTotals } = useMemo(() => {
    if (invoice?.savedLines && invoice?.savedTotals) {
      return {
        computedLines: invoice.savedLines,
        computedTotals: invoice.savedTotals,
      }
    }
    return calculateInvoiceDetails(invoice?.lineItems, items)
  }, [invoice, items])

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-card preview-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-preview-title"
        ref={modalRef}
        tabIndex="-1"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-header panel-header-row">
          <div>
            <h2 id="invoice-preview-title">Preview: {invoice.invoiceNumber}</h2>
            <p>Read-only high-fidelity invoice sheet representation.</p>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Close Preview
          </button>
        </div>

        <div className="preview-sheet-wrap">
          <header className="preview-sheet-header">
            <div>
              <h3 className="preview-sheet-logo">Yash Bottles</h3>
              <span className="preview-sheet-logo-sub">Manufacturer of Glass Bottles</span>
            </div>
            <div className="preview-sheet-document-title">
              <strong>Tax Invoice</strong>
              <p>Original for Buyer</p>
            </div>
          </header>

          <section className="preview-sheet-meta-grid">
            <div>
              <h4>Billed To (Buyer)</h4>
              <p className="preview-sheet-party-name">{selectedBuyer?.Buyer_Name || 'Unknown Buyer'}</p>
              <p className="preview-sheet-address">
                {[
                  selectedBuyer?.Address_Line1,
                  selectedBuyer?.Address_Line2,
                  selectedBuyer?.Address_Line3,
                  selectedBuyer?.City_State_Pin,
                ]
                  .filter(Boolean)
                  .join('\n')}
              </p>
              {selectedBuyer?.GSTIN ? (
                <p className="preview-sheet-tax-id">
                  <strong>GSTIN:</strong> {selectedBuyer.GSTIN}
                </p>
              ) : null}
            </div>

            <div>
              <h4>Ship To (Destination)</h4>
              <p className="preview-sheet-party-name">
                {selectedShipToOption?.id === 'bill_to' ? 'SAME AS BILLING' : selectedShipToOption?.shipToName || 'SAME AS BILLING'}
              </p>
              <p className="preview-sheet-address">
                {selectedShipToOption?.id === 'bill_to'
                  ? [
                      selectedBuyer?.Address_Line1,
                      selectedBuyer?.Address_Line2,
                      selectedBuyer?.Address_Line3,
                      selectedBuyer?.City_State_Pin,
                    ]
                      .filter(Boolean)
                      .join('\n')
                  : selectedShipToOption?.shipToAddress || '--'}
              </p>
              <dl className="preview-sheet-mini-meta">
                <dt>Invoice Date</dt>
                <dd>{formatDisplayDate(invoice.invoiceDate)}</dd>
                <dt>Vehicle No</dt>
                <dd>{invoice.vehicleNumber || '--'}</dd>
              </dl>
            </div>
          </section>

          <table className="preview-sheet-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item Description</th>
                <th className="preview-sheet-number">Bags</th>
                <th className="preview-sheet-number">Qty (Pcs)</th>
                <th className="preview-sheet-number">Gross Rate</th>
                <th className="preview-sheet-number">Taxable Value</th>
                <th className="preview-sheet-number">CGST 9%</th>
                <th className="preview-sheet-number">SGST 9%</th>
                <th className="preview-sheet-number">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {computedLines.map((line, index) => (
                <tr key={`${index}-${line.itemCode}`}>
                  <td>{index + 1}</td>
                  <td>
                    <strong>{line.selectedItem?.Description || 'Unknown Item'}</strong>
                    {line.bags > 0 && line.bottlesPerBag > 0 && (
                      <div className="preview-sheet-bag-note">
                        Bags {line.bags} x {line.bottlesPerBag}
                      </div>
                    )}
                    <div className="preview-sheet-item-meta">
                      HSN: {line.selectedItem?.HSN_Code || '7010'} | {line.bottlesPerBag || 0} Pcs/Bag
                    </div>
                  </td>
                  <td className="preview-sheet-number">{line.bags}</td>
                  <td className="preview-sheet-number">{line.quantity}</td>
                  <td className="preview-sheet-number">{formatMoney(line.grossRate)}</td>
                  <td className="preview-sheet-number">{formatMoney(line.taxableValue)}</td>
                  <td className="preview-sheet-number">{formatMoney(line.taxableValue * 0.09)}</td>
                  <td className="preview-sheet-number">{formatMoney(line.taxableValue * 0.09)}</td>
                  <td className="preview-sheet-number preview-sheet-line-total">
                    {formatMoney(line.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="preview-sheet-totals">
            <div className="preview-sheet-totals-box">
              <span>Total Pcs</span>
              <strong>{computedTotals.quantity} Pcs</strong>

              <span>Taxable Value</span>
              <strong>{formatMoney(computedTotals.taxableValue)}</strong>

              <span>Non-Taxable Value</span>
              <strong>{formatMoney(computedTotals.nonTaxableValue)}</strong>

              <span>CGST 9.0%</span>
              <strong>{formatMoney(computedTotals.cgst)}</strong>

              <span>SGST 9.0%</span>
              <strong>{formatMoney(computedTotals.sgst)}</strong>

              <span className="preview-sheet-grand-total">Grand Total</span>
              <strong className="preview-sheet-grand-total preview-sheet-grand-total-value">
                {formatMoney(computedTotals.total)}
              </strong>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
