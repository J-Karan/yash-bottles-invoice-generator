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

function buildInvoiceLines(lineItemsInput, items) {
  return lineItemsInput.map((line, index) => {
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
    if (Number.isFinite(grossRate) && Number.isFinite(nonTaxableRate) && nonTaxableRate > grossRate) {
      throw new Error(`Non-taxable rate cannot be greater than gross rate for line ${index + 1}.`)
    }

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
}

function calculateInvoiceTotals(lines) {
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0)
  const amount = roundCurrency(lines.reduce((sum, line) => sum + line.amount, 0))
  const nonTaxableValue = roundCurrency(lines.reduce((sum, line) => sum + line.nonTaxableValue, 0))
  const taxableValue = roundCurrency(lines.reduce((sum, line) => sum + line.taxableValue, 0))
  const cgst = roundCurrency(taxableValue * 0.09)
  const sgst = roundCurrency(taxableValue * 0.09)
  const taxableAfterGst = roundCurrency(taxableValue + cgst + sgst)
  const total = roundCurrency(nonTaxableValue + taxableAfterGst)

  return {
    quantity,
    amount,
    nonTaxableValue,
    taxableValue,
    cgst,
    sgst,
    taxableAfterGst,
    total,
  }
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export {
  buildInvoiceLines,
  calculateInvoiceTotals,
  deriveFinancialYearSuffix,
  roundCurrency,
}
