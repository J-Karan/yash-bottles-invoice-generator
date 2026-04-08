import path from 'path'
import { fileURLToPath } from 'url'
import { app } from './app.js'
import { port } from './config.js'
import { dbReady, buildInvoicePayload, generateExcelInvoice, generatePdfInvoice } from './invoice-core.js'

const entryFile = fileURLToPath(import.meta.url)
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === entryFile

if (isDirectRun) {
  app.listen(port, async () => {
    await dbReady
    console.log(`Invoice server running on http://localhost:${port}`)
  })
}

export { app, buildInvoicePayload, generateExcelInvoice, generatePdfInvoice }
