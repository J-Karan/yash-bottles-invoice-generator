import fs from 'node:fs/promises'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { formatDate, formatMoney, numberToIndianWords, sanitizeLine } from './invoice-formatting.js'

async function generatePdfInvoice(invoice, outputPath) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const black = rgb(0.08, 0.08, 0.08)
  const red = rgb(0.64, 0.17, 0.12)
  const pageWidth = 841.89
  const margin = 28
  const contentWidth = pageWidth - margin * 2
  const lineGap = 12
  const headerLeftWidth = 420
  const headerRightWidth = contentWidth - headerLeftWidth - 16
  const companyLines = [
    'YASH BOTTLES',
    'Gat No 54/5, Nr Jambhulwadi Lake, Pune Satara Highway,',
    'Jambhulwadi, Pune-411046',
    'GSTIN : 27BZCPA4008G1ZX',
  ]
  const metaRows = [
    ['Invoice Number', invoice.invoiceNumber],
    ['Date', formatDate(invoice.invoiceDate)],
    ['Vehicle Number', invoice.vehicleNumber],
  ]
  const headerHeight = 78

  const buyerWidth = (contentWidth - 18) / 2
  const buyerLines = [
    invoice.buyer.Buyer_Name,
    sanitizeLine(invoice.buyer.Address_Line1),
    sanitizeLine(invoice.buyer.Address_Line2),
    [invoice.buyer.Address_Line3, invoice.buyer.City_State_Pin].filter(Boolean).join(', '),
    `GSTIN: ${invoice.buyer.GSTIN}`,
  ].filter(Boolean)
  const shipToName = sanitizeLine(invoice.buyer.Ship_To_Name)
  const shipToAddress = sanitizeLine(invoice.buyer.Ship_To_Address)
  const hasDistinctShipTo =
    !!shipToName &&
    shipToName.toUpperCase() !== 'SAME AS TO' &&
    shipToName.toUpperCase() !== invoice.buyer.Buyer_Name.toUpperCase()
  const shipLines = hasDistinctShipTo
    ? [shipToName, shipToAddress].filter(Boolean)
    : []

  const toBoxWidth = hasDistinctShipTo ? buyerWidth : contentWidth
  const shipBoxWidth = buyerWidth
  const buyerWrapped = buyerLines.flatMap((line, index) =>
    wrapText(line, toBoxWidth - 24, index === 0 ? fontBold : font, index === 0 ? 11 : 10),
  )
  const shipWrapped = shipLines.flatMap((line, index) =>
    wrapText(line, shipBoxWidth - 24, index === 0 ? fontBold : font, index === 0 ? 11 : 10),
  )
  const addressHeight = Math.max(buyerWrapped.length, shipWrapped.length || 0) * lineGap + 32

  const colWidths = [36, 180, 55, 48, 72, 72, 78, 82, 82, 80]
  const headers = [
    'Sr No',
    'Description Of Goods',
    'HSN CODE',
    'Qty',
    'Gross Rate (Rs)',
    'Amount (Rs)',
    'Non Taxable Rate (Rs)',
    'Non Taxable Value (Rs)',
    'Taxable Rate (Rs) Per Piece',
    'Taxable Value (Rs)',
  ]
  const tableX = margin
  const headerHeightRow = 24
  const tableRowHeights = invoice.lines.map((line) => {
    const wrappedDescription = wrapText(line.item.Description, colWidths[1] - 8, font, 8.5)
    return Math.max(24, wrappedDescription.length * 10 + 8)
  })
  const tableHeight = headerHeightRow + tableRowHeights.reduce((sum, height) => sum + height, 0)

  const summaryRows = [
    ['Quantity', String(invoice.quantity)],
    ['Total Taxable', formatMoney(invoice.taxableValue)],
    ['CGST 9%', formatMoney(invoice.cgst)],
    ['SGST 9%', formatMoney(invoice.sgst)],
    ['Taxable After GST', formatMoney(invoice.taxableAfterGst)],
    ['Non-Taxable Amount', formatMoney(invoice.nonTaxableValue)],
    ['TOTAL', formatMoney(invoice.total)],
  ]
  const summaryWidth = 280
  const summaryRowHeight = 20
  const summaryHeight = summaryRows.length * summaryRowHeight + 18
  const summaryX = pageWidth - margin - summaryWidth
  const declarationX = margin
  const declarationWidth = contentWidth - summaryWidth - 18
  const declarationText = 'DECLARATION: We hereby declare that this invoice actual price and goods details are true and correct.'
  const amountWords = `Amount In Words: ${numberToIndianWords(invoice.total)}`
  const declarationTextHeight = wrapText(declarationText, declarationWidth - 20, font, 9.5).length * 13
  const amountWordsHeight = wrapText(amountWords, declarationWidth - 20, fontBold, 9.5).length * 13
  const invoiceFacts = [
    `Total Number Of Items: ${invoice.lines.length}`,
    `Total Bags: ${invoice.lines.reduce((sum, line) => sum + line.bags, 0)}`,
    `Vehicle: ${invoice.vehicleNumber}`,
    `Buyer GSTIN: ${invoice.buyer.GSTIN}`,
  ]
  const factsHeight = invoiceFacts.length * 12
  const declarationBlockHeight = Math.max(
    summaryHeight,
    18 + declarationTextHeight + 10 + amountWordsHeight + 12 + factsHeight + 10,
  )
  const footerHeight = 80
  const footerLeftWidth = 340
  const footerRightWidth = contentWidth - footerLeftWidth - 16
  const requiredContentHeight =
    24 + // top margin area before title
    24 + // title spacing
    headerHeight +
    12 +
    addressHeight +
    14 +
    tableHeight +
    12 +
    declarationBlockHeight +
    14 +
    footerHeight +
    18
  const pageHeight = Math.max(595.28, requiredContentHeight)
  const page = pdf.addPage([pageWidth, pageHeight])
  let cursorY = pageHeight - 24

  drawCenteredText(page, 'TAX INVOICE', pageWidth / 2, cursorY, fontBold, 18, black)
  cursorY -= 24

  drawBox(page, margin, cursorY - headerHeight, headerLeftWidth, headerHeight)
  drawBox(page, margin + headerLeftWidth + 16, cursorY - headerHeight, headerRightWidth, headerHeight)
  drawWrappedText(page, companyLines[0], {
    x: margin + 12,
    y: cursorY - 22,
    maxWidth: headerLeftWidth - 24,
    font: fontBold,
    size: 15,
    lineHeight: 16,
    color: red,
  })
  drawWrappedText(page, companyLines.slice(1).join('\n'), {
    x: margin + 12,
    y: cursorY - 42,
    maxWidth: headerLeftWidth - 24,
    font,
    size: 10,
    lineHeight: lineGap,
    color: black,
  })

  metaRows.forEach(([label, value], index) => {
    const y = cursorY - 20 - index * 19
    drawText(page, `${label}:`, margin + headerLeftWidth + 28, y, fontBold, 10, black)
    drawText(page, value, margin + headerLeftWidth + 128, y, font, 10, black)
  })

  cursorY -= headerHeight + 12

  drawBox(page, margin, cursorY - addressHeight, toBoxWidth, addressHeight)
  drawText(page, 'TO:', margin + 10, cursorY - 18, fontBold, 11, black)

  drawWrappedLineList(page, buyerLines, {
    x: margin + 10,
    y: cursorY - 34,
    width: toBoxWidth - 20,
    font,
    fontBold,
    lineHeight: lineGap,
    color: black,
  })
  if (hasDistinctShipTo) {
    drawBox(page, margin + buyerWidth + 18, cursorY - addressHeight, shipBoxWidth, addressHeight)
    drawText(page, 'SHIP TO:', margin + buyerWidth + 28, cursorY - 18, fontBold, 11, black)
    drawWrappedLineList(page, shipLines, {
      x: margin + buyerWidth + 28,
      y: cursorY - 34,
      width: shipBoxWidth - 20,
      font,
      fontBold,
      lineHeight: lineGap,
      color: black,
    })
  }

  cursorY -= addressHeight + 14

  drawTableRow(page, headers, {
    x: tableX,
    y: cursorY - headerHeightRow,
    widths: colWidths,
    height: headerHeightRow,
    font: fontBold,
    size: 8.5,
    color: black,
    fillColor: rgb(0.96, 0.93, 0.9),
    numericColumns: [2, 3, 4, 5, 6, 7, 8, 9],
  })
  cursorY -= headerHeightRow

  invoice.lines.forEach((line, index) => {
    const rowValues = [
      String(index + 1),
      `${line.item.Description} (${line.bags} bags)`,
      line.item.HSN_Code || '',
      String(line.quantity),
      formatMoney(line.grossRate),
      formatMoney(line.amount),
      formatMoney(line.nonTaxableRate),
      formatMoney(line.nonTaxableValue),
      formatMoney(line.taxableRate),
      formatMoney(line.taxableValue),
    ]
    const rowHeight = tableRowHeights[index]

    drawTableRow(page, rowValues, {
      x: tableX,
      y: cursorY - rowHeight,
      widths: colWidths,
      height: rowHeight,
      font,
      size: 8.5,
      color: black,
      numericColumns: [2, 3, 4, 5, 6, 7, 8, 9],
    })
    cursorY -= rowHeight
  })

  cursorY -= 12
  const lowerBlockTop = cursorY

  drawBox(page, summaryX, lowerBlockTop - summaryHeight, summaryWidth, summaryHeight)
  drawText(page, 'SUMMARY', summaryX + 10, lowerBlockTop - 16, fontBold, 11, black)
  summaryRows.forEach(([label, value], index) => {
    const y = lowerBlockTop - 34 - index * summaryRowHeight
    const labelFont = label === 'TOTAL' ? fontBold : font
    drawText(page, label, summaryX + 10, y, labelFont, 10, black)
    drawText(page, value, summaryX + 170, y, labelFont, 10, black)
  })

  drawBox(page, declarationX, lowerBlockTop - declarationBlockHeight, declarationWidth, declarationBlockHeight)
  drawText(page, 'DECLARATION', declarationX + 10, lowerBlockTop - 16, fontBold, 11, black)
  drawWrappedText(page, declarationText, {
    x: declarationX + 10,
    y: lowerBlockTop - 36,
    maxWidth: declarationWidth - 20,
    font,
    size: 9.5,
    lineHeight: 13,
    color: black,
  })
  drawWrappedText(page, amountWords, {
    x: declarationX + 10,
    y: lowerBlockTop - 36 - declarationTextHeight - 10,
    maxWidth: declarationWidth - 20,
    font: fontBold,
    size: 9.5,
    lineHeight: 13,
    color: black,
  })
  invoiceFacts.forEach((fact, index) => {
    drawText(
      page,
      fact,
      declarationX + 10,
      lowerBlockTop - 36 - declarationTextHeight - 10 - amountWordsHeight - 12 - index * 12,
      font,
      9,
      black,
    )
  })

  cursorY = lowerBlockTop - declarationBlockHeight - 14

  drawBox(page, margin, cursorY - footerHeight, footerLeftWidth, footerHeight)
  drawBox(page, margin + footerLeftWidth + 16, cursorY - footerHeight, footerRightWidth, footerHeight)

  drawText(page, 'BANK DETAILS', margin + 10, cursorY - 16, fontBold, 11, black)
  ;[
    'BANK NAME: KOTAK MAHINDRA',
    'BRANCH: KATRAJ, PUNE',
    'ACCOUNT NO.: 5949555673',
    'IFSC CODE: KKBK0001802',
  ].forEach((line, index) => {
    drawText(page, line, margin + 10, cursorY - 30 - index * 13, font, 9.5, black)
  })

  drawText(page, 'For YASH BOTTLE', margin + footerLeftWidth + 28, cursorY - 22, fontBold, 11, black)
  drawText(page, 'Authorized Signatory', margin + footerLeftWidth + 28, cursorY - 64, font, 10, black)

  const bytes = await pdf.save()
  await fs.writeFile(outputPath, bytes)
}

