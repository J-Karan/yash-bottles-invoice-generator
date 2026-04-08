import ExcelJS from 'exceljs'
import fs from 'fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { parse } from 'csv-parse/sync'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import {
  buyersPath,
  dataDir,
  dbPath,
  generatedExcelDir,
  generatedPdfDir,
  itemsPath,
  maxLineItems,
  templatePath,
} from './config.js'

let db
const dbReady = initializeDatabase()

async function readCsv(filePath) {
  const content = await fs.readFile(filePath, 'utf8')
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })
}

async function initializeDatabase() {
  await fs.mkdir(generatedExcelDir, { recursive: true })
  await fs.mkdir(generatedPdfDir, { recursive: true })
  await fs.mkdir(dataDir, { recursive: true })

  db = new DatabaseSync(dbPath)
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS buyers (
      buyer_code TEXT PRIMARY KEY,
      buyer_name TEXT NOT NULL,
      address_line1 TEXT DEFAULT '',
      address_line2 TEXT DEFAULT '',
      address_line3 TEXT DEFAULT '',
      city_state_pin TEXT DEFAULT '',
      gstin TEXT DEFAULT '',
      ship_to_name TEXT DEFAULT '',
      ship_to_address TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS items (
      item_code TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      hsn_code TEXT DEFAULT '',
      gross_rate REAL NOT NULL DEFAULT 0,
      non_taxable_rate REAL NOT NULL DEFAULT 0,
      bottles_per_bag INTEGER NOT NULL DEFAULT 0,
      dad_writes_as TEXT DEFAULT '',
      category TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoice_sequences (
      financial_year TEXT PRIMARY KEY,
      next_serial INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      invoice_number TEXT PRIMARY KEY,
      invoice_key TEXT NOT NULL UNIQUE,
      invoice_date TEXT NOT NULL,
      vehicle_number TEXT NOT NULL,
      quantity REAL NOT NULL,
      amount REAL NOT NULL,
      non_taxable_value REAL NOT NULL,
      taxable_value REAL NOT NULL,
      cgst REAL NOT NULL,
      sgst REAL NOT NULL,
      taxable_after_gst REAL NOT NULL,
      total REAL NOT NULL,
      buyer_code TEXT NOT NULL,
      buyer_name_snapshot TEXT NOT NULL,
      buyer_gstin_snapshot TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL,
      line_index INTEGER NOT NULL,
      item_code TEXT NOT NULL,
      item_description_snapshot TEXT NOT NULL,
      hsn_code_snapshot TEXT DEFAULT '',
      bags REAL NOT NULL,
      bottles_per_bag REAL NOT NULL,
      quantity REAL NOT NULL,
      gross_rate REAL NOT NULL,
      amount REAL NOT NULL,
      non_taxable_rate REAL NOT NULL,
      non_taxable_value REAL NOT NULL,
      taxable_rate REAL NOT NULL,
      taxable_value REAL NOT NULL,
      FOREIGN KEY (invoice_number) REFERENCES invoices(invoice_number) ON DELETE CASCADE
    );
  `)

  await seedDatabaseFromCsv()
}

async function seedDatabaseFromCsv() {
  const buyerCount = db.prepare('SELECT COUNT(*) AS count FROM buyers').get().count
  if (!buyerCount) {
    const buyers = await readCsv(buyersPath)
    const insertBuyer = db.prepare(`
      INSERT INTO buyers (
        buyer_code,
        buyer_name,
        address_line1,
        address_line2,
        address_line3,
        city_state_pin,
        gstin,
        ship_to_name,
        ship_to_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertManyBuyers = withTransaction((rows) => {
      rows.forEach((buyer) => {
        insertBuyer.run(
          buyer.Buyer_Code,
          buyer.Buyer_Name,
          buyer.Address_Line1 || '',
          buyer.Address_Line2 || '',
          buyer.Address_Line3 || '',
          buyer.City_State_Pin || '',
          buyer.GSTIN || '',
          buyer.Ship_To_Name || '',
          buyer.Ship_To_Address || '',
        )
      })
    })

    insertManyBuyers(buyers)
  }

  const itemCount = db.prepare('SELECT COUNT(*) AS count FROM items').get().count
  if (!itemCount) {
    const items = await readCsv(itemsPath)
    const insertItem = db.prepare(`
      INSERT INTO items (
        item_code,
        description,
        hsn_code,
        gross_rate,
        non_taxable_rate,
        bottles_per_bag,
        dad_writes_as,
        category
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertManyItems = withTransaction((rows) => {
      rows.forEach((item) => {
        insertItem.run(
          item.Item_Code,
          item.Description,
          item.HSN_Code || '',
          Number(item.Gross_Rate || 0),
          Number(item.Non_Taxable_Rate || 0),
          Number(item.Bottles_Per_Bag || 0),
          item.Dad_Writes_As || '',
          item.Category || '',
        )
      })
    })

    insertManyItems(items)
  }
}

async function readBuyers() {
  const rows = db.prepare(`
    SELECT
      buyer_code,
      buyer_name,
      address_line1,
      address_line2,
      address_line3,
      city_state_pin,
      gstin,
      ship_to_name,
      ship_to_address
    FROM buyers
    ORDER BY buyer_name COLLATE NOCASE ASC
  `).all()

  return rows.map(mapBuyerRow)
}

async function readItems() {
  const rows = db.prepare(`
    SELECT
      item_code,
      description,
      hsn_code,
      gross_rate,
      non_taxable_rate,
      bottles_per_bag,
      dad_writes_as,
      category
    FROM items
    ORDER BY description COLLATE NOCASE ASC
  `).all()

  return rows.map(mapItemRow)
}

async function readInvoiceHistory(limit = 200) {
  const requestedLimit = Number(limit)
  const safeLimit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 1), 1000)
    : 200

  const rows = db.prepare(`
    SELECT
      i.invoice_number,
      i.invoice_key,
      i.invoice_date,
      i.vehicle_number,
      i.quantity,
      i.total,
      i.buyer_code,
      i.buyer_name_snapshot,
      i.buyer_gstin_snapshot,
      i.created_at,
      COALESCE(lines.line_count, 0) AS line_count
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_number, COUNT(*) AS line_count
      FROM invoice_lines
      GROUP BY invoice_number
    ) AS lines ON lines.invoice_number = i.invoice_number
    ORDER BY i.created_at DESC, i.invoice_number DESC
    LIMIT ?
  `).all(safeLimit)

  return rows.map((row) => ({
    invoiceNumber: row.invoice_number,
    invoiceKey: row.invoice_key,
    invoiceDate: row.invoice_date,
    vehicleNumber: row.vehicle_number,
    quantity: Number(row.quantity || 0),
    total: Number(row.total || 0),
    buyerCode: row.buyer_code,
    buyerName: row.buyer_name_snapshot,
    buyerGstin: row.buyer_gstin_snapshot || '',
    createdAt: row.created_at,
    lineCount: Number(row.line_count || 0),
  }))
}

function createBuyer(input) {
  const payload = normalizeBuyerInput(input, { requireCode: true })
  const existing = db.prepare('SELECT buyer_code FROM buyers WHERE buyer_code = ?').get(payload.Buyer_Code)
  if (existing) {
    throw new Error('Buyer code already exists.')
  }

  db.prepare(`
    INSERT INTO buyers (
      buyer_code,
      buyer_name,
      address_line1,
      address_line2,
      address_line3,
      city_state_pin,
      gstin,
      ship_to_name,
      ship_to_address,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    payload.Buyer_Code,
    payload.Buyer_Name,
    payload.Address_Line1,
    payload.Address_Line2,
    payload.Address_Line3,
    payload.City_State_Pin,
    payload.GSTIN,
    payload.Ship_To_Name,
    payload.Ship_To_Address,
  )

  return mapBuyerRow(db.prepare(`
    SELECT
      buyer_code,
      buyer_name,
      address_line1,
      address_line2,
      address_line3,
      city_state_pin,
      gstin,
      ship_to_name,
      ship_to_address
    FROM buyers
    WHERE buyer_code = ?
  `).get(payload.Buyer_Code))
}

function updateBuyer(buyerCode, input) {
  const existing = db.prepare('SELECT buyer_code FROM buyers WHERE buyer_code = ?').get(buyerCode)
  if (!existing) {
    throw new Error('Buyer was not found.')
  }

  const payload = normalizeBuyerInput({ ...input, Buyer_Code: buyerCode }, { requireCode: false })

  db.prepare(`
    UPDATE buyers
    SET
      buyer_name = ?,
      address_line1 = ?,
      address_line2 = ?,
      address_line3 = ?,
      city_state_pin = ?,
      gstin = ?,
      ship_to_name = ?,
      ship_to_address = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE buyer_code = ?
  `).run(
    payload.Buyer_Name,
    payload.Address_Line1,
    payload.Address_Line2,
    payload.Address_Line3,
    payload.City_State_Pin,
    payload.GSTIN,
    payload.Ship_To_Name,
    payload.Ship_To_Address,
    buyerCode,
  )

  return mapBuyerRow(db.prepare(`
    SELECT
      buyer_code,
      buyer_name,
      address_line1,
      address_line2,
      address_line3,
      city_state_pin,
      gstin,
      ship_to_name,
      ship_to_address
    FROM buyers
    WHERE buyer_code = ?
  `).get(buyerCode))
}

function deleteBuyer(buyerCode) {
  const existing = db.prepare('SELECT buyer_code FROM buyers WHERE buyer_code = ?').get(buyerCode)
  if (!existing) {
    throw new Error('Buyer was not found.')
  }

  const usage = db.prepare('SELECT COUNT(*) AS count FROM invoices WHERE buyer_code = ?').get(buyerCode).count
  if (usage) {
    throw new Error('This buyer is already used in invoice history and cannot be deleted.')
  }

  db.prepare('DELETE FROM buyers WHERE buyer_code = ?').run(buyerCode)
}

function createItem(input) {
  const payload = normalizeItemInput(input, { requireCode: true })
  const existing = db.prepare('SELECT item_code FROM items WHERE item_code = ?').get(payload.Item_Code)
  if (existing) {
    throw new Error('Item code already exists.')
  }

  db.prepare(`
    INSERT INTO items (
      item_code,
      description,
      hsn_code,
      gross_rate,
      non_taxable_rate,
      bottles_per_bag,
      dad_writes_as,
      category,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    payload.Item_Code,
    payload.Description,
    payload.HSN_Code,
    Number(payload.Gross_Rate),
    Number(payload.Non_Taxable_Rate),
    Number(payload.Bottles_Per_Bag),
    payload.Dad_Writes_As,
    payload.Category,
  )

  return mapItemRow(db.prepare(`
    SELECT
      item_code,
      description,
      hsn_code,
      gross_rate,
      non_taxable_rate,
      bottles_per_bag,
      dad_writes_as,
      category
    FROM items
    WHERE item_code = ?
  `).get(payload.Item_Code))
}

function updateItem(itemCode, input) {
  const existing = db.prepare('SELECT item_code FROM items WHERE item_code = ?').get(itemCode)
  if (!existing) {
    throw new Error('Item was not found.')
  }

  const payload = normalizeItemInput({ ...input, Item_Code: itemCode }, { requireCode: false })

  db.prepare(`
    UPDATE items
    SET
      description = ?,
      hsn_code = ?,
      gross_rate = ?,
      non_taxable_rate = ?,
      bottles_per_bag = ?,
      dad_writes_as = ?,
      category = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE item_code = ?
  `).run(
    payload.Description,
    payload.HSN_Code,
    Number(payload.Gross_Rate),
    Number(payload.Non_Taxable_Rate),
    Number(payload.Bottles_Per_Bag),
    payload.Dad_Writes_As,
    payload.Category,
    itemCode,
  )

  return mapItemRow(db.prepare(`
    SELECT
      item_code,
      description,
      hsn_code,
      gross_rate,
      non_taxable_rate,
      bottles_per_bag,
      dad_writes_as,
      category
    FROM items
    WHERE item_code = ?
  `).get(itemCode))
}

function deleteItem(itemCode) {
  const existing = db.prepare('SELECT item_code FROM items WHERE item_code = ?').get(itemCode)
  if (!existing) {
    throw new Error('Item was not found.')
  }

  const usage = db.prepare('SELECT COUNT(*) AS count FROM invoice_lines WHERE item_code = ?').get(itemCode).count
  if (usage) {
    throw new Error('This item is already used in invoice history and cannot be deleted.')
  }

  db.prepare('DELETE FROM items WHERE item_code = ?').run(itemCode)
}

async function buildInvoicePayload(input) {
  await dbReady
  const buyers = await readBuyers()
  const items = await readItems()

  const buyer = buyers.find((entry) => entry.Buyer_Code === input.buyerCode)
  if (!buyer) {
    throw new Error('Selected buyer was not found.')
  }

  const lineItemsInput = Array.isArray(input.lineItems) ? input.lineItems : []
  if (!lineItemsInput.length) {
    throw new Error('At least one invoice item is required.')
  }
  if (lineItemsInput.length > maxLineItems) {
    throw new Error(`This template supports up to ${maxLineItems} item rows per invoice.`)
  }

  const vehicleNumber = String(input.vehicleNumber || '').trim().toUpperCase()
  if (!vehicleNumber) {
    throw new Error('Vehicle number is required.')
  }

  const invoiceDate = input.invoiceDate || new Date().toISOString().slice(0, 10)
  const lines = lineItemsInput.map((line, index) => {
    const item = items.find((entry) => entry.Item_Code === line.itemCode)
    if (!item) {
      throw new Error(`Selected item was not found for line ${index + 1}.`)
    }

    const bags = Number(line.bags)
    if (!Number.isFinite(bags) || bags <= 0) {
      throw new Error(`Bags must be greater than zero for line ${index + 1}.`)
    }

    const bottlesPerBag = Number(item.Bottles_Per_Bag)
    const quantity = bags * bottlesPerBag
    const grossRate = Number(item.Gross_Rate)
    const nonTaxableRate = Number(item.Non_Taxable_Rate)
    const taxableRate = roundCurrency(grossRate - nonTaxableRate)
    const amount = roundCurrency(quantity * grossRate)
    const nonTaxableValue = roundCurrency(quantity * nonTaxableRate)
    const taxableValue = roundCurrency(quantity * taxableRate)

    return {
      item,
      bags,
      bottlesPerBag,
      quantity,
      grossRate,
      amount,
      nonTaxableRate,
      nonTaxableValue,
      taxableRate,
      taxableValue,
    }
  })

  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0)
  const amount = roundCurrency(lines.reduce((sum, line) => sum + line.amount, 0))
  const nonTaxableValue = roundCurrency(lines.reduce((sum, line) => sum + line.nonTaxableValue, 0))
  const taxableValue = roundCurrency(lines.reduce((sum, line) => sum + line.taxableValue, 0))
  const cgst = roundCurrency(taxableValue * 0.09)
  const sgst = roundCurrency(taxableValue * 0.09)
  const taxableAfterGst = roundCurrency(taxableValue + cgst + sgst)
  const total = roundCurrency(nonTaxableValue + taxableAfterGst)

  const invoiceNumber = await nextInvoiceNumber(invoiceDate)
  const invoiceKey = invoiceNumber.replace('/', '-')

  return {
    invoiceNumber,
    invoiceKey,
    invoiceDate,
    vehicleNumber,
    quantity,
    amount,
    nonTaxableValue,
    taxableValue,
    cgst,
    sgst,
    taxableAfterGst,
    total,
    buyer,
    lines,
  }
}

async function nextInvoiceNumber(invoiceDate) {
  await dbReady
  const suffix = deriveFinancialYearSuffix(invoiceDate)

  const reserveNextSerial = withTransaction((financialYear) => {
    const existing = db.prepare('SELECT next_serial FROM invoice_sequences WHERE financial_year = ?').get(financialYear)
    const nextSerial = existing?.next_serial ?? 1

    if (existing) {
      db.prepare('UPDATE invoice_sequences SET next_serial = ? WHERE financial_year = ?').run(nextSerial + 1, financialYear)
    } else {
      db.prepare('INSERT INTO invoice_sequences (financial_year, next_serial) VALUES (?, ?)').run(financialYear, 2)
    }

    return nextSerial
  })

  const nextSerial = reserveNextSerial(suffix)
  return `${String(nextSerial).padStart(3, '0')}/${suffix}`
}

function deriveFinancialYearSuffix(invoiceDate) {
  const source = String(invoiceDate || '').trim()
  const isoMatch = source.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  let year
  let month

  if (isoMatch) {
    const isoYear = Number(isoMatch[1])
    const isoMonth = Number(isoMatch[2])
    const isoDay = Number(isoMatch[3])
    const parsed = new Date(Date.UTC(isoYear, isoMonth - 1, isoDay))

    const isValidIsoDate =
      Number.isFinite(isoYear) &&
      Number.isFinite(isoMonth) &&
      Number.isFinite(isoDay) &&
      parsed.getUTCFullYear() === isoYear &&
      parsed.getUTCMonth() + 1 === isoMonth &&
      parsed.getUTCDate() === isoDay

    if (!isValidIsoDate) {
      throw new Error('Invoice date is invalid.')
    }

    year = isoYear
    month = isoMonth
  } else {
    const parsed = new Date(source)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Invoice date is invalid.')
    }

    year = parsed.getFullYear()
    month = parsed.getMonth() + 1
  }

  const startYear = month >= 4 ? year : year - 1
  return `${startYear}-${String(startYear + 1).slice(-2)}`
}

async function saveInvoiceHistory(invoice) {
  await dbReady

  const persistInvoice = withTransaction((payload) => {
    db.prepare(`
      INSERT OR REPLACE INTO invoices (
        invoice_number,
        invoice_key,
        invoice_date,
        vehicle_number,
        quantity,
        amount,
        non_taxable_value,
        taxable_value,
        cgst,
        sgst,
        taxable_after_gst,
        total,
        buyer_code,
        buyer_name_snapshot,
        buyer_gstin_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.invoiceNumber,
      payload.invoiceKey,
      payload.invoiceDate,
      payload.vehicleNumber,
      payload.quantity,
      payload.amount,
      payload.nonTaxableValue,
      payload.taxableValue,
      payload.cgst,
      payload.sgst,
      payload.taxableAfterGst,
      payload.total,
      payload.buyer.Buyer_Code,
      payload.buyer.Buyer_Name,
      payload.buyer.GSTIN || '',
    )

    db.prepare('DELETE FROM invoice_lines WHERE invoice_number = ?').run(payload.invoiceNumber)

    const insertLine = db.prepare(`
      INSERT INTO invoice_lines (
        invoice_number,
        line_index,
        item_code,
        item_description_snapshot,
        hsn_code_snapshot,
        bags,
        bottles_per_bag,
        quantity,
        gross_rate,
        amount,
        non_taxable_rate,
        non_taxable_value,
        taxable_rate,
        taxable_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    payload.lines.forEach((line, index) => {
      insertLine.run(
        payload.invoiceNumber,
        index + 1,
        line.item.Item_Code,
        line.item.Description,
        line.item.HSN_Code || '',
        line.bags,
        line.bottlesPerBag,
        line.quantity,
        line.grossRate,
        line.amount,
        line.nonTaxableRate,
        line.nonTaxableValue,
        line.taxableRate,
        line.taxableValue,
      )
    })
  })

  persistInvoice(invoice)
}

function withTransaction(callback) {
  return (...args) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = callback(...args)
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

function normalizeBuyerInput(input, options = {}) {
  const buyerCode = String(input.Buyer_Code || '').trim().toUpperCase()
  const buyerName = sanitizeLine(input.Buyer_Name)

  if (options.requireCode && !buyerCode) {
    throw new Error('Buyer code is required.')
  }
  if (!buyerName) {
    throw new Error('Buyer name is required.')
  }

  return {
    Buyer_Code: buyerCode,
    Buyer_Name: buyerName,
    Address_Line1: sanitizeLine(input.Address_Line1),
    Address_Line2: sanitizeLine(input.Address_Line2),
    Address_Line3: sanitizeLine(input.Address_Line3),
    City_State_Pin: sanitizeLine(input.City_State_Pin),
    GSTIN: sanitizeLine(input.GSTIN).toUpperCase(),
    Ship_To_Name: sanitizeLine(input.Ship_To_Name),
    Ship_To_Address: sanitizeLine(input.Ship_To_Address),
  }
}

function normalizeItemInput(input, options = {}) {
  const itemCode = String(input.Item_Code || '').trim().toUpperCase()
  const description = sanitizeLine(input.Description)
  const hsnCode = String(input.HSN_Code || '').trim()
  const grossRate = Number(input.Gross_Rate)
  const nonTaxableRate = Number(input.Non_Taxable_Rate)
  const bottlesPerBag = Number(input.Bottles_Per_Bag)

  if (options.requireCode && !itemCode) {
    throw new Error('Item code is required.')
  }
  if (!description) {
    throw new Error('Item description is required.')
  }
  if (!Number.isFinite(grossRate) || grossRate < 0) {
    throw new Error('Gross rate must be a valid number.')
  }
  if (!Number.isFinite(nonTaxableRate) || nonTaxableRate < 0) {
    throw new Error('Non-taxable rate must be a valid number.')
  }
  if (!Number.isFinite(bottlesPerBag) || bottlesPerBag <= 0) {
    throw new Error('Bottles per bag must be greater than zero.')
  }

  return {
    Item_Code: itemCode,
    Description: description,
    HSN_Code: hsnCode,
    Gross_Rate: roundCurrency(grossRate),
    Non_Taxable_Rate: roundCurrency(nonTaxableRate),
    Bottles_Per_Bag: Math.round(bottlesPerBag),
    Dad_Writes_As: sanitizeLine(input.Dad_Writes_As),
    Category: sanitizeLine(input.Category),
  }
}

function mapBuyerRow(row) {
  return {
    Buyer_Code: row.buyer_code,
    Buyer_Name: row.buyer_name,
    Address_Line1: row.address_line1 || '',
    Address_Line2: row.address_line2 || '',
    Address_Line3: row.address_line3 || '',
    City_State_Pin: row.city_state_pin || '',
    GSTIN: row.gstin || '',
    Ship_To_Name: row.ship_to_name || '',
    Ship_To_Address: row.ship_to_address || '',
  }
}

function mapItemRow(row) {
  return {
    Item_Code: row.item_code,
    Description: row.description,
    HSN_Code: String(row.hsn_code || ''),
    Gross_Rate: Number(row.gross_rate || 0).toFixed(2),
    Non_Taxable_Rate: Number(row.non_taxable_rate || 0).toFixed(2),
    Bottles_Per_Bag: String(row.bottles_per_bag || 0),
    Dad_Writes_As: row.dad_writes_as || '',
    Category: row.category || '',
  }
}

async function generateExcelInvoice(invoice, outputPath) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(templatePath)
  const sheet = workbook.getWorksheet('Temp') || workbook.worksheets[0]

  sheet.getCell('J2').value = invoice.invoiceNumber
  sheet.getCell('J3').value = formatDate(invoice.invoiceDate)
  sheet.getCell('J4').value = invoice.vehicleNumber

  sheet.getCell('A7').value = invoice.buyer.Buyer_Name
  sheet.getCell('A8').value = sanitizeLine(invoice.buyer.Address_Line1)
  sheet.getCell('A9').value = sanitizeLine(invoice.buyer.Address_Line2)
  sheet.getCell('A10').value = [invoice.buyer.Address_Line3, invoice.buyer.City_State_Pin].filter(Boolean).join(', ')
  sheet.getCell('A11').value = `GSTIN: ${invoice.buyer.GSTIN}`

  sheet.getCell('I7').value = invoice.buyer.Ship_To_Name || 'SAME As TO'
  sheet.getCell('I8').value = invoice.buyer.Ship_To_Address || 'SAME As TO'
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
    sheet.getCell(`B${row}`).value = line.item.Description
    sheet.getCell(`C${row}`).value = line.item.HSN_Code
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

function formatDate(dateString) {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('en-GB').format(date)
}

function formatMoney(value) {
  return Number(value).toFixed(2)
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function sanitizeLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function numberToIndianWords(value) {
  const rounded = Math.round(Number(value || 0) * 100) / 100
  const rupees = Math.floor(rounded)
  const paise = Math.round((rounded - rupees) * 100)
  const rupeeWords = `${convertIndianIntegerToWords(rupees)} Rupees`
  if (!paise) {
    return `${rupeeWords} Only`
  }
  return `${rupeeWords} and ${convertIndianIntegerToWords(paise)} Paise Only`
}

function convertIndianIntegerToWords(number) {
  if (number === 0) {
    return 'Zero'
  }

  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ]
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  function belowThousand(n) {
    let result = ''
    if (n >= 100) {
      result += `${ones[Math.floor(n / 100)]} Hundred`
      n %= 100
      if (n) {
        result += ' '
      }
    }
    if (n >= 20) {
      result += tens[Math.floor(n / 10)]
      if (n % 10) {
        result += ` ${ones[n % 10]}`
      }
    } else if (n > 0) {
      result += ones[n]
    }
    return result.trim()
  }

  const parts = []
  const crore = Math.floor(number / 10000000)
  const lakh = Math.floor((number % 10000000) / 100000)
  const thousand = Math.floor((number % 100000) / 1000)
  const remainder = number % 1000

  if (crore) {
    parts.push(`${belowThousand(crore)} Crore`)
  }
  if (lakh) {
    parts.push(`${belowThousand(lakh)} Lakh`)
  }
  if (thousand) {
    parts.push(`${belowThousand(thousand)} Thousand`)
  }
  if (remainder) {
    parts.push(belowThousand(remainder))
  }

  return parts.join(' ').trim()
}

export {
  dbReady,
  readBuyers,
  readItems,
  readInvoiceHistory,
  createBuyer,
  updateBuyer,
  deleteBuyer,
  createItem,
  updateItem,
  deleteItem,
  buildInvoicePayload,
  saveInvoiceHistory,
  generateExcelInvoice,
  generatePdfInvoice,
}
