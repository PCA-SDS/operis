export function now(): number {
  return typeof performance !== 'undefined' && performance.now
    ? Math.round(performance.timeOrigin + performance.now())
    : Date.now()
}