function drawText(page, text, x, y, font, size, color) {
  page.drawText(String(text || ''), { x, y, font, size, color })
}

function drawBox(page, x, y, width, height) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderWidth: 1,
    borderColor: rgb(0.08, 0.08, 0.08),
  })
}

function drawCenteredText(page, text, centerX, y, font, size, color) {
  const width = font.widthOfTextAtSize(text, size)
  drawText(page, text, centerX - width / 2, y, font, size, color)
}

function wrapText(text, maxWidth, font, size) {
  const source = String(text || '').trim()
  if (!source) {
    return ['']
  }

  const manualLines = source.split('\n')
  const lines = []

  manualLines.forEach((manualLine) => {
    const words = manualLine.split(/\s+/)
    let current = ''

    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word
      const width = font.widthOfTextAtSize(next, size)
      if (width <= maxWidth) {
        current = next
      } else {
        if (current) {
          lines.push(current)
        }
        current = word
      }
    })

    if (current) {
      lines.push(current)
    }
  })

  return lines.length ? lines : ['']
}

function drawWrappedText(page, text, options) {
  const lines = wrapText(text, options.maxWidth, options.font, options.size)
  lines.forEach((line, index) => {
    drawText(
      page,
      line,
      options.x,
      options.y - index * options.lineHeight,
      options.font,
      options.size,
      options.color,
    )
  })
  return lines.length * options.lineHeight
}

