import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { safeEqual } from './secret-utils.js'

process.env.ADMIN_PASSWORD ||= 'test-admin-password'
process.env.APP_PASSWORD ||= 'test-app-password'
process.env.PAYMENT_PASSWORD ||= 'test-payment-password'

describe('safeEqual', () => {
  it('matches identical secrets only', () => {
    assert.equal(safeEqual('same-secret', 'same-secret'), true)
    assert.equal(safeEqual('same-secret', 'other-secret'), false)
    assert.equal(safeEqual('same-secret', 'short'), false)
  })
})

describe('stateFromGstin', () => {
  it('maps out-of-state GSTIN prefixes instead of falling back to Maharashtra', async () => {
    const { stateFromGstin } = await import('./eway-core.js')

    assert.deepEqual(stateFromGstin('29ABCDE1234F1Z5'), {
      stateName: 'KARNATAKA',
      stateCode: 29,
    })
    assert.deepEqual(stateFromGstin('07ABCDE1234F1Z5'), {
      stateName: 'DELHI',
      stateCode: 7,
    })
  })

  it('keeps Maharashtra mapping for current local buyers', async () => {
    const { stateFromGstin } = await import('./eway-core.js')

    assert.deepEqual(stateFromGstin('27BZCPA4008G1ZX'), {
      stateName: 'MAHARASHTRA',
      stateCode: 27,
    })
  })
})
