let pending = Promise.resolve()

// Keep number selection, artifact publication and deletion in one ordered lane.
export function withInvoiceMutation(callback) {
  const result = pending.then(callback)
  pending = result.catch(() => {})
  return result
}
