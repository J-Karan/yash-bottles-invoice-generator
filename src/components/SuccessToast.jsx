import { useEffect, useRef } from 'react'

function SuccessToast({ message, visible, onDismiss }) {
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (!visible) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => onDismissRef.current(), 4000)
    return () => window.clearTimeout(timeoutId)
  }, [message, visible])

  if (!visible || !message) {
    return null
  }

  return (
    <div className="success-toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification">
        &times;
      </button>
    </div>
  )
}

export { SuccessToast }
