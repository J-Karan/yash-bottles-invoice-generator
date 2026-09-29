import assert from 'node:assert/strict'
import { it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

it('searches past 300 records, pages without overlap and protects the global latest invoice', async () => {
  const core = await import('./invoice-core.js')
  const repository = await import('./invoice-repository.js')
  const { dbPath } = await import('./config.js')
  await core.dbReady
  const db = new DatabaseSync(dbPath)
  const columns = db.prepare('PRAGMA table_info(invoices)').all().map(row => row.name)
  const original = db.prepare('SELECT * FROM invoices LIMIT 1').get()
  const insert = db.prepare('INSERT INTO invoices (' + columns.join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')')
  db.exec('BEGIN')
  try {
    for (let number = 1; number <= 351; number += 1) {
      const padded = String(number).padStart(3, '0')
      const row = { ...original, invoice_number: padded + '/2040-41', invoice_key: padded + '-2040-41',
        invoice_date: '2040-05-01', buyer_name_snapshot: number === 1 ? 'Archive Needle' : 'Archive Test',
        created_at: '2040-05-01 00:00:00' }
      insert.run(...columns.map(column => row[column]))
    }
    db.exec('COMMIT')
    const first = await core.readInvoiceHistory(50, { search: 'Archive' })
    const last = await core.readInvoiceHistory(50, { offset: 350, search: 'Archive' })
    assert.equal(repository.readInvoiceHistoryCount('Archive'), 351)
    assert.equal(first.length, 50)
    assert.equal(first[0].canDelete, true)
    const priorYear = await core.readInvoiceHistory(50, { search: original.invoice_number })
    assert.equal(priorYear.find(invoice => invoice.invoiceKey === original.invoice_key).canDelete, false)
    await assert.rejects(core.deleteInvoiceHistory(original.invoice_key), /only the latest invoice/)
    assert.equal(last.length, 1)
    assert.equal(last[0].buyerName, 'Archive Needle')
    assert.equal(last[0].canDelete, false)
    const found = await core.readInvoiceHistory(50, { search: 'archive needle' })
    assert.equal(found.length, 1)
    assert.equal(found[0].canDelete, false)
    assert.equal(repository.readInvoiceHistoryCount('01 May 2040'), 351)
    assert.equal(repository.readInvoiceHistoryCount("' OR 1=1 --"), 0)
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK')
    db.prepare("DELETE FROM invoices WHERE invoice_number LIKE '%/2040-41'").run()
    db.close()
  }
})
