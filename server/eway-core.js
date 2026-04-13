import { DatabaseSync } from 'node:sqlite'
import { dbPath } from './config.js'

const supplier = {
  gstin: '27BZCPA4008G1ZX',
  name: 'YASH BOTTLES',
  address1: 'Gat No 54/5, Nr Jambhulwadi Lake',
  address2: 'Pune Satara Highway, Jambhulwadi',
  place: 'Pune',
  pincode: 411046,
  stateName: 'MAHARASHTRA',
  stateCode: 27,
}

const invoiceDistanceKm = {
  '086-2025-26': 241,
  '087-2025-26': 246,
  '088-2025-26': 241,
  '089-2025-26': 246,
  '090-2025-26': 241,
  '091-2025-26': 241,
  '092-2025-26': 246,
  '093-2025-26': 246,
  '094-2025-26': 241,
  '095-2025-26': 233,
  '096-2025-26': 241,
  '097-2025-26': 241,
  '098-2025-26': 246,
  '099-2025-26': 241,
  '100-2025-26': 241,
  '101-2025-26': 241,
  '102-2025-26': 246,
  '103-2025-26': 246,
  '104-2025-26': 241,
  '105-2026-27': 246,
  '106-2026-27': 241,
  '107-2026-27': 241,
  '108-2026-27': 241,
}

const buyerDistanceKm = {
  B001: 241,
  B002: 246,
  B003: 241,
  B004: 233,
  B005: 241,
}

const ambiguousBuyerDistanceCodes = new Set()
const stateCodeByGstinPrefix = {
  27: { stateName: 'MAHARASHTRA', stateCode: 27 },
}

function openDb() {
  return new DatabaseSync(dbPath)
}

function readEwayReadiness() {
  const db = openDb()
  try {
    const rows = db.prepare(`
      SELECT
        i.invoice_number,
        i.invoice_key,
        i.invoice_date,
        i.vehicle_number,
        i.total,
        i.buyer_code,
        i.buyer_name_snapshot,
        i.buyer_gstin_snapshot,
        i.ship_to_name_snapshot,
        i.ship_to_address_snapshot,
        b.address_line1,
        b.address_line2,
        b.address_line3,
        b.city_state_pin,
        b.ship_to_name,
        b.ship_to_address,
        COUNT(l.id) AS line_count
      FROM invoices i
      LEFT JOIN buyers b ON b.buyer_code = i.buyer_code
      LEFT JOIN invoice_lines l ON l.invoice_number = i.invoice_number
      GROUP BY i.invoice_number
      ORDER BY i.created_at DESC, i.invoice_number DESC
    `).all()

    const invoices = rows.map((row) => buildReadinessEntry(row))
    const readyCount = invoices.filter((invoice) => invoice.ready).length

    return {
      summary: {
        total: invoices.length,
        ready: readyCount,
        needsInput: invoices.length - readyCount,
      },
      invoices,
    }
  } finally {
    db.close()
  }
}

function buildReadinessEntry(row, overrideDistanceKm) {
  const distance = resolveDistanceKm(row, overrideDistanceKm)
  const destination = deriveDestination(row)
  const missingFields = []
  const warnings = []

  if (!row.invoice_key) missingFields.push('invoice_key')
  if (!row.invoice_date) missingFields.push('invoice_date')
  if (!row.buyer_gstin_snapshot) missingFields.push('buyer_gstin')
  if (!row.vehicle_number || row.vehicle_number === 'UNKNOWN-LEGACY') missingFields.push('vehicle_number')
  if (!distance.distanceKm) missingFields.push('distance_km')
  if (!destination.pincode) missingFields.push('ship_to_pincode')
  if (!destination.place) missingFields.push('ship_to_place')
  if (!row.line_count) missingFields.push('line_items')

  if (distance.source === 'ambiguous-buyer') {
    warnings.push('Buyer has multiple historical distances; enter distance manually.')
  }
  if (destination.source === 'buyer-master-guess') {
    warnings.push('Ship-to place/pincode were inferred from buyer master text.')
  }

  return {
    invoiceNumber: row.invoice_number,
    invoiceKey: row.invoice_key,
    invoiceDate: row.invoice_date,
    buyerCode: row.buyer_code,
    buyerName: row.buyer_name_snapshot,
    buyerGstin: row.buyer_gstin_snapshot || '',
    vehicleNumber: row.vehicle_number || '',
    total: Number(row.total || 0),
    lineCount: Number(row.line_count || 0),
    distanceKm: distance.distanceKm,
    distanceSource: distance.source,
    shipToPlace: destination.place,
    shipToPincode: destination.pincode,
    missingFields,
    warnings,
    ready: missingFields.length === 0,
  }
}

