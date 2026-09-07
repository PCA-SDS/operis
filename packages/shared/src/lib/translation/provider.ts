/**
 * The port every translation engine plugs into.
 *
 * Deliberately narrow. Everything an engine could plausibly want to expose --
 * model selection, beam width, glossaries, formality -- is either configuration
 * it owns privately or a later phase. What callers need is: turn this text into
 * that language, and tell me what you think it was.
 */

/** ISO-639-1, or BCP-47 when a region genuinely matters ("pt-BR"). */
export type TranslationLocale = string

export type TranslationRequest = {
  text: string
  targetLocale: TranslationLocale
  /**
   * Omitted when unknown, which is the normal case. Chat messages are short and
   * often ambiguous, so the engine's own detection is more trustworthy than
   * anything the caller could guess -- and one detector beats two disagreeing.
   */
  sourceLocale?: TranslationLocale
}

export type TranslationResult = {
  body: string
  /** What the engine decided the input was. */
  sourceLocale: TranslationLocale
  /** Registry key of the engine that produced this. */
  provider: string
  /**
   * Model identity. A translation is only reproducible against the weights that
   * made it, so a cache without this cannot tell two vintages apart after an
   * upgrade.
   */
  modelRevision?: string
}

export type TranslationProvider = {
  /** Stable key, recorded on every row this engine writes. */
  readonly id: string
  /**
   * What this engine's answers may be cached against.
   *
   * Declared by the provider rather than read from a result, because a cache
   * lookup happens BEFORE any call is made — a revision only learned from a
   * response cannot key the read that was supposed to avoid it. Operator-set
   * for the self-hosted engine, so changing the model image and bumping this
   * together is what retires the previous vintage; leaving it unset means the
   * cache can never distinguish two, which is a deployment choice rather than a
   * silent default.
   */
  readonly revision?: string
  /**
   * Pairs the engine can actually serve, as `from:to`, or `'*'` for "any pair it
   * is asked for". Checked before a request is made so an unsupported pair fails
   * as a clear refusal rather than as confident nonsense.
   */
  supports(sourceLocale: TranslationLocale | undefined, targetLocale: TranslationLocale): boolean
  translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult>
  /**
   * What language a text is, without translating it.
   *
   * Optional, because not every engine can answer it separately. Where it can,
   * a caller translating several runs of one message detects ONCE on the whole
   * message rather than asking about each fragment — fragments are exactly
   * where detection is least reliable, and disagreement between them would
   * translate one sentence from two different languages.
   */
  detect?(text: string, signal?: AbortSignal): Promise<{ sourceLocale: string; confidence: number; supported: boolean }>
  /** Liveness, for the integrations health surface. */
  healthcheck?(): Promise<{ ok: boolean; detail?: string }>
}

/**
 * Registry, held on `globalThis` for the same reason the LLM and gateway
 * registries are: module bootstrap runs more than once under Next's dev server,
 * and a module-scoped Map would silently end up with two copies.
 */
const REGISTRY_KEY = '__openMercatoTranslationProviders__'

type RegistryState = { providers: Map<string, TranslationProvider>; defaultId: string | null }

function state(): RegistryState {
  const store = globalThis as unknown as Record<string, RegistryState | undefined>
  let existing = store[REGISTRY_KEY]
  if (!existing) {
    existing = { providers: new Map(), defaultId: null }
    store[REGISTRY_KEY] = existing
  }
  return existing
}

export function registerTranslationProvider(
  provider: TranslationProvider,
  options?: { asDefault?: boolean },
): void {
  const registry = state()
  registry.providers.set(provider.id, provider)
  // First one registered wins the default unless a later one claims it, so a
  // single-provider deployment needs no configuration at all.
  if (options?.asDefault || registry.defaultId === null) registry.defaultId = provider.id
}

export function getTranslationProvider(id?: string | null): TranslationProvider | null {
  const registry = state()
  const key = id ?? registry.defaultId
  if (!key) return null
  return registry.providers.get(key) ?? null
}

export function listTranslationProviders(): TranslationProvider[] {
  return [...state().providers.values()]
}

/** Test seam. Never called by application code. */
export function resetTranslationProviders(): void {
  const registry = state()
  registry.providers.clear()
  registry.defaultId = null
}
