import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeDeletableInvoiceKeys,
  formatDisplayDate,
  formatDisplayDateTime,
  getBusinessDateString,
  resolveShipToOptionId,
} from './invoice-utils.js'

it('allows only the latest serial in the newest financial year to be deleted', () => {
  const deletable = computeDeletableInvoiceKeys([
    { invoiceNumber: '032/2025-26', invoiceKey: 'prior-year' },
    { invoiceNumber: '002/2026-27', invoiceKey: 'latest' },
    { invoiceNumber: '001/2026-27', invoiceKey: 'earlier-current-year' },
  ])
  assert.deepEqual([...deletable], ['latest'])
})

describe('resolveShipToOptionId', () => {
  it('keeps a valid selected ship-to option', () => {
    const buyer = {
      Buyer_Name: 'Buyer',
      Ship_To_Options: [
        { id: 'bill_to', label: 'Bill To' },
        { id: 'warehouse', label: 'Warehouse' },
      ],
    }

    assert.equal(resolveShipToOptionId('warehouse', buyer), 'warehouse')
  })

  it('falls back when buyer changes and the old option is unavailable', () => {
    const buyer = {
      Buyer_Name: 'Buyer',
      Ship_To_Options: [{ id: 'bill_to', label: 'Bill To' }],
    }

    assert.equal(resolveShipToOptionId('old_ship_to', buyer), 'bill_to')
  })
})

describe('formatDisplayDateTime', () => {
  it('uses a 12-hour AM/PM time format', () => {
    const formatted = formatDisplayDateTime('2026-05-25T17:44:00+05:30')

    assert.match(formatted, /\bPM\b/)
    assert.doesNotMatch(formatted, /\b17:44\b/)
  })
})

describe('date helpers', () => {
  it('uses Asia/Kolkata for default invoice dates', () => {
    const formatted = getBusinessDateString(new Date('2026-05-28T19:00:00.000Z'))

    assert.equal(formatted, '2026-05-29')
  })

  it('formats date-only values without timezone shifting', () => {
    const formatted = formatDisplayDate('2026-05-01')

    assert.equal(formatted, '01 May 2026')
  })
})