function drawWrappedLineList(page, lines, options) {
  let currentY = options.y
  lines.forEach((line, index) => {
    const activeFont = index === 0 ? options.fontBold : options.font
    const activeSize = index === 0 ? 11 : 10
    const consumed = drawWrappedText(page, line, {
      x: options.x,
      y: currentY,
      maxWidth: options.width,
      font: activeFont,
      size: activeSize,
      lineHeight: options.lineHeight,
      color: options.color,
    })
    currentY -= consumed
  })
}

function drawTableRow(page, values, options) {
  let cursorX = options.x
  values.forEach((value, index) => {
    const width = options.widths[index]
    const isNumericColumn = options.numericColumns?.includes(index)
    const isEmphasisCell = options.emphasisColumns?.includes(index)
    page.drawRectangle({
      x: cursorX,
      y: options.y,
      width,
      height: options.height,
      borderWidth: 1,
      borderColor: options.color,
      color: isEmphasisCell ? rgb(0.95, 0.88, 0.82) : options.fillColor,
      opacity: options.fillColor ? 1 : undefined,
    })

    const wrapped = wrapText(value, width - 8, options.font, options.size)
    const lineHeight = 10
    const textBlockHeight = wrapped.length * lineHeight
    const startY = options.y + options.height - 10 - Math.max(0, (options.height - textBlockHeight - 6) / 2)

    wrapped.forEach((line, lineIndex) => {
      const lineWidth = options.font.widthOfTextAtSize(line, options.size)
      const textX = isNumericColumn ? cursorX + width - lineWidth - 4 : cursorX + 4
      drawText(page, line, textX, startY - lineIndex * lineHeight, options.font, options.size, options.color)
    })
    cursorX += width
  })
}

export { generatePdfInvoice }
