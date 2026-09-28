import { parseBooleanToken } from './boolean'

/** The first of `keys` set to a non-blank value, trimmed; `undefined` when none is. */
export function readEnvValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return undefined
}

/** The first of `keys` holding a recognisable boolean token; `undefined` when none does. */
export function readBooleanEnv(env: NodeJS.ProcessEnv, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const parsed = parseBooleanToken(env[key])
    if (parsed !== null) return parsed
  }
  return undefined
}
