import { parseDateOnly } from './date-utils.js'
import { sanitizeLine } from './invoice-formatting.js'

const codePattern = /^[A-Z0-9_-]+$/
const gstinPattern = /^[0-9A-Z]{15}$/
const hsnPattern = /^\d{4,8}$/
const invoiceKeyPattern = /^\d{1,6}-\d{4}-\d{2}$/
const vehicleCharsetPattern = /^[A-Z0-9-]+$/

function validationError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function normalizeTextField(value, label, options = {}) {
  const required = Boolean(options.required)
  const maxLength = options.maxLength || 160
  const normalized = sanitizeLine(value)

  if (required && !normalized) {
    throw validationError(`${label} is required.`)
  }
  if (normalized.length > maxLength) {
    throw validationError(`${label} must be ${maxLength} characters or fewer.`)
  }

  return options.uppercase ? normalized.toUpperCase() : normalized
}

function normalizeCodeField(value, label, options = {}) {
  const normalized = normalizeTextField(value, label, {
    required: options.required,
    maxLength: options.maxLength || 32,
    uppercase: true,
  })

  if (normalized && !codePattern.test(normalized)) {
    throw validationError(`${label} can contain only letters, numbers, hyphens, and underscores.`)
  }

  return normalized
}

function normalizeGstin(value, label = 'GSTIN') {
  const normalized = normalizeTextField(value, label, {
    required: false,
    maxLength: 15,
    uppercase: true,
  })

  if (normalized && !gstinPattern.test(normalized)) {
    throw validationError(`${label} must be a 15-character GSTIN.`)
  }

  return normalized
}

function normalizeHsnCode(value, label = 'HSN code') {
  const normalized = normalizeTextField(value, label, {
    required: false,
    maxLength: 8,
  })

  if (normalized && !hsnPattern.test(normalized)) {
    throw validationError(`${label} must contain 4 to 8 digits.`)
  }

  return normalized
}

function normalizeNonNegativeAmount(value, label, options = {}) {
  const max = options.max ?? 1000000
  const normalized = Number(value)

  if (!Number.isFinite(normalized) || normalized < 0 || normalized > max) {
    throw validationError(`${label} must be a valid number between 0 and ${max}.`)
  }

  return normalized
}

function normalizePositiveInteger(value, label, options = {}) {
  const max = options.max ?? 100000
  const normalized = Number(value)

  if (
    !Number.isFinite(normalized) ||
    normalized <= 0 ||
    normalized > max ||
    !Number.isInteger(normalized)
  ) {
    throw validationError(`${label} must be a whole number between 1 and ${max}.`)
  }

  return normalized
}

function normalizeInvoiceDate(value) {
  const normalized = normalizeTextField(value, 'Invoice date', {
    required: true,
    maxLength: 64,
  })

  if (!parseDateOnly(normalized)) {
    throw validationError('Invoice date must use YYYY-MM-DD format.')
  }

  return normalized
}

function normalizeInvoiceKey(value) {
  const normalized = normalizeTextField(value, 'Invoice key', {
    required: true,
    maxLength: 20,
  })

  if (!invoiceKeyPattern.test(normalized)) {
    throw validationError('Invoice key format is invalid.')
  }

  return normalized
}

function normalizeVehicleNumber(value) {
  const normalized = normalizeTextField(value, 'Vehicle number', {
    required: true,
    maxLength: 20,
    uppercase: true,
  }).replace(/\s+/g, '')

  if (!vehicleCharsetPattern.test(normalized)) {
    throw validationError('Vehicle number can contain only letters, numbers, and hyphens.')
  }
  if (normalized.length < 4 || normalized.length > 20) {
    throw validationError('Vehicle number must be 4 to 20 characters long.')
  }

  return normalized
}

function sanitizeHeaderFilenameBase(value, fallback = 'download') {
  const normalized = sanitizeLine(value)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80)
    .replace(/^[._-]+|[._-]+$/g, '')

  return normalized || fallback
}

export {
  normalizeCodeField,
  normalizeGstin,
  normalizeHsnCode,
  normalizeInvoiceDate,
  normalizeInvoiceKey,
  normalizeNonNegativeAmount,
  normalizePositiveInteger,
  normalizeTextField,
  normalizeVehicleNumber,
  sanitizeHeaderFilenameBase,
  validationError,
}
