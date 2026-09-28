import assert from 'node:assert/strict'
import fs from 'node:fs'
import { before, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

let core, eway, dbPath
const input = {
  buyerCode: 'B001', shipToOptionId: 'bill_to', vehicleNumber: 'MH12AB1234',
  invoiceDate: '2028-05-01', lineItems: [{ itemCode: 'I001', bags: '1' }],
}
before(async () => {
  core = await import('./invoice-core.js')
  eway = await import('./eway-core.js')
  ;({ dbPath } = await import('./config.js'))
  await core.dbReady
})

it('gives simultaneous creations distinct numbers and preserves both invoices', async () => {
  const results = await Promise.all([
    core.generateAndSaveInvoice(input),
    core.generateAndSaveInvoice({ ...input, vehicleNumber: 'MH12CD5678' }),
  ])
  assert.notEqual(results[0].invoice.invoiceKey, results[1].invoice.invoiceKey)
  for (const result of results) {
    assert.equal((await core.readInvoiceDraft(result.invoice.invoiceKey)).vehicleNumber, result.invoice.vehicleNumber)
  }
})

it('rejects a stale creation payload instead of treating it as an edit', async () => {
  const first = await core.buildInvoicePayload(input)
  const second = await core.buildInvoicePayload(input)
  await core.saveInvoiceHistory(first)
  await assert.rejects(core.saveInvoiceHistory(second), /no longer available/)
})

it('rolls back an invoice and number when the second file cannot be published', async () => {
  const candidate = await core.buildInvoicePayload(input)
  const originalRename = fs.renameSync
  fs.renameSync = (from, to) => {
    if (to.endsWith('.pdf')) throw new Error('Injected PDF publication failure')
    return originalRename(from, to)
  }
  try {
    await assert.rejects(core.generateAndSaveInvoice(input), /Injected PDF/)
  } finally { fs.renameSync = originalRename }
  await assert.rejects(core.readInvoiceDraft(candidate.invoiceKey), /not found/)
  assert.equal((await core.buildInvoicePayload(input)).invoiceKey, candidate.invoiceKey)
  const targets = core.buildInvoiceFileTargets(candidate.invoiceDate, candidate.invoiceKey)
  assert.equal(fs.existsSync(targets.excel.absolutePath), false)
  assert.equal(fs.existsSync(targets.pdf.absolutePath), false)
})

it('restores original bytes and invoice data after a failed edit publication', async () => {
  const saved = await core.generateAndSaveInvoice(input)
  const targets = core.buildInvoiceFileTargets(saved.invoice.invoiceDate, saved.invoice.invoiceKey)
  const excel = fs.readFileSync(targets.excel.absolutePath)
  const pdf = fs.readFileSync(targets.pdf.absolutePath)
  const originalRename = fs.renameSync
  fs.renameSync = (from, to) => {
    if (to.endsWith('.pdf')) throw new Error('Injected edit failure')
    return originalRename(from, to)
  }
  try {
    await assert.rejects(core.generateAndSaveInvoice({ ...input,
      editInvoiceKey: saved.invoice.invoiceKey, vehicleNumber: 'MH12ZZ9999' }), /Injected edit/)
  } finally { fs.renameSync = originalRename }
  assert.equal((await core.readInvoiceDraft(saved.invoice.invoiceKey)).vehicleNumber, input.vehicleNumber)
  assert.deepEqual(fs.readFileSync(targets.excel.absolutePath), excel)
  assert.deepEqual(fs.readFileSync(targets.pdf.absolutePath), pdf)
})

it('cleans the old month after an edit and deletes the new month files', async () => {
  const saved = await core.generateAndSaveInvoice(input)
  const old = core.buildInvoiceFileTargets(saved.invoice.invoiceDate, saved.invoice.invoiceKey)
  const edited = await core.generateAndSaveInvoice({ ...input,
    invoiceDate: '2028-06-01', editInvoiceKey: saved.invoice.invoiceKey })
  const current = core.buildInvoiceFileTargets(edited.invoice.invoiceDate, edited.invoice.invoiceKey)
  for (const kind of ['excel', 'pdf']) {
    assert.equal(fs.existsSync(old[kind].absolutePath), false)
    assert.equal(fs.existsSync(current[kind].absolutePath), true)
  }
  await core.deleteInvoiceHistory(saved.invoice.invoiceKey)
  for (const kind of ['excel', 'pdf']) assert.equal(fs.existsSync(current[kind].absolutePath), false)
})

it('preserves payment tracking on edits and protects older invoice numbers', async () => {
  const first = await core.generateAndSaveInvoice(input)
  const latest = await core.generateAndSaveInvoice(input)
  await assert.rejects(core.deleteInvoiceHistory(first.invoice.invoiceKey), /only the latest/)
  const db = new DatabaseSync(dbPath)
  try {
    db.prepare("UPDATE invoices SET is_paid = 1, paid_at = '2028-05-02', paid_amount = 100, payment_batch_note = 'test payment' WHERE invoice_key = ?")
      .run(latest.invoice.invoiceKey)
    await core.generateAndSaveInvoice({ ...input, editInvoiceKey: latest.invoice.invoiceKey, vehicleNumber: 'MH12XY9876' })
    const payment = db.prepare('SELECT is_paid, paid_at, paid_amount, payment_batch_note FROM invoices WHERE invoice_key = ?').get(latest.invoice.invoiceKey)
    assert.deepEqual({ ...payment }, { is_paid: 1, paid_at: '2028-05-02', paid_amount: 100, payment_batch_note: 'test payment' })
  } finally { db.close() }
  await core.deleteInvoiceHistory(latest.invoice.invoiceKey)
  assert.equal((await core.buildInvoicePayload(input)).invoiceKey, latest.invoice.invoiceKey)
})

it('preserves buyer and destination snapshots after master edits', async () => {
  const saved = await core.generateAndSaveInvoice(input)
  const before = eway.buildEwayBulkJson(saved.invoice.invoiceKey)
  const draft = await core.readInvoiceDraft(saved.invoice.invoiceKey)
  const buyer = (await core.readBuyers()).find((entry) => entry.Buyer_Code === input.buyerCode)
  try {
    core.updateBuyer(buyer.Buyer_Code, { ...buyer, Buyer_Name: 'Changed Buyer',
      City_State_Pin: 'Mumbai Maharashtra 400001', Ship_To_Name: 'New Warehouse',
      Ship_To_Address: 'Mumbai Maharashtra 400001' })
    assert.deepEqual(eway.buildEwayBulkJson(saved.invoice.invoiceKey), before)
    assert.deepEqual((await core.readInvoiceDraft(saved.invoice.invoiceKey)).buyerSnapshot, draft.buyerSnapshot)
  } finally { core.updateBuyer(buyer.Buyer_Code, buyer) }
})

it('recovers uncommitted files and completes cleanup for committed publications', async () => {
  const { preparePublication, publishFiles, recoverPublications } = await import('./invoice-publication.js')
  const saved = await core.generateAndSaveInvoice(input)
  const targets = core.buildInvoiceFileTargets(input.invoiceDate, saved.invoice.invoiceKey)
  const before = fs.readFileSync(targets.excel.absolutePath)
  const temporary = { excel: `${targets.excel.absolutePath}.recovery`, pdf: `${targets.pdf.absolutePath}.recovery` }
  const db = new DatabaseSync(dbPath)
  try {
    for (const committed of [false, true]) {
      fs.writeFileSync(temporary.excel, 'replacement excel')
      fs.writeFileSync(temporary.pdf, 'replacement pdf')
      const journal = preparePublication(targets, temporary)
      db.exec('BEGIN IMMEDIATE')
      publishFiles(journal, db)
      db.exec(committed ? 'COMMIT' : 'ROLLBACK')
      recoverPublications(db)
      assert.deepEqual(fs.readFileSync(targets.excel.absolutePath), committed ? Buffer.from('replacement excel') : before)
      assert.equal(fs.existsSync(journal.directory), false)
    }
  } finally { db.close() }
})
