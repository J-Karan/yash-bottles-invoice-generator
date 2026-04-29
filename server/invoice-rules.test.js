import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildInvoiceLines,
  calculateInvoiceTotals,
  deriveFinancialYearSuffix,
} from './invoice-rules.js'

const items = [
  {
    Item_Code: 'BE001',
    Description: '650ML TUBORG',
    HSN_Code: '7010',
    Gross_Rate: '4.80',
    Non_Taxable_Rate: '4.60',
    Bottles_Per_Bag: '72',
    Dad_Writes_As: 'Tuborg',
    Category: 'Beer',
  },
  {
    Item_Code: 'BE003',
    Description: '330ML Carlsberg',
    HSN_Code: '7010',
    Gross_Rate: '3.00',
    Non_Taxable_Rate: '2.80',
    Bottles_Per_Bag: '120',
    Dad_Writes_As: 'Carlsberg 330',
    Category: 'Beer',
  },
]

describe('deriveFinancialYearSuffix', () => {
  it('uses the previous financial year before April', () => {
    assert.equal(deriveFinancialYearSuffix('2026-03-31'), '2025-26')
  })

  it('starts the new financial year in April', () => {
    assert.equal(deriveFinancialYearSuffix('2026-04-01'), '2026-27')
  })

  it('rejects invalid ISO dates', () => {
    assert.throws(() => deriveFinancialYearSuffix('2026-02-30'), /Invoice date is invalid/)
  })
})

describe('invoice line and total rules', () => {
  it('calculates multi-line invoice totals with GST only on taxable value', () => {
    const lines = buildInvoiceLines(
      [
        { itemCode: 'BE001', bags: '10' },
        { itemCode: 'BE003', bags: '2' },
      ],
      items,
    )

    assert.deepEqual(
      lines.map((line) => ({
        code: line.item.Item_Code,
        quantity: line.quantity,
        amount: line.amount,
        nonTaxableValue: line.nonTaxableValue,
        taxableValue: line.taxableValue,
      })),
      [
        {
          code: 'BE001',
          quantity: 720,
          amount: 3456,
          nonTaxableValue: 3312,
          taxableValue: 144,
        },
        {
          code: 'BE003',
          quantity: 240,
          amount: 720,
          nonTaxableValue: 672,
          taxableValue: 48,
        },
      ],
    )

    assert.deepEqual(calculateInvoiceTotals(lines), {
      quantity: 960,
      amount: 4176,
      nonTaxableValue: 3984,
      taxableValue: 192,
      cgst: 17.28,
      sgst: 17.28,
      taxableAfterGst: 226.56,
      total: 4210.56,
    })
  })

  it('rejects unknown item codes with the line number', () => {
    assert.throws(
      () => buildInvoiceLines([{ itemCode: 'MISSING', bags: '1' }], items),
      /Selected item was not found for line 1/,
    )
  })

  it('rejects zero or negative bag counts with the line number', () => {
    assert.throws(
      () => buildInvoiceLines([{ itemCode: 'BE001', bags: '0' }], items),
      /Bags must be greater than zero for line 1/,
    )
  })
})
