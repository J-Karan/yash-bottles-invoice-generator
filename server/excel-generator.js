import ExcelJS from 'exceljs'
import { templatePath } from './config.js'
import { formatDate, sanitizeLine } from './invoice-formatting.js'

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
    sheet.getCell(`G${row}`).value = null
  }

  invoice.lines.forEach((line, index) => {
    const row = firstRow + index
    sheet.getCell(`A${row}`).value = index + 1
    sheet.getCell(`B${row}`).value = safeExcelText(line.item.Description)
    sheet.getCell(`C${row}`).value = safeExcelText(line.item.HSN_Code)
    sheet.getCell(`D${row}`).value = line.quantity
    sheet.getCell(`E${row}`).value = line.grossRate
    sheet.getCell(`G${row}`).value = line.nonTaxableRate
  })

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

  invoice.lines.forEach((_, index) => {
    const row = firstRow + index
    applyCurrencyFormatting(sheet, [`E${row}`, `F${row}`, `G${row}`, `H${row}`, `I${row}`, `J${row}`])
  })

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
