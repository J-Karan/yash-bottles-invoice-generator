import ExcelJS from 'exceljs'
import fs from 'fs/promises'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { parse } from 'csv-parse/sync'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import {
  buyersPath,
  dataDir,
  dbPath,
  generatedExcelDir,
  generatedPdfDir,
  invoiceServiceFee,
  itemsPath,
  maxLineItems,
  paymentPassword,
  templatePath,
} from './config.js'
import {
  buildInvoiceLines,
  calculateInvoiceTotals,
  deriveFinancialYearSuffix,
  roundCurrency,
} from './invoice-rules.js'
import {
  defaultBuyerShipToOptions,
  defaultEwayAmbiguousBuyerCodes,
  defaultEwayBuyerDistances,
  defaultEwayInvoiceDistances,
} from './seed-data.js'
import { safeEqual } from './secret-utils.js'
import { generateExcelInvoice } from './excel-generator.js'
import {
  buildInvoiceFileTargets,
  deleteGeneratedFile,
  deleteInvoiceArtifacts,
  deleteInvoiceArtifactsLegacyFullMonth,
  deleteInvoiceArtifactsLegacyNumericMonth,
  fileExists,
} from './invoice-artifacts.js'
import { formatMoney, sanitizeLine } from './invoice-formatting.js'
import { generatePdfInvoice } from './pdf-generator.js'

