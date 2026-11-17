import { useEffect, useRef } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let activeModalCount = 0
let originalOverflow = ''

function useModalTrap(containerRef, onClose) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return undefined
    }

    const previousFocus = document.activeElement
    if (activeModalCount === 0) {
      originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    activeModalCount += 1
    const focusableElements = getFocusableElements(container)
    const firstElement = focusableElements[0] || container
    firstElement.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const currentFocusableElements = getFocusableElements(container)
      if (!currentFocusableElements.length) {
        event.preventDefault()
        container.focus()
        return
      }

      const firstFocusable = currentFocusableElements[0]
      const lastFocusable = currentFocusableElements[currentFocusableElements.length - 1]

      if (event.shiftKey && (document.activeElement === firstFocusable || document.activeElement === container || !container.contains(document.activeElement))) {
        event.preventDefault()
        lastFocusable.focus()
      } else if (!event.shiftKey && (document.activeElement === lastFocusable || !container.contains(document.activeElement))) {
        event.preventDefault()
        firstFocusable.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      activeModalCount = Math.max(0, activeModalCount - 1)
      if (activeModalCount === 0) {
        document.body.style.overflow = originalOverflow
      }
      if (
        previousFocus &&
        typeof previousFocus.focus === 'function' &&
        document.contains(previousFocus)
      ) {
        previousFocus.focus()
      }
    }
  }, [containerRef])
}

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(focusableSelector)).filter((element) => {
    const style = window.getComputedStyle(element)
    return style.visibility !== 'hidden' && style.display !== 'none' && element.getClientRects().length > 0
  })
}

export { useModalTrap }
