import { useEffect, useState } from 'react'
import { getStoredAdminToken } from '../invoice-utils.js'

function useAdminAuth({
  appFetch,
  appToken,
  clearAdminWorkspace,
  readResponseJson,
}) {
  const [adminToken, setAdminToken] = useState(getStoredAdminToken)
  const [adminPasswordInput, setAdminPasswordInput] = useState('')
  const [showAdminPassword, setShowAdminPassword] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    if (!adminToken) {
      return
    }

    verifyAdminSession()
  }, [adminToken])

  async function verifyAdminSession() {
    try {
      const response = await appFetch('/api/admin/session', {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      })

      if (!response.ok) {
        clearAdminSession()
      }
    } catch {
      clearAdminSession()
    }
  }

  async function adminFetch(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'X-Invoice-Session': appToken,
        Authorization: `Bearer ${adminToken}`,
      },
    })

    if (response.status === 401) {
      clearAdminSession()
    }

    return response
  }

  function clearAdminSession() {
    localStorage.removeItem('invoiceAdminToken')
    setAdminToken('')
    setAuthError('Admin session ended. Log in again.')
  }

  async function handleAdminLogin(event) {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError('')

    try {
      const response = await appFetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: adminPasswordInput }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to log in.')
      }

      localStorage.setItem('invoiceAdminToken', data.token)
      setAdminToken(data.token)
      setAdminPasswordInput('')
      setShowAdminPassword(false)
    } catch (loginError) {
      setAuthError(loginError.message)
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleAdminLogout() {
    try {
      await appFetch('/api/admin/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      })
    } catch {
      // Ignore logout failures and clear the local session.
    } finally {
      localStorage.removeItem('invoiceAdminToken')
      setAdminToken('')
      setAuthError('')
      setShowAdminPassword(false)
      clearAdminWorkspace()
    }
  }

  function clearAdminToken() {
    localStorage.removeItem('invoiceAdminToken')
    setAdminToken('')
  }

  return {
    adminFetch,
    adminPasswordInput,
    adminToken,
    authBusy,
    authError,
    clearAdminToken,
    handleAdminLogin,
    handleAdminLogout,
    setAdminPasswordInput,
    setShowAdminPassword,
    showAdminPassword,
  }
}

export { useAdminAuth }
