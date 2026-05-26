import crypto from 'crypto'

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  const compareLength = Math.max(leftBuffer.length, rightBuffer.length, 1)
  const leftPadded = Buffer.alloc(compareLength)
  const rightPadded = Buffer.alloc(compareLength)

  leftBuffer.copy(leftPadded)
  rightBuffer.copy(rightPadded)

  const valuesMatch = crypto.timingSafeEqual(leftPadded, rightPadded)
  return leftBuffer.length === rightBuffer.length && valuesMatch
}

export { safeEqual }
