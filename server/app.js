import cors from 'cors'
import express from 'express'
import fsSync from 'fs'
import path from 'path'
import { createAdminSession, extractBearerToken, invalidateAdminSession, requireAdmin } from './admin-session.js'
import {
  createAppSession,
  credentialsMatch,
  extractAppSessionToken,
  invalidateAppSession,
  requireAppSession,
} from './app-session.js'
import { adminPassword, distDir, generatedExcelDir, generatedPdfDir } from './config.js'
import { buildEwayBulkJson, readEwayReadiness } from './eway-core.js'
import { createRateLimiter } from './rate-limit.js'
import { safeEqual } from './secret-utils.js'
import {
  buildInvoiceFileTargets,
  createBuyer,
  createItem,
  dbReady,
  deleteBuyer,
  deleteInvoiceHistory,
  deleteItem,
  generateAndSaveInvoice,
  markUnpaidInvoicesPaid,
  readBuyers,
  readInvoiceDraft,
  readInvoiceHistory,
  readItems,
  readPaymentSummary,
  updateBuyer,
  updateItem,
} from './invoice-core.js'
import { normalizeInvoiceKey, sanitizeHeaderFilenameBase } from './input-validation.js'

const app = express()
const allowedCorsOrigins = new Set(
  (process.env.CORS_ORIGIN || 'https://invoice.yashbottles.in,http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)
const adminLoginLimiter = createRateLimiter({
  windowMs: 1000 * 60 * 15,
  maxAttempts: 8,
  message: 'Too many admin login attempts. Try again later.',
})
const paymentLimiter = createRateLimiter({
  windowMs: 1000 * 60 * 15,
  maxAttempts: 5,
  message: 'Too many payment password attempts. Try again later.',
})
const appLoginLimiter = createRateLimiter({
  windowMs: 1000 * 60 * 15,
  maxAttempts: 10,
  message: 'Too many login attempts. Try again later.',
})

app.disable('x-powered-by')
app.set('trust proxy', 'loopback')
app.use(securityHeaders)
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedCorsOrigins.has(origin)) {
      callback(null, true)
      return
    }

    callback(null, false)
  },
}))
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '32kb', strict: true }))
app.use(handleJsonBodyError)

function securityHeaders(_req, res, next) {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "manifest-src 'self'",
      'upgrade-insecure-requests',
    ].join('; '),
  )
  next()
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, storage: 'sqlite' })
})

