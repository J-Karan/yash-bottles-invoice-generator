import crypto from 'crypto'

const sessionTtlMs = 1000 * 60 * 60 * 8
const adminSessions = new Map()

function createAdminSession() {
  const token = crypto.randomBytes(24).toString('hex')
  adminSessions.set(token, Date.now() + sessionTtlMs)
  return token
}

function extractBearerToken(req) {
  const header = req.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : ''
}

function invalidateAdminSession(token) {
  if (!token) {
    return
  }
  adminSessions.delete(token)
}

function requireAdmin(req, res, next) {
  const token = extractBearerToken(req)
  if (!token) {
    res.status(401).json({ error: 'Admin login required.' })
    return
  }

  const expiry = adminSessions.get(token)
  if (!expiry || expiry < Date.now()) {
    adminSessions.delete(token)
    res.status(401).json({ error: 'Admin session is invalid or expired.' })
    return
  }

  adminSessions.set(token, Date.now() + sessionTtlMs)
  next()
}

export { createAdminSession, extractBearerToken, invalidateAdminSession, requireAdmin }
