import cors from 'cors'
import express from 'express'
import fsSync from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { createAdminSession, extractBearerToken, invalidateAdminSession, requireAdmin } from './admin-session.js'
import { adminPassword, distDir, generatedExcelDir, generatedPdfDir } from './config.js'
import { buildEwayBulkJson, readEwayReadiness } from './eway-core.js'
import {
  buildInvoicePayload,
  createBuyer,
  createItem,
  dbReady,
  deleteBuyer,
  deleteItem,
  generateExcelInvoice,
  generatePdfInvoice,
  markUnpaidInvoicesPaid,
  readBuyers,
  readInvoiceHistory,
  readItems,
  readPaymentSummary,
  saveInvoiceHistory,
  updateBuyer,
  updateItem,
} from './invoice-core.js'

const app = express()

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

app.post('/api/admin/login', async (req, res) => {
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
      const excelFilename = `${invoice.invoiceKey}.xlsx`
      const pdfFilename = `${invoice.invoiceKey}.pdf`
      const excelPath = path.join(generatedExcelDir, excelFilename)
      const pdfPath = path.join(generatedPdfDir, pdfFilename)
      const excelAvailable = fsSync.existsSync(excelPath)
      const pdfAvailable = fsSync.existsSync(pdfPath)

      return {
        ...invoice,
        excelAvailable,
        pdfAvailable,
        files: {
          excel: excelAvailable ? `/downloads/excel/${excelFilename}` : '',
          pdf: pdfAvailable ? `/downloads/pdf/${pdfFilename}` : '',
        },
      }
    })

    res.json({ invoices: withFiles, paymentSummary: await readPaymentSummary() })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/invoices/mark-paid', async (req, res) => {
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
    await Promise.all([
      fs.mkdir(generatedExcelDir, { recursive: true }),
      fs.mkdir(generatedPdfDir, { recursive: true }),
    ])

    const excelFilename = `${invoicePayload.invoiceKey}.xlsx`
    const pdfFilename = `${invoicePayload.invoiceKey}.pdf`
    const excelOutputPath = path.join(generatedExcelDir, excelFilename)
    const pdfOutputPath = path.join(generatedPdfDir, pdfFilename)

    await generateExcelInvoice(invoicePayload, excelOutputPath)
    await generatePdfInvoice(invoicePayload, pdfOutputPath)
    await saveInvoiceHistory(invoicePayload)

    res.json({
      invoice: invoicePayload,
      files: {
        excel: `/downloads/excel/${excelFilename}`,
        pdf: `/downloads/pdf/${pdfFilename}`,
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
