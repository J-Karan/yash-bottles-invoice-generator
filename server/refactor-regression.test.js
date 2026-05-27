import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { before, describe, it } from 'node:test'

let invoiceCore

before(async () => {
  process.env.APP_PASSWORD ||= 'test-app-password'
  process.env.ADMIN_PASSWORD ||= 'test-admin-password'
  process.env.PAYMENT_PASSWORD ||= 'test-payment-password'
  invoiceCore = await import('./invoice-core.js')
  await invoiceCore.dbReady
})

describe('invoice-core compatibility exports', () => {
  it('keeps the public invoice-core facade intact after module extraction', () => {
    assert.equal(typeof invoiceCore.dbReady?.then, 'function')
    assert.equal(typeof invoiceCore.buildInvoicePayload, 'function')
    assert.equal(typeof invoiceCore.saveInvoiceHistory, 'function')
    assert.equal(typeof invoiceCore.readInvoiceHistory, 'function')
    assert.equal(typeof invoiceCore.readInvoiceDraft, 'function')
    assert.equal(typeof invoiceCore.deleteInvoiceHistory, 'function')
    assert.equal(typeof invoiceCore.readPaymentSummary, 'function')
    assert.equal(typeof invoiceCore.markUnpaidInvoicesPaid, 'function')
    assert.equal(typeof invoiceCore.generateExcelInvoice, 'function')
    assert.equal(typeof invoiceCore.generatePdfInvoice, 'function')
  })
})

describe('generated artifact paths', () => {
  it('uses financial year and numbered month buckets for invoice files', () => {
    const targets = invoiceCore.buildInvoiceFileTargets('2026-05-27', '001-2026-27')

    assert.equal(targets.excel.filename, '001-2026-27.xlsx')
    assert.equal(targets.pdf.filename, '001-2026-27.pdf')
    assert.equal(targets.excel.relativeUrlPath, '2026-27/05-May/001-2026-27.xlsx')
    assert.equal(targets.pdf.relativeUrlPath, '2026-27/05-May/001-2026-27.pdf')
  })

  it('uses the previous financial year for January through March invoice files', () => {
    const targets = invoiceCore.buildInvoiceFileTargets('2026-03-01', '009-2025-26')

    assert.equal(targets.excel.relativeUrlPath, '2025-26/03-March/009-2025-26.xlsx')
  })
})

describe('generated artifact writers', () => {
  it('writes a PDF invoice file from the compatibility export', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'invoice-pdf-'))
    const outputPath = path.join(outputDir, 'sample.pdf')
    const invoice = {
      invoiceNumber: '001/2026-27',
      invoiceKey: '001-2026-27',
      invoiceDate: '2026-05-27',
      vehicleNumber: 'MH12AB1234',
      quantity: 50,
      amount: 600,
      nonTaxableValue: 100,
      taxableValue: 500,
      cgst: 45,
      sgst: 45,
      taxableAfterGst: 590,
      total: 690,
      buyer: {
        Buyer_Code: 'B001',
        Buyer_Name: 'Acme Packaging',
        Address_Line1: 'Factory Road',
        Address_Line2: 'Industrial Area',
        Address_Line3: 'Pune',
        City_State_Pin: 'Pune, Maharashtra 411046',
        GSTIN: '27ABCDE1234F1Z5',
        Ship_To_Name: 'SAME As TO',
        Ship_To_Address: '',
      },
      lines: [
        {
          item: {
            Item_Code: 'I001',
            Description: '200 ML Glass Bottle',
            HSN_Code: '7010',
          },
          bags: 1,
          bottlesPerBag: 50,
          quantity: 50,
          grossRate: 12,
          amount: 600,
          nonTaxableRate: 2,
          nonTaxableValue: 100,
          taxableRate: 10,
          taxableValue: 500,
        },
      ],
    }

    try {
      await invoiceCore.generatePdfInvoice(invoice, outputPath)
      const stats = await fs.stat(outputPath)
      assert.ok(stats.size > 1000, 'expected a non-empty generated PDF')
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true })
    }
  })
})

describe('master data validation guardrails', () => {
  it('rejects buyer creation without a code and name', () => {
    assert.throws(
      () => invoiceCore.createBuyer({ Buyer_Code: '', Buyer_Name: '' }),
      /Buyer code is required/,
    )
  })

  it('rejects item creation with invalid rates and quantities', () => {
    assert.throws(
      () =>
        invoiceCore.createItem({
          Item_Code: 'BAD',
          Description: 'Bad item',
          Gross_Rate: '-1',
          Non_Taxable_Rate: '0',
          Bottles_Per_Bag: '0',
        }),
      /Gross rate must be a valid number/,
    )
  })
})
