import { sanitizeLine } from './invoice-formatting.js'
import { roundCurrency } from './invoice-rules.js'
import { safeEqual } from './secret-utils.js'
import { invoiceServiceFee, paymentPassword } from './config.js'
import { deleteInvoiceArtifacts } from './invoice-artifacts.js'
import {
  normalizeCodeField,
  normalizeGstin,
  normalizeHsnCode,
  normalizeInvoiceKey,
  normalizeNonNegativeAmount,
  normalizePositiveInteger,
  normalizeTextField,
} from './input-validation.js'

let db

function initRepository(database) {
  db = database
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

function normalizeBuyerInput(input, options = {}) {
  return {
    Buyer_Code: normalizeCodeField(input.Buyer_Code, 'Buyer code', { required: options.requireCode }),
    Buyer_Name: normalizeTextField(input.Buyer_Name, 'Buyer name', { required: true, maxLength: 120 }),
    Address_Line1: normalizeTextField(input.Address_Line1, 'Address line 1', { maxLength: 160 }),
    Address_Line2: normalizeTextField(input.Address_Line2, 'Address line 2', { maxLength: 160 }),
    Address_Line3: normalizeTextField(input.Address_Line3, 'Address line 3', { maxLength: 160 }),
    City_State_Pin: normalizeTextField(input.City_State_Pin, 'City/state/pin', { maxLength: 160 }),
    GSTIN: normalizeGstin(input.GSTIN),
    Ship_To_Name: normalizeTextField(input.Ship_To_Name, 'Ship-to name', { maxLength: 120 }),
    Ship_To_Address: normalizeTextField(input.Ship_To_Address, 'Ship-to address', { maxLength: 260 }),
  }
}

function normalizeItemInput(input, options = {}) {
  const itemCode = normalizeCodeField(input.Item_Code, 'Item code', { required: options.requireCode })
  const description = normalizeTextField(input.Description, 'Item description', { required: true, maxLength: 120 })
  const hsnCode = normalizeHsnCode(input.HSN_Code)
  const grossRate = normalizeNonNegativeAmount(input.Gross_Rate, 'Gross rate')
  const nonTaxableRate = normalizeNonNegativeAmount(input.Non_Taxable_Rate, 'Non-taxable rate')
  const bottlesPerBag = normalizePositiveInteger(input.Bottles_Per_Bag, 'Bottles per bag')

  if (nonTaxableRate > grossRate) {
    throw new Error('Non-taxable rate cannot be greater than gross rate.')
  }

  return {
    Item_Code: itemCode,
    Description: description,
    HSN_Code: hsnCode,
    Gross_Rate: roundCurrency(grossRate),
    Non_Taxable_Rate: roundCurrency(nonTaxableRate),
    Bottles_Per_Bag: bottlesPerBag,
    Dad_Writes_As: normalizeTextField(input.Dad_Writes_As, 'Alternate item names', { maxLength: 200 }),
    Category: normalizeTextField(input.Category, 'Category', { maxLength: 80 }),
  }
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
  const key = normalizeInvoiceKey(invoiceKey)

  const invoice = db.prepare(`
    SELECT
      invoice_number,
      invoice_key,
      invoice_date,
      vehicle_number,
      buyer_code,
      ship_to_name_snapshot,
      ship_to_address_snapshot,
      quantity,
      amount,
      non_taxable_value,
      taxable_value,
      cgst,
      sgst,
      total
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

  const savedLines = lines.map((line) => {
    let bags = Number(line.bags || 0)
    let bottlesPerBag = Number(line.bottles_per_bag || 0)
    let description = line.item_description_snapshot || ''

    if (bags === 0 || bottlesPerBag === 0) {
      const match = description.match(/\s*(?:Bags\s+)?(\d+)\s*[\*x]\s*(\d+)/i)
      if (match) {
        bags = Number(match[1])
        bottlesPerBag = Number(match[2])
        description = description.replace(match[0], '').trim()
      }
    }

    return {
      id: `saved-line-${line.item_code}`,
      itemCode: line.item_code,
      bags: bags,
      bottlesPerBag: bottlesPerBag,
      quantity: Number(line.quantity || (bags * bottlesPerBag)),
      grossRate: Number(line.gross_rate || 0),
      amount: Number(line.amount || 0),
      nonTaxableRate: Number(line.non_taxable_rate || 0),
      nonTaxableValue: Number(line.non_taxable_value || 0),
      taxableRate: Number(line.taxable_rate || 0),
      taxableValue: Number(line.taxable_value || 0),
      selectedItem: {
        Item_Code: line.item_code,
        Description: description,
        HSN_Code: line.hsn_code_snapshot || '',
        Gross_Rate: String(line.gross_rate || 0),
        Non_Taxable_Rate: String(line.non_taxable_rate || 0),
        Bottles_Per_Bag: String(bottlesPerBag),
      }
    }
  })

  const savedTotals = {
    quantity: Number(invoice.quantity || 0),
    taxableValue: Number(invoice.taxable_value || 0),
    nonTaxableValue: Number(invoice.non_taxable_value || 0),
    cgst: Number(invoice.cgst || 0),
    sgst: Number(invoice.sgst || 0),
    total: Number(invoice.total || 0),
  }

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
    lineItems: lines.map((line) => {
      let bags = Number(line.bags || 0)
      if (bags === 0) {
        const match = (line.item_description_snapshot || '').match(/\s*(?:Bags\s+)?(\d+)\s*[\*x]\s*(\d+)/i)
        if (match) {
          bags = Number(match[1])
        }
      }
      return {
        itemCode: line.item_code,
        bags: String(bags),
      }
    }),
    savedLines,
    savedTotals,
  }
}

async function deleteInvoiceHistory(invoiceKey) {
  const key = normalizeInvoiceKey(invoiceKey)

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

export {
  initRepository,
  resolveShipToSelection,
  buildShipToOptions,
  defaultShipToOptionId,
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
}
