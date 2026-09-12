// The wrapper can only write the warmup-ready marker while it pipes the
// runtime's stdout: the targeted /login + /backend warmup is driven from that
// line handler. Raw passthrough (`--classic`, `--verbose`) inherits stdio, so
// no warmup runs and no marker is ever written. Advertising the path anyway
// parks queue workers and the scheduler in `mercato server:dev` for the full
// OM_DEV_WARMUP_READY_TIMEOUT_MS (5 minutes by default).
export function resolveWarmupReadyFile({ rawPassthrough, envValue, splashChildStateFile }) {
  if (rawPassthrough) return null
  const configured = typeof envValue === 'string' ? envValue.trim() : ''
  if (configured) return configured
  return splashChildStateFile ? `${splashChildStateFile}.warmup-ready` : null
}

export function applyWarmupReadyFileEnv(env, warmupReadyFile) {
  if (warmupReadyFile) env.OM_DEV_WARMUP_READY_FILE = warmupReadyFile
  else delete env.OM_DEV_WARMUP_READY_FILE
  return env
}