app.post('/api/auth/login', appLoginLimiter, async (req, res) => {
  try {
    await dbReady
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    if (!credentialsMatch(username, password)) {
      res.status(401).json({ error: 'Invalid username or password.' })
      return
    }

    const token = createAppSession()
    res.json({ token, username })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/auth/session', requireAppSession, (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/auth/logout', requireAppSession, (req, res) => {
  invalidateAppSession(extractAppSessionToken(req))
  res.json({ ok: true })
})

app.use('/downloads/excel', requireAppSession, express.static(generatedExcelDir))
app.use('/downloads/pdf', requireAppSession, express.static(generatedPdfDir))
app.use('/api', requireAppSession)

app.get('/api/masters', async (_req, res) => {
  try {
    await dbReady
    const [buyers, items] = await Promise.all([readBuyers(), readItems()])
    res.json({
      buyers,
      items,
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/admin/login', adminLoginLimiter, async (req, res) => {
  try {
    await dbReady
    const password = String(req.body?.password || '')
    if (!safeEqual(password, adminPassword)) {
      res.status(401).json({ error: 'Invalid admin password.' })
      return
    }

    const token = createAdminSession()
    res.json({ token })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/admin/session', requireAdmin, (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = extractBearerToken(req)
  invalidateAdminSession(token)
  res.json({ ok: true })
})

app.get('/api/buyers', requireAdmin, async (_req, res) => {
  try {
    await dbReady
    res.json({ buyers: await readBuyers() })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/buyers', requireAdmin, async (req, res) => {
  try {
    await dbReady
    const buyer = createBuyer(req.body)
    res.status(201).json({ buyer })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.put('/api/buyers/:buyerCode', requireAdmin, async (req, res) => {
  try {
    await dbReady
    const buyer = updateBuyer(req.params.buyerCode, req.body)
    res.json({ buyer })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.delete('/api/buyers/:buyerCode', requireAdmin, async (req, res) => {
  try {
    await dbReady
    deleteBuyer(req.params.buyerCode)
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.get('/api/items', requireAdmin, async (_req, res) => {
  try {
    await dbReady
    res.json({ items: await readItems() })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/invoices/history', async (req, res) => {
  try {
    await dbReady
    const limit = Number(req.query?.limit || 200)
    const invoices = await readInvoiceHistory(limit)
    const withFiles = invoices.map((invoice) => {
      const fileTargets = buildInvoiceFileTargets(invoice.invoiceDate, invoice.invoiceKey)
      const excelPath = fileTargets.excel.absolutePath
      const pdfPath = fileTargets.pdf.absolutePath
      const excelAvailable = fsSync.existsSync(excelPath)
      const pdfAvailable = fsSync.existsSync(pdfPath)

      return {
        ...invoice,
        excelAvailable,
        pdfAvailable,
        files: {
          excel: excelAvailable ? `/downloads/excel/${fileTargets.excel.relativeUrlPath}` : '',
          pdf: pdfAvailable ? `/downloads/pdf/${fileTargets.pdf.relativeUrlPath}` : '',
        },
      }
    })

    res.json({ invoices: withFiles, paymentSummary: await readPaymentSummary() })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/invoices/:invoiceKey', async (req, res) => {
  try {
    await dbReady
    res.json({ invoice: await readInvoiceDraft(req.params.invoiceKey) })
  } catch (error) {
    res.status(error.statusCode || 404).json({ error: error.message })
  }
})

app.delete('/api/invoices/:invoiceKey', async (req, res) => {
  try {
    await dbReady
    const result = await deleteInvoiceHistory(req.params.invoiceKey)
    res.json(result)
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

app.post('/api/invoices/mark-paid', paymentLimiter, async (req, res) => {
  try {
    await dbReady
    const result = await markUnpaidInvoicesPaid(req.body?.password)
    res.json(result)
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

app.get('/api/eway/readiness', async (_req, res) => {
  try {
    await dbReady
    res.json(readEwayReadiness())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/eway/invoices/:invoiceKey/bulk-json', async (req, res) => {
  try {
    await dbReady
    const invoiceKey = normalizeInvoiceKey(req.params.invoiceKey)
    const payload = buildEwayBulkJson(invoiceKey, {
      distanceKm: req.query?.distanceKm,
    })
    const filename = `${sanitizeHeaderFilenameBase(invoiceKey, 'invoice')}-eway.json`

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(JSON.stringify(payload, null, 2))
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.message,
      details: error.details,
    })
  }
})

app.post('/api/items', requireAdmin, async (req, res) => {
  try {
    await dbReady
    const item = createItem(req.body)
    res.status(201).json({ item })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.put('/api/items/:itemCode', requireAdmin, async (req, res) => {
  try {
    await dbReady
    const item = updateItem(req.params.itemCode, req.body)
    res.json({ item })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.delete('/api/items/:itemCode', requireAdmin, async (req, res) => {
  try {
    await dbReady
    deleteItem(req.params.itemCode)
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.post('/api/invoices/generate', async (req, res) => {
  try {
    await dbReady
    res.json(await generateAndSaveInvoice(req.body))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

if (fsSync.existsSync(distDir)) {
  app.use(express.static(distDir))

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/downloads')) {
      next()
      return
    }

    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use(handleUnexpectedError)

function handleJsonBodyError(error, _req, res, next) {
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body must be valid JSON.' })
    return
  }

  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large.' })
    return
  }

  next(error)
}

function handleUnexpectedError(error, _req, res, next) {
  if (res.headersSent) {
    next(error)
    return
  }

  const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500
  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Unexpected server error.' : error.message,
  })
}

export { app }
