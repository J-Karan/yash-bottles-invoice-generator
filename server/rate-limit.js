function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 1000 * 60
  const maxAttempts = options.maxAttempts || 5
  const message = options.message || 'Too many attempts. Try again later.'
  const attempts = new Map()

  return function rateLimit(req, res, next) {
    const now = Date.now()
    const key = `${req.ip || req.socket?.remoteAddress || 'unknown'}:${req.path}`
    const record = attempts.get(key) || { count: 0, resetAt: now + windowMs }

    if (record.resetAt <= now) {
      record.count = 0
      record.resetAt = now + windowMs
    }

    record.count += 1
    attempts.set(key, record)

    if (record.count > maxAttempts) {
      res.status(429).json({ error: message })
      return
    }

    next()
  }
}

export { createRateLimiter }
