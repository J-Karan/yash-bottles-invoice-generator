import fs from 'fs/promises'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { parse } from 'csv-parse/sync'
import {
  buyersPath,
  dataDir,
  dbPath,
  generatedExcelDir,
  generatedPdfDir,
  invoiceServiceFee,
  itemsPath,
  maxLineItems,
} from './config.js'
import { getBusinessDateString } from './date-utils.js'
import {
  normalizeInvoiceDate,
  normalizeInvoiceKey,
  normalizeVehicleNumber,
} from './input-validation.js'
import {
  buildInvoiceLines,
  calculateInvoiceTotals,
  deriveFinancialYearSuffix,
} from './invoice-rules.js'
import {
  defaultBuyerShipToOptions,
  defaultEwayAmbiguousBuyerCodes,
  defaultEwayBuyerDistances,
  defaultEwayInvoiceDistances,
} from './seed-data.js'
import { generateExcelInvoice } from './excel-generator.js'
import {
  buildInvoiceFileTargets,
  deleteGeneratedFile,
  deleteInvoiceArtifacts,
  deleteInvoiceArtifactsLegacyFullMonth,
  deleteInvoiceArtifactsLegacyNumericMonth,
  fileExists,
} from './invoice-artifacts.js'
import { generatePdfInvoice } from './pdf-generator.js'
import {
  initRepository,
  resolveShipToSelection,
  resolveShipToOptionIdFromSnapshot,
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
} from './invoice-repository.js'

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
  initRepository(db)
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

  const seedKey = 'operational_defaults_seed_v1'
  const existing = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get(seedKey)
  if (existing) {
    return
  }

  const seedDefaults = withTransaction(() => {
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

// Database operations are imported from './invoice-repository.js'


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

  const vehicleNumber = normalizeVehicleNumber(input.vehicleNumber)
  const invoiceDate = normalizeInvoiceDate(input.invoiceDate || getBusinessDateString())
  const lines = buildInvoiceLines(lineItemsInput, items)
  const totals = calculateInvoiceTotals(lines)

  let invoiceNumber
  let invoiceKey

  if (input.editInvoiceKey) {
    const editInvoiceKey = normalizeInvoiceKey(input.editInvoiceKey)
    const existingInvoice = db.prepare(`
      SELECT invoice_number, invoice_key
      FROM invoices
      WHERE invoice_key = ?
    `).get(editInvoiceKey)

    if (!existingInvoice) {
      throw new Error('Invoice to update was not found.')
    }

    invoiceNumber = existingInvoice.invoice_number
    invoiceKey = existingInvoice.invoice_key
    assertEditedInvoiceDateMatchesInvoiceNumber(invoiceNumber, invoiceDate)
  } else {
    invoiceNumber = await previewNextInvoiceNumber(invoiceDate)
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

async function previewNextInvoiceNumber(invoiceDate) {
  await dbReady
  const suffix = deriveFinancialYearSuffix(invoiceDate)
  const existing = db.prepare('SELECT next_serial FROM invoice_sequences WHERE financial_year = ?').get(suffix)
  const nextSerial = existing?.next_serial ?? 1

  return `${String(nextSerial).padStart(3, '0')}/${suffix}`
}

function reserveInvoiceNumberForNewPayload(payload, existingInvoice) {
  if (existingInvoice) {
    return
  }

  const parsed = parseInvoiceNumber(payload.invoiceNumber)
  if (!parsed?.financialYear) {
    throw new Error(`Unable to determine financial year for invoice ${payload.invoiceNumber}.`)
  }

  const dateFinancialYear = deriveFinancialYearSuffix(payload.invoiceDate)
  if (dateFinancialYear !== parsed.financialYear) {
    throw new Error(`Invoice ${payload.invoiceNumber} does not match invoice date financial year ${dateFinancialYear}.`)
  }

  const existingSequence = db.prepare('SELECT next_serial FROM invoice_sequences WHERE financial_year = ?').get(parsed.financialYear)
  const nextSerial = existingSequence?.next_serial ?? 1
  if (parsed.serial !== nextSerial) {
    throw new Error(
      `Invoice number ${payload.invoiceNumber} is no longer available. ` +
        `Refresh and generate again to use ${String(nextSerial).padStart(3, '0')}/${parsed.financialYear}.`,
    )
  }

  if (existingSequence) {
    db.prepare('UPDATE invoice_sequences SET next_serial = ? WHERE financial_year = ?').run(nextSerial + 1, parsed.financialYear)
  } else {
    db.prepare('INSERT INTO invoice_sequences (financial_year, next_serial) VALUES (?, ?)').run(parsed.financialYear, 2)
  }
}

function assertEditedInvoiceDateMatchesInvoiceNumber(invoiceNumber, invoiceDate) {
  const parsed = parseInvoiceNumber(invoiceNumber)
  if (!parsed?.financialYear) {
    throw new Error(`Unable to determine financial year for invoice ${invoiceNumber}.`)
  }

  const dateFinancialYear = deriveFinancialYearSuffix(invoiceDate)
  if (dateFinancialYear !== parsed.financialYear) {
    throw new Error(
      `Invoice ${invoiceNumber} belongs to financial year ${parsed.financialYear}. ` +
        `Choose a date within ${parsed.financialYear}, or create a new invoice for ${dateFinancialYear}.`,
    )
  }
}

async function saveInvoiceHistory(invoice) {
  await dbReady

  const persistInvoice = withTransaction((payload) => {
    const existingInvoice = db.prepare(`
      SELECT invoice_key, is_paid, paid_at, paid_amount, payment_batch_note, created_at
      FROM invoices
      WHERE invoice_number = ?
    `).get(payload.invoiceNumber)
    reserveInvoiceNumberForNewPayload(payload, existingInvoice)

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
      existingInvoice?.is_paid ?? 0,
      existingInvoice?.paid_at || '',
      existingInvoice?.paid_amount ?? 0,
      existingInvoice?.payment_batch_note || '',
      existingInvoice?.created_at || new Date().toISOString(),
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
  return invoice
}

async function generateAndSaveInvoice(input) {
  const invoicePayload = await buildInvoicePayload(input)
  const fileTargets = buildInvoiceFileTargets(invoicePayload.invoiceDate, invoicePayload.invoiceKey)
  const temporaryTargets = buildTemporaryInvoiceFileTargets(fileTargets)

  try {
    await Promise.all([
      fs.mkdir(fileTargets.excel.directoryPath, { recursive: true }),
      fs.mkdir(fileTargets.pdf.directoryPath, { recursive: true }),
    ])

    await generateExcelInvoice(invoicePayload, temporaryTargets.excel)
    await generatePdfInvoice(invoicePayload, temporaryTargets.pdf)
    await saveInvoiceHistory(invoicePayload)

    await Promise.all([
      fs.rename(temporaryTargets.excel, fileTargets.excel.absolutePath),
      fs.rename(temporaryTargets.pdf, fileTargets.pdf.absolutePath),
    ])
  } catch (error) {
    await Promise.all([
      removeTemporaryFile(temporaryTargets.excel),
      removeTemporaryFile(temporaryTargets.pdf),
    ])
    throw error
  }

  return {
    invoice: invoicePayload,
    files: {
      excel: `/downloads/excel/${fileTargets.excel.relativeUrlPath}`,
      pdf: `/downloads/pdf/${fileTargets.pdf.relativeUrlPath}`,
    },
  }
}

function buildTemporaryInvoiceFileTargets(fileTargets) {
  const suffix = `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    excel: path.join(fileTargets.excel.directoryPath, `${fileTargets.excel.filename}${suffix}`),
    pdf: path.join(fileTargets.pdf.directoryPath, `${fileTargets.pdf.filename}${suffix}`),
  }
}

async function removeTemporaryFile(filePath) {
  try {
    await fs.unlink(filePath)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

// Ship-to resolving options are imported from './invoice-repository.js'


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

// Mappers and normalizers are imported from './invoice-repository.js'



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
  generateAndSaveInvoice,
  saveInvoiceHistory,
  generateExcelInvoice,
  generatePdfInvoice,
  buildInvoiceFileTargets,
}
