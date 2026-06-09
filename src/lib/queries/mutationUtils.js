/** True when a mutation is in flight; optional match narrows to a specific row/action. */
export function isMutating(mutation, match) {
  if (!mutation?.isPending) return false
  if (!match || mutation.variables == null) return true
  return match(mutation.variables)
}

/** Returns a key from pending mutation variables, or null when idle. */
export function mutatingKey(mutation, keyFn) {
  if (!mutation?.isPending || mutation.variables == null) return null
  return keyFn(mutation.variables)
}