let db
const dbReady = initializeDatabase()
const baselinePaidAt = '2026-03-28T00:00:00+05:30'

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
    PRAGMA busy_timeout = 5000;

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
      ship_to_name_snapshot TEXT DEFAULT '',
      ship_to_address_snapshot TEXT DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS buyer_ship_to_options (
      buyer_code TEXT NOT NULL,
      option_id TEXT NOT NULL,
      label TEXT NOT NULL,
      ship_to_name TEXT NOT NULL,
      ship_to_address TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (buyer_code, option_id),
      FOREIGN KEY (buyer_code) REFERENCES buyers(buyer_code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS eway_invoice_distances (
      invoice_key TEXT PRIMARY KEY,
      distance_km INTEGER NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS eway_buyer_distances (
      buyer_code TEXT PRIMARY KEY,
      distance_km INTEGER NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS eway_ambiguous_buyer_distances (
      buyer_code TEXT PRIMARY KEY,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)

  migrateInvoicePaymentTracking()
  await seedDatabaseFromCsv()
  seedOperationalDefaults()
  await normalizeInvoiceNumberingByFinancialYear()
  await normalizeGeneratedFileLayout()
  await normalizeGeneratedFileLayoutFullMonth()
  await normalizeGeneratedFileLayoutNumberedMonth()
}

function migrateInvoicePaymentTracking() {
  addInvoiceColumnIfMissing('is_paid', 'INTEGER NOT NULL DEFAULT 0')
  addInvoiceColumnIfMissing('paid_at', "TEXT DEFAULT ''")
  addInvoiceColumnIfMissing('paid_amount', 'REAL NOT NULL DEFAULT 0')
  addInvoiceColumnIfMissing('payment_batch_note', "TEXT DEFAULT ''")
  addInvoiceColumnIfMissing('ship_to_name_snapshot', "TEXT DEFAULT ''")
  addInvoiceColumnIfMissing('ship_to_address_snapshot', "TEXT DEFAULT ''")
  seedPaymentTrackingBaseline()
  normalizeBaselinePaymentDate()
}

function addInvoiceColumnIfMissing(columnName, columnDefinition) {
  const columns = db.prepare('PRAGMA table_info(invoices)').all()
  const exists = columns.some((column) => column.name === columnName)
  if (!exists) {
    db.exec(`ALTER TABLE invoices ADD COLUMN ${columnName} ${columnDefinition}`)
  }
}

function seedPaymentTrackingBaseline() {
  const seedKey = 'payment_tracking_seed_v1'
  const existing = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get(seedKey)
  if (existing) {
    return
  }

  const invoices = db.prepare(`
    SELECT invoice_number
    FROM invoices
    ORDER BY created_at DESC, invoice_number DESC
  `).all()

  const unpaidNumbers = new Set(invoices.slice(0, 5).map((invoice) => invoice.invoice_number))
  const markInvoice = db.prepare(`
    UPDATE invoices
    SET
      is_paid = ?,
      paid_at = ?,
      paid_amount = ?,
      payment_batch_note = ?
    WHERE invoice_number = ?
  `)

  const seedBaseline = withTransaction(() => {
    invoices.forEach((invoice) => {
      const isUnpaid = unpaidNumbers.has(invoice.invoice_number)
      markInvoice.run(
        isUnpaid ? 0 : 1,
        isUnpaid ? '' : baselinePaidAt,
        isUnpaid ? 0 : invoiceServiceFee,
        isUnpaid ? 'Generated after payment counter reset.' : 'Paid before payment counter reset.',
        invoice.invoice_number,
      )
    })

    db.prepare(`
      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(seedKey, 'latest_5_unpaid')
  })

  seedBaseline()
}

function normalizeBaselinePaymentDate() {
  const migrationKey = 'payment_tracking_baseline_date_v1'
  const applyMigration = withTransaction(() => {
    const existing = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get(migrationKey)
    if (existing) {
      return
    }

    db.prepare(`
      UPDATE invoices
      SET paid_at = ?
      WHERE
        is_paid = 1
        AND payment_batch_note = 'Paid before payment counter reset.'
        AND paid_at != ?
    `).run(baselinePaidAt, baselinePaidAt)

    db.prepare(`
      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(migrationKey, baselinePaidAt)
  })

  applyMigration()
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

function seedOperationalDefaults() {
  const seedKey = 'operational_defaults_seed_v1'
  const existing = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get(seedKey)
  if (existing) {
    return
  }

  const seedDefaults = withTransaction(() => {
    const insertShipTo = db.prepare(`
      INSERT OR IGNORE INTO buyer_ship_to_options (
        buyer_code,
        option_id,
        label,
        ship_to_name,
        ship_to_address
      ) VALUES (?, ?, ?, ?, ?)
    `)

    defaultBuyerShipToOptions.forEach((option) => {
      insertShipTo.run(
        option.buyerCode,
        option.optionId,
        option.label,
        option.shipToName,
        option.shipToAddress,
      )
    })

    const insertInvoiceDistance = db.prepare(`
      INSERT OR IGNORE INTO eway_invoice_distances (invoice_key, distance_km)
      VALUES (?, ?)
    `)
    defaultEwayInvoiceDistances.forEach(([invoiceKey, distanceKm]) => {
      insertInvoiceDistance.run(invoiceKey, distanceKm)
    })

    const insertBuyerDistance = db.prepare(`
      INSERT OR IGNORE INTO eway_buyer_distances (buyer_code, distance_km)
      VALUES (?, ?)
    `)
    defaultEwayBuyerDistances.forEach(([buyerCode, distanceKm]) => {
      insertBuyerDistance.run(buyerCode, distanceKm)
    })

    const insertAmbiguousBuyer = db.prepare(`
      INSERT OR IGNORE INTO eway_ambiguous_buyer_distances (buyer_code)
      VALUES (?)
    `)
    defaultEwayAmbiguousBuyerCodes.forEach((buyerCode) => {
      insertAmbiguousBuyer.run(buyerCode)
    })

    db.prepare(`
      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(seedKey, 'seeded')
  })

  seedDefaults()
}

async function normalizeInvoiceNumberingByFinancialYear() {
  const migrationKey = 'invoice_financial_year_resequence_v1'
  const existing = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get(migrationKey)
  if (existing) {
    return
  }

  const invoiceRows = db.prepare(`
    SELECT invoice_number, invoice_key, invoice_date, created_at
    FROM invoices
    ORDER BY invoice_date ASC, created_at ASC, invoice_number ASC
  `).all()

  const serialByFinancialYear = new Map()
  const renamePlan = []

  invoiceRows.forEach((row, index) => {
    const financialYear = resolveInvoiceFinancialYear(row)
    const nextSerial = (serialByFinancialYear.get(financialYear) || 0) + 1
    serialByFinancialYear.set(financialYear, nextSerial)

    const newInvoiceNumber = `${String(nextSerial).padStart(3, '0')}/${financialYear}`
    const newInvoiceKey = newInvoiceNumber.replace('/', '-')
    if (newInvoiceNumber === row.invoice_number && newInvoiceKey === row.invoice_key) {
      return
    }

    renamePlan.push({
      oldInvoiceNumber: row.invoice_number,
      oldInvoiceKey: row.invoice_key,
      oldInvoiceDate: row.invoice_date,
      newInvoiceNumber,
      newInvoiceKey,
      tempInvoiceNumber: `TMP-${index + 1}-${Date.now()}`,
      tempInvoiceKey: `tmp-${index + 1}-${Date.now()}`,
    })
  })

  const applyMigration = withTransaction((changes) => {
    changes.forEach((change) => {
      db.prepare('UPDATE invoice_lines SET invoice_number = ? WHERE invoice_number = ?')
        .run(change.tempInvoiceNumber, change.oldInvoiceNumber)
      db.prepare('UPDATE invoices SET invoice_number = ?, invoice_key = ? WHERE invoice_number = ?')
        .run(change.tempInvoiceNumber, change.tempInvoiceKey, change.oldInvoiceNumber)
      db.prepare('UPDATE eway_invoice_distances SET invoice_key = ?, updated_at = CURRENT_TIMESTAMP WHERE invoice_key = ?')
        .run(change.tempInvoiceKey, change.oldInvoiceKey)
    })

    changes.forEach((change) => {
      db.prepare('UPDATE invoice_lines SET invoice_number = ? WHERE invoice_number = ?')
        .run(change.newInvoiceNumber, change.tempInvoiceNumber)
      db.prepare('UPDATE invoices SET invoice_number = ?, invoice_key = ? WHERE invoice_number = ?')
        .run(change.newInvoiceNumber, change.newInvoiceKey, change.tempInvoiceNumber)
      db.prepare('DELETE FROM eway_invoice_distances WHERE invoice_key = ?').run(change.newInvoiceKey)
      db.prepare('UPDATE eway_invoice_distances SET invoice_key = ?, updated_at = CURRENT_TIMESTAMP WHERE invoice_key = ?')
        .run(change.newInvoiceKey, change.tempInvoiceKey)
    })

    rebuildInvoiceSequences()
    db.prepare(`
      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(migrationKey, String(changes.length))
  })

  db.exec('PRAGMA foreign_keys = OFF')
  try {
    applyMigration(renamePlan)
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }

  for (const change of renamePlan) {
    await regenerateInvoiceArtifacts(change.newInvoiceNumber, change.newInvoiceKey)
    await deleteInvoiceArtifacts(change.oldInvoiceDate, change.oldInvoiceKey)
  }
}

async function normalizeGeneratedFileLayout() {
  const migrationKey = 'invoice_generated_file_layout_v1'
  const existing = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get(migrationKey)
  if (existing) {
    return
  }

  const invoices = db.prepare(`
    SELECT invoice_number, invoice_key, invoice_date
    FROM invoices
    ORDER BY invoice_date ASC, created_at ASC, invoice_number ASC
  `).all()

  let regeneratedCount = 0

  for (const invoice of invoices) {
    const targets = buildInvoiceFileTargets(invoice.invoice_date, invoice.invoice_key)
    const [excelExists, pdfExists] = await Promise.all([
      fileExists(targets.excel.absolutePath),
      fileExists(targets.pdf.absolutePath),
    ])

    if (!excelExists || !pdfExists) {
      await regenerateInvoiceArtifacts(invoice.invoice_number, invoice.invoice_key)
      regeneratedCount += 1
    }

    await Promise.all([
      deleteGeneratedFile(generatedExcelDir, `${invoice.invoice_key}.xlsx`),
      deleteGeneratedFile(generatedPdfDir, `${invoice.invoice_key}.pdf`),
    ])
  }

  db.prepare(`
    INSERT INTO app_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(migrationKey, String(regeneratedCount))
}

async function normalizeGeneratedFileLayoutFullMonth() {
  const migrationKey = 'invoice_generated_file_layout_v3_full_month_cleanup'
  const existing = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get(migrationKey)
  if (existing) {
    return
  }

  const invoices = db.prepare(`
    SELECT invoice_number, invoice_key, invoice_date
    FROM invoices
    ORDER BY invoice_date ASC, created_at ASC, invoice_number ASC
  `).all()

  let regeneratedCount = 0
  for (const invoice of invoices) {
    const targets = buildInvoiceFileTargets(invoice.invoice_date, invoice.invoice_key)
    const [excelExists, pdfExists] = await Promise.all([
      fileExists(targets.excel.absolutePath),
      fileExists(targets.pdf.absolutePath),
    ])

    if (!excelExists || !pdfExists) {
      await regenerateInvoiceArtifacts(invoice.invoice_number, invoice.invoice_key)
      regeneratedCount += 1
    }

    await deleteInvoiceArtifactsLegacyNumericMonth(invoice.invoice_date, invoice.invoice_key)
  }

  await Promise.all([
    removeLegacyNumericMonthDirectories(generatedExcelDir),
    removeLegacyNumericMonthDirectories(generatedPdfDir),
  ])

  db.prepare(`
    INSERT INTO app_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(migrationKey, String(regeneratedCount))
}

async function normalizeGeneratedFileLayoutNumberedMonth() {
  const migrationKey = 'invoice_generated_file_layout_v4_numbered_month'
  const existing = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get(migrationKey)
  if (existing) {
    return
  }

  const invoices = db.prepare(`
    SELECT invoice_number, invoice_key, invoice_date
    FROM invoices
    ORDER BY invoice_date ASC, created_at ASC, invoice_number ASC
  `).all()

  let regeneratedCount = 0
  for (const invoice of invoices) {
    const targets = buildInvoiceFileTargets(invoice.invoice_date, invoice.invoice_key)
    const [excelExists, pdfExists] = await Promise.all([
      fileExists(targets.excel.absolutePath),
      fileExists(targets.pdf.absolutePath),
    ])

    if (!excelExists || !pdfExists) {
      await regenerateInvoiceArtifacts(invoice.invoice_number, invoice.invoice_key)
      regeneratedCount += 1
    }

    await deleteInvoiceArtifactsLegacyFullMonth(invoice.invoice_date, invoice.invoice_key)
  }

  await Promise.all([
    removeLegacyFullMonthDirectories(generatedExcelDir),
    removeLegacyFullMonthDirectories(generatedPdfDir),
  ])

  db.prepare(`
    INSERT INTO app_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(migrationKey, String(regeneratedCount))
}

async function removeLegacyNumericMonthDirectories(baseDir) {
  const years = await fs.readdir(baseDir, { withFileTypes: true })
  for (const yearEntry of years) {
    if (!yearEntry.isDirectory()) {
      continue
    }

    const yearPath = path.join(baseDir, yearEntry.name)
    const months = await fs.readdir(yearPath, { withFileTypes: true })
    for (const monthEntry of months) {
      if (!monthEntry.isDirectory()) {
        continue
      }
      if (!/^\d{4}-\d{2}$/.test(monthEntry.name)) {
        continue
      }

      await fs.rm(path.join(yearPath, monthEntry.name), { recursive: true, force: true })
    }
  }
}

async function removeLegacyFullMonthDirectories(baseDir) {
  const years = await fs.readdir(baseDir, { withFileTypes: true })
  for (const yearEntry of years) {
    if (!yearEntry.isDirectory()) {
      continue
    }

    const yearPath = path.join(baseDir, yearEntry.name)
    const months = await fs.readdir(yearPath, { withFileTypes: true })
    for (const monthEntry of months) {
      if (!monthEntry.isDirectory()) {
        continue
      }
      if (!/^[A-Za-z]+$/.test(monthEntry.name)) {
        continue
      }

      await fs.rm(path.join(yearPath, monthEntry.name), { recursive: true, force: true })
    }
  }
}

function resolveInvoiceFinancialYear(row) {
  const invoiceDate = String(row.invoice_date || '').trim()
  if (invoiceDate) {
    try {
      return deriveFinancialYearSuffix(invoiceDate)
    } catch {
      // Fall through to invoice number parsing for legacy rows.
    }
  }

  const parsed = parseInvoiceNumber(row.invoice_number)
  if (parsed?.financialYear) {
    return parsed.financialYear
  }

  throw new Error(`Unable to determine financial year for invoice ${row.invoice_number}.`)
}

function rebuildInvoiceSequences() {
  const sequenceByYear = new Map()
  const invoices = db.prepare('SELECT invoice_number FROM invoices').all()

  invoices.forEach((invoice) => {
    const parsed = parseInvoiceNumber(invoice.invoice_number)
    if (!parsed) {
      return
    }
    const current = sequenceByYear.get(parsed.financialYear) || 0
    sequenceByYear.set(parsed.financialYear, Math.max(current, parsed.serial))
  })

  db.prepare('DELETE FROM invoice_sequences').run()
  const insertSequence = db.prepare(`
    INSERT INTO invoice_sequences (financial_year, next_serial)
    VALUES (?, ?)
  `)
  for (const [financialYear, maxSerial] of [...sequenceByYear.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    insertSequence.run(financialYear, maxSerial + 1)
  }
}

function buildInvoiceArtifactPayload(invoiceNumber) {
  const invoice = db.prepare(`
    SELECT
      i.invoice_number,
      i.invoice_key,
      i.invoice_date,
      i.vehicle_number,
      i.quantity,
      i.amount,
      i.non_taxable_value,
      i.taxable_value,
      i.cgst,
      i.sgst,
      i.taxable_after_gst,
      i.total,
      i.buyer_code,
      i.buyer_name_snapshot,
      i.buyer_gstin_snapshot,
      i.ship_to_name_snapshot,
      i.ship_to_address_snapshot,
      b.address_line1,
      b.address_line2,
      b.address_line3,
      b.city_state_pin
    FROM invoices i
    LEFT JOIN buyers b ON b.buyer_code = i.buyer_code
    WHERE i.invoice_number = ?
  `).get(invoiceNumber)

  if (!invoice) {
    throw new Error(`Invoice was not found for artifact regeneration: ${invoiceNumber}`)
  }

  const lines = db.prepare(`
    SELECT
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
    FROM invoice_lines
    WHERE invoice_number = ?
    ORDER BY line_index ASC, id ASC
  `).all(invoiceNumber)

  return {
    invoiceNumber: invoice.invoice_number,
    invoiceKey: invoice.invoice_key,
    invoiceDate: invoice.invoice_date,
    vehicleNumber: invoice.vehicle_number,
    quantity: Number(invoice.quantity || 0),
    amount: Number(invoice.amount || 0),
    nonTaxableValue: Number(invoice.non_taxable_value || 0),
    taxableValue: Number(invoice.taxable_value || 0),
    cgst: Number(invoice.cgst || 0),
    sgst: Number(invoice.sgst || 0),
    taxableAfterGst: Number(invoice.taxable_after_gst || 0),
    total: Number(invoice.total || 0),
    buyer: {
      Buyer_Code: invoice.buyer_code,
      Buyer_Name: invoice.buyer_name_snapshot,
      Address_Line1: invoice.address_line1 || '',
      Address_Line2: invoice.address_line2 || '',
      Address_Line3: invoice.address_line3 || '',
      City_State_Pin: invoice.city_state_pin || '',
      GSTIN: invoice.buyer_gstin_snapshot || '',
      Ship_To_Name: invoice.ship_to_name_snapshot || '',
      Ship_To_Address: invoice.ship_to_address_snapshot || '',
    },
    lines: lines.map((line) => ({
      item: {
        Item_Code: line.item_code,
        Description: line.item_description_snapshot,
        HSN_Code: line.hsn_code_snapshot || '',
      },
      bags: Number(line.bags || 0),
      bottlesPerBag: Number(line.bottles_per_bag || 0),
      quantity: Number(line.quantity || 0),
      grossRate: Number(line.gross_rate || 0),
      amount: Number(line.amount || 0),
      nonTaxableRate: Number(line.non_taxable_rate || 0),
      nonTaxableValue: Number(line.non_taxable_value || 0),
      taxableRate: Number(line.taxable_rate || 0),
      taxableValue: Number(line.taxable_value || 0),
    })),
  }
}

async function regenerateInvoiceArtifacts(invoiceNumber, invoiceKey) {
  const invoice = buildInvoiceArtifactPayload(invoiceNumber)
  const targets = buildInvoiceFileTargets(invoice.invoiceDate, invoiceKey)

  await Promise.all([
    fs.mkdir(targets.excel.directoryPath, { recursive: true }),
    fs.mkdir(targets.pdf.directoryPath, { recursive: true }),
  ])
  await generateExcelInvoice(invoice, targets.excel.absolutePath)
  await generatePdfInvoice(invoice, targets.pdf.absolutePath)
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
      i.ship_to_name_snapshot,
      i.ship_to_address_snapshot,
      i.created_at,
      i.is_paid,
      i.paid_at,
      i.paid_amount,
      i.payment_batch_note,
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
    shipToName: row.ship_to_name_snapshot || '',
    shipToAddress: row.ship_to_address_snapshot || '',
    createdAt: row.created_at,
    isPaid: Boolean(row.is_paid),
    paidAt: row.paid_at || '',
    paidAmount: Number(row.paid_amount || 0),
    paymentBatchNote: row.payment_batch_note || '',
    lineCount: Number(row.line_count || 0),
  }))
}

async function readInvoiceDraft(invoiceKey) {
  await dbReady

  const key = String(invoiceKey || '').trim()
  if (!key) {
    const error = new Error('Invoice key is required.')
    error.statusCode = 400
    throw error
  }

  const invoice = db.prepare(`
    SELECT
      invoice_number,
      invoice_key,
      invoice_date,
      vehicle_number,
      buyer_code,
      ship_to_name_snapshot,
      ship_to_address_snapshot
    FROM invoices
    WHERE invoice_key = ?
  `).get(key)

  if (!invoice) {
    const error = new Error('Invoice was not found.')
    error.statusCode = 404
    throw error
  }

  const lines = db.prepare(`
    SELECT
      item_code,
      bags
    FROM invoice_lines
    WHERE invoice_number = ?
    ORDER BY line_index ASC, id ASC
  `).all(invoice.invoice_number)

  const buyer = mapBuyerRow(db.prepare(`
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
  `).get(invoice.buyer_code))

  return {
    invoiceNumber: invoice.invoice_number,
    invoiceKey: invoice.invoice_key,
    invoiceDate: invoice.invoice_date,
    buyerCode: invoice.buyer_code,
    shipToOptionId: resolveShipToOptionIdFromSnapshot(
      buyer,
      invoice.ship_to_name_snapshot,
      invoice.ship_to_address_snapshot,
    ),
    vehicleNumber: invoice.vehicle_number,
    lineItems: lines.map((line) => ({
      itemCode: line.item_code,
      bags: String(line.bags || 0),
    })),
  }
}

async function deleteInvoiceHistory(invoiceKey) {
  await dbReady

  const key = String(invoiceKey || '').trim()
  if (!key) {
    const error = new Error('Invoice key is required.')
    error.statusCode = 400
    throw error
  }

  const invoice = db.prepare(`
    SELECT invoice_number, invoice_key, invoice_date
    FROM invoices
    WHERE invoice_key = ?
  `).get(key)

  if (!invoice) {
    const error = new Error('Invoice was not found.')
    error.statusCode = 404
    throw error
  }

  const parsed = parseInvoiceNumber(invoice.invoice_number)
  if (!parsed) {
    const error = new Error('Invoice number format is invalid.')
    error.statusCode = 400
    throw error
  }

  const latestSerialRow = db.prepare(`
    SELECT MAX(CAST(substr(invoice_number, 1, instr(invoice_number, '/') - 1) AS INTEGER)) AS latest_serial
    FROM invoices
    WHERE invoice_number LIKE '%' || '/' || ?
  `).get(parsed.financialYear)
  const latestSerial = Number(latestSerialRow?.latest_serial || 0)
  if (parsed.serial !== latestSerial) {
    const error = new Error('To keep numbering gapless, you can delete only the latest invoice.')
    error.statusCode = 409
    throw error
  }

  const removeInvoice = withTransaction((payload, invoiceMeta) => {
    db.prepare('DELETE FROM eway_invoice_distances WHERE invoice_key = ?').run(payload.invoice_key)
    db.prepare('DELETE FROM invoices WHERE invoice_number = ?').run(payload.invoice_number)
    db.prepare(`
      UPDATE invoice_sequences
      SET next_serial = ?
      WHERE financial_year = ?
    `).run(invoiceMeta.serial, invoiceMeta.financialYear)
  })
  removeInvoice(invoice, parsed)

  await deleteInvoiceArtifacts(invoice.invoice_date, invoice.invoice_key)

  return { deleted: true, invoiceKey: invoice.invoice_key }
}

async function readPaymentSummary() {
  await dbReady
  return getPaymentSummary()
}

function getPaymentSummary() {
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_count,
      SUM(CASE WHEN is_paid = 0 THEN 1 ELSE 0 END) AS unpaid_count,
      SUM(CASE WHEN is_paid = 1 THEN 1 ELSE 0 END) AS paid_count,
      SUM(CASE WHEN is_paid = 1 THEN paid_amount ELSE 0 END) AS paid_amount_total
    FROM invoices
  `).get()

  const unpaidCount = Number(summary.unpaid_count || 0)

  return {
    totalInvoices: Number(summary.total_count || 0),
    paidInvoices: Number(summary.paid_count || 0),
    unpaidInvoices: unpaidCount,
    invoiceRate: invoiceServiceFee,
    amountDue: unpaidCount * invoiceServiceFee,
    paidAmountTotal: Number(summary.paid_amount_total || 0),
  }
}

async function markUnpaidInvoicesPaid(password) {
  await dbReady

  if (!safeEqual(password, paymentPassword)) {
    const error = new Error('Incorrect payment password.')
    error.statusCode = 401
    throw error
  }

  const unpaid = db.prepare(`
    SELECT invoice_number
    FROM invoices
    WHERE is_paid = 0
    ORDER BY created_at ASC, invoice_number ASC
  `).all()

  if (unpaid.length) {
    const now = new Date().toISOString()
    const markPaid = withTransaction(() => {
      db.prepare(`
        UPDATE invoices
        SET
          is_paid = 1,
          paid_at = ?,
          paid_amount = ?,
          payment_batch_note = ?
        WHERE is_paid = 0
      `).run(now, invoiceServiceFee, 'Marked paid from invoice history.')
    })

    markPaid()
  }

  return {
    markedCount: unpaid.length,
    summary: getPaymentSummary(),
  }
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
  const shipToSelection = resolveShipToSelection(buyer, input.shipToOptionId)

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
  const lines = buildInvoiceLines(lineItemsInput, items)
  const totals = calculateInvoiceTotals(lines)

  let invoiceNumber
  let invoiceKey

  if (input.editInvoiceKey) {
    const existingInvoice = db.prepare(`
      SELECT invoice_number, invoice_key
      FROM invoices
      WHERE invoice_key = ?
    `).get(String(input.editInvoiceKey).trim())

    if (!existingInvoice) {
      throw new Error('Invoice to update was not found.')
    }

    invoiceNumber = existingInvoice.invoice_number
    invoiceKey = existingInvoice.invoice_key
  } else {
    invoiceNumber = await nextInvoiceNumber(invoiceDate)
    invoiceKey = invoiceNumber.replace('/', '-')
  }

  return {
    invoiceNumber,
    invoiceKey,
    invoiceDate,
    vehicleNumber,
    ...totals,
    buyer: {
      ...buyer,
      Ship_To_Name: shipToSelection.shipToName,
      Ship_To_Address: shipToSelection.shipToAddress,
    },
    shipToOptionId: shipToSelection.id,
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

async function saveInvoiceHistory(invoice) {
  await dbReady

  const persistInvoice = withTransaction((payload) => {
    const existingPayment = db.prepare(`
      SELECT is_paid, paid_at, paid_amount, payment_batch_note, created_at
      FROM invoices
      WHERE invoice_number = ?
    `).get(payload.invoiceNumber)

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
        buyer_gstin_snapshot,
        ship_to_name_snapshot,
        ship_to_address_snapshot,
        is_paid,
        paid_at,
        paid_amount,
        payment_batch_note,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      payload.buyer.Ship_To_Name || '',
      payload.buyer.Ship_To_Address || '',
      existingPayment?.is_paid ?? 0,
      existingPayment?.paid_at || '',
      existingPayment?.paid_amount ?? 0,
      existingPayment?.payment_batch_note || '',
      existingPayment?.created_at || new Date().toISOString(),
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

function resolveShipToSelection(buyer, requestedOptionId) {
  const options = buildShipToOptions(buyer)
  const defaultOption = options.find((option) => option.id === defaultShipToOptionId(buyer)) || options[0]
  const selected = options.find((option) => option.id === requestedOptionId) || defaultOption

  return {
    id: selected.id,
    shipToName: selected.shipToName,
    shipToAddress: selected.shipToAddress,
  }
}

function buildShipToOptions(buyer) {
  const options = [
    {
      id: 'bill_to',
      label: 'Bill To (Same as buyer address)',
      shipToName: 'SAME As TO',
      shipToAddress: '',
    },
  ]

  if (hasDistinctMasterShipTo(buyer)) {
    options.push({
      id: 'master_ship_to',
      label: `Master Ship-To: ${sanitizeLine(buyer.Ship_To_Name)}`,
      shipToName: sanitizeLine(buyer.Ship_To_Name),
      shipToAddress: sanitizeLine(buyer.Ship_To_Address),
    })
  }

  const extras = db.prepare(`
    SELECT
      option_id,
      label,
      ship_to_name,
      ship_to_address
    FROM buyer_ship_to_options
    WHERE buyer_code = ?
    ORDER BY option_id COLLATE NOCASE ASC
  `).all(buyer.Buyer_Code)

  extras.forEach((option) => {
    options.push({
      id: option.option_id,
      label: sanitizeLine(option.label) || sanitizeLine(option.ship_to_name),
      shipToName: sanitizeLine(option.ship_to_name),
      shipToAddress: sanitizeLine(option.ship_to_address),
    })
  })

  return options
}

function hasDistinctMasterShipTo(buyer) {
  const shipToName = sanitizeLine(buyer.Ship_To_Name)
  const shipToAddress = sanitizeLine(buyer.Ship_To_Address)
  return (
    !!shipToAddress &&
    !!shipToName &&
    shipToName.toUpperCase() !== 'SAME AS TO' &&
    shipToName.toUpperCase() !== sanitizeLine(buyer.Buyer_Name).toUpperCase()
  )
}

function defaultShipToOptionId(buyer) {
  return hasDistinctMasterShipTo(buyer) ? 'master_ship_to' : 'bill_to'
}

function resolveShipToOptionIdFromSnapshot(buyer, shipToNameSnapshot, shipToAddressSnapshot) {
  const options = buildShipToOptions(buyer)
  const snapshotName = sanitizeLine(shipToNameSnapshot).toUpperCase()
  const snapshotAddress = sanitizeLine(shipToAddressSnapshot).toUpperCase()
  const matched = options.find(
    (option) =>
      sanitizeLine(option.shipToName).toUpperCase() === snapshotName &&
      sanitizeLine(option.shipToAddress).toUpperCase() === snapshotAddress,
  )

  return matched?.id || defaultShipToOptionId(buyer)
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

function parseInvoiceNumber(invoiceNumber) {
  const match = String(invoiceNumber || '').match(/^(\d+)\/(\d{4}-\d{2})$/)
  if (!match) {
    return null
  }

  return {
    serial: Number(match[1]),
    financialYear: match[2],
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
  const buyer = {
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

  return {
    ...buyer,
    Ship_To_Options: buildShipToOptions(buyer),
    Default_Ship_To_Option_Id: defaultShipToOptionId(buyer),
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


export {
  dbReady,
  readBuyers,
  readItems,
  readInvoiceHistory,
  readInvoiceDraft,
  deleteInvoiceHistory,
  readPaymentSummary,
  markUnpaidInvoicesPaid,
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
  buildInvoiceFileTargets,
}
