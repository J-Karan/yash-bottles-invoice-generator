import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pruneExpiredAttempts } from './rate-limit.js'
import { safeEqual } from './secret-utils.js'
import { maxBagsPerLine } from './invoice-rules.js'

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

describe('request hardening', () => {
  it('returns JSON errors for malformed and oversized JSON bodies', async () => {
    await withTestServer(async (baseUrl) => {
      const malformed = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"username":',
      })
      assert.equal(malformed.status, 400)
      assert.deepEqual(await malformed.json(), { error: 'Request body must be valid JSON.' })

      const oversized = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'jkaran',
          password: 'x'.repeat(40 * 1024),
        }),
      })
      assert.equal(oversized.status, 413)
      assert.deepEqual(await oversized.json(), { error: 'Request body is too large.' })
    })
  })

  it('rejects unsafe invoice keys before building download headers', async () => {
    await withTestServer(async (baseUrl) => {
      const token = await loginForTest(baseUrl)
      try {
        const response = await fetch(`${baseUrl}/api/eway/invoices/${encodeURIComponent('bad"key')}/bulk-json`, {
          headers: {
            'X-Invoice-Session': token,
          },
        })

        assert.equal(response.status, 400)
        assert.equal(response.headers.get('content-disposition'), null)
        assert.deepEqual(await response.json(), { error: 'Invoice key format is invalid.' })
      } finally {
        await logoutForTest(baseUrl, token)
      }
    })
  })

  it('rate limits login per forwarded client ip, not globally', async () => {
    await withTestServer(async (baseUrl) => {
      const badLogin = (forwardedFor) =>
        fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': forwardedFor,
          },
          body: JSON.stringify({ username: 'jkaran', password: 'wrong-password' }),
        })

      let lastStatus = 0
      for (let attempt = 1; attempt <= 11; attempt += 1) {
        const response = await badLogin('203.0.113.5')
        lastStatus = response.status
        await response.json()
      }
      assert.equal(lastStatus, 429)

      const otherClient = await badLogin('203.0.113.6')
      assert.equal(otherClient.status, 401)
      await otherClient.json()
    })
  })

  it('neutralizes spreadsheet formula text before writing Excel cells', async () => {
    const { safeExcelText } = await import('./excel-generator.js')

    assert.equal(safeExcelText('=HYPERLINK("https://bad.example")'), '\'=HYPERLINK("https://bad.example")')
    assert.equal(safeExcelText('@SUM(1,1)'), "'@SUM(1,1)")
    assert.equal(safeExcelText('Normal customer'), 'Normal customer')
  })

  it('rejects malformed invoice dates, vehicle numbers, and extreme bag counts', async () => {
    const { buildInvoicePayload, dbReady, readBuyers, readItems } = await import('./invoice-core.js')
    await dbReady
    const [buyer] = await readBuyers()
    const [item] = await readItems()

    await assert.rejects(
      () =>
        buildInvoicePayload({
          buyerCode: buyer.Buyer_Code,
          shipToOptionId: buyer.Default_Ship_To_Option_Id,
          vehicleNumber: 'MH12<script>',
          invoiceDate: '2026-05-29',
          lineItems: [{ itemCode: item.Item_Code, bags: '1' }],
        }),
      /Vehicle number can contain only letters, numbers, and hyphens/,
    )

    await assert.rejects(
      () =>
        buildInvoicePayload({
          buyerCode: buyer.Buyer_Code,
          shipToOptionId: buyer.Default_Ship_To_Option_Id,
          vehicleNumber: 'MH12AB1234',
          invoiceDate: 'May 29, 2026',
          lineItems: [{ itemCode: item.Item_Code, bags: '1' }],
        }),
      /Invoice date must use YYYY-MM-DD format/,
    )

    await assert.rejects(
      () =>
        buildInvoicePayload({
          buyerCode: buyer.Buyer_Code,
          shipToOptionId: buyer.Default_Ship_To_Option_Id,
          vehicleNumber: 'MH12AB1234',
          invoiceDate: '2026-05-29',
          lineItems: [{ itemCode: item.Item_Code, bags: String(maxBagsPerLine + 1) }],
        }),
      /Bags cannot exceed/,
    )
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
    const baseNow = originalNow()
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
      Date.now = () => baseNow
      appToken = createAppSession()
      adminToken = createAdminSession()

      Date.now = () => baseNow + Math.max(appTtlMs, adminTtlMs) + cleanupDelayMs
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

async function withTestServer(callback) {
  const { app } = await import('./app.js')
  const server = app.listen(0, '127.0.0.1')

  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()

  try {
    await callback(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

async function loginForTest(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: process.env.APP_USERNAME || 'jkaran',
      password: process.env.APP_PASSWORD,
    }),
  })
  const data = await response.json()

  assert.equal(response.status, 200)
  assert.ok(data.token)
  return data.token
}

async function logoutForTest(baseUrl, token) {
  await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      'X-Invoice-Session': token,
    },
  })
}
