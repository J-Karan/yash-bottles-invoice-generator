import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

process.env.ADMIN_PASSWORD ||= 'test-admin-password'
process.env.APP_PASSWORD ||= 'test-app-password'
process.env.PAYMENT_PASSWORD ||= 'test-payment-password'

let buildEwayBulkJson
let buildInvoicePayload
let dbReady
let readEwayReadiness
let readInvoiceDraft
let readInvoiceHistory

before(async () => {
  const invoiceCore = await import('./invoice-core.js')
  const ewayCore = await import('./eway-core.js')

  buildInvoicePayload = invoiceCore.buildInvoicePayload
  dbReady = invoiceCore.dbReady
  readInvoiceDraft = invoiceCore.readInvoiceDraft
  readInvoiceHistory = invoiceCore.readInvoiceHistory
  buildEwayBulkJson = ewayCore.buildEwayBulkJson
  readEwayReadiness = ewayCore.readEwayReadiness

  await dbReady
})

describe('buildInvoicePayload integration', () => {
  it('preserves invoice number and key when editing an existing invoice', async () => {
    const history = await readInvoiceHistory(1)
    assert.ok(history.length > 0, 'expected at least one invoice in history')

    const existing = history[0]
    const draft = await readInvoiceDraft(existing.invoiceKey)
    const payload = await buildInvoicePayload({
      ...draft,
      editInvoiceKey: existing.invoiceKey,
    })

    assert.equal(payload.invoiceNumber, existing.invoiceNumber)
    assert.equal(payload.invoiceKey, existing.invoiceKey)
    assert.equal(payload.buyer.Buyer_Code, draft.buyerCode)
    assert.equal(payload.lines.length, draft.lineItems.length)
  })
})

describe('E-way readiness integration', () => {
  it('reports readiness summary and ready invoices', () => {
    const readiness = readEwayReadiness()

    assert.ok(readiness.summary.total > 0, 'expected invoice readiness rows')
    assert.equal(
      readiness.summary.total,
      readiness.summary.ready + readiness.summary.needsInput,
    )
    assert.ok(
      readiness.invoices.some((invoice) => invoice.ready),
      'expected at least one E-way-ready invoice',
    )
  })

  it('builds bulk JSON for a ready invoice', () => {
    const readiness = readEwayReadiness()
    const invoice = readiness.invoices.find((entry) => entry.ready)
    assert.ok(invoice, 'expected a ready invoice')

    const payload = buildEwayBulkJson(invoice.invoiceKey, {
      distanceKm: invoice.distanceKm,
    })
    const bill = payload.billLists[0]

    assert.equal(payload.version, '1.0.0621')
    assert.equal(bill.docNo, invoice.invoiceNumber)
    assert.ok(bill.transDistance > 0)
    assert.ok(bill.itemList.length > 0)
  })
})
