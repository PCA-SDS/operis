export function startOfNextQuarter(baseDate: Date): Date {
  const year = baseDate.getFullYear()
  const currentQuarter = Math.floor(baseDate.getMonth() / 3)
  const nextQuarter = currentQuarter + 1
  if (nextQuarter >= 4) return new Date(year + 1, 0, 1, 10, 0, 0, 0)
  return new Date(year, nextQuarter * 3, 1, 10, 0, 0, 0)
}
