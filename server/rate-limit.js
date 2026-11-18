function normalizeRateLimitKey(req) {
  const clientIp = req.ip || req.socket?.remoteAddress || 'unknown'
  const pathPart = (req.baseUrl || '') + (req.path || '')
  const normalizedPath = pathPart.toLowerCase().replace(/\/+$/, '') || '/'
  return `${clientIp}:${normalizedPath}`
}

function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 1000 * 60
  const maxAttempts = options.maxAttempts || 5
  const message = options.message || 'Too many attempts. Try again later.'
  const cleanupIntervalMs = options.cleanupIntervalMs || windowMs
  const attempts = new Map()
  let lastCleanupAt = 0

  const limiter = function rateLimit(req, res, next) {
    const now = Date.now()
    if (now - lastCleanupAt >= cleanupIntervalMs) {
      pruneExpiredAttempts(attempts, now)
      lastCleanupAt = now
    }

    const maxEntries = 5000
    if (attempts.size >= maxEntries) {
      pruneExpiredAttempts(attempts, now)
      if (attempts.size >= maxEntries) {
        let count = 0
        const toEvict = attempts.size - 4000
        for (const k of attempts.keys()) {
          if (count++ >= toEvict) break
          attempts.delete(k)
        }
      }
    }

    const key = normalizeRateLimitKey(req)
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

  limiter.reset = function reset(req) {
    const key = normalizeRateLimitKey(req)
    attempts.delete(key)
  }

  return limiter
}

function pruneExpiredAttempts(attempts, now = Date.now()) {
  for (const [key, record] of attempts.entries()) {
    if (record.resetAt <= now) {
      attempts.delete(key)
    }
  }
}

export { createRateLimiter, pruneExpiredAttempts }
