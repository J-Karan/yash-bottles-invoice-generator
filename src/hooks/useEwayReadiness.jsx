import { useMemo, useState } from 'react'

const ewayBillPortalUrl = 'https://ewaybillgst.gov.in/Login.aspx'

function useEwayReadiness({
  appFetch,
  downloadProtectedFile,
  readResponseJson,
  setDefaultDownloadError,
  setHistoryError,
}) {
  const [ewayReadiness, setEwayReadiness] = useState([])
  const [ewaySummary, setEwaySummary] = useState({ total: 0, ready: 0, needsInput: 0 })
  const [ewayLoading, setEwayLoading] = useState(false)
  const [ewayError, setEwayError] = useState('')
  const [ewayDistanceOverrides, setEwayDistanceOverrides] = useState({})

  const ewayReadinessByKey = useMemo(
    () => new Map(ewayReadiness.map((invoice) => [invoice.invoiceKey, invoice])),
    [ewayReadiness],
  )

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

  function clearEwayReadiness() {
    setEwayReadiness([])
    setEwayDistanceOverrides({})
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

  function downloadEwayJson(invoice, setDownloadError = setDefaultDownloadError) {
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

  return {
    canDownloadEwayJson,
    clearEwayReadiness,
    downloadEwayJson,
    ewayError,
    ewayLoading,
    ewayReadiness,
    ewaySummary,
    getEwayDownloadState,
    refreshEwayReadiness,
    renderEwayJsonAction,
    updateEwayDistance,
  }
}

export { useEwayReadiness }
