import { useMemo } from 'react'
import { formatDisplayDate, formatMoney, buildShipToOptions, calculateInvoiceDetails } from '../invoice-utils.js'

export function InvoicePreviewModal({ invoice, buyers, items, onClose }) {
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
    <section className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card preview-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header panel-header-row">
          <div>
            <h2>Preview: {invoice.invoiceNumber}</h2>
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
            <div style={{ textAlign: 'right' }}>
              <strong style={{ fontSize: '1.1rem', color: 'var(--accent)' }}>Tax Invoice</strong>
              <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: '0.8rem' }}>Original for Buyer</p>
            </div>
          </header>

          <section className="preview-sheet-meta-grid">
            <div>
              <h4>Billed To (Buyer)</h4>
              <p style={{ fontWeight: '700' }}>{selectedBuyer?.Buyer_Name || 'Unknown Buyer'}</p>
              <p style={{ whiteSpace: 'pre-line', fontSize: '0.82rem', marginTop: '4px', color: 'var(--muted-strong)' }}>
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
                <p style={{ marginTop: '8px', fontSize: '0.82rem' }}>
                  <strong>GSTIN:</strong> {selectedBuyer.GSTIN}
                </p>
              ) : null}
            </div>

            <div>
              <h4>Ship To (Destination)</h4>
              <p style={{ fontWeight: '700' }}>
                {selectedShipToOption?.id === 'bill_to' ? 'SAME AS BILLING' : selectedShipToOption?.shipToName || 'SAME AS BILLING'}
              </p>
              <p style={{ whiteSpace: 'pre-line', fontSize: '0.82rem', marginTop: '4px', color: 'var(--muted-strong)' }}>
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
              <dl style={{ marginTop: '12px' }}>
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
                <th style={{ textAlign: 'right' }}>Bags</th>
                <th style={{ textAlign: 'right' }}>Qty (Pcs)</th>
                <th style={{ textAlign: 'right' }}>Gross Rate</th>
                <th style={{ textAlign: 'right' }}>Taxable Value</th>
                <th style={{ textAlign: 'right' }}>CGST 9%</th>
                <th style={{ textAlign: 'right' }}>SGST 9%</th>
                <th style={{ textAlign: 'right' }}>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {computedLines.map((line, index) => (
                <tr key={line.itemCode}>
                  <td>{index + 1}</td>
                  <td>
                    <strong>{line.selectedItem?.Description || 'Unknown Item'}</strong>
                    <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: '2px' }}>
                      HSN: {line.selectedItem?.HSN_Code || '7010'} | {line.bottlesPerBag || 0} Pcs/Bag
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.bags}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.quantity}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(line.grossRate)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(line.taxableValue)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(line.taxableValue * 0.09)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(line.taxableValue * 0.09)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: '700' }}>
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
              <strong className="preview-sheet-grand-total" style={{ fontWeight: '850' }}>
                {formatMoney(computedTotals.total)}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
