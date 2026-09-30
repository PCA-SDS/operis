export function formatTpsPhone(phone: string, countryCode: string): string {
  const digits = phone.replace(/\D/g, '')
  const code = countryCode.replace(/\D/g, '')
  if (!digits || !code) return phone.trim()
  return `+${code} ${digits}`
}
