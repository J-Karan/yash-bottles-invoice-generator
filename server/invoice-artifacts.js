import fs from 'fs/promises'
import path from 'path'
import { generatedExcelDir, generatedPdfDir } from './config.js'
import { deriveFinancialYearSuffix } from './invoice-rules.js'

async function deleteGeneratedFile(directoryPath, filename) {
  const filePath = path.join(directoryPath, filename)
  try {
    await fs.unlink(filePath)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function deleteInvoiceArtifacts(invoiceDate, invoiceKey) {
  const targets = buildInvoiceFileTargets(invoiceDate, invoiceKey)
  await Promise.all([
    deleteGeneratedFile(targets.excel.directoryPath, targets.excel.filename),
    deleteGeneratedFile(targets.pdf.directoryPath, targets.pdf.filename),
    deleteGeneratedFile(generatedExcelDir, `${invoiceKey}.xlsx`),
    deleteGeneratedFile(generatedPdfDir, `${invoiceKey}.pdf`),
  ])
}

async function deleteInvoiceArtifactsLegacyNumericMonth(invoiceDate, invoiceKey) {
  const financialYear = resolveFinancialYearForStorage(invoiceDate, invoiceKey)
  const numericMonth = resolveMonthBucketNumeric(invoiceDate)
  await Promise.all([
    deleteGeneratedFile(path.join(generatedExcelDir, financialYear, numericMonth), `${invoiceKey}.xlsx`),
    deleteGeneratedFile(path.join(generatedPdfDir, financialYear, numericMonth), `${invoiceKey}.pdf`),
  ])
}

async function deleteInvoiceArtifactsLegacyFullMonth(invoiceDate, invoiceKey) {
  const financialYear = resolveFinancialYearForStorage(invoiceDate, invoiceKey)
  const monthName = resolveMonthBucketFullName(invoiceDate)
  await Promise.all([
    deleteGeneratedFile(path.join(generatedExcelDir, financialYear, monthName), `${invoiceKey}.xlsx`),
    deleteGeneratedFile(path.join(generatedPdfDir, financialYear, monthName), `${invoiceKey}.pdf`),
  ])
}

function buildInvoiceFileTargets(invoiceDate, invoiceKey) {
  const financialYear = resolveFinancialYearForStorage(invoiceDate, invoiceKey)
  const monthBucket = resolveMonthBucket(invoiceDate)
  const relativeDir = `${financialYear}/${monthBucket}`
  const excelFilename = `${invoiceKey}.xlsx`
  const pdfFilename = `${invoiceKey}.pdf`

  return {
    excel: {
      filename: excelFilename,
      directoryPath: path.join(generatedExcelDir, financialYear, monthBucket),
      absolutePath: path.join(generatedExcelDir, financialYear, monthBucket, excelFilename),
      relativeUrlPath: `${relativeDir}/${excelFilename}`,
    },
    pdf: {
      filename: pdfFilename,
      directoryPath: path.join(generatedPdfDir, financialYear, monthBucket),
      absolutePath: path.join(generatedPdfDir, financialYear, monthBucket, pdfFilename),
      relativeUrlPath: `${relativeDir}/${pdfFilename}`,
    },
  }
}

function resolveFinancialYearForStorage(invoiceDate, invoiceKey) {
  try {
    return deriveFinancialYearSuffix(invoiceDate)
  } catch {
    const parsed = parseInvoiceNumberFromKey(invoiceKey)
    if (parsed?.financialYear) {
      return parsed.financialYear
    }
    throw new Error(`Invoice date is invalid for file storage: ${invoiceDate}`)
  }
}

function parseInvoiceNumberFromKey(invoiceKey) {
  const match = String(invoiceKey || '').match(/^(\d+)-(\d{4}-\d{2})$/)
  if (!match) {
    return null
  }

  return {
    serial: Number(match[1]),
    financialYear: match[2],
  }
}

function resolveMonthBucket(invoiceDate) {
  const monthNumber = resolveMonthNumber(invoiceDate)
  const monthName = resolveMonthBucketFullName(invoiceDate)
  return `${monthNumber}-${monthName}`
}

function resolveMonthBucketFullName(invoiceDate) {
  const source = String(invoiceDate || '').trim()
  const parsed = new Date(source)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invoice date is invalid for file storage: ${invoiceDate}`)
  }

  return new Intl.DateTimeFormat('en-US', { month: 'long' }).format(parsed)
}

function resolveMonthNumber(invoiceDate) {
  const source = String(invoiceDate || '').trim()
  const match = source.match(/^\d{4}-(\d{2})-\d{2}$/)
  if (match) {
    return match[1]
  }

  const parsed = new Date(source)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invoice date is invalid for file storage: ${invoiceDate}`)
  }

  return String(parsed.getMonth() + 1).padStart(2, '0')
}

function resolveMonthBucketNumeric(invoiceDate) {
  const source = String(invoiceDate || '').trim()
  const match = source.match(/^(\d{4})-(\d{2})-\d{2}$/)
  if (match) {
    return `${match[1]}-${match[2]}`
  }

  const parsed = new Date(source)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invoice date is invalid for file storage: ${invoiceDate}`)
  }

  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`
}

export {
  buildInvoiceFileTargets,
  deleteGeneratedFile,
  deleteInvoiceArtifacts,
  deleteInvoiceArtifactsLegacyFullMonth,
  deleteInvoiceArtifactsLegacyNumericMonth,
  fileExists,
}
