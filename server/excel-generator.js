import ExcelJS from 'exceljs'
import { templatePath } from './config.js'
import { formatDate, sanitizeLine } from './invoice-formatting.js'
import { calculateInvoiceTotals, roundCurrency } from './invoice-rules.js'

async function generateExcelInvoice(invoice, outputPath) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(templatePath)
  const sheet = workbook.getWorksheet('Temp') || workbook.worksheets[0]

  sheet.getCell('J2').value = safeExcelText(invoice.invoiceNumber)
  sheet.getCell('J3').value = safeExcelText(formatDate(invoice.invoiceDate))
  sheet.getCell('J4').value = safeExcelText(invoice.vehicleNumber)

  sheet.getCell('A7').value = safeExcelText(invoice.buyer.Buyer_Name)
  sheet.getCell('A8').value = safeExcelText(invoice.buyer.Address_Line1)
  sheet.getCell('A9').value = safeExcelText(invoice.buyer.Address_Line2)
  sheet.getCell('A10').value = safeExcelText([invoice.buyer.Address_Line3, invoice.buyer.City_State_Pin].filter(Boolean).join(', '))
  sheet.getCell('A11').value = safeExcelText(`GSTIN: ${invoice.buyer.GSTIN}`)

  sheet.getCell('I7').value = safeExcelText(invoice.buyer.Ship_To_Name || 'SAME As TO')
  sheet.getCell('I8').value = safeExcelText(invoice.buyer.Ship_To_Address || 'SAME As TO')
  sheet.getCell('I9').value = ''
  sheet.getCell('I10').value = ''
  sheet.getCell('I11').value = ''

  const firstRow = 13
  const lastTemplateRow = 20

  for (let row = firstRow; row <= lastTemplateRow; row += 1) {
    sheet.getCell(`A${row}`).value = null
    sheet.getCell(`B${row}`).value = null
    sheet.getCell(`C${row}`).value = null
    sheet.getCell(`D${row}`).value = null
    sheet.getCell(`E${row}`).value = null
    sheet.getCell(`F${row}`).value = { formula: `IF(D${row}*E${row}=0,"",D${row}*E${row})`, result: '' }
    sheet.getCell(`G${row}`).value = null
    sheet.getCell(`H${row}`).value = { formula: `IF(D${row}*G${row}=0,"",D${row}*G${row})`, result: '' }
    sheet.getCell(`I${row}`).value = { formula: `IF(OR(NOT(ISNUMBER(E${row})),NOT(ISNUMBER(G${row})),G${row}=0),"",E${row}-G${row})`, result: '' }
    sheet.getCell(`J${row}`).value = { formula: `IF(OR(NOT(ISNUMBER(D${row})),NOT(ISNUMBER(I${row}))),"",D${row}*I${row})`, result: '' }
  }

  const lines = invoice.lines || []
  lines.forEach((line, index) => {
    const row = firstRow + index
    const quantity = Number(line.quantity || 0)
    const grossRate = Number(line.grossRate || 0)
    const nonTaxableRate = Number(line.nonTaxableRate || 0)
    const amount = Number(line.amount ?? roundCurrency(quantity * grossRate))
    const nonTaxableValue = Number(line.nonTaxableValue ?? roundCurrency(quantity * nonTaxableRate))
    const taxableRate = Number(line.taxableRate ?? roundCurrency(grossRate - nonTaxableRate))
    const taxableValue = Number(line.taxableValue ?? roundCurrency(quantity * taxableRate))

    sheet.getCell(`A${row}`).value = index + 1
    sheet.getCell(`B${row}`).value = safeExcelText(line.item?.Description || '')
    sheet.getCell(`C${row}`).value = safeExcelText(line.item?.HSN_Code || '')
    sheet.getCell(`D${row}`).value = quantity
    sheet.getCell(`E${row}`).value = grossRate
    sheet.getCell(`F${row}`).value = { formula: `IF(D${row}*E${row}=0,"",D${row}*E${row})`, result: amount }
    sheet.getCell(`G${row}`).value = nonTaxableRate
    sheet.getCell(`H${row}`).value = { formula: `IF(D${row}*G${row}=0,"",D${row}*G${row})`, result: nonTaxableValue }
    sheet.getCell(`I${row}`).value = { formula: `IF(OR(NOT(ISNUMBER(E${row})),NOT(ISNUMBER(G${row})),G${row}=0),"",E${row}-G${row})`, result: taxableRate }
    sheet.getCell(`J${row}`).value = { formula: `IF(OR(NOT(ISNUMBER(D${row})),NOT(ISNUMBER(I${row}))),"",D${row}*I${row})`, result: taxableValue }
  })

  const computedTotals = calculateInvoiceTotals(lines)
  const totals = {
    quantity: Number(invoice.totals?.quantity ?? invoice.quantity ?? computedTotals.quantity),
    amount: Number(invoice.totals?.amount ?? invoice.amount ?? computedTotals.amount),
    nonTaxableValue: Number(invoice.totals?.nonTaxableValue ?? invoice.nonTaxableValue ?? computedTotals.nonTaxableValue),
    taxableValue: Number(invoice.totals?.taxableValue ?? invoice.taxableValue ?? computedTotals.taxableValue),
    cgst: Number(invoice.totals?.cgst ?? invoice.cgst ?? computedTotals.cgst),
    sgst: Number(invoice.totals?.sgst ?? invoice.sgst ?? computedTotals.sgst),
    taxableAfterGst: Number(invoice.totals?.taxableAfterGst ?? invoice.taxableAfterGst ?? computedTotals.taxableAfterGst),
    total: Number(invoice.totals?.total ?? invoice.total ?? computedTotals.total),
  }

  sheet.getCell('D21').value = { formula: 'SUM(D13:D20)', result: totals.quantity }
  sheet.getCell('H21').value = { formula: 'SUM(H13:H20)', result: totals.nonTaxableValue }
  sheet.getCell('J21').value = { formula: 'SUM(J13:J20)', result: totals.taxableValue }

  sheet.getCell('J23').value = { formula: 'J21', result: totals.taxableValue }
  sheet.getCell('J24').value = { formula: 'J23*0.09', result: totals.cgst }
  sheet.getCell('J25').value = { formula: 'J23*0.09', result: totals.sgst }
  sheet.getCell('J26').value = { formula: 'SUM(J23:J25)', result: totals.taxableAfterGst }
  sheet.getCell('J27').value = { formula: 'H21', result: totals.nonTaxableValue }
  sheet.getCell('J28').value = { formula: 'J26+J27', result: totals.total }

  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    printArea: 'A1:J36',
  }

  applyCurrencyFormatting(sheet, [
    'D21',
    'H21',
    'J21',
    'J23',
    'J24',
    'J25',
    'J26',
    'J27',
    'J28',
  ])

  for (let row = firstRow; row <= lastTemplateRow; row += 1) {
    applyCurrencyFormatting(sheet, [`E${row}`, `F${row}`, `G${row}`, `H${row}`, `I${row}`, `J${row}`])
  }

  workbook.calcProperties.fullCalcOnLoad = true
  workbook.calcProperties.forceFullCalc = true

  await workbook.xlsx.writeFile(outputPath)
}

function applyCurrencyFormatting(sheet, cells) {
  cells.forEach((address) => {
    sheet.getCell(address).numFmt = '#,##0.00'
  })
}

function safeExcelText(value) {
  const text = sanitizeLine(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

export { generateExcelInvoice, safeExcelText }
