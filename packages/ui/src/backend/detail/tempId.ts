export function generateTempId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `tmp_${Math.random().toString(36).slice(2)}`
}
