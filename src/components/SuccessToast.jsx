import { useEffect } from 'react'

function SuccessToast({ message, visible, onDismiss }) {
  useEffect(() => {
    if (!visible) {
      return undefined
    }

    const timeoutId = window.setTimeout(onDismiss, 4000)
    return () => window.clearTimeout(timeoutId)
  }, [onDismiss, visible])

  if (!visible || !message) {
    return null
  }

  return (
    <div className="success-toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification">
        x
      </button>
    </div>
  )
}

export { SuccessToast }
