import { useEffect, useMemo, useState } from 'react'
import './App.css'

const maxLineItems = 8

const emptyBuyerForm = {
  Buyer_Code: '',
  Buyer_Name: '',
  Address_Line1: '',
  Address_Line2: '',
  Address_Line3: '',
  City_State_Pin: '',
  GSTIN: '',
  Ship_To_Name: '',
  Ship_To_Address: '',
}

const emptyItemForm = {
  Item_Code: '',
  Description: '',
  HSN_Code: '7010',
  Gross_Rate: '',
  Non_Taxable_Rate: '',
  Bottles_Per_Bag: '',
  Dad_Writes_As: '',
  Category: '',
}

function createLineItem(itemCode = '') {
  return {
    id: crypto.randomUUID(),
    itemCode,
    bags: '1',
  }
}

function createInitialInvoiceForm(defaultBuyerCode = '', defaultItemCode = '') {
  return {
    buyerCode: defaultBuyerCode,
    vehicleNumber: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    lineItems: [createLineItem(defaultItemCode)],
  }
}

function syncInvoiceForm(current, buyers, items) {
  const buyerCode = buyers.some((buyer) => buyer.Buyer_Code === current.buyerCode)
    ? current.buyerCode
    : buyers[0]?.Buyer_Code || ''
  const fallbackItemCode = items[0]?.Item_Code || ''
  const lineItems =
    current.lineItems.length > 0
      ? current.lineItems.map((line) => ({
          ...line,
          itemCode: items.some((item) => item.Item_Code === line.itemCode) ? line.itemCode : fallbackItemCode,
        }))
      : [createLineItem(fallbackItemCode)]

  return {
    ...current,
    buyerCode,
    lineItems,
  }
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

function formatDisplayDate(value) {
  if (!value) {
    return '--'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return '--'
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}

function formatDisplayDateTime(value) {
  if (!value) {
    return '--'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return '--'
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function getStoredAdminToken() {
  return localStorage.getItem('invoiceAdminToken') || ''
}

function App() {
  const [activeView, setActiveView] = useState('invoice')
  const [buyers, setBuyers] = useState([])
  const [items, setItems] = useState([])
  const [form, setForm] = useState(createInitialInvoiceForm())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

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

  useEffect(() => {
    refreshMasters()
    refreshHistory()
  }, [])

  useEffect(() => {
    if (!adminToken) {
      return
    }

    verifyAdminSession()
  }, [adminToken])

  const selectedBuyer = useMemo(
    () => buyers.find((buyer) => buyer.Buyer_Code === form.buyerCode),
    [buyers, form.buyerCode],
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

  async function refreshMasters() {
    try {
      const response = await fetch('/api/masters')
      const data = await response.json()
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
      const response = await fetch('/api/invoices/history?limit=300')
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load invoice history.')
      }

      setInvoiceHistory(Array.isArray(data.invoices) ? data.invoices : [])
    } catch (loadError) {
      setHistoryError(loadError.message)
    } finally {
      setHistoryLoading(false)
    }
  }

  async function verifyAdminSession() {
    try {
      const response = await fetch('/api/admin/session', {
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
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: adminPasswordInput }),
      })
      const data = await response.json()
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
      await fetch('/api/admin/logout', {
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

    try {
      const response = await fetch('/api/invoices/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate invoice.')
      }
      setResult(data)
      await refreshHistory()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function updateInvoiceField(event) {
    const { name, value } = event.target
    setForm((current) => ({
      ...current,
      [name]: value,
    }))
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

    setForm((current) => ({
      ...current,
      lineItems: [...current.lineItems, createLineItem(items[0]?.Item_Code || '')],
    }))
  }

  function removeLineItem(id) {
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
      const data = await response.json()
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
      const data = await response.json()
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
    const confirmed = window.confirm(`Delete buyer ${editingBuyerCode}?`)
    if (!confirmed) {
      return
    }

    setSavingBuyer(true)
    setBuyerError('')
    setBuyerStatus('')

    try {
      const response = await adminFetch(`/api/buyers/${editingBuyerCode}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete buyer.')
      }

      await refreshMasters()
      startBuyerCreate()
      setBuyerStatus('Buyer deleted.')
    } catch (deleteError) {
      setBuyerError(deleteError.message)
    } finally {
      setSavingBuyer(false)
    }
  }

  async function removeItem() {
    if (!editingItemCode) {
      return
    }
    const confirmed = window.confirm(`Delete item ${editingItemCode}?`)
    if (!confirmed) {
      return
    }

    setSavingItem(true)
    setItemError('')
    setItemStatus('')

    try {
      const response = await adminFetch(`/api/items/${editingItemCode}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete item.')
      }

      await refreshMasters()
      startItemCreate()
      setItemStatus('Item deleted.')
    } catch (deleteError) {
      setItemError(deleteError.message)
    } finally {
      setSavingItem(false)
    }
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

      <section className="workspace-switcher">
        <button
          className={`view-chip ${activeView === 'invoice' ? 'view-chip-active' : ''}`}
          type="button"
          onClick={() => setActiveView('invoice')}
        >
          Invoice Workspace
        </button>
        <button
          className={`view-chip ${activeView === 'history' ? 'view-chip-active' : ''}`}
          type="button"
          onClick={() => setActiveView('history')}
        >
          Invoice History
        </button>
        <button
          className={`view-chip ${activeView === 'buyers' ? 'view-chip-active' : ''}`}
          type="button"
          onClick={() => setActiveView('buyers')}
        >
          Manage Buyers
        </button>
        <button
          className={`view-chip ${activeView === 'items' ? 'view-chip-active' : ''}`}
          type="button"
          onClick={() => setActiveView('items')}
        >
          Manage Items
        </button>
        {adminToken ? (
          <button className="view-chip" type="button" onClick={handleAdminLogout}>
            Log Out Admin
          </button>
        ) : null}
      </section>

      {activeView === 'invoice' ? (
        <section className="content-grid">
          <form className="panel form-panel" onSubmit={handleSubmit}>
            <div className="panel-header">
              <h2>Invoice details</h2>
              <p>Buyer and item options now come from SQLite-backed master data.</p>
            </div>

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

              <label>
                <span>Vehicle number</span>
                <input
                  name="vehicleNumber"
                  value={form.vehicleNumber}
                  onChange={updateInvoiceField}
                  placeholder="MH12AB1234"
                />
              </label>

              <label>
                <span>Invoice date</span>
                <input name="invoiceDate" type="date" value={form.invoiceDate} onChange={updateInvoiceField} />
              </label>
            </div>

            <div className="line-items-section">
              <div className="line-items-header">
                <div>
                  <span className="section-label">Invoice items</span>
                  <p>Add as many item rows as you need.</p>
                </div>
                <button className="secondary-button" type="button" onClick={addLineItem}>
                  Add item
                </button>
              </div>

              <p className="hint-text">Current Excel template supports up to {maxLineItems} item rows.</p>

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
              {submitting ? 'Generating files...' : 'Generate invoice'}
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
                  Generated invoice <strong>{result.invoice.invoiceNumber}</strong>
                </p>
                <div className="download-actions">
                  <a href={result.files.excel} target="_blank" rel="noreferrer">
                    Download Excel
                  </a>
                  <a href={result.files.pdf} target="_blank" rel="noreferrer">
                    Download PDF
                  </a>
                </div>
              </div>
            ) : (
              <p className="hint-text">Generate an invoice to get downloadable Excel and PDF files.</p>
            )}
          </section>
        </section>
      ) : null}

      {activeView === 'history' ? (
        <section className="panel history-panel">
          <div className="panel-header panel-header-row">
            <div>
              <h2>Invoice History</h2>
              <p>Review previously generated invoices and download available files.</p>
            </div>
            <button className="secondary-button" type="button" onClick={refreshHistory} disabled={historyLoading}>
              {historyLoading ? 'Refreshing...' : 'Refresh history'}
            </button>
          </div>

          <div className="history-overview">
            <article>
              <span>Records</span>
              <strong>{invoiceHistory.length}</strong>
            </article>
            <article>
              <span>Filtered</span>
              <strong>{filteredInvoiceHistory.length}</strong>
            </article>
            <article>
              <span>Total value</span>
              <strong>{formatMoney(filteredInvoiceHistory.reduce((sum, entry) => sum + Number(entry.total || 0), 0))}</strong>
            </article>
          </div>

          <label className="search-field history-search">
            <span>Search history</span>
            <input
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
              placeholder="Invoice no, buyer, vehicle, GSTIN"
            />
          </label>

          {historyError ? <p className="error-banner">{historyError}</p> : null}
          {historyLoading ? <p className="hint-text">Loading invoice history...</p> : null}
          {!historyLoading && !filteredInvoiceHistory.length ? (
            <p className="hint-text">No invoices found for the current filter.</p>
          ) : null}

          {!historyLoading && filteredInvoiceHistory.length ? (
            <div className="history-results">
              <div className="history-table-wrap">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Date</th>
                      <th>Buyer</th>
                      <th>Vehicle</th>
                      <th>Lines</th>
                      <th>Total</th>
                      <th>Files</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInvoiceHistory.map((invoice) => (
                      <tr key={invoice.invoiceNumber}>
                        <td>
                          <strong>{invoice.invoiceNumber}</strong>
                          <small>{formatDisplayDateTime(invoice.createdAt)}</small>
                        </td>
                        <td>{formatDisplayDate(invoice.invoiceDate)}</td>
                        <td>
                          <strong>{invoice.buyerName}</strong>
                          <small>{invoice.buyerCode}</small>
                        </td>
                        <td>{invoice.vehicleNumber}</td>
                        <td>{invoice.lineCount}</td>
                        <td>{formatMoney(invoice.total)}</td>
                        <td>
                          <div className="history-downloads">
                            {invoice.excelAvailable ? (
                              <a href={invoice.files.excel} target="_blank" rel="noreferrer">
                                Excel
                              </a>
                            ) : (
                              <span className="history-file-missing">Excel missing</span>
                            )}
                            {invoice.pdfAvailable ? (
                              <a href={invoice.files.pdf} target="_blank" rel="noreferrer">
                                PDF
                              </a>
                            ) : (
                              <span className="history-file-missing">PDF missing</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="history-mobile-list">
                {filteredInvoiceHistory.map((invoice) => (
                  <article className="history-mobile-card" key={`${invoice.invoiceNumber}-mobile`}>
                    <div className="history-mobile-head">
                      <strong>{invoice.invoiceNumber}</strong>
                      <span>{formatDisplayDate(invoice.invoiceDate)}</span>
                    </div>

                    <dl className="history-mobile-meta">
                      <div>
                        <dt>Buyer</dt>
                        <dd>{invoice.buyerName}</dd>
                      </div>
                      <div>
                        <dt>Code</dt>
                        <dd>{invoice.buyerCode}</dd>
                      </div>
                      <div>
                        <dt>Vehicle</dt>
                        <dd>{invoice.vehicleNumber || '--'}</dd>
                      </div>
                      <div>
                        <dt>Lines</dt>
                        <dd>{invoice.lineCount}</dd>
                      </div>
                      <div>
                        <dt>Total</dt>
                        <dd>{formatMoney(invoice.total)}</dd>
                      </div>
                      <div>
                        <dt>Generated</dt>
                        <dd>{formatDisplayDateTime(invoice.createdAt)}</dd>
                      </div>
                    </dl>

                    <div className="history-downloads">
                      {invoice.excelAvailable ? (
                        <a href={invoice.files.excel} target="_blank" rel="noreferrer">
                          Excel
                        </a>
                      ) : (
                        <span className="history-file-missing">Excel missing</span>
                      )}
                      {invoice.pdfAvailable ? (
                        <a href={invoice.files.pdf} target="_blank" rel="noreferrer">
                          PDF
                        </a>
                      ) : (
                        <span className="history-file-missing">PDF missing</span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {(activeView === 'buyers' || activeView === 'items') && !adminToken ? (
        <section className="admin-auth-shell">
          <form className="panel admin-auth-panel" onSubmit={handleAdminLogin}>
            <div className="panel-header admin-auth-top">
              <p className="admin-auth-eyebrow">Restricted Workspace</p>
              <h2>Admin Login Required</h2>
              <p>Buyer and item management are protected. Set <code>ADMIN_PASSWORD</code> on the server for live use.</p>
            </div>

            <div className="admin-auth-note">
              <strong>Protected actions</strong>
              <p>Create, edit, and delete buyer and item master records.</p>
            </div>

            <label className="admin-auth-field">
              <span>Admin password</span>
              <div className="admin-auth-input-row">
                <input
                  type={showAdminPassword ? 'text' : 'password'}
                  value={adminPasswordInput}
                  onChange={(event) => setAdminPasswordInput(event.target.value)}
                  placeholder="Enter admin password"
                  autoComplete="current-password"
                />
                <button
                  className="text-button admin-auth-toggle"
                  type="button"
                  onClick={() => setShowAdminPassword((current) => !current)}
                >
                  {showAdminPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>

            <p className="hint-text admin-auth-hint">
              Local default is <code>admin123</code> until you configure <code>ADMIN_PASSWORD</code>.
            </p>
            {authError ? <p className="error-banner">{authError}</p> : null}

            <button className="primary-button admin-auth-submit" type="submit" disabled={authBusy}>
              {authBusy ? 'Signing in...' : 'Log in as admin'}
            </button>
          </form>
        </section>
      ) : null}

      {activeView === 'buyers' && adminToken ? (
        <section className="admin-grid">
          <section className="panel admin-list-panel">
            <div className="panel-header panel-header-row">
              <div>
                <h2>Buyers</h2>
                <p>Live master records stored in SQLite.</p>
              </div>
              <button className="secondary-button" type="button" onClick={startBuyerCreate}>
                New buyer
              </button>
            </div>

            <label className="search-field">
              <span>Search buyers</span>
              <input value={buyerSearch} onChange={(event) => setBuyerSearch(event.target.value)} placeholder="Search by code, name, GSTIN, city" />
            </label>

            <div className="admin-list">
              {filteredBuyers.map((buyer) => (
                <button
                  key={buyer.Buyer_Code}
                  className={`admin-list-card ${editingBuyerCode === buyer.Buyer_Code ? 'admin-list-card-active' : ''}`}
                  type="button"
                  onClick={() => startBuyerEdit(buyer)}
                >
                  <div>
                    <strong>{buyer.Buyer_Name}</strong>
                    <span>{buyer.Buyer_Code}</span>
                  </div>
                  <small>{buyer.GSTIN || 'No GSTIN saved'}</small>
                </button>
              ))}
            </div>
          </section>

          <form className="panel admin-form-panel" onSubmit={submitBuyer}>
            <div className="panel-header">
              <h2>{editingBuyerCode ? `Edit buyer ${editingBuyerCode}` : 'Create buyer'}</h2>
              <p>Changes save directly into the SQLite master database.</p>
            </div>

            <div className="admin-form-grid">
              <label>
                <span>Buyer code</span>
                <input
                  value={buyerForm.Buyer_Code}
                  onChange={(event) => setBuyerForm((current) => ({ ...current, Buyer_Code: event.target.value }))}
                  disabled={Boolean(editingBuyerCode)}
                  placeholder="B006"
                />
              </label>

              <label className="field-span-2">
                <span>Buyer name</span>
                <input
                  value={buyerForm.Buyer_Name}
                  onChange={(event) => setBuyerForm((current) => ({ ...current, Buyer_Name: event.target.value }))}
                  placeholder="New buyer name"
                />
              </label>

              <label className="field-span-2">
                <span>Address line 1</span>
                <input
                  value={buyerForm.Address_Line1}
                  onChange={(event) => setBuyerForm((current) => ({ ...current, Address_Line1: event.target.value }))}
                />
              </label>

              <label>
                <span>Address line 2</span>
                <input
                  value={buyerForm.Address_Line2}
                  onChange={(event) => setBuyerForm((current) => ({ ...current, Address_Line2: event.target.value }))}
                />
              </label>

              <label>
                <span>Address line 3</span>
                <input
                  value={buyerForm.Address_Line3}
                  onChange={(event) => setBuyerForm((current) => ({ ...current, Address_Line3: event.target.value }))}
                />
              </label>

              <label className="field-span-2">
                <span>City / State / PIN</span>
                <input
                  value={buyerForm.City_State_Pin}
                  onChange={(event) => setBuyerForm((current) => ({ ...current, City_State_Pin: event.target.value }))}
                />
              </label>

              <label>
                <span>GSTIN</span>
                <input
                  value={buyerForm.GSTIN}
                  onChange={(event) => setBuyerForm((current) => ({ ...current, GSTIN: event.target.value }))}
                />
              </label>

              <label>
                <span>Ship to name</span>
                <input
                  value={buyerForm.Ship_To_Name}
                  onChange={(event) => setBuyerForm((current) => ({ ...current, Ship_To_Name: event.target.value }))}
                />
              </label>

              <label className="field-span-2">
                <span>Ship to address</span>
                <input
                  value={buyerForm.Ship_To_Address}
                  onChange={(event) => setBuyerForm((current) => ({ ...current, Ship_To_Address: event.target.value }))}
                />
              </label>
            </div>

            {buyerError ? <p className="error-banner">{buyerError}</p> : null}
            {buyerStatus ? <p className="success-banner">{buyerStatus}</p> : null}

            <div className="admin-actions">
              <button className="primary-button" type="submit" disabled={savingBuyer}>
                {savingBuyer ? 'Saving buyer...' : editingBuyerCode ? 'Update buyer' : 'Create buyer'}
              </button>
              <button className="secondary-button" type="button" onClick={startBuyerCreate}>
                Clear form
              </button>
              {editingBuyerCode ? (
                <button className="danger-button" type="button" onClick={removeBuyer} disabled={savingBuyer}>
                  Delete buyer
                </button>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}

      {activeView === 'items' && adminToken ? (
        <section className="admin-grid">
          <section className="panel admin-list-panel">
            <div className="panel-header panel-header-row">
              <div>
                <h2>Items</h2>
                <p>Update rates and packing data without editing CSV files.</p>
              </div>
              <button className="secondary-button" type="button" onClick={startItemCreate}>
                New item
              </button>
            </div>

            <label className="search-field">
              <span>Search items</span>
              <input value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="Search by code, description, category, alias" />
            </label>

            <div className="admin-list">
              {filteredItems.map((item) => (
                <button
                  key={item.Item_Code}
                  className={`admin-list-card ${editingItemCode === item.Item_Code ? 'admin-list-card-active' : ''}`}
                  type="button"
                  onClick={() => startItemEdit(item)}
                >
                  <div>
                    <strong>{item.Description}</strong>
                    <span>{item.Item_Code}</span>
                  </div>
                  <small>{formatMoney(item.Gross_Rate)}</small>
                </button>
              ))}
            </div>
          </section>

          <form className="panel admin-form-panel" onSubmit={submitItem}>
            <div className="panel-header">
              <h2>{editingItemCode ? `Edit item ${editingItemCode}` : 'Create item'}</h2>
              <p>Rates saved here will immediately affect future invoices.</p>
            </div>

            <div className="admin-form-grid">
              <label>
                <span>Item code</span>
                <input
                  value={itemForm.Item_Code}
                  onChange={(event) => setItemForm((current) => ({ ...current, Item_Code: event.target.value }))}
                  disabled={Boolean(editingItemCode)}
                  placeholder="IT009"
                />
              </label>

              <label className="field-span-2">
                <span>Description</span>
                <input
                  value={itemForm.Description}
                  onChange={(event) => setItemForm((current) => ({ ...current, Description: event.target.value }))}
                />
              </label>

              <label>
                <span>HSN code</span>
                <input
                  value={itemForm.HSN_Code}
                  onChange={(event) => setItemForm((current) => ({ ...current, HSN_Code: event.target.value }))}
                />
              </label>

              <label>
                <span>Category</span>
                <input
                  value={itemForm.Category}
                  onChange={(event) => setItemForm((current) => ({ ...current, Category: event.target.value }))}
                />
              </label>

              <label>
                <span>Gross rate</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={itemForm.Gross_Rate}
                  onChange={(event) => setItemForm((current) => ({ ...current, Gross_Rate: event.target.value }))}
                />
              </label>

              <label>
                <span>Non-taxable rate</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={itemForm.Non_Taxable_Rate}
                  onChange={(event) =>
                    setItemForm((current) => ({ ...current, Non_Taxable_Rate: event.target.value }))
                  }
                />
              </label>

              <label>
                <span>Bottles per bag</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={itemForm.Bottles_Per_Bag}
                  onChange={(event) =>
                    setItemForm((current) => ({ ...current, Bottles_Per_Bag: event.target.value }))
                  }
                />
              </label>

              <label className="field-span-2">
                <span>Dad writes as</span>
                <input
                  value={itemForm.Dad_Writes_As}
                  onChange={(event) => setItemForm((current) => ({ ...current, Dad_Writes_As: event.target.value }))}
                />
              </label>
            </div>

            {itemError ? <p className="error-banner">{itemError}</p> : null}
            {itemStatus ? <p className="success-banner">{itemStatus}</p> : null}

            <div className="admin-actions">
              <button className="primary-button" type="submit" disabled={savingItem}>
                {savingItem ? 'Saving item...' : editingItemCode ? 'Update item' : 'Create item'}
              </button>
              <button className="secondary-button" type="button" onClick={startItemCreate}>
                Clear form
              </button>
              {editingItemCode ? (
                <button className="danger-button" type="button" onClick={removeItem} disabled={savingItem}>
                  Delete item
                </button>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}
    </main>
  )
}

export default App
