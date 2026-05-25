import { appPassword, appUsername } from './config.js'
import { safeEqual } from './secret-utils.js'
import crypto from 'crypto'

const sessionTtlMs = 1000 * 60 * 60 * 12
const appSessions = new Map()

function createAppSession() {
  const token = crypto.randomBytes(32).toString('hex')
  appSessions.set(token, Date.now() + sessionTtlMs)
  return token
}

function extractAppSessionToken(req) {
  const explicitHeader = req.get('x-invoice-session') || ''
  if (explicitHeader) {
    return explicitHeader
  }

  const bearerHeader = req.get('authorization') || ''
  const match = bearerHeader.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : ''
}

function invalidateAppSession(token) {
  if (!token) {
    return
  }
  appSessions.delete(token)
}

function requireAppSession(req, res, next) {
  const token = extractAppSessionToken(req)
  if (!token) {
    res.status(401).json({ error: 'Login required.' })
    return
  }

  const expiry = appSessions.get(token)
  if (!expiry || expiry < Date.now()) {
    appSessions.delete(token)
    res.status(401).json({ error: 'Session expired. Log in again.' })
    return
  }

  appSessions.set(token, Date.now() + sessionTtlMs)
  next()
}

function credentialsMatch(username, password) {
  return safeEqual(username, appUsername) && safeEqual(password, appPassword)
}

export {
  createAppSession,
  credentialsMatch,
  extractAppSessionToken,
  invalidateAppSession,
  requireAppSession,
}
