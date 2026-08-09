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

  function setEwayDistance(invoiceKey, value) {
    const sanitized = String(value || '').replace(/[^\d]/g, '').slice(0, 4)
    setEwayDistanceOverrides((current) => ({
      ...current,
      [invoiceKey]: sanitized,
    }))
  }

  function getEwayDistance(invoice) {
    return ewayDistanceOverrides[invoice.invoiceKey] ?? (invoice.distanceKm ? String(invoice.distanceKm) : '')
  }

  function buildEwayJsonUrl(invoice) {
    const params = new URLSearchParams()
    const distance = getEwayDistance(invoice)
    if (distance) {
      params.set('distanceKm', distance)
    }

    return `/api/eway/invoices/${encodeURIComponent(invoice.invoiceKey)}/bulk-json?${params.toString()}`
  }

  async function downloadEwayJson(invoice, setDownloadError = setDefaultDownloadError) {
    const downloaded = await downloadProtectedFile(
      buildEwayJsonUrl(invoice),
      `${invoice.invoiceKey}-eway.json`,
      setDownloadError,
    )
    if (downloaded) {
      window.open(ewayBillPortalUrl, '_blank', 'noopener,noreferrer')
    }
  }

  function getEwayDownloadState(invoice) {
    if (!invoice?.pdfAvailable) {
      return { canDownload: false, reason: 'PDF missing', readiness: null, needsDistanceInput: false }
    }

    const readiness = ewayReadinessByKey.get(invoice.invoiceKey)
    if (!readiness) {
      return { canDownload: false, reason: ewayLoading ? 'Checking readiness' : 'Readiness unavailable', readiness: null, needsDistanceInput: false }
    }

    const distance = Number(getEwayDistance(readiness))
    const unresolved = (readiness.missingFields || []).filter((field) => field !== 'distance_km')
    const needsDistanceInput = (readiness.missingFields || []).includes('distance_km') && unresolved.length === 0

    if (unresolved.length) {
      return { canDownload: false, reason: `Missing ${unresolved.join(', ')}`, readiness, needsDistanceInput: false }
    }
    if (!Number.isFinite(distance) || distance <= 0) {
      return { canDownload: false, reason: 'Missing distance', readiness, needsDistanceInput }
    }

    return { canDownload: true, reason: '', readiness, needsDistanceInput }
  }

  function renderEwayJsonAction(invoice) {
    const state = getEwayDownloadState(invoice)
    const readiness = state.readiness

    if (state.needsDistanceInput) {
      const distanceValue = readiness ? getEwayDistance(readiness) : ''
      return (
        <div className="eway-distance-action history-action-eway">
          <input
            aria-label={`Distance KM for ${invoice.invoiceNumber}`}
            inputMode="numeric"
            min="1"
            pattern="[0-9]*"
            placeholder="KM"
            value={distanceValue}
            onChange={(event) => setEwayDistance(readiness.invoiceKey, event.target.value)}
          />
          <button
            className="text-button"
            type="button"
            onClick={() => downloadEwayJson(readiness, setHistoryError)}
            disabled={!Number(distanceValue)}
          >
            E-way JSON
          </button>
        </div>
      )
    }

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
    clearEwayReadiness,
    downloadEwayJson,
    ewayError,
    ewayLoading,
    getEwayDistance,
    getEwayDownloadState,
    refreshEwayReadiness,
    renderEwayJsonAction,
    setEwayDistance,
  }
}

export { useEwayReadiness }
