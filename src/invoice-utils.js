const maxLineItems = 8

const defaultPaymentSummary = {
  totalInvoices: 0,
  paidInvoices: 0,
  unpaidInvoices: 0,
  invoiceRate: 100,
  amountDue: 0,
  paidAmountTotal: 0,
}

const emptyBuyerForm = {
  Buyer_Code: '',
  Buyer_Name: '',
  Address_Line1: '',
  Address_Line2: '',
  Address_Line3: '',
  City_State_Pin: '',
  GSTIN: '',
  Ship_To_Name: '',
  Ship_To_Address: '',
}

const emptyItemForm = {
  Item_Code: '',
  Description: '',
  HSN_Code: '7010',
  Gross_Rate: '',
  Non_Taxable_Rate: '',
  Bottles_Per_Bag: '',
  Dad_Writes_As: '',
  Category: '',
}

function generateClientId() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createLineItem(itemCode = '', bags = '1') {
  return {
    id: generateClientId(),
    itemCode,
    bags,
  }
}

function createInitialInvoiceForm(defaultBuyerCode = '', defaultItemCode = '') {
  return {
    buyerCode: defaultBuyerCode,
    shipToOptionId: 'bill_to',
    vehicleNumber: '',
    invoiceDate: getBusinessDateString(),
    lineItems: [createLineItem(defaultItemCode)],
  }
}

function getBusinessDateString(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

function parseDateOnly(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  const isValid =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day

  return isValid ? { year, month, day } : null
}

function hasDistinctMasterShipTo(buyer) {
  if (!buyer) {
    return false
  }

  const shipToName = String(buyer.Ship_To_Name || '').trim()
  const shipToAddress = String(buyer.Ship_To_Address || '').trim()
  const buyerName = String(buyer.Buyer_Name || '').trim()

  return (
    !!shipToName &&
    !!shipToAddress &&
    shipToName.toUpperCase() !== 'SAME AS TO' &&
    shipToName.toUpperCase() !== buyerName.toUpperCase()
  )
}

function buildShipToOptions(buyer) {
  if (Array.isArray(buyer?.Ship_To_Options) && buyer.Ship_To_Options.length) {
    return buyer.Ship_To_Options
  }

  const options = [
    {
      id: 'bill_to',
      label: 'Bill To (Same as buyer address)',
      shipToName: 'SAME As TO',
      shipToAddress: '',
    },
  ]

  if (!buyer) {
    return options
  }

  if (hasDistinctMasterShipTo(buyer)) {
    options.push({
      id: 'master_ship_to',
      label: `Master Ship-To: ${buyer.Ship_To_Name}`,
      shipToName: buyer.Ship_To_Name,
      shipToAddress: buyer.Ship_To_Address,
    })
  }

  return options
}

function defaultShipToOptionId(buyer) {
  if (buyer?.Default_Ship_To_Option_Id) {
    return buyer.Default_Ship_To_Option_Id
  }

  return hasDistinctMasterShipTo(buyer) ? 'master_ship_to' : 'bill_to'
}

function resolveShipToOptionId(requestedOptionId, buyer) {
  const options = buildShipToOptions(buyer)
  if (options.some((option) => option.id === requestedOptionId)) {
    return requestedOptionId
  }
  return defaultShipToOptionId(buyer)
}

function syncInvoiceForm(current, buyers, items) {
  const buyerCode = buyers.some((buyer) => buyer.Buyer_Code === current.buyerCode)
    ? current.buyerCode
    : buyers[0]?.Buyer_Code || ''
  const selectedBuyer = buyers.find((buyer) => buyer.Buyer_Code === buyerCode)
  const fallbackItemCode = items[0]?.Item_Code || ''
  const lineItems =
    current.lineItems.length > 0
      ? current.lineItems.map((line) => ({
          ...line,
          itemCode: items.some((item) => item.Item_Code === line.itemCode) ? line.itemCode : fallbackItemCode,
        }))
      : [createLineItem(fallbackItemCode)]

  return {
    ...current,
    buyerCode,
    shipToOptionId: resolveShipToOptionId(current.shipToOptionId, selectedBuyer),
    lineItems,
  }
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

function formatDisplayDate(value) {
  if (!value) {
    return '--'
  }

  const dateOnly = parseDateOnly(value)
  if (dateOnly) {
    const parsedUtc = new Date(Date.UTC(dateOnly.year, dateOnly.month - 1, dateOnly.day))
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(parsedUtc)
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return '--'
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}

function formatDisplayDateTime(value) {
  if (!value) {
    return '--'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return '--'
  }

  const formatted = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(parsed)

  return formatted.replace(/\b(am|pm)\b/i, (period) => period.toUpperCase())
}

function getStoredAdminToken() {
  return localStorage.getItem('invoiceAdminToken') || ''
}

function getStoredAppToken() {
  return localStorage.getItem('invoiceAppToken') || ''
}

function calculateInvoiceDetails(lineItems, items) {
  const computedLines = (lineItems || []).map((line) => {
    const selectedItem = items.find((item) => item.Item_Code === line.itemCode)
    const bags = Number(line.bags || 0)
    const bottlesPerBag = Number(selectedItem?.Bottles_Per_Bag || 0)
    const quantity = bags * bottlesPerBag
    const grossRate = Number(selectedItem?.Gross_Rate || 0)
    const nonTaxableRate = Number(selectedItem?.Non_Taxable_Rate || 0)
    const taxableRate = grossRate - nonTaxableRate
    const amount = quantity * grossRate
    const nonTaxableValue = quantity * nonTaxableRate
    const taxableValue = quantity * taxableRate

    return {
      ...line,
      selectedItem,
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

  const quantity = computedLines.reduce((sum, line) => sum + line.quantity, 0)
  const taxableValue = computedLines.reduce((sum, line) => sum + line.taxableValue, 0)
  const nonTaxableValue = computedLines.reduce((sum, line) => sum + line.nonTaxableValue, 0)
  const cgst = taxableValue * 0.09
  const sgst = taxableValue * 0.09
  const total = nonTaxableValue + taxableValue + cgst + sgst

  return {
    computedLines,
    computedTotals: {
      quantity,
      taxableValue,
      nonTaxableValue,
      cgst,
      sgst,
      total,
    },
  }
}

export {
  buildShipToOptions,
  createInitialInvoiceForm,
  createLineItem,
  defaultPaymentSummary,
  emptyBuyerForm,
  emptyItemForm,
  formatDisplayDate,
  formatDisplayDateTime,
  formatMoney,
  getBusinessDateString,
  getStoredAdminToken,
  getStoredAppToken,
  maxLineItems,
  resolveShipToOptionId,
  syncInvoiceForm,
  calculateInvoiceDetails,
}
