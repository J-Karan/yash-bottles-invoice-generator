import cors from 'cors'
import express from 'express'
import fsSync from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { createAdminSession, extractBearerToken, invalidateAdminSession, requireAdmin } from './admin-session.js'
import { adminPassword, distDir, generatedExcelDir, generatedPdfDir } from './config.js'
import { buildEwayBulkJson, readEwayReadiness } from './eway-core.js'
import { createRateLimiter } from './rate-limit.js'
import {
  buildInvoiceFileTargets,
  buildInvoicePayload,
  createBuyer,
  createItem,
  dbReady,
  deleteBuyer,
  deleteInvoiceHistory,
  deleteItem,
  generateExcelInvoice,
  generatePdfInvoice,
  markUnpaidInvoicesPaid,
  readBuyers,
  readInvoiceDraft,
  readInvoiceHistory,
  readItems,
  readPaymentSummary,
  saveInvoiceHistory,
  updateBuyer,
  updateItem,
} from './invoice-core.js'

const app = express()
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

app.use(cors())
app.use(express.json())
app.use('/downloads/excel', express.static(generatedExcelDir))
app.use('/downloads/pdf', express.static(generatedPdfDir))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, storage: 'sqlite' })
})

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
    if (password !== adminPassword) {
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
    res.status(404).json({ error: error.message })
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
    const result = await markUnpaidInvoicesPaid(req.body?.password)
    res.json(result)
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

app.get('/api/eway/readiness', async (_req, res) => {
  try {
    res.json(readEwayReadiness())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/eway/invoices/:invoiceKey/bulk-json', async (req, res) => {
  try {
    const payload = buildEwayBulkJson(req.params.invoiceKey, {
      distanceKm: req.query?.distanceKm,
    })
    const filename = `${req.params.invoiceKey}-eway.json`

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
    const invoicePayload = await buildInvoicePayload(req.body)
    const fileTargets = buildInvoiceFileTargets(invoicePayload.invoiceDate, invoicePayload.invoiceKey)
    await Promise.all([
      fs.mkdir(fileTargets.excel.directoryPath, { recursive: true }),
      fs.mkdir(fileTargets.pdf.directoryPath, { recursive: true }),
    ])

    await generateExcelInvoice(invoicePayload, fileTargets.excel.absolutePath)
    await generatePdfInvoice(invoicePayload, fileTargets.pdf.absolutePath)
    await saveInvoiceHistory(invoicePayload)

    res.json({
      invoice: invoicePayload,
      files: {
        excel: `/downloads/excel/${fileTargets.excel.relativeUrlPath}`,
        pdf: `/downloads/pdf/${fileTargets.pdf.relativeUrlPath}`,
      },
    })
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

export { app }
