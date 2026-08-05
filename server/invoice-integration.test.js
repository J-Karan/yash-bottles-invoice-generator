import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

process.env.ADMIN_PASSWORD ||= 'test-admin-password'
process.env.APP_PASSWORD ||= 'test-app-password'
process.env.PAYMENT_PASSWORD ||= 'test-payment-password'

let buildEwayBulkJson
let buildInvoicePayload
let dbReady
let deleteInvoiceHistory
let generateAndSaveInvoice
let readBuyers
let readEwayReadiness
let readInvoiceDraft
let readInvoiceHistory
let readItems

before(async () => {
  const invoiceCore = await import('./invoice-core.js')
  const ewayCore = await import('./eway-core.js')

  buildInvoicePayload = invoiceCore.buildInvoicePayload
  dbReady = invoiceCore.dbReady
  deleteInvoiceHistory = invoiceCore.deleteInvoiceHistory
  generateAndSaveInvoice = invoiceCore.generateAndSaveInvoice
  readBuyers = invoiceCore.readBuyers
  readInvoiceDraft = invoiceCore.readInvoiceDraft
  readInvoiceHistory = invoiceCore.readInvoiceHistory
  readItems = invoiceCore.readItems
  buildEwayBulkJson = ewayCore.buildEwayBulkJson
  readEwayReadiness = ewayCore.readEwayReadiness

  await dbReady
})

describe('buildInvoicePayload integration', () => {
  it('does not reserve a new invoice number until history is saved', async () => {
    const [buyer] = await readBuyers()
    const [item] = await readItems()
    assert.ok(buyer, 'expected at least one buyer master')
    assert.ok(item, 'expected at least one item master')

    const input = {
      buyerCode: buyer.Buyer_Code,
      shipToOptionId: buyer.Default_Ship_To_Option_Id,
      vehicleNumber: 'MH12AB1234',
      invoiceDate: '2026-05-27',
      lineItems: [{ itemCode: item.Item_Code, bags: '1' }],
    }

    const first = await buildInvoicePayload(input)
    const second = await buildInvoicePayload(input)

    assert.equal(second.invoiceNumber, first.invoiceNumber)
    assert.equal(second.invoiceKey, first.invoiceKey)
  })

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

  it('rejects edited invoice dates outside the invoice financial year', async () => {
    const history = await readInvoiceHistory(1)
    assert.ok(history.length > 0, 'expected at least one invoice in history')

    const existing = history[0]
    const financialYearStart = existing.invoiceNumber.match(/\/(\d{4})-\d{2}$/)?.[1]
    assert.ok(financialYearStart, `expected financial year suffix in ${existing.invoiceNumber}`)

    const draft = await readInvoiceDraft(existing.invoiceKey)
    await assert.rejects(
      () =>
        buildInvoicePayload({
          ...draft,
          invoiceDate: `${financialYearStart}-03-31`,
          editInvoiceKey: existing.invoiceKey,
        }),
      /belongs to financial year/,
    )
  })

  it('publishes invoice artifacts after saving invoice history', async () => {
    const [buyer] = await readBuyers()
    const [item] = await readItems()
    let generated
    try {
      generated = await generateAndSaveInvoice({
        buyerCode: buyer.Buyer_Code,
        shipToOptionId: buyer.Default_Ship_To_Option_Id,
        vehicleNumber: 'MH12CD4321',
        invoiceDate: '2026-05-29',
        lineItems: [{ itemCode: item.Item_Code, bags: '1' }],
      })

      const saved = await readInvoiceDraft(generated.invoice.invoiceKey)
      assert.equal(saved.invoiceNumber, generated.invoice.invoiceNumber)
      assert.match(generated.files.excel, /\/downloads\/excel\/2026-27\/05-May\//)
      assert.match(generated.files.pdf, /\/downloads\/pdf\/2026-27\/05-May\//)
    } finally {
      if (generated?.invoice?.invoiceKey) {
        await deleteInvoiceHistory(generated.invoice.invoiceKey)
      }
    }
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

  it('resolves 75km automatically for Rahul Bottles with Lonand ship-to option', async () => {
    const buyers = await readBuyers()
    const rahul = buyers.find((b) => b.Buyer_Code === 'B005')
    assert.ok(rahul, 'expected buyer B005')
    const lonandOption = rahul.Ship_To_Options.find((o) => o.id === 'carlsberg-lonand')
    assert.ok(lonandOption, 'expected carlsberg-lonand ship-to option on B005')

    const item = (await readItems())[0]
    let generated
    try {
      generated = await generateAndSaveInvoice({
        buyerCode: 'B005',
        shipToOptionId: 'carlsberg-lonand',
        vehicleNumber: 'MH12AB1234',
        invoiceDate: '2026-05-27',
        lineItems: [{ itemCode: item.Item_Code, bags: '1' }],
      })

      const readiness = readEwayReadiness()
      const entry = readiness.invoices.find((i) => i.invoiceKey === generated.invoice.invoiceKey)
      assert.ok(entry, 'expected invoice entry in readiness')
      assert.equal(entry.distanceKm, 75)
      assert.equal(entry.distanceSource, 'ship-to-default')
    } finally {
      if (generated?.invoice?.invoiceKey) {
        await deleteInvoiceHistory(generated.invoice.invoiceKey)
      }
    }
  })

  it('resolves 250km automatically as default buyer distance for Campet Bottles (B008)', async () => {
    const buyers = await readBuyers()
    const campet = buyers.find((b) => b.Buyer_Code === 'B008')
    assert.ok(campet, 'expected buyer B008')

    const item = (await readItems())[0]
    let generated
    try {
      generated = await generateAndSaveInvoice({
        buyerCode: 'B008',
        shipToOptionId: campet.Default_Ship_To_Option_Id,
        vehicleNumber: 'MH14MH8226',
        invoiceDate: '2026-08-04',
        lineItems: [{ itemCode: item.Item_Code, bags: '1' }],
      })

      const readiness = readEwayReadiness()
      const entry = readiness.invoices.find((i) => i.invoiceKey === generated.invoice.invoiceKey)
      assert.ok(entry, 'expected invoice entry in readiness')
      assert.equal(entry.distanceKm, 250)
      assert.equal(entry.distanceSource, 'buyer-default')
    } finally {
      if (generated?.invoice?.invoiceKey) {
        await deleteInvoiceHistory(generated.invoice.invoiceKey)
      }
    }
  })
})


