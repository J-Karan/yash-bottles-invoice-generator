import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pruneExpiredAttempts } from './rate-limit.js'
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

describe('memory cleanup', () => {
  it('prunes expired rate limit attempts', () => {
    const attempts = new Map([
      ['expired', { count: 2, resetAt: 100 }],
      ['active', { count: 1, resetAt: 300 }],
    ])

    pruneExpiredAttempts(attempts, 200)

    assert.equal(attempts.has('expired'), false)
    assert.equal(attempts.has('active'), true)
  })

  it('prunes abandoned app and admin sessions when new sessions are created', async () => {
    const originalNow = Date.now
    const {
      createAppSession,
      getAppSessionCount,
      invalidateAppSession,
    } = await import('./app-session.js')
    const {
      createAdminSession,
      getAdminSessionCount,
      invalidateAdminSession,
    } = await import('./admin-session.js')
    const appTtlMs = 1000 * 60 * 60 * 12
    const adminTtlMs = 1000 * 60 * 60 * 8
    const cleanupDelayMs = 1000 * 60 * 15 + 1
    let appToken = ''
    let freshAppToken = ''
    let adminToken = ''
    let freshAdminToken = ''

    try {
      Date.now = () => 1
      appToken = createAppSession()
      adminToken = createAdminSession()

      Date.now = () => Math.max(appTtlMs, adminTtlMs) + cleanupDelayMs
      freshAppToken = createAppSession()
      freshAdminToken = createAdminSession()

      assert.equal(getAppSessionCount(), 1)
      assert.equal(getAdminSessionCount(), 1)
    } finally {
      Date.now = originalNow
      ;[appToken, freshAppToken].forEach(invalidateAppSession)
      ;[adminToken, freshAdminToken].forEach(invalidateAdminSession)
    }
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