function buildEwayBulkJson(invoiceKey, options = {}) {
  const db = openDb()
  try {
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
        b.city_state_pin,
        b.ship_to_name,
        b.ship_to_address
      FROM invoices i
      LEFT JOIN buyers b ON b.buyer_code = i.buyer_code
      WHERE i.invoice_key = ?
    `).get(invoiceKey)

    if (!invoice) {
      const error = new Error('Invoice was not found.')
      error.statusCode = 404
      throw error
    }

    const lines = db.prepare(`
      SELECT
        line_index,
        item_description_snapshot,
        hsn_code_snapshot,
        quantity,
        non_taxable_value,
        taxable_value
      FROM invoice_lines
      WHERE invoice_number = ?
      ORDER BY line_index
    `).all(invoice.invoice_number)

    const readiness = buildReadinessEntry(
      { ...invoice, line_count: lines.length },
      options.distanceKm,
    )

    if (readiness.missingFields.length) {
      const error = new Error(`E-way JSON is missing: ${readiness.missingFields.join(', ')}`)
      error.statusCode = 400
      error.details = readiness
      throw error
    }

    const destination = deriveDestination(invoice)
    const itemList = buildItemList(lines)
    const mainHsnCode = itemList[0]?.hsnCode || 7010
    const billToShipTo = isBillToShipTo(invoice)

    return {
      version: '1.0.0621',
      billLists: [
        {
          genMode: 'Excel',
          userGstin: supplier.gstin,
          supplyType: 'O',
          subSupplyType: 1,
          subSupplyDesc: '',
          docType: 'INV',
          docNo: invoice.invoice_number,
          docDate: formatIndianDate(invoice.invoice_date),
          transType: billToShipTo ? 2 : 1,
          fromGstin: supplier.gstin,
          fromTrdName: supplier.name,
          fromAddr1: supplier.address1,
          fromAddr2: supplier.address2,
          fromPlace: supplier.place,
          fromPincode: supplier.pincode,
          fromStateCode: supplier.stateCode,
          actualFromStateCode: supplier.stateCode,
          toGstin: invoice.buyer_gstin_snapshot,
          toTrdName: invoice.buyer_name_snapshot,
          toAddr1: destination.address1,
          toAddr2: destination.address2,
          toPlace: destination.place,
          toPincode: destination.pincode,
          toStateCode: destination.stateCode,
          actualToStateCode: destination.stateCode,
          totalValue: roundAmount(Number(invoice.non_taxable_value || 0) + Number(invoice.taxable_value || 0)),
          cgstValue: roundAmount(invoice.cgst),
          sgstValue: roundAmount(invoice.sgst),
          igstValue: 0,
          cessValue: 0,
          TotNonAdvolVal: 0,
          OthValue: 0,
          totInvValue: roundAmount(invoice.total),
          transMode: 1,
          transDistance: Number(readiness.distanceKm),
          transporterName: '',
          transporterId: '',
          transDocNo: '',
          transDocDate: '',
          vehicleNo: normalizeVehicleNumber(invoice.vehicle_number),
          vehicleType: 'R',
          mainHsnCode,
          itemList,
        },
      ],
    }
  } finally {
    db.close()
  }
}

function buildItemList(lines) {
  const items = []
  let itemNo = 1

  lines.forEach((line) => {
    const productName = normalizeProductName(line.item_description_snapshot)
    const hsnCode = normalizeHsnCode(line.hsn_code_snapshot)
    const quantity = roundAmount(line.quantity)
    const taxableValue = roundAmount(line.taxable_value)
    const nonTaxableValue = roundAmount(line.non_taxable_value)

    if (taxableValue > 0) {
      items.push({
        itemNo,
        productName,
        productDesc: line.item_description_snapshot,
        hsnCode,
        quantity,
        qtyUnit: 'NOS',
        taxableAmount: taxableValue,
        sgstRate: 9,
        cgstRate: 9,
        igstRate: 0,
        cessRate: 0,
        cessNonAdvol: 0,
      })
      itemNo += 1
    }

    if (nonTaxableValue > 0) {
      items.push({
        itemNo,
        productName,
        productDesc: line.item_description_snapshot,
        hsnCode,
        quantity,
        qtyUnit: 'NOS',
        taxableAmount: nonTaxableValue,
        sgstRate: 0,
        cgstRate: 0,
        igstRate: 0,
        cessRate: 0,
        cessNonAdvol: 0,
      })
      itemNo += 1
    }
  })

  return items
}

function resolveDistanceKm(invoice, overrideDistanceKm) {
  const override = Number(overrideDistanceKm)
  if (Number.isFinite(override) && override > 0) {
    return { distanceKm: Math.round(override), source: 'manual-override' }
  }

  const shipToAddress = sanitize(invoice.ship_to_address_snapshot || invoice.ship_to_address).toUpperCase()
  if (shipToAddress.includes('MIDC LONAND')) {
    return { distanceKm: 75, source: 'ship-to-default' }
  }

  if (invoiceDistanceKm[invoice.invoice_key]) {
    return { distanceKm: invoiceDistanceKm[invoice.invoice_key], source: 'historical-invoice' }
  }

  if (buyerDistanceKm[invoice.buyer_code]) {
    return { distanceKm: buyerDistanceKm[invoice.buyer_code], source: 'buyer-default' }
  }

  if (ambiguousBuyerDistanceCodes.has(invoice.buyer_code)) {
    return { distanceKm: 0, source: 'ambiguous-buyer' }
  }

  return { distanceKm: 0, source: 'missing' }
}

function deriveDestination(invoice) {
  const shipToName = sanitize(invoice.ship_to_name_snapshot || invoice.ship_to_name)
  const shipToAddress = sanitize(invoice.ship_to_address_snapshot || invoice.ship_to_address)
  const hasDistinctShipTo =
    shipToAddress &&
    shipToName.toUpperCase() !== 'SAME AS TO'

  const sourceText = hasDistinctShipTo
    ? shipToAddress
    : [
        invoice.address_line1,
        invoice.address_line2,
        invoice.address_line3,
        invoice.city_state_pin,
      ].filter(Boolean).join(' ')

  const pincode = extractPincode(sourceText)
  const state = stateFromGstin(invoice.buyer_gstin_snapshot)
  const place = extractPlace(sourceText, pincode)

  return {
    address1: sanitize(hasDistinctShipTo ? shipToName : invoice.address_line1) || invoice.buyer_name_snapshot,
    address2: sanitize(hasDistinctShipTo ? shipToAddress : [invoice.address_line2, invoice.address_line3].filter(Boolean).join(' ')),
    place,
    pincode,
    stateName: state.stateName,
    stateCode: state.stateCode,
    source: hasDistinctShipTo ? 'ship-to-address' : 'buyer-master-guess',
  }
}

function isBillToShipTo(invoice) {
  const shipToName = sanitize(invoice.ship_to_name_snapshot || invoice.ship_to_name).toUpperCase()
  const shipToAddress = sanitize(invoice.ship_to_address_snapshot || invoice.ship_to_address)
  if (!shipToAddress || shipToName === 'SAME AS TO') {
    return false
  }

  return true
}

function stateFromGstin(gstin) {
  const prefix = String(gstin || '').slice(0, 2)
  return stateCodeByGstinPrefix[prefix] || supplier
}

function extractPincode(value) {
  const compact = String(value || '').replace(/\s+/g, ' ')
  const match = compact.match(/(\d{3})\s?(\d{3})(?!\d)/)
  return match ? Number(`${match[1]}${match[2]}`) : 0
}

function extractPlace(value, pincode) {
  const source = sanitize(value)
    .replace(/(\d{3})\s?(\d{3})(?!\d)/g, '')
    .replace(/\bMAHARASHTRA\b/gi, '')
    .replace(/[.,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!source) return ''

  const parts = source.split(/\s+/).filter((part) => /[a-z]/i.test(part))
  return parts.at(-1) || ''
}

function normalizeVehicleNumber(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase()
}

function normalizeProductName(value) {
  return sanitize(value).split('(')[0].slice(0, 100) || 'GLASS BOTTLES'
}

function normalizeHsnCode(value) {
  const match = String(value || '').match(/\d+/)
  return match ? Number(match[0]) : 7010
}

function formatIndianDate(value) {
  const [year, month, day] = String(value || '').split('-')
  return `${day}/${month}/${year}`
}

function roundAmount(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function sanitize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export {
  buildEwayBulkJson,
  readEwayReadiness,
}
