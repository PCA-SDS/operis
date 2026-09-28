/**
 * Argument parsing for module `cli.ts` commands.
 *
 * Eighteen commands each carried a private parser. They agree on the valid
 * forms — `--key value`, `--key=value` and a bare `--flag` — and differ only on
 * malformed input, so the variants that behave differently stay distinct here
 * rather than being folded into one: an operator's script that relies on how
 * `--tenant ""` or a trailing bare flag is read keeps working.
 */
export type CliArgs = Record<string, string | boolean>

export type ParseCliArgsOptions = {
  /**
   * Record `--key ""` as the empty string. By default an empty value does not
   * count as one, so the flag reads as bare (`true`).
   */
  keepEmptyValues?: boolean
}

/**
 * Parse `--key value`, `--key=value` and bare `--flag` (recorded as `true`).
 * Everything before the first `=` is the key and the next segment is the value,
 * so `--key=a=b` reads `a`. Tokens that do not start with `--` are skipped.
 */
export function parseCliArgs(rest: string[], options: ParseCliArgsOptions = {}): CliArgs {
  const args: CliArgs = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part?.startsWith('--')) continue
    const [rawKey, rawValue] = part.slice(2).split('=')
    if (!rawKey) continue
    if (rawValue !== undefined) {
      args[rawKey] = rawValue
      continue
    }
    const next = rest[index + 1]
    const hasNext = options.keepEmptyValues ? next !== undefined : Boolean(next)
    if (hasNext && !next!.startsWith('--')) {
      args[rawKey] = next!
      index += 1
      continue
    }
    args[rawKey] = true
  }
  return args
}

/**
 * Like {@link parseCliArgs}, but a flag without a value is ignored rather than
 * recorded, so every entry is a string. A later bare repeat of a key leaves the
 * earlier value in place.
 */
export function parseCliValueArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part?.startsWith('--')) continue
    const [rawKey, rawValue] = part.slice(2).split('=')
    if (rawValue !== undefined) {
      args[rawKey] = rawValue
      continue
    }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[rawKey] = next
      index += 1
    }
  }
  return args
}

/** First of the keys holding a non-blank string, trimmed. */
export function stringOption(args: CliArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

/** First of the keys holding a finite number (or a string that parses to one). */
export function numberOption(args: CliArgs, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

/** The value floored to an integer when it is positive, otherwise `undefined`. */
export function toPositiveInt(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  const floored = Math.floor(value)
  if (!Number.isFinite(floored) || floored <= 0) return undefined
  return floored
}

/** The value floored to an integer when it is zero or more, otherwise the fallback. */
export function toNonNegativeInt(value: number | undefined, fallback = 0): number {
  if (value === undefined) return fallback
  const floored = Math.floor(value)
  if (!Number.isFinite(floored) || floored < 0) return fallback
  return floored
}
