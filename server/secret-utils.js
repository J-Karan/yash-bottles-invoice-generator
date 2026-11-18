import crypto from 'crypto'

function safeEqual(left, right) {
  if (!left || !right || typeof left !== 'string' || typeof right !== 'string') {
    return false
  }

  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  const compareLength = Math.max(leftBuffer.length, rightBuffer.length)
  const leftPadded = Buffer.alloc(compareLength)
  const rightPadded = Buffer.alloc(compareLength)

  leftBuffer.copy(leftPadded)
  rightBuffer.copy(rightPadded)

  const valuesMatch = crypto.timingSafeEqual(leftPadded, rightPadded)
  return leftBuffer.length === rightBuffer.length && valuesMatch
}

export { safeEqual }
