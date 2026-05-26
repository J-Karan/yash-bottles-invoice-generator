import { useEffect, useMemo, useState } from 'react'
import { AdminAuthPanel } from './components/AdminAuthPanel.jsx'
import { AdminBuyerPanel } from './components/AdminBuyerPanel.jsx'
import { AdminItemPanel } from './components/AdminItemPanel.jsx'
import { DeleteConfirmModal } from './components/DeleteConfirmModal.jsx'
import { InvoiceHistory } from './components/InvoiceHistory.jsx'
import { LoginScreen } from './components/LoginScreen.jsx'
import { PaymentModal } from './components/PaymentModal.jsx'
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher.jsx'
import {
  buildShipToOptions,
  createInitialInvoiceForm,
  createLineItem,
  defaultPaymentSummary,
  emptyBuyerForm,
  emptyItemForm,
  formatDisplayDate,
  formatMoney,
  getStoredAdminToken,
  getStoredAppToken,
  maxLineItems,
  resolveShipToOptionId,
  syncInvoiceForm,
} from './invoice-utils.js'
import './App.css'

const ewayBillPortalUrl = 'https://ewaybillgst.gov.in/Login.aspx'
const vehicleNumberPattern = '^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$'
const vehicleNumberRegex = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$/

function App() {
  const [appToken, setAppToken] = useState(getStoredAppToken)
  const [appSessionChecking, setAppSessionChecking] = useState(Boolean(getStoredAppToken()))
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [activeView, setActiveView] = useState('invoice')
  const [buyers, setBuyers] = useState([])
  const [items, setItems] = useState([])
  const [form, setForm] = useState(createInitialInvoiceForm())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [editingInvoice, setEditingInvoice] = useState(null)
  const [historyActionBusyKey, setHistoryActionBusyKey] = useState('')

  const [buyerForm, setBuyerForm] = useState(emptyBuyerForm)
  const [itemForm, setItemForm] = useState(emptyItemForm)
  const [savingBuyer, setSavingBuyer] = useState(false)
  const [savingItem, setSavingItem] = useState(false)
  const [buyerStatus, setBuyerStatus] = useState('')
  const [itemStatus, setItemStatus] = useState('')
  const [buyerError, setBuyerError] = useState('')
  const [itemError, setItemError] = useState('')
  const [editingBuyerCode, setEditingBuyerCode] = useState('')
  const [editingItemCode, setEditingItemCode] = useState('')
  const [adminToken, setAdminToken] = useState(getStoredAdminToken)
  const [adminPasswordInput, setAdminPasswordInput] = useState('')
  const [showAdminPassword, setShowAdminPassword] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [buyerSearch, setBuyerSearch] = useState('')
  const [itemSearch, setItemSearch] = useState('')
  const [invoiceHistory, setInvoiceHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  const [paymentSummary, setPaymentSummary] = useState(defaultPaymentSummary)
  const [paymentStatus, setPaymentStatus] = useState('')
  const [paymentError, setPaymentError] = useState('')
  const [markingPaid, setMarkingPaid] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [paymentPasswordInput, setPaymentPasswordInput] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [ewayReadiness, setEwayReadiness] = useState([])
  const [ewaySummary, setEwaySummary] = useState({ total: 0, ready: 0, needsInput: 0 })
  const [ewayLoading, setEwayLoading] = useState(false)
  const [ewayError, setEwayError] = useState('')
  const [ewayDistanceOverrides, setEwayDistanceOverrides] = useState({})

  useEffect(() => {
    if (!appToken) {
      setAppSessionChecking(false)
      setLoading(false)
      return
    }

    verifyAppSession()
  }, [appToken])

  useEffect(() => {
    if (!adminToken) {
      return
    }

    verifyAdminSession()
  }, [adminToken])

  useEffect(() => {
    if (activeView === 'history') {
      return
    }

    setPaymentModalOpen(false)
    setPaymentPasswordInput('')
    setPaymentError('')
    setPaymentStatus('')
  }, [activeView])

  const selectedBuyer = useMemo(
    () => buyers.find((buyer) => buyer.Buyer_Code === form.buyerCode),
    [buyers, form.buyerCode],
  )
  const shipToOptions = useMemo(() => buildShipToOptions(selectedBuyer), [selectedBuyer])
  const selectedShipToOption = useMemo(
    () => shipToOptions.find((option) => option.id === form.shipToOptionId) || shipToOptions[0] || null,
    [form.shipToOptionId, shipToOptions],
  )

  const computedLines = useMemo(
    () =>
      form.lineItems.map((line) => {
        const selectedItem = items.find((item) => item.Item_Code === line.itemCode)
        const bags = Number(line.bags || 0)
        const bottlesPerBag = Number(selectedItem?.Bottles_Per_Bag || 0)
        const quantity = bags * bottlesPerBag
        const grossRate = Number(selectedItem?.Gross_Rate || 0)
        const nonTaxableRate = Number(selectedItem?.Non_Taxable_Rate || 0)
        const taxableRate = grossRate - nonTaxableRate
        const amount = quantity * grossRate
        const nonTaxableValue = quantity * nonTaxableRate
        const taxableValue = quantity * taxableRate

        return {
          ...line,
          selectedItem,
          bags,
          bottlesPerBag,
          quantity,
          grossRate,
          amount,
          nonTaxableRate,
          nonTaxableValue,
          taxableRate,
          taxableValue,
        }
      }),
    [form.lineItems, items],
  )

  const computedTotals = useMemo(() => {
    const quantity = computedLines.reduce((sum, line) => sum + line.quantity, 0)
    const taxableValue = computedLines.reduce((sum, line) => sum + line.taxableValue, 0)
    const nonTaxableValue = computedLines.reduce((sum, line) => sum + line.nonTaxableValue, 0)
    const cgst = taxableValue * 0.09
    const sgst = taxableValue * 0.09
    const total = nonTaxableValue + taxableValue + cgst + sgst

    return {
      quantity,
      taxableValue,
      nonTaxableValue,
      cgst,
      sgst,
      total,
    }
  }, [computedLines])

  const filteredBuyers = useMemo(() => {
    const query = buyerSearch.trim().toLowerCase()
    if (!query) {
      return buyers
    }

    return buyers.filter((buyer) =>
      [
        buyer.Buyer_Code,
        buyer.Buyer_Name,
        buyer.GSTIN,
        buyer.City_State_Pin,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [buyerSearch, buyers])

  const filteredItems = useMemo(() => {
    const query = itemSearch.trim().toLowerCase()
    if (!query) {
      return items
    }

    return items.filter((item) =>
      [
        item.Item_Code,
        item.Description,
        item.Category,
        item.Dad_Writes_As,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [itemSearch, items])

  const filteredInvoiceHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase()
    if (!query) {
      return invoiceHistory
    }

    return invoiceHistory.filter((invoice) =>
      [
        invoice.invoiceNumber,
        invoice.invoiceDate,
        formatDisplayDate(invoice.invoiceDate),
        invoice.buyerName,
        invoice.buyerCode,
        invoice.buyerGstin,
        invoice.vehicleNumber,
        String(invoice.total),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [historySearch, invoiceHistory])

  const ewayReadinessByKey = useMemo(
    () => new Map(ewayReadiness.map((invoice) => [invoice.invoiceKey, invoice])),
    [ewayReadiness],
  )

  async function verifyAppSession() {
    setAppSessionChecking(true)
    try {
      const response = await appFetch('/api/auth/session')
      if (!response.ok) {
        throw new Error('Session expired.')
      }

      await Promise.all([refreshMasters(), refreshHistory(), refreshEwayReadiness()])
      setLoginError('')
    } catch {
      clearAppSession()
    } finally {
      setAppSessionChecking(false)
    }
  }

  async function handleAppLogin(event) {
    event.preventDefault()
    setLoginBusy(true)
    setLoginError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword,
        }),
      })
      const data = await readResponseJson(response, 'Login failed. Check that the backend server is running with required environment variables.')
      if (!response.ok) {
        throw new Error(data.error || 'Login failed.')
      }

      localStorage.setItem('invoiceAppToken', data.token)
      setAppToken(data.token)
      setLoginPassword('')
      setShowLoginPassword(false)
      setLoading(true)
    } catch (error) {
      setLoginError(error.message)
    } finally {
      setLoginBusy(false)
    }
  }

  async function handleAppLogout() {
    try {
      await appFetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // The local session is authoritative for UI state.
    } finally {
      clearAppSession()
    }
  }

  function clearAppSession() {
    localStorage.removeItem('invoiceAppToken')
    localStorage.removeItem('invoiceAdminToken')
    setAppToken('')
    setAdminToken('')
    setBuyers([])
    setItems([])
    setInvoiceHistory([])
    setEwayReadiness([])
    setResult(null)
    setEditingInvoice(null)
    setLoginPassword('')
    setLoading(false)
  }

  async function appFetch(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'X-Invoice-Session': appToken,
      },
    })
  }

  async function readResponseJson(response, fallbackMessage) {
    const text = await response.text()
    if (!text) {
      if (response.ok) {
        return {}
      }
      throw new Error(fallbackMessage || `Request failed with status ${response.status}.`)
    }

    try {
      return JSON.parse(text)
    } catch {
      throw new Error(fallbackMessage || 'Server returned an invalid response.')
    }
  }

  async function downloadProtectedFile(url, filename, setDownloadError = setError) {
    try {
      setDownloadError('')
      const response = await appFetch(url)
      if (!response.ok) {
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const data = await readResponseJson(response)
          throw new Error(data.error || 'Download failed.')
        }
        throw new Error('Download failed.')
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename || url.split('/').pop() || 'download'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (downloadError) {
      setDownloadError(downloadError.message)
    }
  }

  async function refreshMasters() {
    try {
      const response = await appFetch('/api/masters')
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load master data.')
      }

      setBuyers(data.buyers)
      setItems(data.items)
      setForm((current) => syncInvoiceForm(current, data.buyers, data.items))
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  async function refreshHistory() {
    setHistoryLoading(true)
    setHistoryError('')

    try {
      const response = await appFetch('/api/invoices/history?limit=300')
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load invoice history.')
      }

      setInvoiceHistory(Array.isArray(data.invoices) ? data.invoices : [])
      setPaymentSummary(data.paymentSummary || defaultPaymentSummary)
    } catch (loadError) {
      setHistoryError(loadError.message)
    } finally {
      setHistoryLoading(false)
    }
  }

  async function refreshEwayReadiness() {
    setEwayLoading(true)
    setEwayError('')

    try {
      const response = await appFetch('/api/eway/readiness')
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load E-way readiness.')
      }

      setEwayReadiness(Array.isArray(data.invoices) ? data.invoices : [])
      setEwaySummary(data.summary || { total: 0, ready: 0, needsInput: 0 })
    } catch (loadError) {
      setEwayError(loadError.message)
    } finally {
      setEwayLoading(false)
    }
  }

  function resetInvoiceWorkspace() {
    setEditingInvoice(null)
    setResult(null)
    setError('')
    setForm(syncInvoiceForm(createInitialInvoiceForm(), buyers, items))
  }

  function updateEwayDistance(invoiceKey, value) {
    setEwayDistanceOverrides((current) => ({
      ...current,
      [invoiceKey]: value,
    }))
  }

  function getEwayDistance(invoice) {
    return ewayDistanceOverrides[invoice.invoiceKey] ?? (invoice.distanceKm ? String(invoice.distanceKm) : '')
  }

  function canDownloadEwayJson(invoice) {
    const distance = Number(getEwayDistance(invoice))
    const unresolved = (invoice.missingFields || []).filter((field) => field !== 'distance_km')
    return unresolved.length === 0 && Number.isFinite(distance) && distance > 0
  }

  function buildEwayJsonUrl(invoice) {
    const params = new URLSearchParams()
    const distance = getEwayDistance(invoice)
    if (distance) {
      params.set('distanceKm', distance)
    }

    return `/api/eway/invoices/${encodeURIComponent(invoice.invoiceKey)}/bulk-json?${params.toString()}`
  }

  function downloadEwayJson(invoice, setDownloadError = setError) {
    window.open(ewayBillPortalUrl, '_blank', 'noopener,noreferrer')
    downloadProtectedFile(buildEwayJsonUrl(invoice), `${invoice.invoiceKey}-eway.json`, setDownloadError)
  }

  function getEwayDownloadState(invoice) {
    if (!invoice?.pdfAvailable) {
      return { canDownload: false, reason: 'PDF missing', readiness: null }
    }

    const readiness = ewayReadinessByKey.get(invoice.invoiceKey)
    if (!readiness) {
      return { canDownload: false, reason: ewayLoading ? 'Checking readiness' : 'Readiness unavailable', readiness: null }
    }

    const distance = Number(getEwayDistance(readiness))
    const unresolved = (readiness.missingFields || []).filter((field) => field !== 'distance_km')

    if (unresolved.length) {
      return { canDownload: false, reason: `Missing ${unresolved.join(', ')}`, readiness }
    }
    if (!Number.isFinite(distance) || distance <= 0) {
      return { canDownload: false, reason: 'Missing distance', readiness }
    }

    return { canDownload: true, reason: '', readiness }
  }

  function renderEwayJsonAction(invoice) {
    const state = getEwayDownloadState(invoice)

    if (state.canDownload) {
      return (
        <button
          className="text-button history-action-eway"
          type="button"
          onClick={() => downloadEwayJson(state.readiness, setHistoryError)}
        >
          E-way JSON
        </button>
      )
    }

    return <span className="history-file-missing history-action-eway">E-way JSON: {state.reason}</span>
  }

  function openPaymentModal() {
    setPaymentModalOpen(true)
    setPaymentPasswordInput('')
    setPaymentError('')
  }

  function closePaymentModal(force = false) {
    if (markingPaid && !force) {
      return
    }

    setPaymentModalOpen(false)
    setPaymentPasswordInput('')
    setPaymentError('')
  }

  async function handleMarkPaid() {
    if (!paymentPasswordInput.trim()) {
      setPaymentError('Payment password is required.')
      return
    }

    setMarkingPaid(true)
    setPaymentError('')
    setPaymentStatus('')

    try {
      const response = await appFetch('/api/invoices/mark-paid', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: paymentPasswordInput }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to mark invoices paid.')
      }

      setPaymentSummary(data.summary || defaultPaymentSummary)
      setPaymentStatus(`Marked ${data.markedCount || 0} invoice(s) as paid.`)
      closePaymentModal(true)
      await refreshHistory()
    } catch (payError) {
      setPaymentError(payError.message)
    } finally {
      setMarkingPaid(false)
    }
  }

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
      setEditingBuyerCode('')
      setEditingItemCode('')
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    const isEditingInvoice = Boolean(editingInvoice?.invoiceKey)

    try {
      if (!vehicleNumberRegex.test(form.vehicleNumber)) {
        throw new Error('Enter a valid vehicle number like MH12AB1234.')
      }

      const response = await appFetch('/api/invoices/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...form,
          editInvoiceKey: editingInvoice?.invoiceKey || '',
        }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate invoice.')
      }
      if (isEditingInvoice) {
        setEditingInvoice({
          invoiceKey: data.invoice.invoiceKey,
          invoiceNumber: data.invoice.invoiceNumber,
        })
      }
      setResult(data)
      await refreshHistory()
      await refreshEwayReadiness()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function loadInvoiceForEdit(invoice) {
    setHistoryActionBusyKey(invoice.invoiceKey)
    setHistoryError('')

    try {
      const response = await appFetch(`/api/invoices/${encodeURIComponent(invoice.invoiceKey)}`)
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load invoice.')
      }

      const draft = data.invoice
      setEditingInvoice({
        invoiceKey: draft.invoiceKey,
        invoiceNumber: draft.invoiceNumber,
      })
      setResult(null)
      setError('')
      setForm(
        syncInvoiceForm(
          {
            buyerCode: draft.buyerCode,
            shipToOptionId: draft.shipToOptionId,
            vehicleNumber: draft.vehicleNumber,
            invoiceDate: draft.invoiceDate,
            lineItems: draft.lineItems.map((line) => createLineItem(line.itemCode, String(line.bags || '1'))),
          },
          buyers,
          items,
        ),
      )
      setActiveView('invoice')
    } catch (loadError) {
      setHistoryError(loadError.message)
    } finally {
      setHistoryActionBusyKey('')
    }
  }

  async function handleDeleteInvoice(invoice) {
    setPendingDelete({
      type: 'invoice',
      invoice,
      title: `Delete invoice ${invoice.invoiceNumber}?`,
      message: 'This removes the invoice from history and deletes its generated Excel/PDF files.',
      detail: 'Only the latest invoice can be deleted, so the server will still protect older invoice numbers.',
      confirmLabel: 'Delete invoice',
    })
  }

  async function confirmDeleteInvoice(invoice) {
    setHistoryActionBusyKey(invoice.invoiceKey)
    setHistoryError('')

    try {
      const response = await appFetch(`/api/invoices/${encodeURIComponent(invoice.invoiceKey)}`, {
        method: 'DELETE',
      })
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete invoice.')
      }

      if (editingInvoice?.invoiceKey === invoice.invoiceKey) {
        resetInvoiceWorkspace()
      }
      if (result?.invoice?.invoiceKey === invoice.invoiceKey) {
        setResult(null)
      }

      await refreshHistory()
      await refreshEwayReadiness()
      setPendingDelete(null)
    } catch (deleteError) {
      setPendingDelete(null)
      setHistoryError(deleteError.message)
    } finally {
      setHistoryActionBusyKey('')
    }
  }

  function updateInvoiceField(event) {
    const { name, value } = event.target
    if (name === 'buyerCode') {
      const buyer = buyers.find((entry) => entry.Buyer_Code === value)
      setForm((current) => ({
        ...current,
        buyerCode: value,
        shipToOptionId: resolveShipToOptionId(current.shipToOptionId, buyer),
      }))
      return
    }

    setForm((current) => ({ ...current, [name]: name === 'vehicleNumber' ? value.toUpperCase().replace(/\s+/g, '') : value }))
  }

  function updateLineItem(id, field, value) {
    setForm((current) => ({
      ...current,
      lineItems: current.lineItems.map((line) =>
        line.id === id
          ? {
              ...line,
              [field]: value,
            }
          : line,
      ),
    }))
  }

  function addLineItem() {
    if (form.lineItems.length >= maxLineItems) {
      setError(`This template supports up to ${maxLineItems} item rows per invoice.`)
      return
    }

    setError('')
    setForm((current) => ({
      ...current,
      lineItems: [...current.lineItems, createLineItem(items[0]?.Item_Code || '')],
    }))
  }

  function removeLineItem(id) {
    setError('')
    setForm((current) => {
      if (current.lineItems.length === 1) {
        return current
      }

      return {
        ...current,
        lineItems: current.lineItems.filter((line) => line.id !== id),
      }
    })
  }

  function startBuyerCreate() {
    setEditingBuyerCode('')
    setBuyerForm(emptyBuyerForm)
    setBuyerError('')
    setBuyerStatus('')
  }

  function startBuyerEdit(buyer) {
    setEditingBuyerCode(buyer.Buyer_Code)
    setBuyerForm({ ...buyer })
    setBuyerError('')
    setBuyerStatus('')
  }

  async function submitBuyer(event) {
    event.preventDefault()
    setSavingBuyer(true)
    setBuyerError('')
    setBuyerStatus('')

    try {
      const isEditing = Boolean(editingBuyerCode)
      const response = await adminFetch(isEditing ? `/api/buyers/${editingBuyerCode}` : '/api/buyers', {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buyerForm),
      })
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save buyer.')
      }

      await refreshMasters()
      setEditingBuyerCode(data.buyer.Buyer_Code)
      setBuyerForm({ ...data.buyer })
      setBuyerStatus(isEditing ? 'Buyer updated.' : 'Buyer created.')
    } catch (saveError) {
      setBuyerError(saveError.message)
    } finally {
      setSavingBuyer(false)
    }
  }

  function startItemCreate() {
    setEditingItemCode('')
    setItemForm(emptyItemForm)
    setItemError('')
    setItemStatus('')
  }

  function startItemEdit(item) {
    setEditingItemCode(item.Item_Code)
    setItemForm({ ...item })
    setItemError('')
    setItemStatus('')
  }

  async function submitItem(event) {
    event.preventDefault()
    setSavingItem(true)
    setItemError('')
    setItemStatus('')

    try {
      const isEditing = Boolean(editingItemCode)
      const response = await adminFetch(isEditing ? `/api/items/${editingItemCode}` : '/api/items', {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(itemForm),
      })
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save item.')
      }

      await refreshMasters()
      setEditingItemCode(data.item.Item_Code)
      setItemForm({ ...data.item })
      setItemStatus(isEditing ? 'Item updated.' : 'Item created.')
    } catch (saveError) {
      setItemError(saveError.message)
    } finally {
      setSavingItem(false)
    }
  }

  async function removeBuyer() {
    if (!editingBuyerCode) {
      return
    }
    setPendingDelete({
      type: 'buyer',
      buyerCode: editingBuyerCode,
      title: `Delete buyer ${editingBuyerCode}?`,
      message: 'This removes the buyer from the master list.',
      detail: 'Buyers already used in invoice history cannot be deleted.',
      confirmLabel: 'Delete buyer',
    })
  }

  async function confirmDeleteBuyer(buyerCode) {
    setSavingBuyer(true)
    setBuyerError('')
    setBuyerStatus('')

    try {
      const response = await adminFetch(`/api/buyers/${buyerCode}`, { method: 'DELETE' })
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete buyer.')
      }

      await refreshMasters()
      startBuyerCreate()
      setBuyerStatus('Buyer deleted.')
      setPendingDelete(null)
    } catch (deleteError) {
      setPendingDelete(null)
      setBuyerError(deleteError.message)
    } finally {
      setSavingBuyer(false)
    }
  }

  async function removeItem() {
    if (!editingItemCode) {
      return
    }
    setPendingDelete({
      type: 'item',
      itemCode: editingItemCode,
      title: `Delete item ${editingItemCode}?`,
      message: 'This removes the item from the master list.',
      detail: 'Items already used in invoice history cannot be deleted.',
      confirmLabel: 'Delete item',
    })
  }

  async function confirmDeleteItem(itemCode) {
    setSavingItem(true)
    setItemError('')
    setItemStatus('')

    try {
      const response = await adminFetch(`/api/items/${itemCode}`, { method: 'DELETE' })
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete item.')
      }

      await refreshMasters()
      startItemCreate()
      setItemStatus('Item deleted.')
      setPendingDelete(null)
    } catch (deleteError) {
      setPendingDelete(null)
      setItemError(deleteError.message)
    } finally {
      setSavingItem(false)
    }
  }

  function closeDeleteModal() {
    if (historyActionBusyKey || savingBuyer || savingItem) {
      return
    }

    setPendingDelete(null)
  }

  function confirmPendingDelete() {
    if (!pendingDelete) {
      return
    }

    if (pendingDelete.type === 'invoice') {
      confirmDeleteInvoice(pendingDelete.invoice)
      return
    }

    if (pendingDelete.type === 'buyer') {
      confirmDeleteBuyer(pendingDelete.buyerCode)
      return
    }

    if (pendingDelete.type === 'item') {
      confirmDeleteItem(pendingDelete.itemCode)
    }
  }

  const deleteBusy = Boolean(historyActionBusyKey || savingBuyer || savingItem)

  const generatedEwayState = result
    ? getEwayDownloadState({
        invoiceKey: result.invoice.invoiceKey,
        pdfAvailable: Boolean(result.files?.pdf),
      })
    : { canDownload: false, reason: 'PDF not generated yet', readiness: null }

  if (appSessionChecking) {
    return (
      <main className="app-shell app-shell-loading">
        <p className="status-card">Checking secure session...</p>
      </main>
    )
  }

  if (!appToken) {
    return (
      <LoginScreen
        loginUsername={loginUsername}
        setLoginUsername={setLoginUsername}
        loginPassword={loginPassword}
        setLoginPassword={setLoginPassword}
        showLoginPassword={showLoginPassword}
        setShowLoginPassword={setShowLoginPassword}
        loginError={loginError}
        loginBusy={loginBusy}
        onSubmit={handleAppLogin}
      />
    )
  }

  if (loading) {
    return (
      <main className="app-shell app-shell-loading">
        <p className="status-card">Loading master data...</p>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className="hero workspace-hero">
        <div>
          <p className="eyebrow">Yash Bottles</p>
          <h1>Invoice generation and master data management in one workspace.</h1>
          <p className="hero-copy">
            Use the invoice tab for document generation and use the buyers or items tabs to maintain
            live SQLite master data without editing CSV files manually.
          </p>
          <div className="hero-metrics">
            <div>
              <span>Buyers</span>
              <strong>{buyers.length}</strong>
            </div>
            <div>
              <span>Items</span>
              <strong>{items.length}</strong>
            </div>
            <div>
              <span>Invoice Rows</span>
              <strong>{form.lineItems.length}</strong>
            </div>
          </div>
        </div>
        <div className="hero-badge">
          <span>Live Storage</span>
          <strong>SQLite-backed masters</strong>
          <p>Invoice generation still uses the same payload and PDF behavior.</p>
          <div className="hero-badge-grid">
            <div>
              <small>Buyer Source</small>
              <b>SQLite</b>
            </div>
            <div>
              <small>Item Source</small>
              <b>SQLite</b>
            </div>
          </div>
        </div>
      </section>

      <WorkspaceSwitcher
        activeView={activeView}
        setActiveView={setActiveView}
        adminToken={adminToken}
        onAdminLogout={handleAdminLogout}
        onAppLogout={handleAppLogout}
      />

      {activeView === 'invoice' ? (
        <section className="content-grid">
          <form className="panel form-panel" onSubmit={handleSubmit}>
            <div className="panel-header">
              <h2>Invoice details</h2>
              <p>
                {editingInvoice
                  ? `Editing ${editingInvoice.invoiceNumber}. Saving will overwrite its Excel and PDF files.`
                  : 'Buyer and item options now come from SQLite-backed master data.'}
              </p>
            </div>

            {editingInvoice ? (
              <div className="downloads">
                <p>
                  Editing invoice <strong>{editingInvoice.invoiceNumber}</strong>. Regenerating will rewrite the previous files.
                </p>
                <div className="download-actions">
                  <button className="secondary-button" type="button" onClick={resetInvoiceWorkspace}>
                    Start new invoice
                  </button>
                </div>
              </div>
            ) : null}

            <div className="top-fields">
              <label className="field-span-2">
                <span>Buyer name</span>
                <select name="buyerCode" value={form.buyerCode} onChange={updateInvoiceField}>
                  {buyers.map((buyer) => (
                    <option key={buyer.Buyer_Code} value={buyer.Buyer_Code}>
                      {buyer.Buyer_Name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-span-2">
                <span>Ship to address</span>
                <select name="shipToOptionId" value={form.shipToOptionId} onChange={updateInvoiceField}>
                  {shipToOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Vehicle number</span>
                <input
                  name="vehicleNumber"
                  value={form.vehicleNumber}
                  onChange={updateInvoiceField}
                  placeholder="MH12AB1234"
                  pattern={vehicleNumberPattern}
                  title="Use an Indian vehicle number like MH12AB1234."
                  required
                />
                <small className="field-hint">
                  Format example: MH12AB1234. Spaces are removed automatically.
                </small>
              </label>

              <label>
                <span>Invoice date</span>
                <input name="invoiceDate" type="date" value={form.invoiceDate} onChange={updateInvoiceField} required />
              </label>
            </div>

            <div className="line-items-section">
              <div className="line-items-header">
                <div>
                  <span className="section-label">Invoice items</span>
                  <p>Add as many item rows as you need.</p>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={addLineItem}
                  disabled={form.lineItems.length >= maxLineItems}
                >
                  Add item
                </button>
              </div>

              <p className="hint-text">Current Excel template supports up to {maxLineItems} item rows.</p>
              {form.lineItems.length >= maxLineItems ? (
                <p className="inline-warning">Maximum {maxLineItems} item rows reached for this Excel template.</p>
              ) : null}

              <div className="line-items-list">
                {computedLines.map((line, index) => (
                  <article className="line-item-card" key={line.id}>
                    <div className="line-item-topbar">
                      <strong>Item {index + 1}</strong>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => removeLineItem(line.id)}
                        disabled={form.lineItems.length === 1}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="line-item-layout">
                      <div className="line-item-fields">
                        <label>
                          <span>Description of item</span>
                          <select
                            value={line.itemCode}
                            onChange={(event) => updateLineItem(line.id, 'itemCode', event.target.value)}
                          >
                            {items.map((item) => (
                              <option key={item.Item_Code} value={item.Item_Code}>
                                {item.Description}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>Number of bags</span>
                          <input
                            type="number"
                            min="1"
                            value={line.bags}
                            onChange={(event) => updateLineItem(line.id, 'bags', event.target.value)}
                            required
                          />
                        </label>
                      </div>

                      <div className="line-item-metrics">
                        <div className="metric-card">
                          <span className="metric-label">Qty</span>
                          <strong className="metric-value">{line.quantity || 0}</strong>
                          <small className="metric-note">
                            {line.bags || 0} x {line.bottlesPerBag || 0}
                          </small>
                        </div>
                        <div className="metric-card">
                          <span className="metric-label">Gross rate</span>
                          <strong className="metric-value">{formatMoney(line.grossRate)}</strong>
                          <small className="metric-note">Per piece</small>
                        </div>
                        <div className="metric-card">
                          <span className="metric-label">Taxable rate</span>
                          <strong className="metric-value">{formatMoney(line.taxableRate)}</strong>
                          <small className="metric-note">Per piece</small>
                        </div>
                        <div className="metric-card">
                          <span className="metric-label">Line taxable</span>
                          <strong className="metric-value">{formatMoney(line.taxableValue)}</strong>
                          <small className="metric-note">HSN {line.selectedItem?.HSN_Code || '7010'}</small>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="calc-grid">
              <article>
                <span>Qty</span>
                <strong>{computedTotals.quantity || 0}</strong>
                <small>Total across all items</small>
              </article>
              <article>
                <span>Taxable value</span>
                <strong>{formatMoney(computedTotals.taxableValue)}</strong>
                <small>Combined taxable amount</small>
              </article>
              <article>
                <span>Grand total</span>
                <strong>{formatMoney(computedTotals.total)}</strong>
                <small>Including CGST + SGST</small>
              </article>
            </div>

            {error ? <p className="error-banner">{error}</p> : null}

            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? 'Generating files...' : editingInvoice ? 'Regenerate invoice' : 'Generate invoice'}
            </button>
          </form>

          <section className="panel preview-panel">
            <div className="panel-header">
              <h2>Live preview</h2>
              <p>The generated Excel uses your template workbook. The PDF uses the same invoice data.</p>
            </div>

            <div className="invoice-card">
              <header>
                <div>
                  <p className="mini-label">Buyer</p>
                  <h3>{selectedBuyer?.Buyer_Name || 'Select a buyer'}</h3>
                </div>
                <div>
                  <p className="mini-label">Vehicle</p>
                  <h3>{form.vehicleNumber || 'Not entered yet'}</h3>
                </div>
              </header>

              <div className="preview-rate-bar">
                <div>
                  <span>Ship to mode</span>
                  <strong>{selectedShipToOption?.id === 'bill_to' ? 'Bill To' : 'Bill To - Ship To'}</strong>
                </div>
                <div>
                  <span>Ship to party</span>
                  <strong>{selectedShipToOption?.shipToName || 'SAME As TO'}</strong>
                </div>
              </div>

              <div className="preview-lines">
                {computedLines.map((line, index) => (
                  <div className="preview-line" key={line.id}>
                    <div className="preview-line-head">
                      <div>
                        <p className="mini-label">Item {index + 1}</p>
                        <h3>{line.selectedItem ? `${line.selectedItem.Description} (${line.bags || 0} bags)` : '--'}</h3>
                      </div>
                      <div className="preview-chip">HSN {line.selectedItem?.HSN_Code || '7010'}</div>
                    </div>
                    <div className="preview-rate-bar">
                      <div>
                        <span>Gross rate</span>
                        <strong>{formatMoney(line.grossRate)}</strong>
                      </div>
                      <div>
                        <span>Taxable rate / piece</span>
                        <strong>{formatMoney(line.taxableRate)}</strong>
                      </div>
                      <div>
                        <span>Amount</span>
                        <strong>{formatMoney(line.amount)}</strong>
                      </div>
                    </div>
                    <dl className="invoice-meta">
                      <div>
                        <dt>Bags</dt>
                        <dd>{line.bags || 0}</dd>
                      </div>
                      <div>
                        <dt>Quantity</dt>
                        <dd>{line.quantity || 0}</dd>
                      </div>
                      <div>
                        <dt>Line total</dt>
                        <dd>{formatMoney(line.amount)}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>

              <div className="totals">
                <div>
                  <span>Taxable value</span>
                  <strong>{formatMoney(computedTotals.taxableValue)}</strong>
                </div>
                <div>
                  <span>Non-taxable</span>
                  <strong>{formatMoney(computedTotals.nonTaxableValue)}</strong>
                </div>
                <div>
                  <span>CGST 9%</span>
                  <strong>{formatMoney(computedTotals.cgst)}</strong>
                </div>
                <div>
                  <span>SGST 9%</span>
                  <strong>{formatMoney(computedTotals.sgst)}</strong>
                </div>
                <div className="grand-total">
                  <span>Total</span>
                  <strong>{formatMoney(computedTotals.total)}</strong>
                </div>
              </div>
            </div>

            {result ? (
              <div className="downloads">
                <p>
                  {editingInvoice ? 'Updated invoice ' : 'Generated invoice '}
                  <strong>{result.invoice.invoiceNumber}</strong>
                </p>
                <div className="download-actions">
                  <button
                    type="button"
                    onClick={() => downloadProtectedFile(result.files.excel, `${result.invoice.invoiceKey}.xlsx`, setError)}
                  >
                    Download Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadProtectedFile(result.files.pdf, `${result.invoice.invoiceKey}.pdf`, setError)}
                  >
                    Download PDF
                  </button>
                  {generatedEwayState.canDownload ? (
                    <button
                      type="button"
                      onClick={() => downloadEwayJson(generatedEwayState.readiness, setError)}
                    >
                      Download E-way JSON
                    </button>
                  ) : (
                    <span className="download-disabled">E-way JSON: {generatedEwayState.reason}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="downloads downloads-muted">
                <p className="hint-text">Generate an invoice to get downloadable Excel, PDF, and E-way JSON files.</p>
                <div className="download-actions">
                  <span className="download-disabled">Download E-way JSON: PDF not generated yet</span>
                </div>
              </div>
            )}
          </section>
        </section>
      ) : null}

      {activeView === 'history' ? (
        <InvoiceHistory
          ewayError={ewayError}
          ewayLoading={ewayLoading}
          filteredInvoiceHistory={filteredInvoiceHistory}
          handleDeleteInvoice={handleDeleteInvoice}
          historyActionBusyKey={historyActionBusyKey}
          historyError={historyError}
          historyLoading={historyLoading}
          historySearch={historySearch}
          invoiceHistory={invoiceHistory}
          loadInvoiceForEdit={loadInvoiceForEdit}
          markingPaid={markingPaid}
          onDownloadProtectedFile={(url, filename) => downloadProtectedFile(url, filename, setHistoryError)}
          onOpenPaymentModal={openPaymentModal}
          onRefreshEwayReadiness={refreshEwayReadiness}
          onRefreshHistory={refreshHistory}
          onRenderEwayJsonAction={renderEwayJsonAction}
          paymentError={paymentError}
          paymentStatus={paymentStatus}
          paymentSummary={paymentSummary}
          setHistorySearch={setHistorySearch}
        />
      ) : null}
      {activeView === 'history' && paymentModalOpen ? (
        <PaymentModal
          paymentSummary={paymentSummary}
          paymentPasswordInput={paymentPasswordInput}
          setPaymentPasswordInput={setPaymentPasswordInput}
          paymentError={paymentError}
          markingPaid={markingPaid}
          onClose={closePaymentModal}
          onConfirm={handleMarkPaid}
        />
      ) : null}
      {pendingDelete ? (
        <DeleteConfirmModal
          title={pendingDelete.title}
          message={pendingDelete.message}
          detail={pendingDelete.detail}
          confirmLabel={pendingDelete.confirmLabel}
          busy={deleteBusy}
          onCancel={closeDeleteModal}
          onConfirm={confirmPendingDelete}
        />
      ) : null}

      {(activeView === 'buyers' || activeView === 'items') && !adminToken ? (
        <AdminAuthPanel
          adminPasswordInput={adminPasswordInput}
          setAdminPasswordInput={setAdminPasswordInput}
          showAdminPassword={showAdminPassword}
          setShowAdminPassword={setShowAdminPassword}
          authError={authError}
          authBusy={authBusy}
          onSubmit={handleAdminLogin}
        />
      ) : null}

      {activeView === 'buyers' && adminToken ? (
        <AdminBuyerPanel
          buyerError={buyerError}
          buyerForm={buyerForm}
          buyerSearch={buyerSearch}
          buyerStatus={buyerStatus}
          editingBuyerCode={editingBuyerCode}
          filteredBuyers={filteredBuyers}
          onRemoveBuyer={removeBuyer}
          onStartBuyerCreate={startBuyerCreate}
          onStartBuyerEdit={startBuyerEdit}
          onSubmitBuyer={submitBuyer}
          savingBuyer={savingBuyer}
          setBuyerForm={setBuyerForm}
          setBuyerSearch={setBuyerSearch}
        />
      ) : null}
      {activeView === 'items' && adminToken ? (
        <AdminItemPanel
          editingItemCode={editingItemCode}
          filteredItems={filteredItems}
          itemError={itemError}
          itemForm={itemForm}
          itemSearch={itemSearch}
          itemStatus={itemStatus}
          onRemoveItem={removeItem}
          onStartItemCreate={startItemCreate}
          onStartItemEdit={startItemEdit}
          onSubmitItem={submitItem}
          savingItem={savingItem}
          setItemForm={setItemForm}
          setItemSearch={setItemSearch}
        />
      ) : null}
    </main>
  )
}

export default App
