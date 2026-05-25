import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveShipToOptionId } from './invoice-utils.js'

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
