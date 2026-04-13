import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const generatedDir = path.join(rootDir, 'generated')
const generatedExcelDir = path.join(generatedDir, 'excel')
const generatedPdfDir = path.join(generatedDir, 'pdf')
const dataDir = path.join(rootDir, 'data')
const mastersDir = path.join(dataDir, 'masters')
const templatesDir = path.join(dataDir, 'templates')
const dbPath = path.join(dataDir, 'invoice-app.sqlite')
const distDir = path.join(rootDir, 'dist')
const templatePath = resolvePath([
  path.join(templatesDir, 'Invoice Temp.xlsx'),
  path.join(rootDir, 'Invoice Temp.xlsx'),
])
const buyersPath = resolvePath([
  path.join(mastersDir, 'Buyers_Master.csv'),
  path.join(rootDir, 'Buyers_Master.csv'),
])
const itemsPath = resolvePath([
  path.join(mastersDir, 'Items_Master.csv'),
  path.join(rootDir, 'Items_Master.csv'),
])

const port = Number(process.env.PORT || 5000)
const host = process.env.HOST || '0.0.0.0'
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
const paymentPassword = process.env.PAYMENT_PASSWORD || 'Ashlesha21@NYRP'
const invoiceServiceFee = Number(process.env.INVOICE_SERVICE_FEE || 100)
const maxLineItems = 8

function resolvePath(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return candidates[0]
}

export {
  __filename,
  __dirname,
  rootDir,
  generatedDir,
  generatedExcelDir,
  generatedPdfDir,
  dataDir,
  mastersDir,
  templatesDir,
  dbPath,
  distDir,
  templatePath,
  buyersPath,
  itemsPath,
  port,
  host,
  adminPassword,
  paymentPassword,
  invoiceServiceFee,
  maxLineItems,
}
