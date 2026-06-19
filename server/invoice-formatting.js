import { parseDateOnly } from './date-utils.js'

function formatDate(dateString) {
  const dateOnly = parseDateOnly(dateString)
  if (dateOnly) {
    return `${String(dateOnly.day).padStart(2, '0')}/${String(dateOnly.month).padStart(2, '0')}/${dateOnly.year}`
  }

  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('en-GB').format(date)
}

function formatMoney(value) {
  return Number(value).toFixed(2)
}

function sanitizeLine(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function numberToIndianWords(value) {
  const rounded = Math.round(Number(value || 0) * 100) / 100
  const rupees = Math.floor(rounded)
  const paise = Math.round((rounded - rupees) * 100)
  const rupeeWords = `${convertIndianIntegerToWords(rupees)} Rupees`
  if (!paise) {
    return `${rupeeWords} Only`
  }
  return `${rupeeWords} and ${convertIndianIntegerToWords(paise)} Paise Only`
}

function convertIndianIntegerToWords(number) {
  if (number === 0) {
    return 'Zero'
  }

  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ]
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  function belowThousand(n) {
    let result = ''
    if (n >= 100) {
      result += `${ones[Math.floor(n / 100)]} Hundred`
      n %= 100
      if (n) {
        result += ' '
      }
    }
    if (n >= 20) {
      result += tens[Math.floor(n / 10)]
      if (n % 10) {
        result += ` ${ones[n % 10]}`
      }
    } else if (n > 0) {
      result += ones[n]
    }
    return result.trim()
  }

  const parts = []
  const crore = Math.floor(number / 10000000)
  const lakh = Math.floor((number % 10000000) / 100000)
  const thousand = Math.floor((number % 100000) / 1000)
  const remainder = number % 1000

  if (crore) {
    parts.push(`${belowThousand(crore)} Crore`)
  }
  if (lakh) {
    parts.push(`${belowThousand(lakh)} Lakh`)
  }
  if (thousand) {
    parts.push(`${belowThousand(thousand)} Thousand`)
  }
  if (remainder) {
    parts.push(belowThousand(remainder))
  }

  return parts.join(' ').trim()
}

export {
  formatDate,
  formatMoney,
  sanitizeLine,
  numberToIndianWords,
}
