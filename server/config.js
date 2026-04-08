import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const generatedDir = path.join(rootDir, 'generated')
const generatedExcelDir = path.join(generatedDir, 'excel')
const generatedPdfDir = path.join(generatedDir, 'pdf')
const dataDir = path.join(rootDir, 'data')
const dbPath = path.join(dataDir, 'invoice-app.sqlite')
const distDir = path.join(rootDir, 'dist')
const templatePath = path.join(rootDir, 'Invoice Temp.xlsx')
const buyersPath = path.join(rootDir, 'Buyers_Master.csv')
const itemsPath = path.join(rootDir, 'Items_Master.csv')

const port = Number(process.env.PORT || 5000)
const host = process.env.HOST || '0.0.0.0'
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
const maxLineItems = 8

export {
  __filename,
  __dirname,
  rootDir,
  generatedDir,
  generatedExcelDir,
  generatedPdfDir,
  dataDir,
  dbPath,
  distDir,
  templatePath,
  buyersPath,
  itemsPath,
  port,
  host,
  adminPassword,
  maxLineItems,
}
