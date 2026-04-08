import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { generatePdfInvoice } from './index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const outputDir = path.join(rootDir, 'debug', 'pdf-harness')

const baselineInvoice = {
  invoiceNumber: 'HARNESS/2026-27',
  invoiceKey: 'HARNESS-2026-27',
  invoiceDate: '2026-04-07',
  vehicleNumber: 'MH12AB1234',
  quantity: 720,
  amount: 3456,
  nonTaxableValue: 3312,
  taxableValue: 144,
  cgst: 12.96,
  sgst: 12.96,
  taxableAfterGst: 169.92,
  total: 3481.92,
  buyer: {
    Buyer_Code: 'B001',
    Buyer_Name: 'SHREE BALAJI ENTERPRISES',
    Address_Line1: 'NEAR K-74 RANJANGAO PLOT NO-5',
    Address_Line2: 'GUT NO-30 MIDC WALUJ',
    Address_Line3: '',
    City_State_Pin: 'AURANGABAD MAHARASHTRA-431136',
    GSTIN: '27ADNPN5929R1ZG',
    Ship_To_Name: 'SAME As TO',
    Ship_To_Address: '',
  },
  lines: [
    {
      item: {
        Item_Code: 'BE001',
        Description: '650ML TUBORG',
        HSN_Code: '7010',
        Gross_Rate: '4.80',
        Non_Taxable_Rate: '4.60',
        Bottles_Per_Bag: '72',
        Dad_Writes_As: 'Tuborg|Tuborg 650|Tuborg 650ml',
        Category: 'Beer',
      },
      bags: 10,
      bottlesPerBag: 72,
      quantity: 720,
      grossRate: 4.8,
      amount: 3456,
      nonTaxableRate: 4.6,
      nonTaxableValue: 3312,
      taxableRate: 0.2,
      taxableValue: 144,
    },
  ],
}

const cases = [
  {
    name: 'baseline-valid',
    expectation: 'success',
    description: 'Current expected payload shape.',
    mutate: (invoice) => invoice,
  },
  {
    name: 'missing-invoice-number',
    expectation: 'silent-corruption',
    description: 'Removes invoice.invoiceNumber. PDF still renders, but invoice number field becomes blank.',
    mutate: (invoice) => {
      delete invoice.invoiceNumber
      return invoice
    },
  },
  {
    name: 'missing-buyer-gstin',
    expectation: 'silent-corruption',
    description: 'Removes invoice.buyer.GSTIN. PDF still renders, but GSTIN text becomes blank.',
    mutate: (invoice) => {
      delete invoice.buyer.GSTIN
      return invoice
    },
  },
  {
    name: 'buyer-object-removed',
    expectation: 'throw',
    description: 'Removes invoice.buyer entirely. PDF code dereferences buyer fields and throws.',
    mutate: (invoice) => {
      delete invoice.buyer
      return invoice
    },
  },
  {
    name: 'lines-not-array',
    expectation: 'throw',
    description: 'Changes invoice.lines from an array to an object. PDF code calls map/forEach/reduce and throws.',
    mutate: (invoice) => {
      invoice.lines = { broken: true }
      return invoice
    },
  },
  {
    name: 'line-item-missing-item-object',
    expectation: 'throw',
    description: 'Removes line.item. PDF code reads line.item.Description and throws.',
    mutate: (invoice) => {
      delete invoice.lines[0].item
      return invoice
    },
  },
]

await fs.mkdir(outputDir, { recursive: true })

for (const testCase of cases) {
  const invoice = structuredClone(baselineInvoice)
  const mutatedInvoice = testCase.mutate(invoice)
  const outputPath = path.join(outputDir, `${testCase.name}.pdf`)

  try {
    await generatePdfInvoice(mutatedInvoice, outputPath)
    const stats = await fs.stat(outputPath)
    console.log(
      JSON.stringify(
        {
          case: testCase.name,
          expectation: testCase.expectation,
          outcome: 'success',
          bytes: stats.size,
          file: outputPath,
          description: testCase.description,
        },
        null,
        2,
      ),
    )
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          case: testCase.name,
          expectation: testCase.expectation,
          outcome: 'throw',
          error: error.message,
          description: testCase.description,
        },
        null,
        2,
      ),
    )
  }
}
